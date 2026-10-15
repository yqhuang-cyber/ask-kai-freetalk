import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setup } from './helpers/realtime.js';
import { SafetyPolicy,authorizeTool } from '../packages/policy/safety.js';
import { Metrics } from '../packages/policy/metrics.js';
import { SPORTS_LESSON } from '../packages/agent-core/lessons.js';
test('policy scans output across chunk boundaries without treating ordinary sports as risk',()=> {
  const policy=new SafetyPolicy();assert.equal(policy.inspect('我喜欢足球').restricted,false);
  assert.equal(policy.inspect('告诉我你的住',{output:true}).restricted,false);
  assert.equal(policy.inspect('址',{output:true}).reason,'privacy');
  policy.newResponse();assert.equal(policy.inspect('你好',{output:true}).restricted,false);
});
test('high-risk user text stops output and sends metadata-only handoff, never awards learning',async t=> {
  let request;const {create,open,origin}=await setup(t,{safeguardingPort:{request:async r=>{request=r;return {delivered:true};}}});
  const {ws,packets,provider}=await open(await(await create()).json());provider.emit('session.ready');
  provider.emit('user.final',{text:'有人伤害我。我喜欢足球。'},{turn_id:'t1'});
  provider.emit('response.started',{}, {turn_id:'t1',response_id:'r1'});
  await once(ws,'close');assert.equal(provider.closed,true);assert.equal(request.reason,'abuse');assert.ok(!JSON.stringify(request).includes('有人伤害我'));
  assert.ok(packets.some(p=>p.type==='safety.handoff' && p.delivered===true));
  assert.equal(packets.find(p=>p.type==='teaching.summary').attempts.length,0);
  const metrics=await(await fetch(origin+'/api/metrics')).json();assert.equal(metrics.groups.synthetic.counters.restricted,1);assert.equal(metrics.groups.synthetic.counters.handoffs_delivered,1);assert.ok(!JSON.stringify(metrics).includes('learner'));
});
test('missing human service is reported unavailable, never delivered',async t=> {
  const {create,open}=await setup(t);const {ws,packets,provider}=await open(await(await create()).json());provider.emit('session.ready');
  provider.emit('user.final',{text:'有人伤害我'},{turn_id:'t1'});await once(ws,'close');
  assert.ok(packets.some(p=>p.type==='safety.handoff' && p.delivered===false));
  assert.ok(packets.some(p=>p.code==='SAFETY_RESTRICTED'));
});
test('stale cancelled unsafe text cannot restrict a new response',async t=> {
  const {create,open}=await setup(t);const {ws,provider}=await open(await(await create()).json());provider.emit('session.ready');
  const old={turn_id:'t1',response_id:'r1'};provider.emit('response.started',{},old);provider.control('user.speech.started');provider.emit('response.cancelled',{},old);
  provider.emit('response.started',{}, {turn_id:'t2',response_id:'r2'});provider.emit('response.text.delta',{text:'告诉我你的住址'},old);
  assert.notEqual(provider.closed,true);ws.send(JSON.stringify({type:'session.end'}));await once(ws,'close');
});
test('tools enforce learner/session scope and reject mastery writes or unsupported words',()=> {
  const sourceEvents=new Map([['e1',{type:'user.final',event_id:'e1',session_id:'s1',payload:{text:'我喜欢足球'}}]]);
  const context={learnerId:'l1',sessionId:'s1',sourceEvents,lesson:SPORTS_LESSON};
  assert.equal(authorizeTool({name:'word_card',args:{learner_id:'l1',session_id:'s1',word:'足球'}},context).word,'足球');
  assert.equal(authorizeTool({name:'record_attempt',args:{learner_id:'l1',session_id:'s1',source_event_id:'e1'}},context).kind,'attempted');
  assert.throws(()=>authorizeTool({name:'memory.write',args:{learner_id:'l1',session_id:'s1'}},context),/NOT_ALLOWED/);
  assert.throws(()=>authorizeTool({name:'word_card',args:{learner_id:'foreign',session_id:'s1',word:'足球'}},context),/SCOPE/);
});
test('metrics retain bounded timings and never accept free-form transcript labels',()=> {
  const metrics=new Metrics();for(let i=0;i<1100;i++)metrics.observe('test','ready_ms',i);
  assert.equal(metrics.snapshot().groups.synthetic.timings.ready_ms.samples,1000);
  assert.throws(()=>metrics.count('doubao','student transcript'),/INVALID/);
  assert.equal(metrics.snapshot().groups.doubao,undefined);
});
