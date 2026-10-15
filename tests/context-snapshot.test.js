import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { metadata,ExperienceTrace } from '../apps/realtime-gateway/public/diagnostics.js';
import { setup,until } from './helpers/realtime.js';
const final=(turn,text)=>({version:1,event_id:`event-${turn}`,session_id:'s1',seq:1,at_ms:0,type:'user.final',turn_id:turn,payload:{text}});
test('immutable context preserves source and language when a newer student request changes the session',()=>{
  const t=new TeachingSession({sessionId:'s1',mode:'free'}),initial=t.contextSnapshot();
  assert.equal(initial.scope,'initial');assert.equal(initial.version,1);assert.equal(initial.hash,t.contextSnapshot().hash);
  t.accept(final('t1','Please speak Chinese only.'));const first=t.contextSnapshot();
  assert.equal(first.language.english_support,'off');assert.equal(first.source_turn_id,'t1');assert.equal(first.scope,'subsequent_inputs');
  t.accept(final('t2','Please add English translation.'));
  assert.equal(t.contextSnapshot().language.english_support,'required');assert.equal(first.language.english_support,'off');assert.notEqual(first.hash,t.contextSnapshot().hash);
  assert.throws(()=>{first.language.preference='zh_en';},TypeError);assert.equal(initial.language.english_support,'required');
});

test('resolved language excludes superseded profile settings from the generic model memory without deleting profile evidence',()=>{
  const now=Date.now(),memory=[{field:'support_language',value:'zh_en',source:'authorized_hskai_profile',updated_at:new Date(now).toISOString(),expires_at:new Date(now+86400000).toISOString()}];
  const session=new TeachingSession({sessionId:'s1',mode:'free',memory});session.accept(final('t1','Please speak Chinese only.'));
  const snapshot=session.contextSnapshot();assert.equal(snapshot.language.preference,'zh');assert.equal(snapshot.language.preference_source,'student_current_session');
  assert.ok(!snapshot.instructions.includes('"value":"zh_en"'));assert.equal(session.language.validMemory()[0].value,'zh_en');
  assert.equal(session.memory[0].value,'zh_en');assert.equal(snapshot.language.english_support,'off');
});
test('pending context remains bound to its original version across newer input and delayed or duplicate confirmations',async t=>{
  const {create,open}=await setup(t),{ws,packets,provider}=await open(await(await create({mode:'free'})).json());
  ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>packets.some(p=>p.row?.name==='session.config'));
  provider.emit('session.ready');provider.emit('user.final',{text:'Please speak Chinese only.'},{turn_id:'t1'});
  provider.emit('response.started',{}, {turn_id:'t1',response_id:'r1'});provider.emit('response.done',{}, {turn_id:'t1',response_id:'r1'});
  const first={...provider.contexts[0]};assert.equal(first.version,2);
  provider.emit('user.final',{text:'English only when needed.'},{turn_id:'t2'});provider.emit('response.started',{}, {turn_id:'t2',response_id:'r2'});
  provider.control('context.updated',{version:999});assert.equal(provider.contexts.length,1);
  provider.control('context.updated',{version:2});assert.equal(provider.contexts.length,1);
  provider.emit('response.done',{}, {turn_id:'t2',response_id:'r2'});assert.equal(provider.contexts.length,2);assert.equal(provider.contexts[1].version,3);
  assert.deepEqual(provider.contexts[0],first);provider.control('context.updated',{version:2});
  provider.control('context.updated',{version:3});await until(()=>packets.filter(p=>p.type==='teaching.context.applied').length===2);
  assert.deepEqual(packets.filter(p=>p.type==='teaching.context.applied').map(p=>p.version),[2,3]);
  const starts=packets.filter(p=>p.row?.name==='teaching.response');assert.equal(starts[1].row.fields.applied_context_version,1);
  assert.match(starts[1].row.fields.applied_context_hash,/^[a-f0-9]{64}$/);assert.equal(starts[1].row.fields.current_decision_context_version,3);
  assert.ok(packets.some(p=>p.row?.name==='context.confirmation.ignored'));
});
test('context diagnostics retain only bounded hashes and provenance metadata, never private instructions or state',()=>{
  const clean=metadata({context_hash:'a'.repeat(64),applied_context_hash:'b'.repeat(64),context_policy_version:'kai-context-v1',context_scope:'subsequent_inputs',instructions:'PRIVATE',language:{known_expressions:['PRIVATE']},source_event_id:'PRIVATE'});
  assert.equal(clean.context_hash,'a'.repeat(64));assert.ok(!JSON.stringify(clean).includes('PRIVATE'));
  assert.deepEqual(metadata({context_hash:'not-a-hash',context_policy_version:'private-version'}),{});
  const trace=new ExperienceTrace({now:()=>10});trace.record('teaching.response',{response_id:'owned',...clean});const report=trace.snapshot();
  assert.equal(report.summary.responses[0].teaching_context.applied_context_hash,'b'.repeat(64));assert.equal(report.contains_text,false);
});

test('gateway completion leaves browser presentation unknown; browser-only observation is reply-owned and metadata-only',()=>{
  const trace=new ExperienceTrace({now:()=>10});trace.gateway({name:'response.complete',at_ms:1,fields:{response_id:'r1',state:'done',pcm_duration_ms:200}});
  let p=trace.snapshot().summary.responses[0].presentation;assert.equal(p.browser_audio_observed,false);assert.equal(p.played_pcm_ms,null);
  trace.record('audio.queued',{response_id:'r1',queue_ms:120,text:'private'});trace.record('caption.playback',{response_id:'r1',played_pcm_ms:180,caption_mode:'complete'});trace.record('presentation.dropped',{response_id:'old',reason:'ownership'});
  p=trace.snapshot().summary.responses[0].presentation;assert.equal(p.browser_audio_observed,true);assert.equal(p.played_pcm_ms,180);assert.equal(p.caption_complete,true);
  assert.equal(trace.snapshot().summary.responses[1].presentation.late_events_dropped,1);assert.ok(!JSON.stringify(trace.snapshot()).includes('private'));
});
