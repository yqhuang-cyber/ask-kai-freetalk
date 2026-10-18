import { planningCapabilities } from './skill-catalog.js';
import { createHash } from 'node:crypto';
import { PLAN_ACTIONS,LIMITS,exact,boundedText,isId,immutable } from '../contracts/planning.js';
import { checkGoalPatch,goalChoice } from './goal-lifecycle.js';
import { validateVisibleInstruction } from './agent-reasoning.js';
import { measureReply,REPLY_POLICY_VERSION } from './reply-policy.js';
import { assertSpeakingChoice,deriveSpeakingConstraints } from './speaking-policy.js';
export const planHash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function contextRefs(context,resource) {
  return new Set([context.snapshot_id,...context.student_profile.interests.map(r=>r.record_id),...context.learning_profile.kp_states.map(r=>r.record_id),...context.learning_history.map(r=>r.record_id),...(resource?[resource.id,...resource.goals.map(g=>g.id),...resource.key_points.map(k=>k.id),...resource.cards.map(c=>c.id)]:[])]);
}
const refs=(list,allowed)=>Array.isArray(list)&&list.length<=12&&list.every(id=>isId(id)&&allowed.has(id));
const strategyShape=(strategy,mode)=>exact(strategy,['language_support','support_level','correction','pace',...(mode==='free'?['speaking_difficulty']:[])])||mode==='free'&&exact(strategy,['language_support','support_level','correction','pace']);
export function validateConversation(p,{entry,context,resource,speakingConstraints}={}) {
  const allowed=contextRefs(context,entry.mode==='free'?null:planningCapabilities(entry,resource));
  if(entry.opening_request)allowed.add('initial-choice');
  if(!exact(p,['conversation_purpose','content_focus','opening_options','primary_goal_id','candidate_goal_ids','key_points','strategy','selection_basis'])||Buffer.byteLength(JSON.stringify(p))>LIMITS.proposal_bytes||!boundedText(p.conversation_purpose)||!boundedText(p.content_focus)||!Array.isArray(p.opening_options)||p.opening_options.length>2||!p.opening_options.every(x=>boundedText(x,100))||!strategyShape(p.strategy,entry.mode)||!['auto','zh','zh_en'].includes(p.strategy.language_support)||!['none','partial','model','unknown'].includes(p.strategy.support_level)||!['gentle','on_request'].includes(p.strategy.correction)||!['slow','normal'].includes(p.strategy.pace))throw new Error('INVALID_CONVERSATION_PROPOSAL');
  const ids=new Set(resource?.goals.map(g=>g.id)??[]),kp=new Set(resource?.key_points.map(k=>k.id)??[]);
  if(entry.mode==='free'&&(p.primary_goal_id!==null||!Array.isArray(p.candidate_goal_ids)||p.candidate_goal_ids.length||!Array.isArray(p.key_points)||p.key_points.length))throw new Error('FREE_INITIAL_GOAL_FORBIDDEN');
  if(p.primary_goal_id!==null&&!ids.has(p.primary_goal_id)||!Array.isArray(p.candidate_goal_ids)||p.candidate_goal_ids.length>2||!p.candidate_goal_ids.every(id=>ids.has(id))||new Set(p.candidate_goal_ids).size!==p.candidate_goal_ids.length||!Array.isArray(p.key_points)||p.key_points.length>2||!p.key_points.every(id=>kp.has(id)))throw new Error('INVALID_PLAN_RESOURCE_REFERENCE');
  if(entry.mode==='free') {
    if(!p.strategy.speaking_difficulty)throw new Error('INVALID_SPEAKING_DIFFICULTY');
    assertSpeakingChoice(p.strategy.speaking_difficulty,{constraints:speakingConstraints??deriveSpeakingConstraints(context),allowedRefs:allowed,kind:'conversation'});
  }
  if(entry.mode==='topic'&&p.primary_goal_id===null)throw new Error('TOPIC_GOAL_REQUIRED');
  if(resource&&p.primary_goal_id===null) {
    const declined=context.learning_history.flatMap(h=>h.declined_goal_ids);
    const eligible=resource.goals.some(g=>!declined.includes(g.id)&&g.kp_ids.every(id=>resource.key_points.find(k=>k.id===id).prerequisites.every(prior=>context.learning_profile.kp_states.some(s=>s.kp_id===prior&&['demonstrated_independent','demonstrated_transfer'].includes(s.evidence_state)))));
    if(eligible)throw new Error('RESOURCE_GOAL_REQUIRED');
  }
  if(p.strategy.language_support!==context.learning_profile.language_support||p.strategy.correction!==context.student_profile.conversation_preferences.correction||p.strategy.pace!==(entry.speech_pace??context.student_profile.conversation_preferences.pace))throw new Error('INITIAL_STRATEGY_CONFLICT');
  if(resource&&p.primary_goal_id!==null) {
    const goal=resource.goals.find(g=>g.id===p.primary_goal_id);
    if(p.key_points.length!==goal.kp_ids.length||!goal.kp_ids.every(k=>p.key_points.includes(k)))throw new Error('GOAL_KP_MISMATCH');
    const declined=context.learning_history.flatMap(h=>h.declined_goal_ids);
    if(declined.includes(goal.id))throw new Error('DECLINED_INITIAL_GOAL');
    for(const k of goal.kp_ids)for(const prior of resource.key_points.find(x=>x.id===k).prerequisites)if(!context.learning_profile.kp_states.some(s=>s.kp_id===prior&&['demonstrated_independent','demonstrated_transfer'].includes(s.evidence_state)))throw new Error('PREREQUISITE_UNVERIFIED');
  } else if(p.key_points.length)throw new Error('GOAL_KP_MISMATCH');
  if(!Array.isArray(p.selection_basis)||p.selection_basis.length<1||p.selection_basis.length>6||!p.selection_basis.every(b=>exact(b,['reason','refs'])))throw new Error('INVALID_SELECTION_BASIS');
  if(!p.selection_basis.every(b=>boundedText(b.reason,80)))throw new Error('INVALID_SELECTION_REASON');
  if(!p.selection_basis.every(b=>refs(b.refs,allowed)))throw new Error('INVALID_SELECTION_REFERENCE');
  validateVisibleInstruction([p.conversation_purpose,p.content_focus,...p.opening_options],allowed);
  return immutable(p);
}
export function validateTurn(p,{plan,input,policy,allowedRefs,context,resource,priorExecution,review={difficulty_count:0},speakingConstraints,now=Date.now()}) {
  if(!exact(p,['interpretation','prior_outcome','goal_assessment','action','active_goal_id','local_help_target','reply_directive','expected_observation','proposed_plan_patch','evidence_refs','rationale_code'])||Buffer.byteLength(JSON.stringify(p))>LIMITS.proposal_bytes||!exact(p.interpretation,['intent','clarity','refs'])||!boundedText(p.interpretation.intent,100)||!['clear','ambiguous','unknown'].includes(p.interpretation.clarity)||!refs(p.interpretation.refs,allowedRefs)||!PLAN_ACTIONS.includes(p.action)||!boundedText(p.rationale_code,100)||!refs(p.evidence_refs,allowedRefs))throw new Error('INVALID_TURN_PROPOSAL');
  const freeTurn=plan.mode==='free';
  const directiveShape=exact(p.reply_directive,['task','support_level','new_points','budget_ref',...(freeTurn?['speaking_difficulty']:[])])||freeTurn&&exact(p.reply_directive,['task','support_level','new_points','budget_ref']);
  if(!directiveShape||!boundedText(p.reply_directive.task,400))throw new Error('INVALID_TURN_DIRECTIVE');
  if(freeTurn&&!p.reply_directive.speaking_difficulty)throw new Error('INVALID_SPEAKING_DIFFICULTY');
  if(!['none','partial','model','choice'].includes(p.reply_directive.support_level))throw new Error('INVALID_SUPPORT_LEVEL');
  if(![0,1].includes(p.reply_directive.new_points))throw new Error('INVALID_NEW_POINT_COUNT');
  if(p.reply_directive.budget_ref!==REPLY_POLICY_VERSION)throw new Error('INVALID_REPLY_BUDGET_REF');
  if(!exact(p.expected_observation,['kind','required_student_answer'])||!boundedText(p.expected_observation.kind,100)||p.expected_observation.required_student_answer!==null)throw new Error('INVALID_EXPECTED_OBSERVATION');
  if(!exact(p.prior_outcome,['execution_ref','status','unknown'])||(p.prior_outcome.execution_ref!==null&&!allowedRefs.has(p.prior_outcome.execution_ref))||!['none','unknown','generated','forwarded','cancelled','partial','completed'].includes(p.prior_outcome.status)||!Array.isArray(p.prior_outcome.unknown)||p.prior_outcome.unknown.length>4||!p.prior_outcome.unknown.every(x=>boundedText(x,100)))throw new Error('INVALID_PRIOR_OUTCOME');
  if(priorExecution!==undefined&&(p.prior_outcome.execution_ref!==(priorExecution?.execution_id??null)||p.prior_outcome.status!==(priorExecution?.status??'none')))throw new Error('PRIOR_OUTCOME_CONFLICT');
  if(p.goal_assessment!==null&&(!exact(p.goal_assessment,['progress','gap','refs'])||!['unknown','attempted','not_related'].includes(p.goal_assessment.progress)||!boundedText(p.goal_assessment.gap,150)||!refs(p.goal_assessment.refs,allowedRefs)))throw new Error('INVALID_GOAL_ASSESSMENT');
  if(p.goal_assessment?.progress==='attempted'&&plan.goal_status!=='active')throw new Error('INACTIVE_GOAL_ASSESSMENT');
  if(p.goal_assessment?.progress==='attempted'&&!p.goal_assessment.refs.some(ref=>(review.observed_attempts??[]).some(o=>o.observation_id===ref||o.source_event_id===ref)))throw new Error('UNSUPPORTED_ATTEMPT_ASSESSMENT');
  const patch=p.proposed_plan_patch,structured=exact(patch,['op','goal_id','refs'])&&['replace','retire'].includes(patch.op)&&isId(patch.goal_id)&&refs(patch.refs,allowedRefs);
  if(p.active_goal_id!==null&&p.active_goal_id!==plan.primary_goal?.id||p.local_help_target!==null&&!boundedText(p.local_help_target,100)||patch!==null&&!['pause','resume'].includes(patch)&&!structured)throw new Error('INVALID_GOAL_PATCH');
  const capabilities=planningCapabilities(plan,resource);
  checkGoalPatch(patch,{plan,input,policy,context,resource:capabilities,review,choice:goalChoice(input.text??'',capabilities)});
  if(input.expires_at<=now)throw new Error('PLAN_EXPIRED');
  if(policy.action==='CLOSE'&&p.action!=='CLOSE'||policy.teaching_paused&&(p.active_goal_id!==null||['INVITE_PRACTICE','REVIEW'].includes(p.action))||policy.teaching_cooldown>0&&p.reply_directive.new_points>0||policy.clarification_pending&&policy.reason==='clarification_limit'&&p.action==='CLARIFY'||p.proposed_plan_patch==='resume'&&policy.teaching_paused)throw new Error('PLAN_POLICY_CONFLICT');
  if(p.action==='CLOSE'&&(p.reply_directive.new_points!==0||p.active_goal_id!==null))throw new Error('CLOSE_TEACHING_FORBIDDEN');
  if(p.action==='CLOSE'&&policy.action!=='CLOSE')throw new Error('UNREQUESTED_CLOSING_FORBIDDEN');
  if(p.active_goal_id!==null&&plan.goal_status!=='active')throw new Error('INACTIVE_GOAL_TEACHING_FORBIDDEN');
  if(p.local_help_target!==null&&(['INVITE_PRACTICE','REVIEW','CLOSE'].includes(p.action)||p.active_goal_id!==null))throw new Error('LOCAL_HELP_SCOPE_CONFLICT');
  if(p.action==='CORRECT'&&policy.reason==='goal_attempt_observed')throw new Error('VALID_EXPRESSION_CORRECTION_FORBIDDEN');
  validateVisibleInstruction([p.reply_directive.task],allowedRefs);
  if(measureReply(p.reply_directive.task).question_budget_exceeded)throw new Error('MULTIPLE_QUESTIONS_IN_DIRECTIVE');
  if(freeTurn)assertSpeakingChoice(p.reply_directive.speaking_difficulty,{constraints:speakingConstraints??deriveSpeakingConstraints(context),allowedRefs,kind:'turn',newPoints:p.reply_directive.new_points,action:p.action,cooldown:policy.teaching_cooldown??0});
  return immutable(p);
}
