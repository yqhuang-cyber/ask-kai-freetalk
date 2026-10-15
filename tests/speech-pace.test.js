import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createDoubaoProvider, validateSeeduplexProfile } from '../packages/provider-doubao/seeduplex.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { ExperienceTrace, metadata } from '../apps/realtime-gateway/public/diagnostics.js';
import { setup, until } from './helpers/realtime.js';

// Authored synthetic peers only: these tests do not attest to a real supplier account.
const template=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
function profile() {const p=structuredClone(template);p.reviewed=true;p.realtime.reviewed=true;p.realtime.ordered_acks_reviewed=true;return p;}
function peer(source,speechPace) {
  const socket=new EventEmitter(),sent=[];
  Object.assign(socket,{readyState:1,bufferedAmount:0,send:value=>sent.push(JSON.parse(value)),terminate:()=>{}});
  const provider=createDoubaoProvider({profile:source,speechPace,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});
  const original=provider.open.bind(provider);provider.open=options=>{original(options);socket.emit('open');};
  let seq=0;
  return {provider,sent,wire:raw=>socket.emit('message',Buffer.from(JSON.stringify({event_id:`synthetic-${++seq}`,...raw})),false)};
}
test('speed presets reach session.create without changing audio format or mutating concurrent profiles',()=>{
  const source=profile();source.session_create.session.audio.output.speed=17;
  const slow=peer(source,'slow'),normal=peer(source,'normal'),legacy=peer(source,undefined);
  for(const x of [slow,normal,legacy])x.provider.open({sessionId:'synthetic-local',instructions:'synthetic lesson',onEvent:()=>{},onFailure:()=>assert.fail('synthetic transport failure')});
  assert.deepEqual([slow,normal,legacy].map(x=>x.sent[0].session.audio.output.speed),[-20,0,17]);
  assert.equal(source.session_create.session.audio.output.speed,17);
  for(const x of [slow,normal,legacy]) {
    assert.deepEqual(x.sent[0].session.audio.output.format,{type:'pcm_s16le',rate:24000});
    assert.deepEqual(x.sent[0].session.audio.input.format,{type:'pcm',rate:16000});
    x.wire({type:'session.created',session:{id:'synthetic-session'}});
    const bytes=Buffer.alloc(640,2);x.provider.sendAudio(bytes);
    assert.deepEqual(Buffer.from(x.sent.at(-1).audio,'base64'),bytes);
    x.provider.close();
  }
});
test('invalid speed values and unreviewed pace mappings fail before connection',()=>{
  for(const speed of [-51,101,NaN,Infinity,'-20',null,{}]) {
    const p=profile();p.session_create.session.audio.output.speed=speed;
    assert.throws(()=>validateSeeduplexProfile(p),/INVALID_SEEDUPLEX_SPEED/);
  }
  for(const speed of [-50,0,100]){const p=profile();p.session_create.session.audio.output.speed=speed;assert.equal(validateSeeduplexProfile(p),p);}
  assert.throws(()=>peer(profile(),'fast'),/INVALID_SPEECH_PACE/);
  assert.throws(()=>createDoubaoProvider({profile:{realtime:{protocol:'generic'}},speechPace:'slow'}),/SPEECH_PACE_UNSUPPORTED/);
  assert.throws(()=>peer(template,'slow'),/NOT_VERIFIED/);
});
test('capabilities stay honest and the session API rejects arbitrary settings and unsupported choices',async t=>{
  const {origin,create}=await setup(t);
  const capability=await(await fetch(origin+'/api/speech-paces')).json();assert.equal(capability.supported,false);assert.deepEqual(capability.options,[]);
  assert.equal((await create({mode:'sports',speech_pace:'slow'})).status,400);
  const x=await setup(t,{speechPaceSupported:true});
  for(const speech_pace of [null,-20,'fast','constructor',{speed:-20}])assert.equal((await x.create({mode:'sports',speech_pace})).status,400);
  assert.equal((await x.create({mode:'sports',speed:-20})).status,400);
  assert.equal((await x.create({mode:'sports',speech_pace:'slow',learner_id:'foreign'})).status,400);
});
test('ticket choice drives real transport payload, diagnostics and subsequent teaching updates (synthetic peer)',async t=>{
  const peers=[],tickets=[],source=profile();
  const {origin,create,open}=await setup(t,{speechPaceSupported:true,providerFactory:ticket=>{tickets.push(ticket);const x=peer(source,ticket.speech_pace);peers.push(x);return x.provider;}});
  const caps=await(await fetch(origin+'/api/speech-paces')).json();assert.equal(caps.supported,true);assert.equal(caps.default,'slow');assert.deepEqual(caps.options.map(o=>o.id),['slow','normal']);
  const first=await open(await(await create()).json()),slow=peers[0];
  const second=await open(await(await create({mode:'free',speech_pace:'normal'})).json()),normal=peers[1];
  assert.deepEqual(tickets.map(x=>x.speech_pace),['slow','normal']);
  assert.deepEqual(peers.map(x=>x.sent[0].session.audio.output.speed),[-20,0]);
  await until(()=>first.packets.some(p=>p.type==='session.config'));
  assert.deepEqual(first.packets.find(p=>p.type==='session.config').speech,{supported:true,pace:'slow',output_speed:-20});
  first.ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>first.packets.some(p=>p.row?.name==='session.config'));
  const trace=new ExperienceTrace();first.packets.filter(p=>p.row).forEach(p=>trace.gateway(p.row));
  const row=trace.snapshot().timeline.find(r=>r.name==='session.config');assert.equal(row.speech_pace,'slow');assert.equal(row.output_speed,-20);assert.equal(row.speed_explicit,true);assert.equal(row.speech_pace_supported,true);assert.equal(trace.snapshot().kind,'synthetic');
  slow.wire({type:'session.created',session:{id:'synthetic-session'}});
  slow.wire({type:'conversation.item.input_audio_transcription.completed',item_id:'synthetic-turn',transcript:'我喜欢足球'});
  slow.wire({type:'response.output_text.delta',response_id:'synthetic-reply',question_id:'synthetic-turn',delta:'很好！'});
  slow.wire({type:'response.done',response_id:'synthetic-reply',question_id:'synthetic-turn'});
  await until(()=>slow.sent.some(p=>p.type==='session.update'));
  assert.match(slow.sent.find(p=>p.type==='session.update').session.instructions,/kai-speech-v1；档位：slow/);
  assert.match(normal.sent[0].session.instructions,/档位：normal/);
  slow.wire({type:'session.updated',session:{id:'synthetic-session'}});
  await until(()=>first.packets.some(p=>p.type==='teaching.context.applied'));
  // Pace changes are next-session settings, not an extra control competing with cancel/context ACKs.
  first.ws.send(JSON.stringify({type:'speech.pace',pace:'normal'}));await once(first.ws,'close');
  assert.equal(slow.sent[0].session.audio.output.speed,-20);
  second.ws.close();await once(second.ws,'close');
});
test('pace guidance persists across lesson/memory updates and exports only allowlisted settings',()=>{
  const teaching=new TeachingSession({sessionId:'synthetic',speechPace:'slow'});
  teaching.stage='practice';teaching.version++;teaching.memory=[{field:'interest',value:'跑步',source:'student_correction',updated_at:'2026-10-09'}];
  assert.match(teaching.instructions(),/档位：slow/);assert.match(teaching.instructions(),/意群边界自然停顿/);
  assert.deepEqual(metadata({speech_pace:'normal',speech_pace_supported:true,output_speed:0,speed_explicit:true,text:'private'}),{speech_pace:'normal',speech_pace_supported:true,output_speed:0,speed_explicit:true});
  assert.deepEqual(metadata({speech_pace:'private',output_speed:-51}),{});
});
