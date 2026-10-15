import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { PlanningState,conservativeTurn,TURN_PLANNING_BUDGET_MS } from '../packages/agent-core/planning-state.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { learnerFixture,SPORTS_RESOURCE } from '../apps/hskai-mock/src/planning-fixtures.js';
import { MOCK_IDENTITY } from '../apps/hskai-mock/src/server.js';
import { boundedProposal } from '../packages/agent-core/planner-port.js';
const final=(text='你好。',turn_id='t')=>({version:1,event_id:randomUUID(),session_id:'s',turn_id,seq:1,at_ms:0,type:'user.final',payload:{text}});
async function bound(mode='topic',resource=SPORTS_RESOURCE) {
  const identity={...MOCK_IDENTITY,authorization_until:Date.now()+60000,scopes:['session:create','context:read','curriculum:read']};
  const initializer=new ConversationInitializer({port:{read:async()=>learnerFixture(identity),getResource:async()=>mode==='free'?null:resource}});
  return new Preparations({initializer}).bind(await initializer.prepare({mode,...(mode==='topic'?{topic_id:'sports'}:{})},identity),'s');
}
test('two-second default includes time after accepted final, even when the planner receives a cloned event',async()=> {
  const planning=await bound();let now=Date.now(),captured;
  const s=new TeachingSession({sessionId:'s',mode:'sports',planning,planner:{planTurn:async input=>{captured=input;return conservativeTurn(input);}}});
  s.planning.clock=()=>now;
  assert.equal(s.planning.budgetMs,TURN_PLANNING_BUDGET_MS);
  assert.throws(()=>new PlanningState({...planning,budgetMs:5000}),/INVALID_TURN_PLANNING_BUDGET/);
  const e=final(),acceptedAt=now;s.accept(e);now+=1500;
  const plan=await s.planTurn(structuredClone(e));
  assert.ok(plan);assert.equal(captured.turn.expires_at,acceptedAt+2000);assert.equal(plan.expires_at-now,500);s.finalize();
});
test('an already exhausted queue budget starts no model call or capture, and closing controls remain immediate',async()=> {
  let now=Date.now(),calls=0,captures=0;
  const s=new TeachingSession({sessionId:'s',mode:'sports',planning:await bound(),planner:{planTurn:async input=>{calls++;return conservativeTurn(input);}},onAcceptedProposal:()=>captures++});s.planning.clock=()=>now;
  const e=final();s.accept(e);now+=2000;
  assert.equal(await s.planTurn(e),null);assert.equal(calls,0);assert.equal(captures,0);assert.equal(s.planning.records.at(-1).status,'expired');
  const bye=final('再见。','bye');s.accept(bye);assert.equal(s.teaching.decision.action,'CLOSE');assert.equal((await s.planTurn(bye)).action,'CLOSE');assert.equal(calls,0);s.finalize();
});
test('model timeout reserves commit time and an adapter ignoring abort cannot replace the accepted fallback',async t=> {
  let now=Date.now(),release;
  const s=new TeachingSession({sessionId:'s',mode:'sports',planning:await bound(),planner:{planTurn:input=>new Promise(resolve=>{release=()=>resolve(conservativeTurn(input));})}});s.planning.clock=()=>now;
  t.mock.timers.enable({apis:['setTimeout']});
  const e=final(),acceptedAt=now;s.accept(e);const work=s.planTurn(e);await Promise.resolve();
  now+=1800;t.mock.timers.tick(1800);const plan=await work;
  assert.equal(plan.planner_kind,'rule');assert.equal(plan.degraded_reason,'planner_timeout');assert.equal(plan.expires_at,acceptedAt+2000);assert.equal(plan.accepted_at,now);
  release();await Promise.resolve();await Promise.resolve();assert.equal(s.planning.accepted,plan);assert.equal(s.planning.records.length,1);s.finalize();
});
test('repair is not given a fresh budget or started when too little time remains',async()=> {
  let now=Date.now(),calls=0;
  const s=new TeachingSession({sessionId:'s',mode:'sports',planning:await bound(),planner:{planTurn:async()=>{calls++;now+=1751;return {};}}});s.planning.clock=()=>now;
  const e=final();s.accept(e);const plan=await s.planTurn(e);
  assert.equal(calls,1);assert.equal(plan.planner_kind,'rule');assert.equal(plan.degraded_reason,'planner_timeout');assert.equal(plan.expires_at-now,249);s.finalize();
});
test('late validation is rejected even if a blocked event loop has not fired its timeout',async()=> {
  let now=1000;
  const result=await boundedProposal({budgetMs:100,deadlineAt:1100,clock:()=>now,method:'planTurn',input:{},planner:{planTurn:async()=>({kind:'model'})},validate:proposal=>{if(proposal.kind==='model')now=1101;return proposal;},fallback:()=>({kind:'fallback'})});
  assert.equal(result.planner_kind,'rule');assert.equal(result.degraded_reason,'planner_timeout');assert.equal(result.proposal.kind,'fallback');assert.equal(result.attempts.some(a=>a.state==='accepted'),false);
});
