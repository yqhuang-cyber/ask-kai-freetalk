import { REPLY_POLICY_VERSION } from './reply-policy.js';
import { randomUUID } from 'node:crypto';
import { planningCapabilities } from './skill-catalog.js';
import { immutable } from '../contracts/planning.js';
import { fallbackDecision,FALLBACK_POLICY_VERSION } from './fallback-policy.js';
import { ObservationCoordinator } from './observation-port.js';
import { boundedProposal } from './planner-port.js';
import { contextRefs,validateTurn,planHash } from './plan-validator.js';
import { goalChoice,eligibleGoal,assessGoal,GOAL_POLICY_VERSION } from './goal-lifecycle.js';
export const TURN_PLANNING_BUDGET_MS=2000;
export const TURN_PLANNING_COMMIT_RESERVE_MS=200;
export function conservativeTurn(input) {
  const d=fallbackDecision(input),p=input.policy;
  return {interpretation:{intent:d.code,clarity:d.action==='CLARIFY'?'ambiguous':'unknown',refs:[input.turn.source_event_id]},prior_outcome:{execution_ref:input.prior_execution?.execution_id??null,status:input.prior_execution?.status??'none',unknown:['学生理解与完整播放未知']},goal_assessment:null,action:d.action,active_goal_id:null,local_help_target:d.localHelp?'回应本轮表达求助':null,reply_directive:{task:d.task,support_level:d.support,new_points:0,budget_ref:REPLY_POLICY_VERSION},expected_observation:{kind:d.action==='CLOSE'?'student_choice':'conversation_continuity',required_student_answer:null},proposed_plan_patch:p.teaching_paused?'pause':d.easier?{op:'replace',goal_id:d.easier.id,refs:[input.turn.source_event_id]}:null,evidence_refs:[input.turn.source_event_id],rationale_code:d.code};
}
export class PlanningState {
  constructor({plan,context,resource,planner,observations,resourceVerifier,mode=plan.execution_mode,clock=()=>Date.now(),budgetMs=TURN_PLANNING_BUDGET_MS,onRecord=()=>{},onAcceptedProposal,observationPort}) {
    if(plan.mode==='free'&&resource!=null)throw new Error('FREE_RESOURCE_FORBIDDEN');
    if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>TURN_PLANNING_BUDGET_MS)throw new Error('INVALID_TURN_PLANNING_BUDGET');
    Object.assign(this,{plan,context,resource,planner,observations,resourceVerifier,mode,clock,budgetMs,onRecord,onAcceptedProposal,observationPort});this.observationCoordinator=new ObservationCoordinator({port:observationPort,clock});this.sessionDeclinedGoals=new Set();this.transitions=[];this.goalOutcomes=new Map();this.controlInputs=new Map();this.difficulties=[];this.localHelp=null;if(plan.primary_goal)this.goalOutcomes.set(plan.primary_goal.id,{goal:plan.primary_goal,status:plan.goal_status});this.revision=1;this.authorizationEpoch=1;this.closed=false;this.inputs=new Map();this.records=[];this.history=[];this.executions=new Map();this.current=null;this.accepted=null;this.controller=null;
  }
  get capabilities(){return planningCapabilities(this.plan,this.resource);}
  noteInput(event) {
    if(this.closed||event.session_id!==this.plan.session_id||event.type!=='user.final')return;
    this.acceptedInputTimes??=new Map();
    const previous=this.acceptedInputTimes.get(event.turn_id);
    if(previous?.source_event_id===event.event_id)return previous.accepted_at;
    if(!previous&&this.acceptedInputTimes.size>=1000)throw new Error('PLANNING_TURN_LIMIT');
    const accepted_at=this.clock();this.acceptedInputTimes.set(event.turn_id,{source_event_id:event.event_id,accepted_at});return accepted_at;
  }
  emit(name,fields={}){this.onRecord(name,{planning_revision:this.revision,path:this.mode,...fields});}
  invalidate(reason='new_input') {this.revision++;this.controller?.abort();this.observationCoordinator.cancel(reason);this.accepted=null;this.localHelp=null;this.emit('planning.cancelled',{reason});}
  review() {
    const rows=[...this.observations?.observations.values()??[]];
    return immutable({policy_version:GOAL_POLICY_VERSION,fallback_policy_version:FALLBACK_POLICY_VERSION,session_declined_goal_ids:[...this.sessionDeclinedGoals],difficulty_count:this.difficulties.length,assessment:this.plan.primary_goal?assessGoal(this.plan.primary_goal,rows):null,observed_attempts:rows.filter(o=>o.goal_id===this.plan.primary_goal?.id).slice(-12).map(o=>({observation_id:o.observation_id,source_event_id:o.source_event_id,support:o.support,semantic_review:'unverified'})),transitions:this.transitions.slice(-6)});
  }
  commitGoal(status,{goal=this.plan.primary_goal,reason='policy',source=null}={}) {
    if(this.mode==='shadow'||this.closed)return;
    if(!['active','paused','retired'].includes(status)||status!=='retired'&&!goal)return;
    if(goal?.id===this.plan.primary_goal?.id&&status===this.plan.goal_status)return;
    this.observationCoordinator.cancel('goal_revised');
    const old=this.plan.primary_goal;
    if(old&&old.id!==goal?.id)this.goalOutcomes.set(old.id,{goal:old,status:'retired'});
    if(goal)this.goalOutcomes.set(goal.id,{goal,status});
    const {hash,...base}=this.plan;
    const task=goal?(old?.id===goal.id?(base.teaching_decision?.task??base.goal_instance?.task??goal.start_tip):goal.start_tip):'跟随学生当前选择交流';
    const next={...base,revision:base.revision+1,primary_goal:goal,primary_goal_id:goal?.id??null,key_points:goal?.kp_ids??[],candidate_goal_ids:[],goal_status:status,resource_refs:this.resource?[{id:this.resource.id,version:this.resource.version,...(this.resource.hash?{hash:this.resource.hash}:{})}]:[],selection_basis:[{reason,refs:source?[source]:[this.context.snapshot_id]}]};
    if(base.mode==='free'){next.skill_catalog_ref={id:this.capabilities.id,version:this.capabilities.version};next.goal_instance=goal?{schema_version:'goal-instance-v1',instance_id:old?.id===goal.id&&base.goal_instance?base.goal_instance.instance_id:randomUUID(),skill_id:goal.kp_ids[0],catalog_ref:next.skill_catalog_ref,task,support_level:base.strategy.support_level,observation:'unassessed'}:null;}
    else if(base.schema_version==='conversation-plan-v2'){next.goal_instance=goal?{schema_version:'goal-instance-v1',instance_id:old?.id===goal.id&&base.goal_instance?base.goal_instance.instance_id:randomUUID(),skill_id:goal.kp_ids[0],resource_ref:{id:this.resource.id,version:this.resource.version,hash:this.resource.hash},task,support_level:base.strategy.support_level,observation:'unassessed'}:null;}
    if(base.teaching_decision){next.teaching_decision={...base.teaching_decision,plan_kind:goal&&status==='active'?'targeted_practice':'supportive_conversation',no_goal_reason:goal?null:'conversation_preference',task,needs:goal?[{skill_id:goal.kp_ids[0],refs:source?[source]:[this.context.snapshot_id],reason}]:[]};}
    this.plan=immutable({...next,hash:planHash(next)});
    this.transitions.push({from:old?.id??null,to:goal?.id??null,status,reason,source_event_id:source,plan_revision:next.revision});this.transitions=this.transitions.slice(-100);
    this.emit('conversation_plan.revised',{plan_revision:next.revision,goal_status:status,reason});
  }
  controls(event,policy) {
    if(this.mode==='shadow'||this.closed||event.session_id!==this.plan.session_id||this.controlInputs.get(event.turn_id)===event.event_id)return;
    this.controlInputs.set(event.turn_id,event.event_id);this.localHelp=null;this.accepted=null;if(this.current?.source_event_id!==event.event_id)this.controller?.abort();
    const choice=goalChoice(event.payload.text,this.capabilities);
    if(policy.action==='CLOSE'||['student_declined','student_changed_topic'].includes(policy.reason)) {
      if(policy.reason==='student_declined'&&this.plan.primary_goal)this.sessionDeclinedGoals.add(this.plan.primary_goal.id);
      this.difficulties=[];if(this.plan.primary_goal)this.commitGoal('paused',{reason:policy.reason,source:event.event_id});
    }
    if(policy.action==='CLOSE')return;
    if(choice.kind==='retire') {if(this.plan.primary_goal)this.sessionDeclinedGoals.add(this.plan.primary_goal.id);this.commitGoal('retired',{goal:null,reason:'student_cancelled_goal',source:event.event_id});this.difficulties=[];return;}
    if(choice.kind==='select'&&!this.resourceUnavailable) {
      const goal=this.capabilities?.goals.find(g=>g.id===choice.goal_id);
      if(eligibleGoal(goal,this.context,this.capabilities,{explicit:true})) {this.sessionDeclinedGoals.delete(goal.id);this.commitGoal('active',{goal,reason:'student_selected_goal',source:event.event_id});this.difficulties=[];}
      else if(this.plan.primary_goal)this.commitGoal('paused',{reason:'requested_goal_unverified',source:event.event_id});
      return;
    }
    if(this.plan.primary_goal&&this.plan.goal_status==='paused'&&!policy.teaching_paused&&['student_requested_practice','student_requested_help'].includes(policy.reason)&&eligibleGoal(this.plan.primary_goal,this.context,this.capabilities,{explicit:true})){this.sessionDeclinedGoals.delete(this.plan.primary_goal.id);this.commitGoal('active',{reason:'student_resumed_goal',source:event.event_id});}
    if(choice.kind==='difficulty'&&this.plan.primary_goal&&this.plan.goal_status==='active') {
      this.difficulties.push({turn_id:event.turn_id,source_event_id:event.event_id});this.difficulties=this.difficulties.slice(-2);
    } else this.difficulties=[];
  }
  reduceSupport(event) {
    if(this.mode==='shadow'||this.plan.goal_status!=='active'||!this.observations?.observations.has(event.turn_id)||this.plan.strategy.support_level!=='model')return;
    const {hash,...base}=this.plan,next={...base,revision:base.revision+1,strategy:{...base.strategy,support_level:'partial'}};
    this.plan=immutable({...next,hash:planHash(next)});this.emit('conversation_plan.revised',{plan_revision:next.revision,reason:'reduce_support_after_attempt'});
  }
  async acceptInput(event,policy,language) {
    if(this.closed||event.session_id!==this.plan.session_id||event.type!=='user.final')return null;
    const previous=this.inputs.get(event.turn_id);
    if(previous?.text===event.payload.text)return null;
    if(this.inputs.size>=1000)throw new Error('PLANNING_TURN_LIMIT');
    const startedAt=this.noteInput(event),reserve=Math.min(TURN_PLANNING_COMMIT_RESERVE_MS,Math.max(1,Math.floor(this.budgetMs/10)));
    this.invalidate(previous?'input_corrected':'new_input');
    const input=immutable({turn_id:event.turn_id,source_event_id:event.event_id,text:event.payload.text,input_revision:(previous?.input_revision??0)+1,expires_at:startedAt+this.budgetMs,revision:this.revision,authorization_epoch:this.authorizationEpoch});
    this.inputs.set(event.turn_id,input);this.current=input;this.controls(event,policy);const controller=new AbortController();this.controller=controller;
    const expired=()=> {
      if(this.clock()<input.expires_at)return false;
      controller.abort();if(this.current===input)this.observationCoordinator.cancel('superseded');
      const elapsed_ms=Math.max(0,this.clock()-startedAt);
      this.records.push({input_ref:event.event_id,turn_id:input.turn_id,input_revision:input.input_revision,status:'expired',elapsed_ms});
      this.emit('planning.rejected',{turn_id:input.turn_id,reason:'stale',elapsed_ms});return true;
    };
    if(expired())return null;
    if(this.resource?.schema_version==='topic-pack-v1'&&this.resourceVerifier) {
      let timer;
      try {
        await Promise.race([this.resourceVerifier(this.resource,{signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('TOPIC_READ_TIMEOUT')),Math.max(1,input.expires_at-this.clock()-reserve));})]);
        if(this.closed||controller.signal.aborted||this.current!==input||this.revision!==input.revision)return null;
        if(expired())return null;
      } catch {
        if(this.closed||controller.signal.aborted||this.current!==input||this.revision!==input.revision)return null;
        this.resourceUnavailable=true;this.commitGoal('retired',{goal:null,reason:'topic_unavailable',source:event.event_id});this.localHelp=null;
      } finally {clearTimeout(timer);}
    }
    policy={...policy,teaching_paused:this.plan.goal_status==='paused'||this.plan.goal_status==='retired'||policy.teaching_paused&&this.plan.goal_status!=='active'};
    this.history=this.history.filter(h=>h.turn_id!==event.turn_id);
    const prior=[...this.executions.values()].at(-1)??null;
    const snapshot=immutable({plan:this.plan,turn:input,policy,language,learner_feedback:this.observations?.feedback.get(event.turn_id)??null,actual_context:this.history.slice(-12),prior_execution:prior?{execution_id:prior.execution_id,status:prior.status,consumption:prior.consumption,generation_basis:prior.generation_basis}:null,student_profile:this.context.student_profile,learning_profile:this.context.learning_profile,learning_history:this.context.learning_history,coverage:this.context.coverage,resource:this.resource,...(this.plan.mode==='free'?{skill_catalog:this.capabilities}:{}),goal_review:this.review()});
    // Shadow observation never changes Planner input, goals, attempts or saved facts.
    this.observationWork=this.observationCoordinator.start(snapshot,{signal:controller.signal,isCurrent:()=>!this.closed&&this.current===input&&this.revision===input.revision&&this.authorizationEpoch===input.authorization_epoch&&this.plan.revision===snapshot.plan.revision});
    this.history.push({turn_id:input.turn_id,source_event_id:event.event_id,role:'student',text:input.text});this.history=this.history.slice(-12);
    const allowedRefs=contextRefs(this.context,this.capabilities);allowedRefs.add(event.event_id);for(const o of this.observations?.observations.values()??[]){allowedRefs.add(o.observation_id);allowedRefs.add(o.source_event_id);}for(const h of snapshot.actual_context){allowedRefs.add(h.source_event_id);if(h.execution_id)allowedRefs.add(h.execution_id);}if(prior)allowedRefs.add(prior.execution_id);
    this.emit('planning.started',{turn_id:input.turn_id,input_revision:input.input_revision});
    const base={input_ref:event.event_id,turn_id:input.turn_id,input_revision:input.input_revision,based_on_plan_revision:this.plan.revision,base_planning_revision:input.revision,authorization_epoch:this.authorizationEpoch};
    let result;
    try {
      if(policy.action==='CLOSE'||this.resourceUnavailable)result={proposal:validateTurn(conservativeTurn(snapshot),{plan:this.plan,input,policy,allowedRefs,context:this.context,resource:this.resource,priorExecution:snapshot.prior_execution,review:snapshot.goal_review,now:this.clock()}),planner_kind:'rule',degraded_reason:null};
      else if(input.expires_at-this.clock()<=reserve)result={proposal:validateTurn(conservativeTurn(snapshot),{plan:this.plan,input,policy,allowedRefs,context:this.context,resource:this.resource,priorExecution:snapshot.prior_execution,review:snapshot.goal_review,now:this.clock()}),planner_kind:'rule',degraded_reason:'planner_timeout',attempts:[]};
      else result=await boundedProposal({planner:this.planner,method:'planTurn',input:snapshot,signal:controller.signal,budgetMs:input.expires_at-this.clock()-reserve,deadlineAt:input.expires_at-reserve,clock:this.clock,validate:p=>validateTurn(p,{plan:this.plan,input,policy,allowedRefs,context:this.context,resource:this.resource,priorExecution:snapshot.prior_execution,review:snapshot.goal_review,now:this.clock()}),fallback:()=>conservativeTurn(snapshot)});
    } catch {if(this.current===input&&expired())return null;const elapsed_ms=Math.max(0,this.clock()-startedAt);this.records.push({...base,status:'cancelled',elapsed_ms});this.emit('planning.cancelled',{turn_id:input.turn_id,elapsed_ms});return null;}
    if(this.closed||controller.signal.aborted||this.current!==input||this.revision!==input.revision){this.records.push({...base,status:'stale'});this.emit('planning.rejected',{turn_id:input.turn_id,reason:'stale'});return null;}
    if(expired())return null;
    const proposal={schema_version:'turn-plan-v1',proposal_id:randomUUID(),session_id:this.plan.session_id,...base,...result.proposal,planner_kind:result.planner_kind,degraded_reason:result.degraded_reason,accepted_at:this.clock(),expires_at:input.expires_at};
    const accepted=immutable({...proposal,hash:planHash(proposal)});
    if(expired())return null;
    this.records.push({proposal_id:accepted.proposal_id,...base,status:this.mode==='shadow'?'shadow':'accepted',elapsed_ms:Math.max(0,this.clock()-startedAt),planner_kind:accepted.planner_kind,degraded_reason:accepted.degraded_reason,attempts:result.attempts??[],hash:accepted.hash});
    // Opt-in evaluation hook: immutable input is captured before any proposal patch.
    // Default production sessions do not retain input snapshots or write files.
    try{this.onAcceptedProposal?.(immutable({input_snapshot:snapshot,plan:accepted}));}catch{}
    if(this.mode!=='shadow') {
      const patch=accepted.proposed_plan_patch;
      if(policy.teaching_paused||patch==='pause')this.commitGoal('paused',{reason:'accepted_pause',source:event.event_id});
      else if(patch==='resume')this.commitGoal('active',{reason:'accepted_resume',source:event.event_id});
      else if(patch?.op==='replace')this.commitGoal('active',{goal:this.capabilities.goals.find(g=>g.id===patch.goal_id),reason:'accepted_goal_replacement',source:event.event_id});
      else if(patch?.op==='retire')this.commitGoal('retired',{goal:null,reason:'accepted_goal_retirement',source:event.event_id});
      this.localHelp=accepted.local_help_target?{text:accepted.local_help_target,turn_id:input.turn_id,source_event_id:event.event_id}:null;
      this.accepted=accepted;
    }
    this.emit('planning.accepted',{turn_id:input.turn_id,elapsed_ms:Math.max(0,this.clock()-startedAt),planner_kind:accepted.planner_kind,degraded:!!accepted.degraded_reason,rejection_code:(result.attempts??[]).filter(a=>a.state==='rejected').at(-1)?.code});return this.mode==='shadow'?null:accepted;
  }
  updateContext(context) {
    if(this.closed)return;this.invalidate('preferences_changed');this.context=context;
    const {hash,...base}=this.plan,interest=context.student_profile.interests[0]?.label;
    const next={...base,revision:base.revision+1,input_refs:{...base.input_refs,context:context.snapshot_id,revision:context.revision,coverage:context.coverage},selection_basis:[{reason:'authorized_context_refresh',refs:[context.snapshot_id]}],content_focus:this.plan.mode==='free'?base.content_focus:interest??'跟随学生当前选择',strategy:{...base.strategy,language_support:context.learning_profile.language_support,correction:context.student_profile.conversation_preferences.correction}};
    this.plan=immutable({...next,hash:planHash(next)});this.emit('conversation_plan.revised',{plan_revision:this.plan.revision});
    if(this.plan.primary_goal&&!eligibleGoal(this.plan.primary_goal,context,this.capabilities,{explicit:true}))this.commitGoal('paused',{reason:'prerequisite_context_changed'});
  }
  isCurrent(plan){return !this.closed&&this.accepted===plan&&this.current?.turn_id===plan.turn_id&&this.current?.input_revision===plan.input_revision&&this.revision===plan.base_planning_revision&&this.authorizationEpoch===plan.authorization_epoch;}
  observe(packet) {
    if(this.closed)return;
    const e=packet.event;if(!e||e.session_id!==this.plan.session_id||!e.response_id)return;
    let x=this.executions.get(e.response_id);
    if(e.type==='response.started'&&!x) {
      if(this.executions.size>=1000)return;
      x={execution_id:e.response_id,turn_id:e.turn_id,plan_id:this.plan.plan_id,plan_revision:this.plan.revision,turn_plan_ref:null,path:this.mode,generation_basis:'unknown',generation_requested_at:null,first_observed_output_at:this.clock(),status:'unknown',consumption:'unknown',text:'',audio_bytes:0};this.executions.set(e.response_id,x);
    }
    if(!x||x.turn_id!==e.turn_id||['cancelled','completed'].includes(x.status))return;
    if(e.type==='response.text.delta'){x.text=(x.text+e.payload.text).slice(0,2000);x.status='forwarded';}
    if(e.type==='response.audio.chunk'){x.audio_bytes+=e.payload.byte_length;x.status='forwarded';}
    if(e.type==='response.cancelled'){x.status='cancelled';x.text='';}
    if(e.type==='response.done'){x.status='completed';if(x.text)this.history.push({role:'teacher',turn_id:x.turn_id,source_event_id:e.event_id,execution_id:x.execution_id,text:x.text,presentation:'unknown'});this.history=this.history.slice(-12);}
  }
  consumption(responseId,report) {
    const x=this.executions.get(responseId);if(!x||this.closed||!['unknown','partial','client_reported_complete'].includes(report.state)||!Number.isFinite(report.audio_ms)||report.audio_ms<0)return false;
    x.consumption=report.state;x.client_reported_consumed_ms=report.audio_ms;return true;
  }
  close(){if(this.closed)return;this.closed=true;this.observationCoordinator.close();this.authorizationEpoch++;this.invalidate('session_closed');}
}
