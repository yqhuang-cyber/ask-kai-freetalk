import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setup,until } from './helpers/realtime.js';
import { Presentation } from '../apps/realtime-gateway/public/presentation.js';
test('manual cancellation fences late packets and old ack preserves a newer response over WebSocket',async t=> {
  const {create,open}=await setup(t);const {ws,packets,provider}=await open(await(await create()).json());
  provider.emit('session.ready');const old={turn_id:'t1',response_id:'r1'},next={turn_id:'t2',response_id:'r2'};
  provider.emit('response.started',{},old);await until(()=>packets.some(p=>p.event?.response_id==='r1'));
  ws.send(JSON.stringify({type:'response.cancel',response_id:'r1'}));await until(()=>provider.cancelled.length===1);
  provider.emit('response.text.delta',{text:'旧字幕不可见'},old);
  provider.emit('response.audio.chunk',{byte_length:4,format:'pcm_s16le'},old,{audio:'AAAAAA==',sample_rate:24000});
  provider.emit('response.started',{},next);provider.emit('response.cancelled',{},old);provider.emit('response.text.delta',{text:'新的回复'},next);
  ws.send(Buffer.alloc(640));await until(()=>provider.frames.length===1 && packets.some(p=>p.event?.payload?.text==='新的回复'));
  assert.ok(packets.some(p=>p.type==='output.stop' && p.response_id==='r1'));
  assert.ok(!packets.some(p=>p.event?.payload?.text==='旧字幕不可见' || (p.type==='event' && p.audio)));
  assert.equal(provider.cancelled[0],'r1');
});
test('verified speech-start interrupts while microphone upload continues',async t=> {
  const {create,open}=await setup(t);const {ws,provider}=await open(await(await create()).json());
  provider.emit('session.ready');provider.emit('response.started',{}, {turn_id:'t1',response_id:'r1'});
  provider.control('user.speech.started',{turn_id:'t2'});
  ws.send(Buffer.alloc(640));await until(()=>provider.cancelled.length===1 && provider.frames.length===1);
  provider.emit('response.cancelled',{}, {turn_id:'t1',response_id:'r1'});
});
test('unconfirmed cancellation fails the session instead of silently continuing',async t=> {
  const {create,open}=await setup(t,{cancelTimeoutMs:25});const {ws,packets,provider}=await open(await(await create()).json());
  provider.emit('session.ready');provider.emit('response.started',{}, {turn_id:'t1',response_id:'r1'});
  provider.control('user.speech.started');await once(ws,'close');
  assert.ok(packets.some(p=>p.code==='CANCEL_ACK_TIMEOUT'));assert.equal(provider.closed,true);
});
test('teaching context waits for outstanding cancellation ACK before sending an update',async t=> {
  const {create,open}=await setup(t);const {ws,provider}=await open(await(await create()).json());
  const old={turn_id:'t1',response_id:'r1'},next={turn_id:'t2',response_id:'r2'};
  provider.emit('session.ready');provider.emit('response.started',{},old);
  ws.send(JSON.stringify({type:'response.cancel',response_id:'r1'}));await until(()=>provider.cancelled.length===1);
  provider.emit('user.final',{text:'我喜欢足球'},{turn_id:'t2'});provider.emit('response.started',{},next);provider.emit('response.done',{},next);
  assert.equal(provider.contexts.length,0);provider.emit('response.cancelled',{},old);
  assert.equal(provider.contexts.length,1);provider.control('context.updated',{version:provider.contexts[0].version});
});
test('subtitles reveal gradually, cancel clears pending text, stale ack/audio cannot clear new output',()=> {
  const callbacks=new Map();let counter=0,visible='',played=[],stops=0;
  const view=new Presentation({render:v=>visible=v,play:(audio)=>played.push(audio),getPlayback:()=>({running:true,played_ms:1000,received_ms:2000}),stopAudio:()=>stops++,schedule:f=>{callbacks.set(++counter,f);return counter;},unschedule:id=>callbacks.delete(id)});
  const tick=()=>{const [id,f]=callbacks.entries().next().value;callbacks.delete(id);f();};
  view.begin('old');view.append('old','这是整段字幕，不应该一次出现。');assert.equal(visible,'');
  view.done('old'); // A completed text-only reply still reveals one phrase at a time.
  tick();assert.ok(visible.length>0 && visible.length<10);
  view.stop('old');assert.equal(visible,'');assert.equal(callbacks.size,0);
  view.begin('new');view.append('new','新的字幕');assert.equal(view.stop('old'),false);
  assert.equal(view.audio('old','stale',24000),false);view.audio('new','current',24000);
  view.done('new');
  tick();assert.match(visible,/新的/);assert.deepEqual(played,['current']);
  view.done('new');assert.equal(view.append('new','迟到'),false);
  assert.equal(view.begin('old'),false);view.reset();assert.equal(callbacks.size,0);assert.ok(stops>=3);
});
