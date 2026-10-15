import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createDoubaoProvider } from '../packages/provider-doubao/seeduplex.js';
import { TurnOutputGate } from '../apps/realtime-gateway/src/output-gate.js';
import { ExperienceTrace } from '../apps/realtime-gateway/public/diagnostics.js';
import { setup, until } from './helpers/realtime.js';

// All wire messages and audio are authored synthetic; no live supplier account.
const template=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
function peer() {
  const profile=structuredClone(template);profile.reviewed=true;profile.realtime.reviewed=true;profile.realtime.ordered_acks_reviewed=true;
  const socket=new EventEmitter(),sent=[];
  Object.assign(socket,{readyState:1,bufferedAmount:0,send:v=>sent.push(JSON.parse(v)),terminate:()=>{}});
  const provider=createDoubaoProvider({profile,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});
  const open=provider.open.bind(provider);provider.open=options=>{open(options);socket.emit('open');};
  let seq=0;return {provider,sent,wire:raw=>socket.emit('message',Buffer.from(JSON.stringify({event_id:`synthetic-${++seq}`,...raw})),false)};
}
const response=(type,id='synthetic-r1',turn='synthetic-t1',extra={})=>({type,response_id:id,question_id:turn,...extra});
const asr=(type,turn='synthetic-t2',extra={})=>({type:`conversation.item.input_audio_transcription.${type}`,item_id:turn,...extra});
const cancels=x=>x.sent.filter(p=>p.type==='response.cancel');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function gateway(t,options={}) {
  const x=peer(),g=await setup(t,{replyGraceMs:15,providerFactory:()=>x.provider,...options});
  const connection=await g.open(await(await g.create()).json());
  x.wire({type:'session.created',session:{id:'synthetic-session'}});
  connection.ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>connection.packets.some(p=>p.row?.name==='session.config'));
  return {...x,...connection};
}
function clockGate(options={}) {
  let now=0,next=0;const timers=new Map(),sent=[],failed=[],observed=[];
  const gate=new TurnOutputGate({send:p=>sent.push(p),fail:code=>failed.push(code),observe:(name,fields)=>observed.push({name,fields}),now:()=>now,schedule:(fn,ms)=>{timers.set(++next,{fn,at:now+ms});return next;},unschedule:id=>timers.delete(id),...options});
  const advance=ms=>{const end=now+ms;while(true){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;};
  const packet=(type,id='r1',turn='t1')=>({event:{type,response_id:id,turn_id:turn,payload:{}}});
  return {gate,advance,sent,failed,observed,timers,packet};
}
test('unfinished student turn and short pause never release teacher text/audio; final plus grace releases in order',()=>{
  const x=clockGate();x.gate.candidate('t1');x.gate.user({type:'user.partial',turn_id:'t1'});
  for(const type of ['response.started','response.text.delta','response.audio.chunk','response.done'])x.gate.push(x.packet(type));
  x.advance(1000);assert.equal(x.sent.length,0);
  x.gate.user({type:'user.partial',turn_id:'t1'});x.advance(500);assert.equal(x.sent.length,0);
  x.gate.user({type:'user.final',turn_id:'t1'});x.advance(349);assert.equal(x.sent.length,0);
  x.advance(1);assert.deepEqual(x.sent.map(p=>p.event.type),['response.started','response.text.delta','response.audio.chunk','response.done']);assert.equal(x.timers.size,0);
});
test('stop/replacement/close discard a held reply and its timers without clearing newer ownership',()=>{
  const x=clockGate();x.gate.candidate('t1');x.gate.push(x.packet('response.started'));x.gate.push(x.packet('response.audio.chunk'));
  x.gate.stop('r1');x.gate.push(x.packet('response.started','r2','t2'));x.gate.push(x.packet('response.text.delta','r2','t2'));
  x.gate.stop('r1');x.advance(6000);assert.deepEqual(x.sent.map(p=>p.event.response_id),['r2','r2']);assert.deepEqual(x.failed,[]);
  x.gate.candidate('t3');x.gate.push(x.packet('response.started','r3','t3'));x.gate.close();x.advance(6000);assert.equal(x.timers.size,0);assert.equal(x.sent.length,2);
});
test('missing final and excessive held output fail closed with bounded cleanup; observers cannot break delivery',()=>{
  const timeout=clockGate();timeout.gate.candidate('t1');timeout.gate.push(timeout.packet('response.started'));timeout.advance(5000);assert.deepEqual(timeout.failed,['TURN_FINAL_TIMEOUT']);assert.equal(timeout.gate.held,null);assert.equal(timeout.timers.size,0);
  const overflow=clockGate({maxPackets:1});overflow.gate.candidate('t1');overflow.gate.push(overflow.packet('response.started'));overflow.gate.push(overflow.packet('response.audio.chunk'));assert.deepEqual(overflow.failed,['OUTPUT_HOLD_LIMIT']);overflow.advance(6000);assert.equal(overflow.sent.length,0);assert.equal(overflow.timers.size,0);
  const bytes=clockGate({maxBytes:1});bytes.gate.candidate('t1');bytes.gate.push(bytes.packet('response.started'));assert.deepEqual(bytes.failed,['OUTPUT_HOLD_LIMIT']);
  const safe=clockGate({observe:()=>{throw Error('synthetic broken diagnostics');}});safe.gate.user({type:'user.final',turn_id:'t1'});safe.gate.push(safe.packet('response.started'));safe.advance(350);assert.equal(safe.sent.length,1);
});
test('ASR candidate and punctuation do not interrupt; new-turn speech text confirms once with continuous PCM',async t=>{
  const x=await gateway(t);x.wire(response('response.output_text.delta',undefined,undefined,{delta:'合成旧回复'}));
  x.wire(asr('started'));x.wire(asr('delta',undefined,{delta:'……'}));await until(()=>x.packets.some(p=>p.event?.type==='user.partial'));assert.equal(cancels(x).length,0);
  x.wire(asr('delta',undefined,{delta:'嗯'}));assert.equal(cancels(x).length,0);
  x.wire(asr('delta',undefined,{delta:'等'}));x.wire(asr('delta',undefined,{delta:'一下'}));
  await until(()=>cancels(x).length===1);x.ws.send(Buffer.alloc(640));
  await until(()=>x.sent.some(p=>p.type==='input_audio_buffer.append'));
  assert.deepEqual(Buffer.from(x.sent.find(p=>p.type==='input_audio_buffer.append').audio,'base64'),Buffer.alloc(640));
  x.wire({type:'response.canceled'});await until(()=>x.packets.some(p=>p.row?.name==='cancel.ack'));
  assert.equal(x.packets.filter(p=>p.row?.name==='speech.confirmed').length,1);
  const trace=new ExperienceTrace();x.packets.filter(p=>p.row).forEach(p=>trace.gateway(p.row));const report=trace.snapshot();assert.equal(report.kind,'synthetic');assert.equal(report.summary.interruptions_by_source.asr_confirmed,1);
  assert.ok(!JSON.stringify(report).includes('合成旧回复'));assert.ok(!JSON.stringify(report).includes('synthetic-t2'));
});
test('same-turn or delayed ASR confirmation cannot cancel a newer reply',async t=>{
  const x=await gateway(t);x.wire(response('response.output_text.delta',undefined,undefined,{delta:'合成旧回复'}));
  x.wire(asr('started','synthetic-t1'));x.wire(asr('delta','synthetic-t1',{delta:'一'}));await until(()=>x.packets.some(p=>p.event?.type==='user.partial'));assert.equal(cancels(x).length,0);
  x.wire(asr('started'));const old=x.packets.find(p=>p.event?.type==='response.started').event;
  x.ws.send(JSON.stringify({type:'response.cancel',response_id:old.response_id}));await until(()=>cancels(x).length===1);
  x.wire({type:'response.canceled'});x.wire(response('response.output_text.delta','synthetic-r2','synthetic-t2',{delta:'合成新回复'}));
  x.wire(asr('delta',undefined,{delta:'停'}));x.wire(asr('completed',undefined,{transcript:'停'}));
  await until(()=>x.packets.some(p=>p.event?.payload?.text==='合成新回复'));assert.equal(cancels(x).length,1);
  const fresh=x.packets.find(p=>p.event?.payload?.text==='合成新回复').event.response_id;assert.ok(!x.packets.some(p=>p.type==='output.stop' && p.response_id===fresh));
});
test('a one-character explicit stop confirms a new turn even if the ASR started hint is omitted',async t=>{
  const x=await gateway(t);x.wire(response('response.output_text.delta',undefined,undefined,{delta:'合成旧回复'}));
  x.wire(asr('delta',undefined,{delta:'停'}));await until(()=>cancels(x).length===1 && x.packets.some(p=>p.type==='output.stop'));
  x.wire({type:'response.canceled'});await until(()=>x.packets.some(p=>p.row?.name==='cancel.ack'));
});
test('gateway holds early teacher output; final releases it, and hand interruption during grace clears it',async t=>{
  const x=await gateway(t,{replyGraceMs:40});
  x.wire(asr('started','synthetic-t1'));x.wire(asr('delta','synthetic-t1',{delta:'一'}));
  x.wire(response('response.output_text.delta',undefined,undefined,{delta:'合成等待回复'}));
  x.wire(response('response.output_audio.delta',undefined,undefined,{delta:Buffer.alloc(960).toString('base64')}));
  await until(()=>x.packets.some(p=>p.row?.name==='response.held'));assert.ok(!x.packets.some(p=>p.event?.type==='response.started'));assert.equal(cancels(x).length,0);
  x.wire(asr('completed','synthetic-t1',{transcript:'一'}));await until(()=>x.packets.some(p=>p.event?.payload?.text==='合成等待回复'));assert.ok(x.packets.some(p=>p.row?.name==='response.released'));
  x.wire(response('response.done'));await until(()=>x.sent.some(p=>p.type==='session.update'));x.wire({type:'session.updated',session:{id:'synthetic-session'}});
  x.wire(asr('completed','synthetic-t2',{transcript:'二'}));x.wire(response('response.output_text.delta','synthetic-r2','synthetic-t2',{delta:'应丢弃的合成等待回复'}));x.wire(response('response.done','synthetic-r2','synthetic-t2'));
  await until(()=>x.packets.filter(p=>p.row?.name==='response.held').length===2);
  x.ws.send(JSON.stringify({type:'response.cancel'}));await until(()=>x.packets.some(p=>p.row?.name==='response.hold.discarded'));await delay(60);
  assert.ok(!x.packets.some(p=>p.event?.payload?.text==='应丢弃的合成等待回复'));assert.equal(cancels(x).length,0);
});
test('resuming speech during a final grace cancels held old output before it can be shown',async t=>{
  const x=await gateway(t,{replyGraceMs:60});x.wire(asr('completed','synthetic-t1',{transcript:'一'}));
  x.wire(response('response.output_text.delta',undefined,undefined,{delta:'被继续表达取消的合成回复'}));await until(()=>x.packets.some(p=>p.row?.name==='response.held'));
  x.wire(asr('started'));x.wire(asr('delta',undefined,{delta:'我还没说完'}));await until(()=>cancels(x).length===1);
  x.wire({type:'response.canceled'});await delay(75);assert.ok(!x.packets.some(p=>p.event?.payload?.text==='被继续表达取消的合成回复'));assert.ok(x.packets.some(p=>p.row?.name==='response.hold.discarded'));
});
test('safety restriction clears an armed output hold before handoff completes',async t=>{
  const x=await gateway(t,{replyGraceMs:50,safeguardingPort:{request:async()=>{await delay(150);return {delivered:true};}}});
  x.wire(asr('completed','synthetic-t1',{transcript:'我喜欢足球'}));x.wire(response('response.output_text.delta',undefined,undefined,{delta:'不得在限制后释放的合成回复'}));
  await until(()=>x.packets.some(p=>p.row?.name==='response.held'));
  x.wire(asr('completed',undefined,{transcript:'有人伤害我'}));await until(()=>x.packets.some(p=>p.type==='safety.notice'));
  await delay(75);assert.ok(!x.packets.some(p=>p.event?.type==='response.started'));assert.ok(!x.packets.some(p=>p.event?.payload?.text==='不得在限制后释放的合成回复'));
  await once(x.ws,'close');assert.ok(x.packets.some(p=>p.code==='SAFETY_RESTRICTED'));
});
async function contextRace(t,options={}) {
  const x=await gateway(t,options);x.wire(asr('completed','synthetic-t1',{transcript:'我喜欢足球'}));
  x.wire(response('response.output_text.delta',undefined,undefined,{delta:'合成第一轮'}));x.wire(response('response.done'));
  await until(()=>x.sent.some(p=>p.type==='session.update'));
  x.wire(response('response.output_text.delta','synthetic-r2','synthetic-t2',{delta:'更新期间的合成回复'}));
  await until(()=>x.packets.some(p=>p.event?.payload?.text==='更新期间的合成回复'));
  const id=x.packets.find(p=>p.event?.payload?.text==='更新期间的合成回复').event.response_id;
  x.ws.send(JSON.stringify({type:'response.cancel',response_id:id}));await until(()=>x.packets.some(p=>p.type==='output.stop' && p.response_id===id));
  return x;
}
test('interrupt during context update fences immediately and sends cancel only after the exact context ACK',async t=>{
  const x=await contextRace(t);assert.equal(cancels(x).length,0);
  x.wire(response('response.output_text.delta','synthetic-r2','synthetic-t2',{delta:'旧回复迟到的合成文本'}));
  x.wire({type:'session.updated',session:{id:'synthetic-session'}});await until(()=>cancels(x).length===1);
  x.wire({type:'response.canceled',response_id:'synthetic-r2'});await until(()=>x.packets.some(p=>p.row?.name==='cancel.ack'));
  assert.ok(!x.packets.some(p=>p.type==='session.failed'));assert.ok(!x.packets.some(p=>p.event?.payload?.text==='旧回复迟到的合成文本'));
});
test('queued cancellation completed or replaced before ACK never sends a targetless cancel at the new reply',async t=>{
  for(const done of [true,false]) {
    const x=await contextRace(t);if(done)x.wire(response('response.done','synthetic-r2','synthetic-t2'));
    x.wire(response('response.output_text.delta','synthetic-r3','synthetic-t3',{delta:'应保留的合成新回复'}));
    x.wire({type:'session.updated',session:{id:'synthetic-session'}});
    await until(()=>x.packets.some(p=>p.row?.name==='cancel.skipped'));
    assert.equal(cancels(x).length,0);assert.ok(x.packets.some(p=>p.row?.fields?.reason===(done?'completed':'replaced')));
    await until(()=>x.packets.some(p=>p.event?.payload?.text==='应保留的合成新回复'));assert.ok(!x.packets.some(p=>p.type==='session.failed'));
    x.ws.close();await once(x.ws,'close');
  }
});
test('cancellation ACK deadline starts at actual send; a missing context ACK remains a context failure',async t=>{
  const x=await contextRace(t,{cancelTimeoutMs:20,contextTimeoutMs:300});await delay(45);assert.equal(x.ws.readyState,x.ws.OPEN);assert.equal(cancels(x).length,0);
  x.wire({type:'session.updated',session:{id:'synthetic-session'}});await once(x.ws,'close');assert.ok(x.packets.some(p=>p.code==='CANCEL_ACK_TIMEOUT'));
  const y=await contextRace(t,{cancelTimeoutMs:20,contextTimeoutMs:100});await once(y.ws,'close');assert.equal(cancels(y).length,0);assert.ok(y.packets.some(p=>p.code==='CONTEXT_ACK_TIMEOUT'));
});
test('duplicate manual interrupts keep a sole request/ACK, and serialized second cancels preserve reply ownership',async t=>{
  const x=await gateway(t);x.wire(response('response.output_text.delta',undefined,undefined,{delta:'合成旧回复'}));await until(()=>x.packets.some(p=>p.event?.type==='response.started'));
  const old=x.packets.find(p=>p.event?.type==='response.started').event.response_id;
  for(let i=0;i<3;i++)x.ws.send(JSON.stringify({type:'response.cancel',response_id:old}));await until(()=>x.packets.some(p=>p.row?.name==='cancel.ignored'));assert.equal(cancels(x).length,1);
  x.wire(response('response.output_text.delta','synthetic-r2','synthetic-t2',{delta:'合成第二轮'}));await until(()=>x.packets.some(p=>p.event?.payload?.text==='合成第二轮'));
  const second=x.packets.find(p=>p.event?.payload?.text==='合成第二轮').event.response_id;x.ws.send(JSON.stringify({type:'response.cancel',response_id:second}));await until(()=>x.packets.filter(p=>p.type==='output.stop').length===2);assert.equal(cancels(x).length,1);
  x.wire({type:'response.canceled',response_id:'synthetic-r1'});await until(()=>cancels(x).length===2);x.wire({type:'response.canceled',response_id:'synthetic-r2'});await until(()=>x.packets.filter(p=>p.row?.name==='cancel.ack').length===2);assert.ok(!x.packets.some(p=>p.type==='session.failed'));
});
