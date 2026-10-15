import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ReviewedDoubaoProvider,validateRealtimeProfile } from '../packages/provider-doubao/realtime.js';
import { DUPLEX_ENDPOINT } from '../packages/provider-doubao/probe.js';
function fakeProfile() {
  const inbound={};
  for(const name of ['user_partial','user_final','response_started','text_delta','audio_chunk','response_done','response_cancelled','speech_started','context_updated','error'])inbound[name]={type:`test.${name}`,turn:'turn_id',response:'response_id',text:'text',audio:'audio',version:'version'};
  return {version:1,endpoint:DUPLEX_ENDPOINT,reviewed:true,evidence_source:'https://docs.volcengine.com/test-only',auth:{header:'X-Test-Key',env:'DOUBAO_TEST_KEY',prefix:''},ready:{type:'test.ready',session_id_path:'session.id'},observed_event_types:['test.ready'],identity_paths:[],session_create:{type:'session.create',session:{}},realtime:{reviewed:true,evidence_source:'https://docs.volcengine.com/test-only',audio:{encoding:'pcm_s16le',input_rate:16000,output_rate:24000,frame_ms:20},initial_instructions:'session.instructions',inbound,outbound:{audio:{type:'test.audio',data:'data'},cancel:{type:'test.cancel',response:'response_id'},context:{type:'test.context',instructions:'instructions',version:'version'}}}};
}
test('reviewed adapter maps explicitly configured JSON and never exposes raw provider identities',()=> {
  const socket=new EventEmitter();socket.readyState=1;socket.bufferedAmount=0;const sent=[];socket.send=v=>sent.push(JSON.parse(v));socket.terminate=()=>socket.ended=true;
  const packets=[];
  const provider=new ReviewedDoubaoProvider({profile:fakeProfile(),env:{DOUBAO_TEST_KEY:'synthetic-secret'},socketFactory:(url,options)=>{assert.equal(url,DUPLEX_ENDPOINT);assert.equal(options.headers['X-Test-Key'],'synthetic-secret');assert.equal(options.maxPayload,131072);return socket;}});
  provider.open({sessionId:'local-session',instructions:'trusted teaching',onEvent:p=>packets.push(p),onFailure:()=>assert.fail('unexpected failure')});socket.emit('open');
  assert.equal(sent[0].session.instructions,'trusted teaching');
  const wire=value=>socket.emit('message',Buffer.from(JSON.stringify(value)),false);
  wire({type:'test.ready',session:{id:'private-session'}});
  wire({type:'test.response_started',turn_id:'private-turn',response_id:'private-response'});
  wire({type:'test.audio_chunk',turn_id:'private-turn',response_id:'private-response',audio:'AAAAAA=='});
  const id=packets[1].event.response_id;assert.equal(packets[2].event.response_id,id);assert.equal(packets[2].audio,'AAAAAA==');
  assert.ok(!JSON.stringify(packets).includes('private-'));provider.cancel(id);assert.equal(sent.at(-1).response_id,'private-response');
  provider.sendAudio(Buffer.alloc(640));assert.equal(sent.at(-1).type,'test.audio');
  provider.updateContext({version:2,instructions:'next'});assert.equal(sent.at(-1).version,2);
  provider.close();assert.equal(socket.ended,true);
});
test('realtime mappings reject unreviewed formats and prototype-mutating paths',()=> {
  const profile=fakeProfile();profile.realtime.audio.encoding='opus';assert.throws(()=>validateRealtimeProfile(profile),/AUDIO/);
  const bad=fakeProfile();bad.realtime.outbound.context.instructions='constructor.prototype';assert.throws(()=>validateRealtimeProfile(bad),/MAPPING/);
});
test('initialization/send failures remain safe provider errors instead of escaping the socket listener',()=> {
  const socket=new EventEmitter();socket.readyState=1;socket.bufferedAmount=0;socket.send=()=>{throw new Error('private-error-with-key');};socket.terminate=()=>{};
  const failures=[];const provider=new ReviewedDoubaoProvider({profile:fakeProfile(),env:{DOUBAO_TEST_KEY:'test-only'},socketFactory:()=>socket});
  provider.open({sessionId:'s1',instructions:'safe',onEvent:()=>{},onFailure:code=>failures.push(code)});
  assert.doesNotThrow(()=>socket.emit('open'));assert.deepEqual(failures,['PROVIDER_INITIALIZATION_FAILED']);provider.close();
});
