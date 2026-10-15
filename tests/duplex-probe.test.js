import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { preflight, validateProfile, runProbe } from '../packages/provider-doubao/probe.js';
const profile = () => ({version:1,reviewed:true,endpoint:'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue',evidence_source:'https://docs.volcengine.com/docs/6561/2556358',auth:{header:'X-Test-Auth',env:'DOUBAO_TEST_KEY',prefix:''},ready:{type:'test.ready',session_id_path:'session.id'},observed_event_types:['test.ready','test.error'],identity_paths:['session.id','response_id'],session_create:{type:'session.create',session:{}}});
const env = { DOUBAO_TEST_KEY:'synthetic-secret-only' };
class FakeSocket extends EventTarget {
  readyState = 1;
  sent = [];
  closed = false;
  send(value) { this.sent.push(value); }
  close() { this.closed = true; }
  open() { this.dispatchEvent(new Event('open')); }
  message(value) { this.dispatchEvent(new MessageEvent('message',{data:value})); }
}
function simulated(options = {}) {
  const socket = new FakeSocket();
  const promise = runProbe({profile:profile(),env,durationMs:20,socketFactory:()=>socket,...options});
  return {socket,promise};
}
test('unreviewed official template never enables network, even with a key', async () => {
  const template = JSON.parse(await readFile(new URL('../docs/protocol/duplex-profile.template.json',import.meta.url),'utf8'));
  assert.equal(preflight(template,env).live_eligible,false);
  let opened = false;
  await assert.rejects(runProbe({profile:template,env,socketFactory:()=>{opened=true;}}),/PREFLIGHT_BLOCKED/);
  assert.equal(opened,false);
});
test('reviewed profile still requires credentials and fixed official endpoint', () => {
  assert.equal(preflight(profile(),{}).live_eligible,false);
  assert.throws(()=>validateProfile({...profile(),endpoint:'wss://evil.example'}),/INVALID_PROTOCOL_PROFILE/);
  assert.throws(()=>validateProfile({...profile(),evidence_source:'https://volcengine.com.evil.example/docs'}),/OFFICIAL_PROTOCOL_EVIDENCE_REQUIRED/);
  assert.throws(()=>validateProfile({...profile(),session_create:{type:'session.create',session:{api_key:'bad'}}}),/INVALID_SESSION_CREATE/);
  assert.throws(()=>validateProfile({...profile(),auth:{header:'Host',env:'DOUBAO_TEST_KEY',prefix:''}}),/INVALID_AUTH_MAPPING/);
});
test('socket open alone is not session readiness; outgoing create is JSON', async () => {
  const {socket,promise} = simulated(); socket.open();
  assert.deepEqual(JSON.parse(socket.sent[0]),{type:'session.create',session:{}});
  const report = await promise;
  assert.equal(report.socket_open_observed,true); assert.equal(report.session_ready_observed,false); assert.equal(report.provider_connected,false);
  assert.equal(socket.closed,true);
});
test('readiness requires the reviewed event and actual session identity', async () => {
  const {socket,promise} = simulated(); socket.open();
  socket.message(JSON.stringify({type:'test.ready',session:{}}));
  socket.message(JSON.stringify({type:'test.ready',session:{id:'synthetic-session'}}));
  const report = await promise;
  assert.equal(report.session_ready_observed,true); assert.equal(report.provider_connected,false);
});
test('metadata excludes keys, transcripts, audio, provider session IDs and error messages', async () => {
  const {socket,promise} = simulated(); socket.open();
  socket.message(JSON.stringify({type:'test.error',event_id:'private-id',transcript:'private student text',audio:'private-audio',api_key:env.DOUBAO_TEST_KEY,error:{message:'private error'}}));
  socket.message(JSON.stringify({type:'private-student-text-as-type',session:{id:'private-id'}}));
  const serialized = JSON.stringify(await promise);
  for (const value of ['private student text','private-audio','private-id','private error',env.DOUBAO_TEST_KEY,'private-student-text-as-type']) assert.ok(!serialized.includes(value));
});
test('malformed, oversized and unverified binary frames stop the probe', async () => {
  for (const [data,ended] of [['not-json','invalid_json'],['[]','invalid_json_shape'],[new ArrayBuffer(2),'binary_protocol_unverified'],['x'.repeat(100),'oversized_frame']]) {
    const {socket,promise} = simulated({maxFrameBytes:64});socket.open();socket.message(data);
    assert.equal((await promise).ended,ended);
  }
});
test('frame budget, transport failure and abort stop the socket', async () => {
  const first = simulated({maxFrames:1});first.socket.open();
  first.socket.message('{"type":"unknown"}');first.socket.message('{"type":"unknown"}');
  assert.equal((await first.promise).ended,'frame_limit');
  const second = simulated(); second.socket.dispatchEvent(new Event('error'));
  assert.equal((await second.promise).ended,'transport_error');
  const abort = new AbortController();const third = simulated({signal:abort.signal});abort.abort();
  assert.equal((await third.promise).ended,'aborted');assert.equal(third.socket.closed,true);
});
test('credential and profile errors do not reach transport construction', async () => {
  let opened = false;
  await assert.rejects(runProbe({profile:profile(),env:{DOUBAO_TEST_KEY:'bad\nheader'},socketFactory:()=>{opened=true;}}),/INVALID_CREDENTIAL_FORMAT/);
  assert.equal(opened,false);
});
test('built-in Node WebSocket sends headers and receives JSON on a local test server', async t => {
  const server = createServer();const observed = new EventEmitter();let peer;
  server.on('upgrade',(req,socket) => {
    peer = socket;
    observed.emit('header',req.headers['x-test-auth']);
    const accept = createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    // Single small unmasked server text frame; this is a test peer, not a server implementation.
    const body = Buffer.from('{"type":"test.ready","session":{"id":"synthetic"}}');
    socket.write(Buffer.concat([Buffer.from([0x81,body.length]),body]));
    socket.on('error',()=>{});
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{peer?.destroy();server.close(resolve);server.closeAllConnections();}));
  const header = once(observed,'header');
  const report = await runProbe({profile:profile(),env,durationMs:80,socketFactory:(_url,options)=>new WebSocket(`ws://127.0.0.1:${server.address().port}`,options)});
  assert.equal((await header)[0],env.DOUBAO_TEST_KEY);
  assert.equal(report.session_ready_observed,true);
});
test('identity aliases correlate within a probe but cannot join separate probes', async () => {
  const reports = [];
  for (let index=0;index<2;index++) {
    const {socket,promise} = simulated();socket.open();
    socket.message('{"type":"test.ready","session":{"id":"private-id"},"response_id":"reply-private"}');
    socket.message('{"type":"test.error","response_id":"reply-private"}');
    reports.push(await promise);
  }
  assert.equal(reports[0].events[0].identity_refs.response_id,reports[0].events[1].identity_refs.response_id);
  assert.notEqual(reports[0].events[0].identity_refs.response_id,reports[1].events[0].identity_refs.response_id);
  assert.throws(()=>validateProfile({...profile(),identity_paths:['payload.text']}),/INVALID_IDENTITY_PATHS/);
});
test('live CLI with the unreviewed template fails before connection and masks credentials', () => {
  const result = spawnSync(process.execPath,['scripts/duplex-probe.js','--live'],{encoding:'utf8',env:{PATH:process.env.PATH,DOUBAO_API_KEY:'synthetic-cli-secret'}});
  assert.equal(result.status,1);
  assert.match(result.stderr,/PROBE_PREFLIGHT_BLOCKED/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes('synthetic-cli-secret'));
});
test('official metadata probe mutes after readiness, closes session and masks fatal wire errors', async () => {
  const p = JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
  p.reviewed = true;
  const {socket,promise} = simulated({profile:p,env:{DOUBAO_API_KEY:'synthetic-only'}});
  socket.open();socket.message('{"type":"session.created","session":{"id":"private-session"}}');
  const report = await promise;
  assert.equal(report.session_ready_observed,true);
  assert.equal(socket.sent.map(s=>JSON.parse(s).type).join(','),'session.create,input_audio_mute.commit,session.close');
  const failed = simulated({profile:p,env:{DOUBAO_API_KEY:'synthetic-only'}});failed.socket.open();
  failed.socket.message('{"type":"error","error":{"message":"synthetic-only private failure"}}');
  const error = await failed.promise;assert.equal(error.ended,'provider_error');assert.ok(!JSON.stringify(error).includes('private failure'));
});
