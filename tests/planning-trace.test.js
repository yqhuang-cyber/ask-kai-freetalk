import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanningTrace } from '../packages/agent-core/planning-trace.js';
import { boundedProposal } from '../packages/agent-core/planner-port.js';
import { MiniMaxJsonTransport } from '../packages/provider-minimax/planner.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { learnerFixture } from '../apps/hskai-mock/src/planning-fixtures.js';

const response=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value),reasoning_content:'PRIVATE_REASONING'}}],usage:{prompt_tokens:10,completion_tokens:5}}));
const rows=trace=>trace.snapshot().rows;
function run(trace,transport,input={marker:'authored fixture'},options={}) {
  return boundedProposal({trace,planner:{planConversation:(_input,{signal})=>transport.completeJSON({kind:'conversation',messages:[{role:'user',content:JSON.stringify(input)}],signal})},method:'planConversation',input,validate:p=>p,fallback:()=>({fallback:true}),budgetMs:500,...options});
}
test('request/response observations are scoped across concurrent sessions and match actual request bodies',async()=>{
  const sent=[],transport=new MiniMaxJsonTransport({apiKey:'synthetic-private-key',fetcher:async(_url,init)=>{
    assert.equal(init.headers.Authorization,'Bearer synthetic-private-key');const body=JSON.parse(init.body);sent.push(body);
    const marker=JSON.parse(body.messages[0].content).marker;
    await new Promise(r=>setTimeout(r,marker==='A'?12:1));return response({marker});
  }}),a=new PlanningTrace(),b=new PlanningTrace();
  await Promise.all([run(a,transport,{marker:'A'}),run(b,transport,{marker:'B'})]);
  for(const [trace,marker] of [[a,'A'],[b,'B']]) {
    const request=rows(trace).find(x=>x.stage==='planner.request');assert.equal(request.data.attempt,1);
    assert.deepEqual(request.data.body,sent.find(x=>JSON.parse(x.messages[0].content).marker===marker));
    const result=rows(trace).find(x=>x.stage==='planner.response');assert.equal(JSON.parse(result.data.content).marker,marker);
    assert.equal(result.data.planning_id,request.data.planning_id);
    assert.ok(!JSON.stringify(trace.snapshot()).includes('synthetic-private-key'));
    assert.ok(!JSON.stringify(trace.snapshot()).includes('PRIVATE_REASONING'));
  }
  assert.notEqual(rows(a)[0].data.planning_id,rows(b)[0].data.planning_id);
  await run(null,transport,{marker:'off'});assert.equal(rows(a).length,rows(b).length);
});
test('validation repairs, fallback and late responses preserve their distinct observed outcomes',async()=>{
  let calls=0;const trace=new PlanningTrace(),transport=new MiniMaxJsonTransport({apiKey:'synthetic',fetcher:async()=>response({n:++calls})});
  const result=await run(trace,transport,{}, {validate:p=>{if(p.n)throw new Error('INVALID_CONVERSATION_PROPOSAL');return p;}});
  assert.equal(result.degraded_reason,'planner_validation_failed');
  assert.deepEqual(rows(trace).filter(x=>x.stage==='planner.request').map(x=>x.data.attempt),[1,2]);
  assert.equal(rows(trace).filter(x=>x.stage==='planning.rejected').length,2);
  assert.equal(rows(trace).at(-1).stage,'planning.fallback');
  const late=new PlanningTrace();let release;
  const slow=new MiniMaxJsonTransport({apiKey:'synthetic',fetcher:()=>new Promise(resolve=>{release=()=>resolve(response({late:true}));})});
  const timed=await run(late,slow,{}, {budgetMs:10});assert.equal(timed.degraded_reason,'planner_timeout');
  const before=rows(late).length;release();await new Promise(r=>setTimeout(r,5));assert.equal(rows(late).length,before);
  assert.equal(rows(late).at(-1).stage,'planning.fallback');
});
test('trace storage is bounded, explicitly marks oversized rows, clears on release and ignores broken listeners',()=>{
  const trace=new PlanningTrace({limit:2,maxBytes:1000,maxRowBytes:100});trace.subscribe(()=>{throw new Error('observer failed');});
  trace.record('one',{headers:{Authorization:'PRIVATE'},api_key:'PRIVATE',reasoning_content:'PRIVATE',text:'Bearer a-private-token'});
  const first=rows(trace)[0];assert.ok(!JSON.stringify(first).includes('PRIVATE'));assert.ok(!JSON.stringify(first).includes('a-private-token'));
  trace.record('large',{text:'a'.repeat(200)});assert.equal(rows(trace).at(-1).truncated,true);
  trace.record('last',{ok:true});assert.equal(rows(trace).length,2);assert.equal(trace.snapshot().discarded,1);
  trace.clear();trace.record('late',{text:'must not retain'});assert.deepEqual(rows(trace),[]);
});
test('preparation traces are opt-in, identity-bound, transferred once and removed on cancel/revoke',async()=>{
  const identity={owner_id:'trace-owner',learner_id:'trace-learner',scopes:['session:create','context:read'],authorization_until:Date.now()+60000};
  const context=learnerFixture(identity),preparations=new Preparations({initializer:new ConversationInitializer({port:{read:async()=>context}})});
  const plain=preparations.create(identity,{mode:'free'});await preparations.get(identity,plain.preparation_id).done;
  assert.equal(preparations.view(identity,plain.preparation_id).observation,undefined);
  const observed=preparations.create(identity,{mode:'free'},{observe:true});await preparations.get(identity,observed.preparation_id).done;
  const item=preparations.get(identity,observed.preparation_id),trace=item.trace;
  assert.ok(rows(trace).some(x=>x.stage==='planning.fallback'));
  assert.throws(()=>preparations.view({...identity,learner_id:'other'},observed.preparation_id),/PREPARATION_NOT_FOUND/);
  const consumed=await preparations.consume(identity,observed.preparation_id,{mode:'free'});
  assert.equal(consumed.trace,trace);assert.equal(preparations.bind(consumed,'trace-session').trace,trace);
  assert.throws(()=>preparations.view(identity,observed.preparation_id),/PREPARATION_NOT_FOUND/);
  const cancelled=preparations.create(identity,{mode:'free'},{observe:true}),cancelTrace=preparations.get(identity,cancelled.preparation_id).trace;
  preparations.cancel(identity,cancelled.preparation_id);assert.deepEqual(rows(cancelTrace),[]);
  const revoked=preparations.create(identity,{mode:'free'},{observe:true}),revokeTrace=preparations.get(identity,revoked.preparation_id).trace;
  preparations.revoke(identity);assert.deepEqual(rows(revokeTrace),[]);preparations.close();trace.clear();
});
