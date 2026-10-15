import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { setup,until } from './helpers/realtime.js';
import { projectSummary } from '../apps/realtime-gateway/public/summary-cards.js';
import { validateLearningRecord } from '../packages/contracts/planning.js';
import { metadata,ExperienceTrace } from '../apps/realtime-gateway/public/diagnostics.js';
import { createGateway } from '../apps/realtime-gateway/src/server.js';
async function fixture(t,options={}) {
  const backend=await startMockBackend({fixtureVariant:'b'});t.after(()=>backend.close());
  const gateway=await setup(t,{...backend,planningMode:'next_turn_advisory',...options});
  const call=async(method,path,input)=> {
    const launch=await fetch(gateway.origin+'/api/poc/launch',{method:'POST',headers:{Origin:gateway.origin,'Content-Type':'application/json'},body:'{}'});
    return fetch(gateway.origin+path,{method,headers:{Origin:gateway.origin,Cookie:launch.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
  };
  const prepare=async entry=> {
    const response=await call('POST','/api/conversation-preparations',entry);assert.equal(response.status,202);const {preparation_id}=await response.json();let result;
    for(let i=0;i<50;i++){result=await(await call('GET',`/api/conversation-preparations/${preparation_id}`)).json();if(result.status!=='preparing')break;await new Promise(r=>setTimeout(r,5));}
    assert.equal(result.status,'ready');return {...result,preparation_id};
  };
  return {...gateway,backend,call,prepare};
}
test('dynamic HTTP preparations require origin/auth, reject injection and fail stale after preferences change',async t=> {
  const f=await fixture(t),created=await f.prepare({mode:'sports'});
  assert.equal((await fetch(f.origin+'/api/conversation-preparations/'+created.preparation_id)).status,401);
  assert.equal((await f.call('POST','/api/conversation-preparations',{mode:'sports',learner_id:'foreign'})).status,400);
  assert.equal((await f.call('POST','/api/memory',{field:'interest',value:'跑步'})).status,200);
  assert.equal((await f.call('POST','/api/sessions',{mode:'sports',preparation_id:created.preparation_id})).status,409);
  const next=await f.prepare({mode:'sports'});assert.equal(next.view.prompt_title,'跑步');assert.match(next.view.goal,/时间/);
});
test('same plan drives page/voice, each final records planning, and synthetic voice never reports controlled generation',async t=> {
  const f=await fixture(t),prepared=await f.prepare({mode:'sports'});
  const ticket=await(await f.call('POST','/api/sessions',{mode:'sports',preparation_id:prepared.preparation_id})).json();
  const {ws,provider,packets}=await f.open(ticket);assert.match(provider.input.instructions,/express-time/);assert.ok(!provider.input.instructions.includes('只练第一个主要目标'));
  provider.emit('session.ready');ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>packets.some(p=>p.event?.type==='session.ready'));
  provider.emit('user.final',{text:'我下午打篮球。'},{turn_id:'turn-a'});
  await until(()=>packets.some(p=>p.row?.name==='planning.accepted'));
  assert.equal(provider.contexts.length,1);assert.match(provider.contexts[0].instructions,/后续输入建议/);
  provider.control('context.updated',{version:provider.contexts[0].version});
  ws.send(JSON.stringify({type:'session.end'}));await once(ws,'close');
  const summary=packets.find(p=>p.type==='teaching.summary');assert.equal(summary.summary.planning.controlled_execution,false);assert.equal(summary.goal,prepared.view.goal);
  const view=projectSummary(summary,{sessionId:ticket.session_id,mode:'sports'});assert.equal(view.observations[0].count,1);assert.equal(view.synthetic,true);
});
test('explicit end-save writes attempted-only mock record, returns receipt, deduplicates and affects subsequent history',async t=> {
  const f=await fixture(t),ticket=await(await f.call('POST','/api/sessions',{mode:'sports'})).json();const {ws,provider,packets}=await f.open(ticket);
  provider.emit('session.ready');provider.emit('user.final',{text:'我下午打篮球。'},{turn_id:'turn-a'});
  await until(()=>packets.some(p=>p.type==='teaching.state'&&p.attempt_count===1));ws.send(JSON.stringify({type:'session.end',save_learning:true}));await once(ws,'close');
  const receipt=packets.find(p=>p.type==='learning.record.receipt');assert.equal(receipt.status,'accepted');assert.equal(receipt.mocked,true);
  const i=f.backend.bridge.verify(await f.backend.pocPort.issue(),'session:create'),context=await f.backend.planningPort.read(i);assert.ok(context.learning_history.some(h=>h.activity_type==='ask_kai'&&h.observations.some(line=>line.startsWith('知识点：'))));
  assert.equal(context.learning_profile.kp_states[1].evidence_state,'prompted_attempt');
});
test('mock planning ports separate owners/scopes, reject fabricated mastery and deduplicate record writes',async t=> {
  const f=await fixture(t),i=f.backend.bridge.verify(await f.backend.pocPort.issue(),'session:create');
  await assert.rejects(f.backend.planningPort.read({...i,owner_id:'foreign'}));await assert.rejects(f.backend.planningPort.read({...i,scopes:[]}));
  const record=validateLearningRecord({schema_version:'learning-record-v1',session_id:'record-session',plan_id:'plan-id',plan_revision:1,resource_ref:{id:'sports',version:'mock-sports-v3'},observations:[],outcome:'ended',source:'ask_kai_observation'});
  const a=await f.backend.planningPort.append(i,record,'record-session'),b=await f.backend.planningPort.append(i,record,'record-session');assert.equal(a.receipt_id,b.receipt_id);assert.equal(a.revision,b.revision);
  await assert.rejects(f.backend.planningPort.append(i,{...record,outcome:'partial'},'record-session'));
});
test('controlled mode stays closed before provider connection or planning calls',async t=> {
  assert.throws(()=>createGateway({planningMode:'next_turn_advisory'}),/PLANNING_PORT_REQUIRED/);
  const f=await fixture(t,{planningMode:'controlled'});
  const result=await f.call('POST','/api/conversation-preparations',{mode:'sports'});assert.equal(result.status,501);assert.equal((await result.json()).error,'CONTROLLED_REALTIME_NOT_VERIFIED');assert.equal(f.providers.length,0);
});
test('a revoked/aborted learning write cannot start a late request',async t=> {
  const f=await fixture(t),i=f.backend.bridge.verify(await f.backend.pocPort.issue(),'session:create'),controller=new AbortController();controller.abort();
  const record={schema_version:'learning-record-v1',session_id:'cancelled-session',plan_id:'plan-id',plan_revision:1,resource_ref:null,observations:[],outcome:'ended',source:'ask_kai_observation'};
  await assert.rejects(f.backend.planningPort.append(i,record,'cancelled-session',{signal:controller.signal}));
  const context=await f.backend.planningPort.read(i);assert.equal(context.revision,1);
});
test('planning diagnostics preserve anonymous causal fields without prompt, student values or raw model errors',()=> {
  const clean=metadata({turn_id:'turn-a',path:'next_turn_advisory',planning_revision:4,planner_kind:'llm',degraded:false,rejection_code:'PREREQUISITE_UNVERIFIED',goal_status:'paused',task:'PRIVATE',input:'PRIVATE',error:'PRIVATE'});
  assert.equal(clean.path,'next_turn_advisory');assert.ok(!JSON.stringify(clean).includes('PRIVATE'));
  assert.equal(clean.rejection_code,'PREREQUISITE_UNVERIFIED');assert.equal(clean.goal_status,'paused');assert.deepEqual(metadata({rejection_code:'PRIVATE'}),{});
  const trace=new ExperienceTrace();trace.gateway({name:'planning.accepted',at_ms:2,fields:clean});assert.equal(trace.snapshot().timeline[0].turn_ref,'t1');assert.equal(trace.snapshot().contains_text,false);
});
test('a recognized goodbye speaks the sourced summary before closing and always writes recent history',async t=> {
  const f=await fixture(t),ticket=await(await f.call('POST','/api/sessions',{mode:'free'})).json();
  const {ws,provider,packets}=await f.open(ticket);
  provider.emit('session.ready');
  provider.emit('user.final',{text:'我喜欢音乐。'},{turn_id:'talk'});
  provider.emit('response.started',{},{turn_id:'talk',response_id:'talk-reply'});
  provider.emit('response.done',{},{turn_id:'talk',response_id:'talk-reply'});
  provider.emit('user.final',{text:'再见。'},{turn_id:'bye'});
  provider.emit('response.started',{},{turn_id:'bye',response_id:'bye-reply'});
  provider.emit('response.done',{},{turn_id:'bye',response_id:'bye-reply'});
  await until(()=>typeof provider.spoken==='string');
  assert.match(provider.spoken,/知识点：兴趣爱好/);assert.match(provider.spoken,/表达：我喜欢音乐/);assert.match(provider.spoken,/还不代表已经掌握/);
  assert.equal(packets.some(p=>p.type==='session.closed'),false);
  provider.emit('response.started',{},{turn_id:'summary',response_id:'summary-reply'});
  provider.emit('response.text.delta',{text:provider.spoken},{turn_id:'summary',response_id:'summary-reply'});
  provider.emit('response.done',{},{turn_id:'summary',response_id:'summary-reply'});
  await once(ws,'close');
  const summaryIndex=packets.findIndex(p=>p.type==='teaching.summary'),closedIndex=packets.findIndex(p=>p.type==='session.closed');
  assert.ok(summaryIndex>=0&&summaryIndex<closedIndex);
  assert.equal(packets.find(p=>p.type==='learning.record.receipt').status,'accepted');
  const identity=f.backend.bridge.verify(await f.backend.pocPort.issue(),'session:create'),context=await f.backend.planningPort.read(identity);
  const saved=context.learning_history.find(row=>row.observations.some(line=>line.includes('我喜欢音乐')));
  assert.ok(saved);assert.ok(saved.observations.some(line=>line.startsWith('知识点：')));assert.ok(saved.observations.some(line=>line.startsWith('表达：')));
});
test('free practice uses host skills without resources and shares the page/voice plan',async t=> {
  const f=await fixture(t);let reads=0;f.backend.planningPort.getResource=async()=>{reads++;throw new Error('TOPIC_MANAGER_OFFLINE');};
  const ticket=await(await f.call('POST','/api/sessions',{mode:'free'})).json();
  const {ws,provider,packets}=await f.open(ticket);
  provider.updateContext=value=>{provider.contexts.push(value);provider.control('context.updated',{version:value.version});};
  provider.emit('session.ready');
  provider.emit('user.final',{text:'planet 中文怎么说？'},{turn_id:'local-help'});
  await until(()=>packets.some(p=>p.type==='teaching.state'&&p.decision?.turn_id==='local-help'));
  assert.deepEqual(packets.filter(p=>p.type==='teaching.state').at(-1).cards,[]);
  provider.emit('user.final',{text:'我想练习喜好表达。'},{turn_id:'practice'});
  await until(()=>packets.some(p=>p.type==='teaching.state'&&p.decision?.turn_id==='practice'&&p.goal==='表达喜好'));
  const view=packets.filter(p=>p.type==='teaching.state').at(-1);assert.equal(view.mode,'free');assert.match(view.goal,/喜好/);
  provider.emit('user.final',{text:'我喜欢篮球。'},{turn_id:'attempt'});
  await until(()=>packets.some(p=>p.type==='teaching.state'&&p.decision?.turn_id==='attempt'));
  assert.equal(reads,0);assert.deepEqual(view.cards,[]);assert.equal(view.resource_version,null);
  assert.equal(packets.filter(p=>p.type==='teaching.state').at(-1).attempt_count,0);
  assert.ok(provider.contexts.some(c=>c.instructions.includes('express-likes')));
  ws.send(JSON.stringify({type:'session.end',save_learning:true}));await once(ws,'close');
  assert.equal(packets.find(p=>p.type==='learning.record.receipt').status,'accepted');
  const summary=packets.find(p=>p.type==='teaching.summary');assert.deepEqual(projectSummary(summary,{sessionId:ticket.session_id,mode:'free'}).observations,[]);assert.equal(summary.summary.goals[0].attempt_rule_supported,false);
});
