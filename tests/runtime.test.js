import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntime } from '../packages/agent-core/session.js';
import { assertEvent, validateEvent } from '../packages/contracts/events.js';
import { loadScenario, ReplayProvider } from '../packages/provider-replay/index.js';
import { runScenario } from '../apps/eval-runner/src/replay.js';
const event = (type, options = {}) => ({version:1,event_id:'e1',session_id:'s1',seq:0,at_ms:0,type,payload:{},...options});
const ready = runtime => runtime.ingest(event('session.ready'));

test('only ready transitions a connecting session to active', () => {
  const runtime = new SessionRuntime('s1');
  assert.equal(runtime.ingest(event('user.final',{event_id:'early',turn_id:'t1',payload:{text:'足球'}})).reason,'session_not_ready');
  ready(runtime);
  assert.equal(runtime.snapshot().status,'active');
});
test('reject foreign-session, malformed and duplicate events without state changes', () => {
  const runtime = new SessionRuntime('s1');
  assert.equal(runtime.ingest(event('session.ready',{session_id:'s2'})).reason,'foreign_session');
  assert.equal(runtime.ingest(event('session.ready',{version:2})).reason,'invalid_event');
  assert.equal(runtime.snapshot().status,'connecting');
  ready(runtime);
  assert.equal(runtime.ingest(event('session.ready')).reason,'duplicate_event');
});
test('strict contract rejects unknown fields, missing response IDs and invalid audio', () => {
  assert.equal(validateEvent(event('session.ready',{api_key:'secret'})),false);
  assert.equal(validateEvent(event('response.done',{turn_id:'t1'})),false);
  assert.equal(validateEvent(event('response.audio.chunk',{turn_id:'t1',response_id:'r1',payload:{byte_length:65537,format:'pcm_s16le'}})),false);
  assert.equal(validateEvent(event('user.final',{turn_id:'t1',payload:{text:''}})),false);
  assert.throws(() => assertEvent({}),/INVALID_INTERNAL_EVENT/);
});
test('partial transcript and teacher output never form student evidence', () => {
  const runtime = new SessionRuntime('s1'); ready(runtime);
  runtime.ingest(event('user.partial',{event_id:'e2',turn_id:'t1',payload:{text:'足球'}}));
  runtime.ingest(event('response.started',{event_id:'e3',turn_id:'t1',response_id:'r1'}));
  runtime.ingest(event('response.text.delta',{event_id:'e4',turn_id:'t1',response_id:'r1',payload:{text:'足球'}}));
  assert.deepEqual(runtime.snapshot().evidence,[]);
});
test('final transcript yields one attempted evidence item per turn, with provenance', () => {
  const runtime = new SessionRuntime('s1'); ready(runtime);
  runtime.ingest(event('user.final',{event_id:'e2',turn_id:'t1',payload:{text:'足球'}}));
  assert.equal(runtime.ingest(event('user.final',{event_id:'e3',turn_id:'t1',payload:{text:'足球'}})).reason,'duplicate_final_turn');
  assert.deepEqual(runtime.snapshot().evidence,[{session_id:'s1',turn_id:'t1',source_event_id:'e2',target:'足球',kind:'attempted',rule_version:'keyword-attempt-v1'}]);
});
test('old audio, text and done remain isolated after cancellation and a new reply', async () => {
  const fixture = await loadScenario('interruption');
  const runtime = new SessionRuntime(fixture.session_id);
  const acceptedText = [];
  for (const item of fixture.events) {
    const result = runtime.ingest(item);
    if (result.accepted && item.type === 'response.text.delta') acceptedText.push(item.payload.text);
    if (item.type === 'response.cancelled') assert.equal(runtime.snapshot().active_response_id,'r2');
  }
  assert.deepEqual(acceptedText,['我们聊足球。','你也喜欢游泳。']);
  assert.equal(runtime.snapshot().dropped,3);
});
test('response IDs cannot be recycled after done', () => {
  const runtime = new SessionRuntime('s1'); ready(runtime);
  runtime.ingest(event('response.started',{event_id:'e2',turn_id:'t1',response_id:'r1'}));
  runtime.ingest(event('response.done',{event_id:'e3',turn_id:'t1',response_id:'r1'}));
  assert.equal(runtime.ingest(event('response.started',{event_id:'e4',turn_id:'t2',response_id:'r1'})).reason,'reused_response');
});
test('wrong-turn payload and overlapping reply cannot take over active output', () => {
  const runtime = new SessionRuntime('s1'); ready(runtime);
  runtime.ingest(event('response.started',{event_id:'e2',turn_id:'t1',response_id:'r1'}));
  assert.equal(runtime.ingest(event('response.text.delta',{event_id:'e3',turn_id:'t2',response_id:'r1',payload:{text:'bad'}})).reason,'inactive_response');
  assert.equal(runtime.ingest(event('response.started',{event_id:'e4',turn_id:'t2',response_id:'r2'})).reason,'overlapping_response');
  assert.equal(runtime.snapshot().active_response_id,'r1');
});
test('failed and closed sessions never reopen', () => {
  for (const type of ['session.failed','session.closed']) {
    const runtime = new SessionRuntime('s1');
    runtime.ingest(event(type,{payload:type === 'session.failed'?{code:'TEST_FAILURE'}:{}}));
    assert.equal(runtime.ingest(event('session.ready',{event_id:'e2'})).reason,'terminal_session');
  }
});
test('event budget bounds deduplication storage', () => {
  const runtime = new SessionRuntime('s1',{maxEvents:1}); ready(runtime);
  assert.equal(runtime.ingest(event('session.closed',{event_id:'e2'})).reason,'event_limit');
  assert.equal(runtime.seen.size,1);
});
test('snapshots cannot mutate the runtime learning record', () => {
  const runtime = new SessionRuntime('s1'); ready(runtime);
  runtime.ingest(event('user.final',{event_id:'e2',turn_id:'t1',payload:{text:'足球'}}));
  runtime.snapshot().evidence[0].kind = 'mastered';
  assert.equal(runtime.snapshot().evidence[0].kind,'attempted');
});
test('replay can be aborted without leaking more events', async () => {
  const fixture = await loadScenario('normal');
  const provider = new ReplayProvider(fixture);
  const abort = new AbortController();
  const seen = [];
  for await (const item of provider.open({signal:abort.signal})) { seen.push(item); abort.abort(); }
  assert.equal(seen.length,1);
  await provider.close();
  await assert.rejects(provider.sendAudio(new Uint8Array()),/REPLAY_DOES_NOT_ACCEPT_AUDIO/);
});
test('normal and failure fixtures have deterministic outcomes', async () => {
  const normal = await runScenario('normal');
  assert.equal(normal.status,'closed'); assert.equal(normal.dropped,0);
  assert.equal(normal.evidence.length,1); assert.equal(normal.provider_connected,false);
  const failure = await runScenario('failure');
  assert.equal(failure.status,'failed'); assert.equal(failure.accepted,1); assert.equal(failure.dropped,2);
});
test('fixture selection cannot traverse paths', async () => {
  await assert.rejects(loadScenario('../../.env'),/UNKNOWN_SCENARIO/);
});
