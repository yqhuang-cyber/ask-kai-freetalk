import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { setup,until } from './helpers/realtime.js';
const event=(type,text,turn='t1')=>({version:1,event_id:`e-${turn}`,session_id:'s1',seq:1,at_ms:0,type,turn_id:turn,...(type.startsWith('response.')?{response_id:'r1'}:{}),payload:{text}});
test('only final student expressions create sourced attempts; teacher/partial/duplicate cannot',()=> {
  const teaching=new TeachingSession({sessionId:'s1'});
  assert.equal(teaching.accept(event('user.partial','我喜欢足球')),false);
  assert.equal(teaching.accept(event('response.text.delta','我喜欢足球')),false);
  assert.equal(teaching.accept(event('user.final','我喜欢足球')),true);
  assert.equal(teaching.accept(event('user.final','我喜欢足球')),false);
  const view=teaching.view();assert.equal(view.attempts.length,1);assert.equal(view.stage,'practice');
  assert.equal(view.attempts[0].kind,'attempted');assert.equal(view.attempts[0].source_event_id,'e-t1');assert.equal(view.attempts[0].pronunciation_assessed,false);
  assert.ok(!JSON.stringify(view).includes('mastered'));
});
test('free chat does not force sports evidence; negated expression is not the goal',()=> {
  const sports=new TeachingSession({sessionId:'s1'});sports.accept(event('user.final','我不喜欢足球'));assert.equal(sports.evidence.length,0);
  const free=new TeachingSession({sessionId:'s1',mode:'free'});free.accept(event('user.final','我喜欢足球'));assert.equal(free.evidence.length,0);assert.match(free.instructions(),/不强制/);
  assert.throws(()=>new TeachingSession({sessionId:'s1',mode:'mission'}),/TRUSTED/);
});
test('teaching views are copies and bounded sessions preserve provenance without raw text',()=> {
  const teaching=new TeachingSession({sessionId:'s1'});teaching.accept(event('user.final','我喜欢足球'));
  teaching.view().attempts[0].kind='mastered';assert.equal(teaching.view().attempts[0].kind,'attempted');
  assert.ok(!Object.hasOwn(teaching.evidence[0],'text'));
  assert.match(teaching.instructions(),/不设置固定字数、句数/);assert.match(teaching.instructions(),/AI/);
});
test('gateway passes persona at open, updates at reply boundary and confirms exact version',async t=> {
  const {create,open}=await setup(t);const {packets,provider}=await open(await(await create()).json());
  assert.match(provider.input.instructions,/我喜欢/);provider.emit('session.ready');
  provider.emit('user.final',{text:'我喜欢足球'},{turn_id:'t1'});provider.emit('response.started',{}, {turn_id:'t1',response_id:'r1'});
  assert.equal(provider.contexts.length,0);provider.emit('response.done',{}, {turn_id:'t1',response_id:'r1'});
  assert.equal(provider.contexts.length,1);provider.control('context.updated',{version:999});
  provider.control('context.updated',{version:provider.contexts[0].version});
  await until(()=>packets.some(p=>p.type==='teaching.context.applied'));
  const state=packets.filter(p=>p.type==='teaching.state').at(-1);assert.equal(state.attempts.length,1);assert.equal(state.stage,'practice');
});
test('missing context acknowledgement cannot silently report update success',async t=> {
  const {create,open}=await setup(t,{contextTimeoutMs:25});const {ws,packets,provider}=await open(await(await create()).json());
  provider.emit('session.ready');provider.emit('user.final',{text:'你好'},{turn_id:'t1'});provider.emit('response.started',{}, {turn_id:'t1',response_id:'r1'});provider.emit('response.done',{}, {turn_id:'t1',response_id:'r1'});
  await once(ws,'close');assert.ok(packets.some(p=>p.code==='CONTEXT_ACK_TIMEOUT'));
});
