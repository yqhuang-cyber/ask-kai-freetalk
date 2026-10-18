import { validateEvent } from '../contracts/events.js';
import { PERSONA_VERSION,PERSONA_ADAPTIVE_VERSION,SPORTS_LESSON } from './lessons.js';
import { speechPaceInstructions } from './speech.js';
import { REPLY_POLICY_VERSION,REPLY_BUDGET } from './reply-policy.js';
import { NaturalTeaching,TEACHING_POLICY_VERSION } from './natural-teaching.js';
import { LearningSummary,SUMMARY_LIMITS,closingBrief as closeBrief } from './learning-summary.js';
import { LanguageSupport } from './language-support.js';
import { compileContextSnapshot } from './context-snapshot.js';
import { planProjection } from './conversation-initializer.js';
import { PlanningState } from './planning-state.js';
import { PlanningObservations } from './planning-observations.js';
import { SessionRecap } from './session-recap.js';
import { assessGoal } from './goal-lifecycle.js';
export class TeachingSession {
  constructor({sessionId,mode='sports',memory=[],mission=null,speechPace,planning,planner,resourceVerifier,onPlanningRecord,onAcceptedProposal,observationPort}) {
    if(!['sports','topic','free','mission'].includes(mode))throw new Error('INVALID_MODE');
    if(mode==='mission' && !mission)throw new Error('TRUSTED_MISSION_REQUIRED');
    this.speechInstructions=speechPaceInstructions(speechPace);
    Object.assign(this,{sessionId,mode,memory:structuredClone(memory),mission:mission?structuredClone(mission):null});this.stage='warmup';this.version=1;this.seen=new Set();this.evidence=[];this.completedReplyTurns=new Set();
    this.teaching=new NaturalTeaching({mode,mission});
    this.learning=new LearningSummary({sessionId,mode,mission});
    this.language=new LanguageSupport({memory});
    if(planning) {
      this.observations=new PlanningObservations({sessionId,...planning});
      this.planning=new PlanningState({...planning,planner,observations:this.observations,resourceVerifier,onRecord:onPlanningRecord,onAcceptedProposal,observationPort});
      if(this.planning.mode!=='shadow') {
        this.teaching.goal=planning.plan.primary_goal?{id:planning.plan.primary_goal.id,source:this.planning.capabilities?.source??'mock_hskai'}:null;
        this.teaching.likesGoal=planning.plan.mode!=='free'&&(planning.plan.primary_goal?.kp_ids.includes('likes-expression')??false);
      }
    }
    this.recap=new SessionRecap({sessionId,mode,mission,planning:planning?.plan.execution_mode==='shadow'?null:planning});
  }
  summarySnapshot(){return this.recap.snapshot();}
  instructions() {
    return this.contextSnapshot().instructions;
  }
  syncGoal() {
    if(!this.planning||this.planning.mode==='shadow')return;
    const p=this.planning.plan,goal=p.goal_status==='active'?p.primary_goal:null;
    if(this.teaching.goal?.id!==goal?.id){this.teaching.goalAttempted=false;this.teaching.autoTeachingUsed=false;}
    this.teaching.goal=goal?{id:goal.id,source:this.planning.capabilities?.source??'mock_hskai'}:null;
    this.teaching.likesGoal=p.mode!=='free'&&(goal?.kp_ids.includes('likes-expression')??false);
    this.teaching.paused=goal?false:p.goal_status==='paused'||p.goal_status==='retired'||this.teaching.paused;
    if(this.teaching.decision){this.teaching.decision.goal_id=goal?.id??null;this.teaching.decision.goal_source=goal?this.planning.capabilities?.source??'mock_hskai':null;this.teaching.decision.teaching_paused=this.teaching.paused;}
  }
  contextSnapshot() {
    const memory=this.language.validMemory().map(m=>({field:m.field,value:m.value,source:m.source,updated_at:m.updated_at}));
    return compileContextSnapshot({sessionId:this.sessionId,version:this.version,mode:this.mode,mission:this.mission,stage:this.stage,speechInstructions:this.speechInstructions,
      languageInstructions:this.language.instructions(),language:this.language.snapshot(),decision:this.teaching.decision,teachingContext:this.teaching.context(),memory,sessionRecap:this.teaching.decision?.teaching_paused&&this.teaching.decision?.action!=='CLOSE'?null:this.recap?.snapshot(),planning:this.planning?.mode==='shadow'?null:this.planning});
  }
  accept(event) {
    if(this.closed || !validateEvent(event) || event.session_id!==this.sessionId || event.type!=='user.final' || this.seen.has(event.turn_id))return false;
    if(this.seen.size>=1000)throw new Error('TEACHING_TURN_LIMIT');
    this.planning?.noteInput(event);
    this.seen.add(event.turn_id);
    this.version++;
    const decision=this.teaching.select(event,this.version);
    this.recap.input(event,{closing:decision.action==='CLOSE',plan:this.planning?.plan});
    this.planning?.controls(event,decision);this.syncGoal();
    if(decision.action!=='CLOSE'&&this.planning&&this.planning.mode!=='shadow'){for(const {goal,status} of this.planning.goalOutcomes.values())this.recap.goal({primary_goal:goal,goal_status:status,revision:this.planning.plan.revision});}
    this.language.observe(event.payload.text,{turn_id:event.turn_id,source_event_id:event.event_id,context_version:this.version});
    if(this.planning?.speaking&&this.planning.mode!=='shadow')this.planning.speaking.observe(event.payload.text,event);
    if(this.completedReplyTurns.has(event.turn_id))this.language.completeReply(event.turn_id);
    if(this.stage==='warmup')this.stage='conversation';
    if(decision.action==='CLOSE')this.stage='closing';
    else if(this.stage==='closing')this.stage='conversation';
    this.observations?.accept(event,{plan:this.planning.plan,resource:this.planning.resource,goal_status:this.teaching.decision.teaching_paused?'paused':this.planning.plan.goal_status,executions:this.planning.executions.values()});
    this.planning?.reduceSupport(event);
    if(this.planning&&this.planning.mode!=='shadow')this.learning.observeStudent(event);
    const attempt=this.planning&&this.planning.mode!=='shadow'?null:this.learning.recordFinal(event,decision);
    if(attempt) {
      this.evidence.push(attempt);
      if(decision.action!=='CLOSE'&&!decision.teaching_paused)this.stage='practice';
    }
    return true;
  }
  async planTurn(event) {
    if(!this.planning||this.closed)return null;
    const plan=await this.planning.acceptInput(event,this.teaching.decision,this.language.snapshot());
    if(plan&&!this.closed){this.syncGoal();this.recap.goal(this.planning.plan);this.version++;return plan;}return null;
  }
  completeReply(event) {
    if(this.closed||!validateEvent(event)||event.session_id!==this.sessionId||!['response.done','response.cancelled'].includes(event.type)||this.completedReplyTurns.has(event.turn_id))return false;
    if(this.completedReplyTurns.size>=1000)throw new Error('TEACHING_TURN_LIMIT');
    this.completedReplyTurns.add(event.turn_id);
    if(!this.language.completeReply(event.turn_id))return false;
    this.version++;return true;
  }
  forward(packet) {const before=this.recap.revision;this.recap.forward(packet);if(this.recap.revision!==before)this.version++;return this.learning.forward(packet);}
  updateMemory(memory){this.planning?.invalidate('preferences_changed');this.memory=structuredClone(memory);this.language.updateMemory(memory);this.version++;}
  updateLearnerContext(context){this.planning?.updateContext(context);this.syncGoal();this.version++;}
  languageSnapshot(){return this.language.snapshot();}
  finalize(options={}) {
    this.closed=true;this.planning?.close();const summary=this.learning.finalize({...options,evidence:this.evidence});
    if(this.planning&&this.planning.mode!=='shadow') {
      const suppressed=['authorization_revoked','safety_restricted'].includes(options.endReason),rows=suppressed?[]:[...this.observations.observations.values()];
      const plan=this.planning.plan,goal=plan.primary_goal;
      Object.assign(summary,{schema_version:3,policy_version:'kai-dynamic-summary-v2',focus:suppressed?'unavailable':!this.seen.size?'insufficient':rows.length?'practice_observed':'conversation_only',goals:suppressed?[]:[...this.planning.goalOutcomes.values()].map(({goal,status})=>({id:goal.id,label:goal.label,status:status==='active'?'unverified':status,attempt_rule_supported:goal.kp_ids.every(id=>this.planning.capabilities.key_points.find(k=>k.id===id)?.evidence_rule!=='unassessed'),assessment:assessGoal(goal,rows.slice(-100))})),learning_items:[],review_suggestions:[],dynamic_observations:rows.slice(-100).map(r=>({...r,session_id:this.sessionId,label:this.planning.capabilities.key_points.find(k=>k.id===r.kp_id).label})),planning:{path:this.planning.mode,plans:this.planning.records.length,controlled_execution:false},coverage:{rule_scope:'trusted_resource_attempt_rules_v2',complete_learning_inventory:false,observations_truncated:rows.length>100}});
      summary.counts.student_final_turns=suppressed?0:this.seen.size;summary.counts.attempts=rows.length;
      summary.headline=suppressed?{zh:'本轮总结暂不可用。',en:'This session summary is unavailable.'}:rows.length?{zh:'本轮记录了表达尝试；尚未评估掌握。',en:'Expression attempts were recorded; mastery was not assessed.'}:this.seen.size?{zh:'本轮以交流为主。',en:'This session focused on conversation.'}:{zh:'本轮记录不足。',en:'There is not enough information to summarize.'};
    }
    if(!['authorization_revoked','safety_restricted'].includes(options.endReason))summary.session_recap=this.summarySnapshot();
    return summary;
  }
  sessionRecap() {
    const sourced=this.learning.sourcedLists();
    const knowledge=[...sourced.knowledge_points];
    for(const row of this.observations?.observations.values()??[]) {
      const label=this.planning?.capabilities?.key_points.find(item=>item.id===row.kp_id)?.label;
      if(label&&!knowledge.includes(label))knowledge.push(label);
    }
    const list=items=>items.filter(item=>typeof item==='string'&&item.length>0&&item.length<=40).slice(0,4);
    return {knowledge_points:list(knowledge),vocabulary:list(sourced.vocabulary),expressions:list(sourced.expressions)};
  }
  closingBrief(){return closeBrief(this.sessionRecap());}
  learningRecord(outcome='ended'){return this.planning&&this.planning.mode!=='shadow'?this.observations.record(this.planning.plan,outcome,this.sessionRecap()):null;}
  view() {
    const sports=this.mode==='sports';
    const language=this.languageSnapshot();
    const view={mode:this.mode,stage:this.stage,context_version:this.version,persona_version:(this.planning?.plan.schema_version==='conversation-plan-v2'||this.planning?.plan.mode==='free')?PERSONA_ADAPTIVE_VERSION:PERSONA_VERSION,reply_policy_version:REPLY_POLICY_VERSION,reply_budget:{...REPLY_BUDGET},language_policy:{version:language.policy_version,english_support:language.english_support,reason:language.reason,known_expression_count:language.known_expressions.length},teaching_policy_version:TEACHING_POLICY_VERSION,decision:this.teaching.decision?{...this.teaching.decision}:null,lesson_source:sports?SPORTS_LESSON.source:this.mode==='mission'?'authorized-hskai-mission':null,lesson_version:sports?SPORTS_LESSON.version:null,goal:sports?SPORTS_LESSON.goal.label:this.mode==='mission'?this.mission.targets[0]:'用中文聊感兴趣的话题。',start_tip:sports?SPORTS_LESSON.start_tip:'可以从一句简单的中文开始。',cards:sports?structuredClone(SPORTS_LESSON.cards):[],attempts:structuredClone(this.evidence.slice(-SUMMARY_LIMITS.view_attempts)),attempt_count:this.evidence.length,attempts_truncated:this.evidence.length>SUMMARY_LIMITS.view_attempts,notice:'最终识别仅形成学习尝试；尚未评估掌握或发音。'};
    if(this.planning&&this.planning.mode!=='shadow'){const projection=planProjection(this.planning.plan,this.planning.resource);Object.assign(view,projection,{attempt_count:this.observations.observations.size,lesson_source:this.planning.capabilities?.source??'mock_hskai',lesson_version:this.planning.capabilities?.version??null});if(this.planning.plan.goal_status!=='active'){view.goal='跟随你当前的话题交流。';view.start_tip='';view.cards=[];}}
    return view;
  }
}
