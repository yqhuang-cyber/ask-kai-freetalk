import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {classifySpeechPace,SpeechPaceState} from '../packages/agent-core/speech.js';
import {TeachingSession} from '../packages/agent-core/teaching.js';
import {createDoubaoProvider} from '../packages/provider-doubao/seeduplex.js';
import {SpeechPlayback,speechStateMessage} from '../apps/realtime-gateway/public/speech-playback.js';
import {SpeechPaceCoordinator} from '../apps/realtime-gateway/src/speech-pace-coordinator.js';
import {ConversationInitializer} from '../packages/agent-core/conversation-initializer.js';
import {learnerFixture} from '../apps/hskai-mock/src/planning-fixtures.js';
import {setup,until} from './helpers/realtime.js';

const event=(text,turn=randomUUID())=>({version:1,event_id:randomUUID(),session_id:'synthetic',seq:1,at_ms:0,type:'user.final',turn_id:turn,payload:{text}});
test('spoken speed controls distinguish explicit requests from discussion, negation and ambiguity',()=>{
  for(const text of ['慢一点','请说慢一点。','你可以说慢一点吗？','语速慢一点','请把语速调慢一点','说话稍微慢一点','slower please','Could you speak more slowly?'])assert.equal(classifySpeechPace(text),'slower',text);
  for(const text of ['快一点','请说快一点','语速快一点吧','speak faster please'])assert.equal(classifySpeechPace(text),'faster',text);
  for(const text of ['恢复正常语速','请恢复正常语速。','back to normal speed'])assert.equal(classifySpeechPace(text),'normal',text);
  for(const text of ['不要说慢一点','不用加快','别把语速调快一点','“慢一点”用英语怎么说','慢一点是什么意思','他说“快一点”','慢一点还是快一点','我今天走路慢一点','快一点结束吧','不要说慢一点，正常聊就好','慢一点，快一点'])assert.equal(classifySpeechPace(text),null,text);
});
test('relative changes are bounded and only released/acknowledged settings become active',()=>{
  const s=new SpeechPaceState('slow');s.enable(-20);
  const first=s.observe(event('慢一点'));assert.equal(first.target,-40);assert.equal(s.applied,-20);assert.equal(s.contextSpeed,-20);
  assert.equal(s.release('foreign'),false);assert.equal(s.release(first.id),true);assert.equal(s.applied,-20);
  s.confirm(s.snapshot());assert.equal(s.applied,-40);
  const limit=s.observe(event('慢一点'));assert.equal(limit.changed,false);assert.equal(limit.target,-40);
  for(let i=0;i<6;i++)s.observe(event('快一点'));assert.equal(s.desired,40);
  const restore=s.observe(event('恢复正常'));assert.equal(restore.target,0);
  s.abandon(restore.id);assert.equal(s.desired,-40);
});
test('effective session speed survives learner/profile refresh without creating teaching attempts',()=>{
  const s=new TeachingSession({sessionId:'synthetic',mode:'free',speechPace:'slow'});s.speech.enable(-20);
  const e=event('快一点');assert.equal(s.accept(e),true);assert.equal(s.accept(e),false);
  assert.equal(s.view().decision.action,'RESPOND');assert.equal(s.view().decision.new_points,0);
  s.releaseSpeechRequest(e.event_id);s.updateMemory([{field:'interest',value:'足球',source:'student_correction',updated_at:'2026-10-24'}]);
  assert.equal(s.contextSnapshot().speech.speed,0);assert.match(s.instructions(),/本场有效语速：正常/);assert.equal(s.view().attempt_count,0);
});
test('Planner/profile refresh cannot reintroduce the old initial pace into effective instructions',async()=>{
  const identity={owner_id:'owner',learner_id:'learner',scopes:['session:create','context:read'],authorization_until:Date.now()+60000};
  const prepared=await new ConversationInitializer({port:{read:async()=>learnerFixture(identity)},planner:null}).prepare({mode:'free',speech_pace:'slow'},identity);
  const s=new TeachingSession({sessionId:'synthetic',mode:'free',speechPace:'slow',planning:{...prepared,plan:{...prepared.plan,session_id:'synthetic'}}});
  s.speech.enable(-20);const e=event('快一点');s.accept(e);assert.equal(await s.planTurn(e),null);s.releaseSpeechRequest(e.event_id);
  s.updateLearnerContext(prepared.context);
  const next=event('今天天气很好');s.accept(next);await s.planTurn(next);
  assert.equal(s.contextSnapshot().speech.speed,0);assert.match(s.instructions(),/本场有效语速：正常/);
  assert.ok(!s.instructions().includes('"pace":"slow"'));assert.equal(s.planning.plan.strategy.pace,'slow');
  s.planning.close();
});

