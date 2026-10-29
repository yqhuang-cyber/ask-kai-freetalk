import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {ThaiInputBridge} from '../apps/free-talk-thai/src/input-bridge.js';
import {UtteranceBuffer} from '../apps/free-talk-thai/src/utterance-buffer.js';
import {inputIntent,BRIDGE_TRIGGER} from '../apps/free-talk-thai/src/input-policy.js';
import {createHash} from 'node:crypto';
import {FakeHistoryNative,tick,voiceFrame} from './helpers/thai-input.js';
const template=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
async function setup({mode='th',asr,historyFailure=false}={}){
 const natives=[],packets=[],failures=[];let asrCalls=0;
 const bridge=new ThaiInputBridge({profile:template,inputMode:mode,triggerPcm:Buffer.alloc(1280),asr:asr??{recognize:async()=>{asrCalls++;return {text:'ฉันชอบแมว',source:'doubao_asr_final'};}},nativeFactory:options=>{const n=new FakeHistoryNative(options);n.historyFailure=historyFailure;natives.push(n);return n;}});
 bridge.open({sessionId:'test-thai-input',instructions:'FULL_AGENT_CONTEXT_SENT_ONLY_TO_CHINESE',onFailure:c=>failures.push(c),onEvent:p=>{packets.push(p);if(p.event)bridge.observeForwarded({type:'event',...p});}});await tick();
 return {bridge,natives,packets,failures,get asrCalls(){return asrCalls;}};
}
test('manual Chinese stays native and never calls external ASR',async()=>{
 const x=await setup({mode:'zh'});try{for(let i=0;i<20;i++)x.bridge.sendAudio(voiceFrame());assert.equal(x.asrCalls,0);assert.equal(x.natives[0].frames.length,20);assert.match(x.natives[0].instructions,/FULL_AGENT/);assert.equal(x.bridge.contextMode,'agent');const decision={action:'CHAT',reason:'quoted_end_word'};assert.equal(x.bridge.inputDecision({turn_id:'cn'},decision),decision);assert.equal(x.bridge.managesClosing,false);}finally{x.bridge.close();}
});
test('Thai emits only the real ASR final; activation is suppressed and response is owned by its actual input',async()=>{
 const x=await setup();try{
  x.bridge.speechStarted();await x.bridge.transcribe(Buffer.alloc(6400));await tick();
  const actual=x.packets.find(p=>p.event?.type==='user.final').event;assert.equal(actual.payload.text,'ฉันชอบแมว');assert.equal(x.asrCalls,1);
  const n=x.natives.at(-1);assert.equal(x.natives[0].frames.length,0);assert.doesNotMatch(n.instructions,/FULL_AGENT/);assert.equal(n.options.history.at(-2).text,actual.payload.text);
  n.emit('user.final',{text:BRIDGE_TRIGGER},{turn_id:'program-turn'});n.response('你喜欢猫。 คุณชอบแมว',{turn:'program-turn'});
  assert.equal(x.packets.filter(p=>p.event?.type==='user.final').length,1);
  const responses=x.packets.filter(p=>p.event?.type.startsWith('response.'));assert(responses.every(p=>p.event.turn_id===actual.turn_id));assert.equal(x.bridge.history.at(-2).text,actual.payload.text);assert.equal(x.bridge.history.at(-1).text,'你喜欢猫。 คุณชอบแมว');assert.equal(x.failures.length,0);
 }finally{x.bridge.close();}
});
test('manual interruption rejects a late ASR final without fabricating a learner turn',async()=>{
 let resolve;const asr={recognize:()=>new Promise(r=>{resolve=r;})},x=await setup({asr});
 try{x.bridge.speechStarted();const pending=x.bridge.transcribe(Buffer.alloc(6400));await tick();x.bridge.cancelPendingInput();resolve({text:'ข้อความเก่า'});await pending;assert.equal(x.packets.filter(p=>p.event?.type==='user.final').length,0);assert.equal(x.natives.length,1);}finally{x.bridge.close();}
});
test('old bridge output is fenced after cancellation and cannot clear a newer reply',async()=>{
 const x=await setup();try{
  x.bridge.speechStarted();await x.bridge.transcribe(Buffer.alloc(6400));const n=x.natives.at(-1);n.emit('user.final',{text:BRIDGE_TRIGGER},{turn_id:'trigger-old'});n.response('旧回复',{turn:'trigger-old',response:'old',complete:false});
  const old=x.bridge.currentReply.id;assert.equal(x.bridge.cancel(old),'local');await tick();const count=x.packets.length;
  n.emit('response.text.delta',{text:'迟到文字'},{turn_id:'trigger-old',response_id:'old'});n.emit('response.done',{}, {turn_id:'trigger-old',response_id:'old'});assert.equal(x.packets.length,count);assert.equal(x.packets.filter(p=>p.event?.type==='response.cancelled').length,1);assert.equal(x.bridge.history.length,0);
 }finally{x.bridge.close();}
});
test('history mismatch blocks activation audio and reports retry without inventing a context ACK',async()=>{
 const x=await setup({historyFailure:true});try{x.bridge.speechStarted();await x.bridge.transcribe(Buffer.alloc(6400));const n=x.natives.at(-1);assert.equal(n.frames.length,0);assert.equal(n.closed,true);const count=x.packets.length;n.emit('user.final',{text:BRIDGE_TRIGGER},{turn_id:'late'});n.response('迟到回复',{turn:'late'});assert.equal(x.packets.length,count);assert.equal(x.packets.filter(p=>p.control==='context.updated').length,0);assert(x.packets.some(p=>p.control==='input.state'&&p.state.message));}finally{x.bridge.close();}
});
test('switching input cancels an unfinished ASR and preserves business session readiness',async()=>{
 let resolve;const x=await setup({asr:{recognize:()=>new Promise(r=>{resolve=r;})}});try{x.bridge.speechStarted();const p=x.bridge.transcribe(Buffer.alloc(6400));await tick();await x.bridge.setInputMode('zh');resolve({text:'旧泰语'});await p;assert.equal(x.packets.filter(p=>p.event?.type==='session.ready').length,1);assert.equal(x.packets.filter(p=>p.event?.type==='user.final').length,0);x.bridge.sendAudio(voiceFrame());assert.equal(x.natives.at(-1).frames.length,1);}finally{x.bridge.close();}
});
test('Thai ending is an M2 decision and uses fixed farewell without submitting a trigger as learner text',async()=>{
 const x=await setup({asr:{recognize:async()=>({text:'วันนี้พอแค่นี้ ขอบคุณ ลาก่อน'})}});try{x.bridge.speechStarted();await x.bridge.transcribe(Buffer.alloc(6400));const e=x.packets.find(p=>p.event?.type==='user.final').event;assert.equal(x.bridge.inputDecision(e,{action:'CHAT'}).action,'CLOSE');const n=x.natives.at(-1);assert.match(n.spoken,/再见/);n.response(n.spoken,{turn:'fixed-farewell'});assert(x.packets.filter(p=>p.event?.type.startsWith('response.')).every(p=>p.event.turn_id===e.turn_id));}finally{x.bridge.close();}
});
test('M2 intent distinguishes end, negated end, word explanation and wake',()=>{
 for(const s of ['再见。','今天就到这里。','วันนี้พอแค่นี้ ขอบคุณ ลาก่อน'])assert.equal(inputIntent(s),'end');
 for(const s of ['不要结束，继续聊','ฉันยังไม่อยากจบ ขอคุยต่อ'])assert.equal(inputIntent(s),'continue');
 for(const s of ['再见是什么意思','ลาก่อน ภาษาจีนพูดว่าอะไร'])assert.equal(inputIntent(s),'chat');assert.equal(inputIntent('Kai!'),'wake');
});
test('short activation asset is authored control audio with a matching immutable manifest',async()=>{
 const bytes=await readFile(new URL('../apps/free-talk-thai/assets/trigger.pcm',import.meta.url)),manifest=JSON.parse(await readFile(new URL('../apps/free-talk-thai/assets/trigger.json',import.meta.url),'utf8'));
 assert.equal(manifest.text,BRIDGE_TRIGGER);assert.equal(manifest.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(manifest.sample_rate,16000);assert.equal(manifest.channels,1);assert(bytes.length<32000&&bytes.length>640);
});
test('acoustic buffer ignores silence and short clicks, keeps onset, and emits a bounded complete segment',()=>{
 let starts=0,segments=[];const b=new UtteranceBuffer({onStart:()=>starts++,onSegment:pcm=>segments.push(pcm)});
 try{for(let i=0;i<50;i++)b.push(Buffer.alloc(640));for(let i=0;i<3;i++)b.push(voiceFrame());b.push(Buffer.alloc(640));assert.equal(starts,0);for(let i=0;i<20;i++)b.push(voiceFrame());for(let i=0;i<36;i++)b.push(Buffer.alloc(640));assert.equal(starts,1);assert.equal(segments.length,1);assert(segments[0].length>=20*640);assert(segments[0].length<60*640);}finally{b.close();}
});
