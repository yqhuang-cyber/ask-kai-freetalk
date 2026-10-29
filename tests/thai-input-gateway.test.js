import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {once} from 'node:events';import WebSocket from 'ws';
import {startMockBackend} from '../apps/hskai-mock/src/backend.js';import {createThaiApp} from '../apps/free-talk-thai/src/server.js';import {ThaiInputBridge} from '../apps/free-talk-thai/src/input-bridge.js';import {FakeHistoryNative,voiceFrame,tick} from './helpers/thai-input.js';
const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
const until=async(fn)=>{const start=Date.now();while(!fn()){if(Date.now()-start>6000)throw Error('TEST_TIMEOUT');await tick();}};
async function setup({mode='th',holdContext=false,recognition=['วันนี้พอแค่นี้ ขอบคุณ ลาก่อน','ฉันยังไม่อยากจบ ขอคุยต่อ'],reply='好的，我们继续聊。 ได้เลย คุยกันต่อ'}={}){
 const backend=await startMockBackend(),natives=[],packets=[],providers=[],texts=[...recognition];
 const server=createThaiApp({backend,inputBridge:true,providerKind:'test',providerFactory:t=>{
  const p=new ThaiInputBridge({profile,triggerPcm:voiceFrame(),inputMode:t.input_mode,asr:{recognize:async()=>({text:texts.shift()??'ฉันชอบแมว'})},nativeFactory:options=>{
   const n=new FakeHistoryNative(options);if(holdContext)n.updateContext=u=>n.updates.push(u);
   n.onSpeak=text=>n.response(text,{turn:'synthetic-fixed'});
   n.onAudio=bytes=>{if(n.fired||!bytes.some(x=>x))return;n.fired=true;n.emit('user.final',{text:'请回答。'},{turn_id:'synthetic-trigger'});n.response(reply,{turn:'synthetic-trigger'});};natives.push(n);return n;
  }});providers.push(p);return p;
 }});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const launch=await fetch(origin+'/api/poc/launch',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({uid:'mock-dao-hsk4'})}),cookie=launch.headers.get('set-cookie').split(';')[0];
 const call=async(path,body)=>{const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok);return r.json();};
 const entry={mode:'free',speech_pace:'slow',input_mode:mode},pre=await call('/api/conversation-preparations',entry);let prepared;for(let i=0;i<60;i++){prepared=await call('/api/conversation-preparations/'+pre.preparation_id);if(prepared.status==='ready')break;await tick();}assert.equal(prepared.status,'ready');
 const ticket=await call('/api/sessions',{...entry,preparation_id:pre.preparation_id}),ws=new WebSocket(origin.replace('http:','ws:')+ticket.websocket_path,[ticket.protocol,'ticket.'+ticket.ticket],{origin});ws.on('message',b=>packets.push(JSON.parse(b)));await once(ws,'open');await until(()=>packets.some(p=>p.event?.type==='session.ready'));
 return {backend,server,ws,natives,packets,bridge:providers[0],async close(){ws.terminate();server.stopRealtime();server.close();server.closeAllConnections();await backend.close();}};
}
test('M2 Thai end enters real closing protocol; continue cancels it and stale playback cannot close the session',async()=>{
 const x=await setup();try{
  // Use the actual bridge path, with synthetic final ASR data, not a rewritten user message.
  x.bridge.speechStarted();await x.bridge.transcribe(Buffer.alloc(6400));await until(()=>x.packets.some(p=>p.type==='session.closing'&&p.phase==='awaiting_playback'));
  const old=x.packets.filter(p=>p.type==='session.closing'&&p.phase==='awaiting_playback').at(-1);assert(old.response_id);assert(x.packets.some(p=>p.event?.type==='response.text.delta'&&p.event.payload.text.includes('再见')));
  x.bridge.speechStarted();await x.bridge.transcribe(Buffer.alloc(6400));await until(()=>x.packets.some(p=>p.type==='session.closing'&&p.phase==='cancelled'));
  x.ws.send(JSON.stringify({type:'closing.playback',closing_id:old.closing_id,response_id:old.response_id,summary_revision:old.summary_revision,state:'played',audio_ms:200}));await new Promise(r=>setTimeout(r,100));assert(!x.packets.some(p=>p.type==='session.closed'));
  await until(()=>x.packets.filter(p=>p.event?.type==='response.done').length>=2);assert.equal(x.packets.filter(p=>p.event?.type==='user.final').length,2);
  assert(x.natives.every(n=>n.updates.length===0)); // No full Agent update or forged ACK on Thai path.
 }finally{await x.close();}
});
test('Thai M2 ending authority ignores an unsolicited model farewell for a non-ending input',async()=>{
 const x=await setup({recognition:['ฉันชอบแมว'],reply:'那今天就先聊到这里。 วันนี้พอแค่นี้'});try{x.bridge.speechStarted();await x.bridge.transcribe(Buffer.alloc(6400));await until(()=>x.packets.some(p=>p.event?.type==='response.done'));assert(!x.packets.some(p=>p.type==='session.closing'||p.type==='session.closed'));}finally{await x.close();}
});
test('language switch waits for an outstanding real context ACK rather than inventing one or timing out',async()=>{
 const x=await setup({mode:'zh',holdContext:true});try{
  const n=x.natives[0];n.emit('user.final',{text:'你好'},{turn_id:'cn-turn'});n.response('你好。 สวัสดี',{turn:'cn-turn'});await until(()=>n.updates.length>0);
  x.ws.send(JSON.stringify({type:'input.mode',mode:'th'}));await tick();assert.equal(x.bridge.mode,'zh');const update=n.updates.at(-1);
  n.onEvent({control:'context.updated',version:update.version});await until(()=>x.bridge.mode==='th'&&x.bridge.phase==='listening');assert.equal(x.packets.filter(p=>p.event?.type==='session.ready').length,1);assert(!x.packets.some(p=>p.type==='session.failed'));
 }finally{await x.close();}
});
