import { learnerFixture,SPORTS_RESOURCE } from '../../hskai-mock/src/planning-fixtures.js';
import { ConversationInitializer } from '../../../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../../realtime-gateway/src/preparations.js';
import { TeachingSession } from '../../../packages/agent-core/teaching.js';
// Author expectations are accessed only after runtime execution. They are never
// supplied to the initializer, Planner or provider, and never create records.
export async function evaluateAgentFeedbackCase(c,{planner=null,reviewer=null}={}) {
  const sessionId='agent-eval-'+c.id,identity={owner_id:'fixture-owner',learner_id:'fixture-learner',authorization_until:Date.now()+600000,scopes:['session:create']};
  const initializer=new ConversationInitializer({planner,port:{read:async()=>learnerFixture(identity,{variant:c.fixture}),getResource:async()=>c.mode==='free'?null:SPORTS_RESOURCE}});
  const planning=new Preparations({initializer}).bind(await initializer.prepare({mode:c.mode??'topic',...(c.mode==='free'?{}:{topic_id:'sports'})},identity),sessionId);
  const s=new TeachingSession({sessionId,mode:c.mode==='free'?'free':'sports',planning,planner});
  let seq=0;
  const event=(type,turn,text)=>({version:1,event_id:'event-'+c.id+'-'+(++seq),session_id:sessionId,seq,at_ms:seq,type,turn_id:turn,payload:{text}});
  if(c.before){const before=event('user.final','before',c.before);s.accept(before);await s.planTurn(before);}
  const current=event('user.final','current',c.text);
  if(c.prior_reply) {
    const prior=c.prior_reply,turn=prior.same_turn?'current':'prior';
    const packet=(type,payload={})=>({event:{...event(type,turn,''),response_id:'actual-reply',payload}});
    s.planning.observe(packet('response.started'));s.planning.observe(packet('response.text.delta',{text:prior.text}));
    if(prior.state==='completed')s.planning.observe(packet('response.done'));
    if(prior.state==='cancelled')s.planning.observe(packet('response.cancelled'));
    if(prior.late_text)s.planning.observe(packet('response.text.delta',{text:prior.late_text}));
    if(prior.consumption)s.planning.consumption('actual-reply',{state:prior.consumption,audio_ms:20});
  }
  s.accept(current);const p=await s.planTurn(current),feedback=s.observations.feedback.get('current'),observations=s.learningRecord().observations;
  const actual={attempts:observations.length,signal:feedback.signal,prompt_scope:feedback.prompt.scope};
  const checks=Object.entries(c.expect).map(([field,expected])=>({field,passed:actual[field]===expected}));
  checks.push({field:'no_mastery_or_prompt_inference',passed:observations.every(o=>o.state==='attempted'&&o.support==='unknown'&&o.execution_ref===null)&&feedback.semantic_review==='unverified'&&feedback.prompt.preceded_student_speech==='unknown'});
  const semantic_review=reviewer&&p?await reviewer.review({student_input:{text:c.text},plan_proposal:p,learner_feedback:feedback,actual_context:s.planning.history.filter(h=>h.source_event_id!==current.event_id),learning_profile:planning.context.learning_profile,resource:planning.resource,goal_review:s.planning.review(),conversation_plan:s.planning.plan}):{status:'not_reviewed',criteria:[],semantic_quality_accepted:false,human_calibrated:false};
  s.finalize({businessSource:'mock_hskai',providerKind:'replay',ready:true});
  return {id:c.id,initial_planner:planning.plan.planner_kind,planner:p?.planner_kind??null,degraded_reason:p?.degraded_reason??null,learner_attempt_count:actual.attempts,signal:actual.signal,prompt_scope:actual.prompt_scope,checks,passed:checks.every(x=>x.passed),planner_attempts:s.planning.records.at(-1)?.attempts??[],semantic_review,semantic_quality_accepted:false};
}
