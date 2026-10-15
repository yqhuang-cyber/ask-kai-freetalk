import { learnerFixture,SPORTS_RESOURCE,missionResource } from '../../hskai-mock/src/planning-fixtures.js';
import { MOCK_IDENTITY,MOCK_MISSION } from '../../hskai-mock/src/server.js';
import { ConversationInitializer } from '../../../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../../realtime-gateway/src/preparations.js';
import { TeachingSession } from '../../../packages/agent-core/teaching.js';
// Source events are synthetic; expected assertions remain evaluation-only.
export async function evaluateLongSession(c,{planner=null,observationPort=null}={}) {
  const identity={...MOCK_IDENTITY,mission:MOCK_MISSION,authorization_until:Date.now()+600000,scopes:['session:create']},sessionId='long-'+c.id;
  const initializer=new ConversationInitializer({port:{read:async()=>learnerFixture(identity,{variant:c.fixture}),getResource:async()=>c.mode==='free'?null:c.mode==='mission'?missionResource(MOCK_MISSION):SPORTS_RESOURCE}});
  const planning=new Preparations({initializer}).bind(await initializer.prepare({mode:c.mode==='sports'?'topic':c.mode,...(c.mode==='mission'?{mission_id:MOCK_MISSION.id}:c.mode==='sports'?{topic_id:'sports'}:{})},identity),sessionId);
  let snapshots=0;const s=new TeachingSession({sessionId,mode:c.mode,mission:MOCK_MISSION,planning,planner,observationPort,onAcceptedProposal:()=>{snapshots++;}}),turns=[];
  for(const [index,row] of c.turns.entries()) {
    if(row.prior_reply){const turn='turn-'+(index-1),response='reply-'+index,base={version:1,event_id:'teacher-'+index,session_id:sessionId,seq:1,at_ms:index,turn_id:turn,response_id:response};s.planning.observe({event:{...base,type:'response.started',payload:{}}});s.planning.observe({event:{...base,type:'response.text.delta',payload:{text:row.prior_reply.text}}});s.planning.observe({event:{...base,type:row.prior_reply.state==='cancelled'?'response.cancelled':'response.done',payload:{}}});}
    const event={version:1,event_id:'input-'+c.id+'-'+index,session_id:sessionId,seq:index+1,at_ms:index,type:'user.final',turn_id:'turn-'+index,payload:{text:row.text}};
    s.accept(event);const proposal=await s.planTurn(event);if(observationPort)await s.planning.observationWork;
    const record=s.learningRecord(),feedback=s.observations.feedback.get(event.turn_id),actual={goal:s.planning.plan.primary_goal?.id??null,status:s.planning.plan.goal_status,attempts:record.observations.length,local_help:!!s.planning.localHelp,action:proposal?.action??null,prompt_scope:feedback.prompt.scope,declined:s.planning.review().session_declined_goal_ids};
    const checks=Object.entries(row.expect).map(([field,value])=>({field,passed:JSON.stringify(actual[field])===JSON.stringify(value)}));
    checks.push({field:'attempted_only',passed:record.observations.every(o=>o.state==='attempted'&&o.support==='unknown'&&o.plan_revision<=record.plan_revision)});
    turns.push({index,...actual,planner:proposal?.planner_kind??null,rationale:proposal?.rationale_code??null,checks,passed:checks.every(x=>x.passed)});
  }
  const summary=s.finalize({businessSource:'mock_hskai',providerKind:'replay',ready:true});
  return {id:c.id,mode:c.mode,turns,snapshots,passed:turns.every(t=>t.passed),summary:{attempts:summary.counts.attempts,goals:summary.goals.map(g=>({id:g.id,status:g.status,assessment:g.assessment.status})),controlled_execution:false},shadow_candidates:s.planning.observationCoordinator.rows.map(r=>({status:r.status,goal_id:r.goal_id,learning_fact:false})),synthetic:true,provider_connected:false,semantic_quality_accepted:false};
}
