import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { setup,until } from './helpers/realtime.js';
import { PCMResampler } from '../apps/realtime-gateway/public/audio.js';
import { validateRealtimeProfile } from '../packages/provider-doubao/realtime.js';
import { readFile } from 'node:fs/promises';
test('unreviewed probe template cannot enable the speech adapter',async()=> {
  const profile=JSON.parse(await readFile(new URL('../docs/protocol/duplex-profile.template.json',import.meta.url)));
  assert.throws(()=>validateRealtimeProfile(profile),/NOT_VERIFIED/);
});
test('session tickets require same origin, allowlisted modes and exclude identity injection',async t=> {
  const {create}=await setup(t);
  assert.equal((await create({mode:'sports'},{Origin:'http://evil.example'})).status,403);
  assert.equal((await create({mode:'mission'})).status,400);
  assert.equal((await create({mode:'sports',learner_id:'foreign'})).status,400);
  const response=await create();assert.equal(response.status,201);assert.equal((await response.json()).provider_connected,false);
});
test('real WebSocket carries PCM and identity-bound output only after readiness',async t=> {
  const {create,open}=await setup(t);const {ws,packets,provider}=await open(await (await create()).json());
  provider.emit('session.ready');await until(()=>packets.some(p=>p.event?.type==='session.ready'));
  assert.equal(packets.find(p=>p.event?.type==='session.ready').provider_connected,false);
  assert.equal(packets.find(p=>p.event?.type==='session.ready').synthetic,true);
  ws.send(Buffer.alloc(640));await until(()=>provider.frames.length===1);
  const ids={turn_id:'t1',response_id:'r1'};
  provider.emit('response.started',{},ids);provider.emit('response.audio.chunk',{byte_length:4,format:'pcm_s16le'},ids,{audio:'AAAAAA==',sample_rate:24000});
  await until(()=>packets.some(p=>p.type==='event' && p.audio));assert.equal(packets.find(p=>p.type==='event' && p.audio).event.response_id,'r1');
  ws.send(JSON.stringify({type:'session.end'}));await once(ws,'close');assert.equal(provider.closed,true);
});
test('audio before readiness fails and never reaches provider',async t=> {
  const {create,open}=await setup(t);const {ws,provider}=await open(await(await create()).json());
  ws.send(Buffer.alloc(640));await once(ws,'close');assert.equal(provider.frames.length,0);
});
test('tickets are single-use and upstream disconnect cleans resources',async t=> {
  const {create,open,origin}=await setup(t);const ticket=await(await create()).json();const {ws,provider}=await open(ticket);
  const duplicate=new WebSocket(origin.replace('http:','ws:')+'/api/realtime',['ask-kai.v1',`ticket.${ticket.ticket}`],{origin});
  await assert.rejects(once(duplicate,'open'),/401/);
  provider.input.onFailure('PROVIDER_DISCONNECTED');await once(ws,'close');assert.equal(provider.closed,true);
});
test('ready timeout and bounded session capacity are enforced',async t=> {
  const {create,open}=await setup(t,{maxConnections:1,readyTimeoutMs:25});
  const ticket=await(await create()).json();assert.equal((await create()).status,429);
  const {ws,packets}=await open(ticket);await once(ws,'close');assert.ok(packets.some(p=>p.code==='PROVIDER_READY_TIMEOUT'));
});
test('PCM resampling is continuous across worklet buffers and little-endian',()=> {
  const input=Float32Array.from({length:1000},(_,i)=>Math.sin(i/10));
  const all=new PCMResampler(48000,16000).push(input);
  const split=new PCMResampler(48000,16000);
  const a=split.push(input.slice(0,501)),b=split.push(input.slice(501));
  assert.deepEqual(Buffer.concat([a,b]),Buffer.from(all));
  const extremes=new PCMResampler(16000,16000).push(Float32Array.of(-1,1,0));
  assert.equal(new DataView(extremes.buffer).getInt16(0,true),-32768);
  assert.equal(new DataView(extremes.buffer).getInt16(2,true),32767);
});