const template=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
async function fixture(t,options={}) {
  let x;
  const source=structuredClone(template);source.reviewed=true;source.realtime.reviewed=true;source.realtime.ordered_acks_reviewed=true;
  const gateway=await setup(t,{speechPaceSupported:true,...options,providerFactory:ticket=>{
    const socket=new EventEmitter(),sent=[];Object.assign(socket,{readyState:1,bufferedAmount:0,send:value=>sent.push(JSON.parse(value)),terminate:()=>{}});
    const provider=createDoubaoProvider({profile:source,speechPace:ticket.speech_pace,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});
    const original=provider.open.bind(provider);provider.open=input=>{original(input);socket.emit('open');};
    let seq=0;
    x={provider,sent,wire:raw=>socket.emit('message',Buffer.from(JSON.stringify({event_id:`fixture-${++seq}`,...raw})),false)};
    return provider;
  }});
  const client=await gateway.open(await(await gateway.create({mode:'free',speech_pace:'slow'})).json());
  x.wire({type:'session.created',session:{id:'fixture-session'}});
  await until(()=>client.packets.some(p=>p.event?.type==='session.ready'));
  const automatic=(turn,id)=>x.wire({type:'response.output_text.delta',question_id:turn,response_id:id,delta:'未受控的自动回复'});
  const input=(text,turn)=>x.wire({type:'conversation.item.input_audio_transcription.completed',item_id:turn,text});
  const synth=(id)=>{
    x.wire({type:'response.output_audio.started',question_id:`fixed-question-${id}`,response_id:id});
    x.wire({type:'response.output_audio.delta',response_id:id,delta:Buffer.alloc(4800,2).toString('base64')});
    x.wire({type:'response.output_audio.done',question_id:`fixed-question-${id}`,response_id:id});
  };
  const reported=new Set();
  const playback=async phase=>{
    const matches=p=>p.type==='speech.state'&&p.phase===`awaiting_${phase}_playback`&&!reported.has(`${p.request_id}:${phase}`);
    await until(()=>client.packets.some(matches));
    const p=client.packets.findLast(matches);reported.add(`${p.request_id}:${phase}`);
    client.ws.send(JSON.stringify({type:'speech.playback',request_id:p.request_id,response_id:p.response_id,phase,state:'played',audio_ms:p.audio_ms}));
    return p;
  };
  return {...gateway,...client,...x,input,automatic,synth,playback,source};
}
test('spoken slower runs owned request speech, playback, serialized speed ACK and new-speed result speech',async t=>{
  const f=await fixture(t);
  f.input('慢一点','request-turn');f.automatic('request-turn','auto-reply');
  assert.equal(f.sent.at(-1).type,'response.cancel');
  f.wire({type:'response.canceled',response_id:'auto-reply'});
  assert.match(f.sent.at(-1).text,/我来把语速放慢/);
  assert.equal(f.sent.some(p=>p.type==='session.update'),false);
  f.synth('before');const before=await f.playback('before');
  await until(()=>f.sent.some(p=>p.type==='session.update'));
  const update=f.sent.find(p=>p.type==='session.update');assert.equal(update.session.audio.output.speed,-40);
  assert.match(update.session.instructions,/本场有效语速：更慢/);assert.equal(f.provider.profile.session_create.session.audio.output.speed,-20);
  assert.equal(f.sent.filter(p=>p.type==='speech_text_buffer.commit').length,1);
  f.wire({type:'session.updated',session:{id:'fixture-session'}});
  assert.equal(f.provider.profile.session_create.session.audio.output.speed,-40);
  assert.match(f.sent.at(-1).text,/已经放慢了/);f.synth('after');const after=await f.playback('after');
  await until(()=>f.packets.some(p=>p.type==='speech.state'&&p.phase==='complete'));
  const control=f.packets.filter(p=>p.speech_control);
  assert.ok(control.length>4);assert.ok(control.every(p=>p.event.turn_id===before.turn_id));
  assert.ok(!f.packets.some(p=>p.event?.payload?.text==='未受控的自动回复'));
  assert.ok(f.packets.filter(p=>p.type==='teaching.state').every(p=>p.attempt_count===0));
  assert.equal(f.source.session_create.session.audio.output.speed,-20);
  // A duplicate/late playback receipt cannot start another update or utterance.
  const count=f.sent.length;f.ws.send(JSON.stringify({type:'speech.playback',request_id:after.request_id,response_id:after.response_id,phase:'after',state:'played',audio_ms:after.audio_ms}));await new Promise(r=>setTimeout(r,20));assert.equal(f.sent.length,count);
});
test('new input cancels stale confirmation and a pending update ACK cannot announce stale success',async t=>{
  const f=await fixture(t);
  f.input('快一点','first');f.automatic('first','auto-first');f.wire({type:'response.canceled',response_id:'auto-first'});
  f.synth('pre-first');await f.playback('before');await until(()=>f.sent.some(p=>p.type==='session.update'));
  f.input('我们聊聊公园','new-topic');
  f.wire({type:'session.updated',session:{id:'fixture-session'}});
  assert.equal(f.sent.filter(p=>p.type==='speech_text_buffer.commit').length,1);
  assert.equal(f.provider.profile.session_create.session.audio.output.speed,0);
  assert.ok(!f.sent.some(p=>p.text?.includes('已经加快了')));
});
test('failed update cannot generate a successful spoken confirmation',async t=>{
  const f=await fixture(t,{contextTimeoutMs:30});
  f.input('快一点','request');f.automatic('request','auto');f.wire({type:'response.canceled',response_id:'auto'});
  f.synth('pre');await f.playback('before');await once(f.ws,'close');
  assert.equal(f.sent.filter(p=>p.type==='speech_text_buffer.commit').length,1);
  assert.equal(f.packets.find(p=>p.type==='session.failed').code,'CONTEXT_ACK_TIMEOUT');
});
test('successive faster requests serialize a queued cancel behind the old update and retain the newest target',async t=>{
  const f=await fixture(t);
  f.input('快一点','first');f.automatic('first','auto-first');f.wire({type:'response.canceled',response_id:'auto-first'});
  f.synth('pre-first');await f.playback('before');await until(()=>f.sent.some(p=>p.type==='session.update'));
  assert.equal(f.sent.findLast(p=>p.type==='session.update').session.audio.output.speed,0);
  f.input('再快一点','second');f.automatic('second','auto-second');
  const count=f.sent.filter(p=>p.type==='response.cancel').length;assert.equal(count,1);
  f.wire({type:'session.updated',session:{id:'fixture-session'}});
  assert.equal(f.sent.filter(p=>p.type==='speech_text_buffer.commit').length,1);
  assert.equal(f.sent.at(-1).type,'response.cancel');
  f.wire({type:'response.canceled',response_id:'auto-second'});
  f.synth('pre-second');await f.playback('before');
  await until(()=>f.sent.filter(p=>p.type==='session.update').length===2);
  assert.equal(f.sent.findLast(p=>p.type==='session.update').session.audio.output.speed,20);
  f.wire({type:'session.updated',session:{id:'fixture-session'}});f.synth('post-second');await f.playback('after');
  await until(()=>f.packets.some(p=>p.type==='speech.state'&&p.phase==='complete'&&p.output_speed===20));
  assert.equal(f.sent.filter(p=>p.text?.includes('已经加快了')).length,1);
});
test('a manually cancelled reserved utterance cannot revive its request when late audio starts',async t=>{
  const f=await fixture(t);f.input('慢一点','request');f.automatic('request','auto');f.wire({type:'response.canceled',response_id:'auto'});
  f.ws.send(JSON.stringify({type:'response.cancel'}));
  await until(()=>f.packets.some(p=>p.type==='speech.state'&&p.phase==='cancelled'));
  f.wire({type:'response.output_audio.started',response_id:'late-fixed',question_id:'late-fixed-question'});
  assert.equal(f.sent.at(-1).type,'response.cancel');f.wire({type:'response.canceled',response_id:'late-fixed'});
  assert.ok(f.sent.filter(p=>p.type==='session.update').every(p=>p.session.audio.output.speed===-20));
  assert.equal(f.packets.some(p=>p.speech_control&&p.event.type==='response.started'),false);
});
test('limits do not falsely claim that a superseded, unconfirmed target has already been applied',()=>{
  const s=new SpeechPaceState('slow');s.enable(-20);s.observe(event('慢一点'));
  const repeated=s.observe(event('慢一点'));assert.equal(repeated.target,-40);assert.equal(repeated.changed,true);
});
test('browser speech receipts require matching drained PCM and completed captions',()=>{
  const reports=[],presentation={current:'owned',mode:'playing'};
  let playback={running:true,received_ms:100,queued_ms:30};
  const browser=new SpeechPlayback({presentation,getPlayback:()=>playback,isMuted:()=>false,send:p=>reports.push(p)});
  const p={phase:'awaiting_before_playback',request_id:'request',response_id:'owned',audio_ms:100};browser.update(p);assert.equal(reports.length,0);
  presentation.mode='complete';browser.check();assert.equal(reports.length,0);
  playback.queued_ms=0;assert.equal(browser.check(),true);assert.equal(reports.length,1);assert.equal(browser.check(),false);
  browser.update({...p,phase:'cancelled'});assert.equal(browser.check(),false);
  assert.match(speechStateMessage({phase:'failed',output_speed:0}),/未完成/);
});
test('wrong-version context and forged playback cannot complete a speed transaction',()=>{
  let applies=0;const s=new TeachingSession({sessionId:'synthetic',mode:'free',speechPace:'slow'});s.speech.enable(-20);const e=event('快一点');s.accept(e);
  const c=new SpeechPaceCoordinator({sessionId:'synthetic',teaching:s,send:()=>{},speak:()=>{},available:()=>true,settled:()=>true,apply:()=>applies++,fail:()=>assert.fail('unexpected timeout')});
  c.input(e,s.speech.request);
  assert.equal(c.report({phase:'before',request_id:e.event_id,response_id:'foreign',state:'played',audio_ms:0}),false);
  c.confirmed({speech:{request_id:'foreign',speed:0}});assert.equal(c.current.phase,'speaking_before');assert.equal(applies,0);c.close();
});
