import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {once} from 'node:events';import {execFileSync} from 'node:child_process';import {chromium} from 'playwright';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';import {createThaiApp} from '../../apps/free-talk-thai/src/server.js';import {ThaiInputBridge} from '../../apps/free-talk-thai/src/input-bridge.js';import {DoubaoThaiAsr} from '../../packages/provider-doubao/asr.js';import {FakeHistoryNative,voiceFrame} from '../../tests/helpers/thai-input.js';import {pcmWave} from '../bilingual-speech-pace/evidence.js';
const live=process.argv.includes('--live');if(process.argv.slice(2).some(a=>a!=='--live'))throw Error('INVALID_ARGUMENTS');
const directory='.local/thai-support-spike/input-browser-'+new Date().toISOString().replace(/[-:.]/g,'');await mkdir(directory,{recursive:true,mode:0o700});
let backend,server,browser,asrCalls=0,currentFixture='math',active,closed=false;const natives=[],errors=[],events=[];
const report={live_provider:live,synthetic_provider:!live,microphone:'authored_web_audio_stream',hardware_microphone:false,browser_playback:'actual_web_audio_clock',human_listening:false,mock_business:true,checks:{}},reviews=[];
const authored={math:['th','สามบวกห้าเท่ากับเท่าไร'],music:['th','ฉันชอบดนตรี'],chinese:['zh','你好，我喜欢音乐。'],end:['th','วันนี้พอแค่นี้ ขอบคุณ ลาก่อน']},wavs={};
try{
 for(const[id,[locale,text]]of Object.entries(authored)){
  if(live){const path=directory+'/'+id;execFileSync('/usr/bin/say',['-v',locale==='th'?'Kanya':'Tingting','-o',path+'.aiff',text]);execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path+'.aiff',path+'.wav']);wavs[id]=(await readFile(path+'.wav')).toString('base64');}
  else wavs[id]=pcmWave(Buffer.concat([...Array.from({length:60},voiceFrame),Buffer.alloc(6400)]),16000).toString('base64');
 }
 const profile=JSON.parse(await readFile(live?(process.env.ASK_KAI_THAI_REALTIME_PROFILE??'.local/seeduplex-thai-profile.json'):'docs/protocol/seeduplex-profile.template.json','utf8')),triggerPcm=await readFile('apps/free-talk-thai/assets/trigger.pcm');
 let asr;
 if(live){asr=new DoubaoThaiAsr();const start=asr.start.bind(asr);asr.start=o=>{asrCalls++;return start(o);};}
 else asr={start({signal}){asrCalls++;const fixture=currentFixture;let yes,no;const result=new Promise((r,j)=>{yes=r;no=j;});signal?.addEventListener('abort',()=>no(Error('ASR_ABORTED')),{once:true});return {result,write(){},finish(){yes({text:authored[fixture][1],source:'synthetic_asr_final'});}};}};
 const nativeFactory=live?undefined:options=>{
  const n=new FakeHistoryNative(options);n.onAudio=pcm=>{if(n.fired||!pcm.some(b=>b))return;n.fired=true;const trigger=n.instructions.includes('程序唤醒信号'),turn=trigger?'synthetic-program':'synthetic-chinese';n.emit('user.final',{text:trigger?'请回答。':authored.chinese[1]},{turn_id:turn});const ids=n.response(trigger?'三加五等于八。 สามบวกห้าเท่ากับแปด':'你好，很高兴聊天。 สวัสดี ยินดีที่ได้คุย',{turn,complete:false});setTimeout(()=>n.emit('response.done',{}, {turn_id:turn,response_id:ids.response}),1200);};n.onSpeak=text=>{const ids=n.response(text,{turn:'synthetic-fixed',complete:false});setTimeout(()=>n.emit('response.done',{}, {turn_id:ids.turn,response_id:ids.response}),1200);};natives.push(n);return n;
 };
 backend=await startMockBackend();server=createThaiApp({backend,inputBridge:true,providerKind:live?'doubao':'test',providerFactory:t=>new ThaiInputBridge({profile,speechPace:t.speech_pace,inputMode:t.input_mode,triggerPcm,asr,...(nativeFactory?{nativeFactory}:{})})});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});const context=await browser.newContext(),page=await context.newPage();
 if(!live)await context.route('**/voice-readiness.js',route=>route.fulfill({contentType:'text/javascript',body:'export function voiceReadiness(p,a){return p.synthetic===true&&a?{status:"合成联调中",real_provider:false}:null;}'}));
 await page.addInitScript(()=>{
  window.__micCalls=0;window.__micTracks=[];
  navigator.mediaDevices.getUserMedia=async()=>{
   window.__micCalls++;const context=new AudioContext({sampleRate:16000});await context.resume();const destination=context.createMediaStreamDestination(),zero=context.createConstantSource();zero.offset.value=0;zero.connect(destination);zero.start();window.__micTracks.push(...destination.stream.getTracks());
   window.__feedAuthor=async base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const buffer=await context.decodeAudioData(bytes.buffer),node=context.createBufferSource();node.buffer=buffer;node.connect(destination);window.__authorNode=node;node.start();return new Promise(resolve=>{node.onended=resolve;});};
   window.__stopAuthor=()=>{try{window.__authorNode?.stop();}catch{}};return destination.stream;
  };
 });
 page.on('pageerror',e=>errors.push(e.message));page.on('websocket',socket=>socket.on('framereceived',frame=>{
  try{const p=JSON.parse(String(frame.payload));if(p.type==='session.failed')report.session_failure=p.code;if(p.type==='session.closed')closed=true;
   const e=p.event;if(!e)return;events.push({type:e.type,turn:e.turn_id,response:e.response_id});if(!active)return;
   if(e.type==='user.final'){active.finals++;active.recognized=e.payload.text;reviews.push({case:active.id,kind:'input',text:e.payload.text});}
   if(e.type==='response.started'){active.response=e.response_id;active.started=true;}
   if(e.response_id!==active.response)return;if(e.type==='response.text.delta')active.text+=e.payload.text;if(e.type==='response.audio.chunk')active.chunks++;if(e.type==='response.done')active.done=true;if(e.type==='response.cancelled')active.cancelled=true;
  }catch{}
 }));
 const wait=async(fn,ms=45000)=>{const start=Date.now();while(!fn()){if(report.session_failure)throw Error(report.session_failure);if(Date.now()-start>ms)throw Error('BROWSER_FLOW_TIMEOUT');await page.waitForTimeout(30);}};
 await page.goto(origin);await page.locator('#input-mode-setting').waitFor();await page.selectOption('#input-mode','th');await page.click('#connect');await page.locator('#message').filter({hasText:'请说泰语'}).waitFor({timeout:25000});assert.equal(await page.evaluate(()=>window.__micCalls),1);report.checks.manual_language_selector=true;
 currentFixture='math';active={id:'thai_math',finals:0,text:'',chunks:0};await page.evaluate(w=>window.__feedAuthor(w),wavs.math);await wait(()=>active.done);assert.equal(active.finals,1);assert(active.chunks>0);report.checks.thai_reply=true;report.math_content={asr_operator_present:/บวก|\+/u.test(active.recognized??''),answer_eight_present:/八|8/u.test(active.text),review_required:live};if(!live)assert(report.math_content.answer_eight_present);reviews.push({case:active.id,kind:'reply',text:active.text});
 await page.click('#interrupt');await page.waitForTimeout(300);
 // Cancel while the ASR is still receiving; stop the synthetic speaker too.
 currentFixture='music';active={id:'interrupt_asr',finals:0,text:'',chunks:0};await page.evaluate(w=>{void window.__feedAuthor(w);},wavs.music);await page.locator('#status').filter({hasText:'正在听泰语'}).waitFor();await page.evaluate(()=>window.__stopAuthor());await page.click('#interrupt');await page.waitForTimeout(1400);assert.equal(active.finals,0);assert.equal(active.chunks,0);report.checks.interrupt_pending_asr=true;
 // Cancel owned output and verify the old response cannot append captions.
 currentFixture='music';active={id:'interrupt_reply',finals:0,text:'',chunks:0};await page.evaluate(w=>window.__feedAuthor(w),wavs.music);await wait(()=>active.chunks>0);await page.click('#interrupt');await wait(()=>active.cancelled||active.done);await page.waitForTimeout(500);assert.equal(await page.locator('#caption').textContent(),'');report.checks.interrupt_stops_output=true;report.checks.owned_cancel_observed=active.cancelled===true;
 await page.locator('#input-mode:enabled').waitFor();await page.selectOption('#input-mode','zh');await page.locator('#message').filter({hasText:'可以开始说中文'}).waitFor();await page.waitForTimeout(400);const before=asrCalls;currentFixture='chinese';active={id:'chinese',finals:0,text:'',chunks:0};await page.evaluate(w=>window.__feedAuthor(w),wavs.chinese);await wait(()=>active.done);assert.equal(asrCalls,before);assert.equal(active.finals,1);report.checks.chinese_no_external_asr=true;
 await page.click('#interrupt');await page.waitForTimeout(300);await page.locator('#input-mode:enabled').waitFor();await page.selectOption('#input-mode','th');await page.locator('#message').filter({hasText:'请说泰语'}).waitFor();currentFixture='end';active={id:'thai_end',finals:0,text:'',chunks:0};await page.evaluate(w=>window.__feedAuthor(w),wavs.end);await wait(()=>closed,45000);await page.locator('#summary').waitFor();assert.match(active.text,/再见/);assert.equal(await page.evaluate(()=>window.__micTracks.every(t=>t.readyState==='ended')),true);report.checks.farewell_caption=true;report.checks.automatic_end_after_browser_playback=true;report.checks.microphone_released=true;
 assert.equal(errors.length,0);report.page_errors=0;report.asr_calls=asrCalls;report.status='passed';await page.screenshot({path:directory+'/finished.png',fullPage:true});
}catch(error){report.status='failed';report.error=String(error.message).slice(0,250);report.active=active?{id:active.id,finals:active.finals,chunks:active.chunks,done:active.done,cancelled:active.cancelled}:null;if(active?.text)reviews.push({case:active.id,kind:'incomplete_reply',text:active.text});report.page_errors=errors;process.exitCode=1;}
finally{await browser?.close();server?.stopRealtime();server?.close();server?.closeAllConnections();await backend?.close();await writeFile(directory+'/metadata.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});await writeFile(directory+'/authored-review.json',JSON.stringify(reviews,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({directory,...report}));}
