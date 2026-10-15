import { FREE_PRACTICE_CATALOG,planningCapabilities } from './skill-catalog.js';
import { assessNeeds,topicFallback,validateTopicConversation,topicModelInput,requireTopicGoal } from './topic-initialization.js';
import { goalDetails } from './goal-details.js';
import { randomUUID } from 'node:crypto';
import { immutable,exact,isId,boundedText,requireIdentity,PLANNING_VERSION } from '../contracts/planning.js';
import { boundedProposal,plannerDescriptor } from './planner-port.js';
import { validateConversation,planHash } from './plan-validator.js';
export function normalizeEntry(input,identity) {
  if(!exact(input,['mode','topic_id','mission_id','speech_pace','opening_request'])||!['sports','topic','mission','free'].includes(input.mode)||input.speech_pace!==undefined&&!['slow','normal'].includes(input.speech_pace))throw new Error('INVALID_PLANNING_ENTRY');
  if(input.opening_request!==undefined&&!boundedText(input.opening_request,200))throw new Error('INVALID_OPENING_REQUEST');
  const mode=input.mode==='sports'?'topic':input.mode;
  if(mode==='mission'&&(!isId(input.mission_id)||input.mission_id!==identity.mission?.id))throw new Error('TRUSTED_MISSION_REQUIRED');
  if(mode==='topic'&&input.topic_id!==undefined&&!isId(input.topic_id)||mode!=='topic'&&input.topic_id!==undefined||mode!=='mission'&&input.mission_id!==undefined)throw new Error('INVALID_PLANNING_RESOURCE');
  return {mode,...(mode==='topic'?{topic_id:input.topic_id??'sports'}:{}),...(mode==='mission'?{mission_id:input.mission_id}:{}),...(input.speech_pace?{speech_pace:input.speech_pace}:{}),...(input.opening_request?{opening_request:input.opening_request}:{})};
}
export function conservativeConversation(entry,context,resource) {
  const learning=context.learning_profile,profile=context.student_profile,declined=context.learning_history.flatMap(r=>r.declined_goal_ids);
  const independent=id=>learning.kp_states.some(s=>s.kp_id===id&&['demonstrated_independent','demonstrated_transfer'].includes(s.evidence_state));
  const eligible=resource?.goals.filter(g=>!declined.includes(g.id)&&g.kp_ids.every(id=>resource.key_points.find(k=>k.id===id).prerequisites.every(independent)))??[];
  const goal=entry.mode==='free'?null:eligible.find(g=>g.kp_ids.some(id=>learning.review_candidates.includes(id)))??eligible.find(g=>!g.kp_ids.every(independent))??eligible[0]??null;
  if(entry.mode==='topic'&&!goal)throw new Error('TOPIC_NO_ELIGIBLE_GOAL');
  const state=learning.kp_states.find(k=>goal?.kp_ids.includes(k.kp_id));
  const interest=profile.interests.find(i=>i.topic_id===entry.topic_id||entry.mode==='mission');
  return {conversation_purpose:entry.mode==='free'?'跟随学生选择进行自然交流':`围绕${resource.title}进行简短交流`,content_focus:entry.mode==='free'?'由学生选择话题':interest?.label??resource.title,opening_options:[],primary_goal_id:goal?.id??null,candidate_goal_ids:[],key_points:goal?.kp_ids??[],strategy:{language_support:learning.language_support,support_level:state?.support_needed??'unknown',correction:profile.conversation_preferences.correction,pace:entry.speech_pace??profile.conversation_preferences.pace},selection_basis:[{reason:entry.mode==='free'?'free_student_choice':goal?'conservative_evidence_selection':'declined_or_unverified_goals',refs:[context.snapshot_id,...(goal?[goal.id]:[]),...(state?[state.record_id]:[]),...(interest&&entry.mode!=='free'?[interest.record_id]:[])]}]};
}
export function planProjection(plan,resource) {
  const goal=plan.primary_goal;
  return {mode:plan.mode==='topic'?(resource?.id==='sports'?'sports':'topic'):plan.mode,topic_id:plan.mode==='topic'?resource?.id:null,goal:goal?.label??'由你选择话题，自然交流。',goal_details:goalDetails(plan,planningCapabilities(plan,resource)),prompt_title:plan.content_focus,start_tip:goal?(plan.teaching_decision?.task??goal.start_tip):'',cards:goal?planningCapabilities(plan,resource).cards.filter(c=>goal.card_ids.includes(c.id)).map(({id,...c})=>c):[],attempts:[],attempt_count:0,notice:resource?.schema_version==='topic-pack-v1'?`学习资料来自本地 mock；Topic Pack：${resource.source}；练习方向未评估。`:'示例学习资料来自本地 mock；目标不是学习成果。',teaching_decision:plan.teaching_decision??null,resource_version:resource?.version??null,planning:{mode:plan.execution_mode,planner_kind:plan.planner_kind,degraded:!!plan.degraded_reason}};
}
export const INITIAL_PLANNING_BUDGET_MS=15000;
export class ConversationInitializer {
  constructor({port,planner,mode='next_turn_advisory',clock=()=>Date.now(),budgetMs=INITIAL_PLANNING_BUDGET_MS}){if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>20000)throw new Error('INVALID_INITIAL_PLANNING_BUDGET');Object.assign(this,{port,planner,mode,clock,budgetMs});}
  async prepare(entry,identity,{signal}={}) {
    requireIdentity(identity,'session:create',this.clock());
    const expiresAt=this.clock()+this.budgetMs;
    // A ref'd timer keeps the deadline active when the only other wait is a
    // port call that ignores abort. AbortSignal.timeout() does not.
    const deadlineControl=new AbortController(),deadlineTimer=setTimeout(()=>deadlineControl.abort(),this.budgetMs);
    const deadline=deadlineControl.signal,combined=signal?AbortSignal.any([signal,deadline]):deadline;
    let aborted;
    let context,resource;
    try {
      [context,resource]=await Promise.race([Promise.all([this.port.read(identity),entry.mode==='free'?null:this.port.getResource(identity,entry,{signal:combined})]),new Promise((_,reject)=>{aborted=()=>reject(new Error('PREPARATION_CANCELLED'));combined.addEventListener('abort',aborted,{once:true});if(combined.aborted)aborted();})]).finally(()=>combined.removeEventListener('abort',aborted));
    } finally {clearTimeout(deadlineTimer);}
    combined.throwIfAborted();requireIdentity(identity,'session:create',this.clock());
    const topic=resource?.schema_version==='topic-pack-v1';
    if(entry.mode==='topic')requireTopicGoal(entry,context,resource);
    const input=immutable({...(topic?{planning_needs:assessNeeds(context,resource)}:{}),entry,...(topic?topicModelInput(context,resource):{student_profile:context.student_profile,learning_profile:context.learning_profile,learning_history:context.learning_history}),coverage:context.coverage,history_page:context.history_page,snapshot_ref:context.snapshot_id,...(entry.mode==='free'?{skill_catalog:FREE_PRACTICE_CATALOG}:{}),required_strategy:{language_support:context.learning_profile.language_support,correction:context.student_profile.conversation_preferences.correction,pace:entry.speech_pace??context.student_profile.conversation_preferences.pace},resource});
    const result=await boundedProposal({planner:topic?(typeof this.planner?.planTopicConversation==='function'?this.planner:null):this.planner,method:topic?'planTopicConversation':'planConversation',input,signal:combined,budgetMs:Math.max(1,expiresAt-this.clock()-50),clock:this.clock,deadlineAt:expiresAt-50,validate:p=>(topic?validateTopicConversation:validateConversation)(p,{entry,context,resource}),fallback:()=>(topic?topicFallback:conservativeConversation)(entry,context,resource)});
    combined.throwIfAborted();requireIdentity(identity,'session:create',this.clock());
    const described=this.planner?.plannerFor?.(entry)??this.planner,profile=plannerDescriptor(described);
    const p=result.proposal,plan={schema_version:topic?'conversation-plan-v2':'conversation-plan-v1',plan_id:randomUUID(),revision:1,session_id:null,mode:entry.mode,resource_refs:resource?[{id:resource.id,version:resource.version,...(topic?{hash:resource.hash}:{})}]:[],input_refs:{context:context.snapshot_id,revision:context.revision,coverage:context.coverage,policy:PLANNING_VERSION,prompt:profile.prompt},...p,...(topic?{goal_instance:p.primary_goal_id?{schema_version:'goal-instance-v1',instance_id:randomUUID(),skill_id:p.key_points[0],resource_ref:{id:resource.id,version:resource.version,hash:resource.hash},task:p.teaching_decision.task,support_level:p.strategy.support_level,observation:'unassessed'}:null}:{}),primary_goal:resource?.goals.find(g=>g.id===p.primary_goal_id)??null,goal_status:p.primary_goal_id?'active':'unverified',planner_kind:result.planner_kind,planner_profile:profile,degraded_reason:result.degraded_reason,planner_attempts:result.attempts,execution_mode:this.mode};
    return {plan:immutable({...plan,hash:planHash(plan)}),context,resource};
  }
}
