// Shipped Thai page with synthetic provider/audio. --baseline reproduces the old
// listener through a test-only route replacement; product files stay unchanged.
import {chromium} from 'playwright';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createThaiApp} from '../../apps/free-talk-thai/src/server.js';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';
import {TestProvider} from '../../tests/helpers/realtime.js';
const baseline=process.argv.includes('--baseline');
if(process.argv.slice(2).some(a=>a!=='--baseline'))throw Error('INVALID_ARGUMENTS');
const backend=await startMockBackend();let browser;
const results=[];
class SyntheticProvider extends TestProvider{
  speechControlSupported=true;speechStartKind='asr_candidate';speechPace='slow';profile={realtime:{protocol:'seeduplex-1.2.6.1'},session_create:{session:{audio:{output:{speed:-20}}}}};
  open(input){super.open(input);queueMicrotask(()=>this.emit('session.ready'));}
  updateContext(value){super.updateContext(value);queueMicrotask(()=>this.control('context.updated',{version:value.version}));}
  cancel(id){super.cancel(id);queueMicrotask(()=>this.emit('response.cancelled',{}, {turn_id:this.turn,response_id:id}));}
  goodbye(audioMs=500){
    const turn=randomUUID(),response=randomUUID();this.turn=turn;
    this.emit('user.final',{text:'再见。'},{turn_id:turn});
    this.emit('response.started',{}, {turn_id:turn,response_id:response});
    this.emit('response.text.delta',{text:'我们聊了音乐，再见。 เราคุยเรื่องเพลง แล้วพบกันใหม่'},{turn_id:turn,response_id:response});
    const audio=Buffer.alloc(audioMs*48);
    for(let at=0;at<audio.length;at+=24000){const chunk=audio.subarray(at,at+24000);this.emit('response.audio.chunk',{byte_length:chunk.length,format:'pcm_s16le'},{turn_id:turn,response_id:response},{audio:chunk.toString('base64'),sample_rate:24000});}
    this.emit('response.done',{}, {turn_id:turn,response_id:response});
  }
}
const wait=async test=>{const until=Date.now()+5000;while(!test()){if(Date.now()>until)throw Error('TEST_TIMEOUT');await new Promise(r=>setTimeout(r,20));}};
async function fixture(name,task){
  let server,context,provider;
  const sent=[],received=[],errors=[];let started,closedAt,lastClosing;
  const timeout=baseline?1600:5000;
  try{
    server=createThaiApp({backend,providerKind:'test',closingPlaybackMs:timeout,providerFactory:()=>provider=new SyntheticProvider()});server.listen(0,'127.0.0.1');await once(server,'listening');
    context=await browser.newContext();const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.testAudioContexts=[];window.testMicStreams=[];
      const Audio=window.AudioContext;window.AudioContext=class extends Audio{constructor(...args){super(...args);window.testAudioContexts.push(this);}};
      const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(...args){super(...args);window.testSocket=this;}};
      const mic=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await mic(...args);window.testMicStreams.push(stream);return stream;};
    });
    page.on('websocket',socket=>{
      socket.on('framesent',frame=>{if(typeof frame.payload!=='string')return;try{const p=JSON.parse(frame.payload);sent.push({type:p.type,at_ms:Math.round(performance.now()-started)});}catch{}});
      socket.on('framereceived',frame=>{if(typeof frame.payload!=='string')return;try{const p=JSON.parse(frame.payload);if(p.type==='session.closing'){lastClosing=p;received.push({phase:p.phase,at_ms:Math.round(performance.now()-started)});}if(p.type==='session.closed')closedAt=performance.now()-started;}catch{}});
    });
    await context.route('**/voice-readiness.js',route=>route.fulfill({contentType:'text/javascript',body:'export function voiceReadiness(p,a){return p.synthetic===true&&a?{status:"合成联调中",real_provider:false}:null;}'}));
    if(baseline)await context.route('**/web.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace("p.type==='session.closing'","p.type==='closing.state'")});});
    await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#connect').click();await page.locator('#message').filter({hasText:'可以开始说中文'}).waitFor();started=performance.now();
    const evidence=await task({page,provider,sent,received,get lastClosing(){return lastClosing;},get closedAt(){return closedAt;},timeout,started});
    assert.equal(errors.length,0);
    const result={name,passed:true,...evidence,closing_playback_reports:sent.filter(p=>p.type==='closing.playback').length,session_closed_ms:closedAt===undefined?null:Math.round(closedAt),closing_phases:received,test_timeout_ms:timeout,page_errors:errors.length};results.push(result);console.log(JSON.stringify(result));
  }finally{await context?.close();server?.stopRealtime();if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});}
}
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  await fixture(baseline?'old_listener_timeout':'goodbye_closes_after_playback',async f=>{
    f.provider.goodbye();await wait(()=>f.received.some(p=>p.phase==='awaiting_playback'));
    await f.page.waitForFunction(()=>!document.querySelector('#connect').disabled,{},{timeout:6000});
    const reports=f.sent.filter(p=>p.type==='closing.playback');assert.equal(reports.length,baseline?0:1);
    if(baseline)assert(f.closedAt>=1600);else{assert(f.closedAt<3500);const awaiting=f.received.find(p=>p.phase==='awaiting_playback').at_ms;assert(f.closedAt-awaiting<f.timeout/2);assert(await f.page.locator('#summary').isVisible());assert.match(await f.page.locator('#receipt').textContent(),/已保存/);}
    assert(await f.page.evaluate(()=>window.testMicStreams.length>0&&window.testMicStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
    return {receipt_source:baseline?'none':'automatic',closed_by:baseline?'timeout':'owned_playback_receipt',microphone_released:true};
  });
  if(!baseline){
    await fixture('pause_defers_close_until_resume',async f=>{
      f.provider.goodbye(1200);await wait(()=>f.received.some(p=>p.phase==='awaiting_playback'));
      await f.page.evaluate(()=>window.testAudioContexts.at(-1).suspend());await f.page.waitForTimeout(650);
      assert.equal(f.sent.filter(p=>p.type==='closing.playback').length,0);assert.equal(f.closedAt,undefined);assert(await f.page.locator('#connect').isDisabled());
      await f.page.evaluate(()=>window.testAudioContexts.at(-1).resume());await f.page.waitForFunction(()=>!document.querySelector('#connect').disabled,{},{timeout:4000});assert.equal(f.sent.filter(p=>p.type==='closing.playback').length,1);
      return {receipt_source:'automatic',pause_prevented_close:true,closed_by:'owned_playback_receipt_after_resume'};
    });
    await fixture('continuation_rejects_old_playback_receipt',async f=>{
      f.provider.goodbye(1500);await wait(()=>f.received.some(p=>p.phase==='awaiting_playback'));const old={...f.lastClosing};
      f.provider.emit('user.final',{text:'等等，我还想聊。'},{turn_id:randomUUID()});await wait(()=>f.received.some(p=>p.phase==='cancelled'));
      await f.page.waitForTimeout(1800);assert.equal(f.sent.filter(p=>p.type==='closing.playback').length,0);assert.equal(f.closedAt,undefined);
      await f.page.evaluate(p=>window.testSocket.send(JSON.stringify(p)),{type:'closing.playback',closing_id:old.closing_id,response_id:old.response_id,summary_revision:old.summary_revision,state:'played',audio_ms:1500});
      await f.page.waitForTimeout(150);assert.equal(f.closedAt,undefined);assert(await f.page.locator('#connect').isDisabled());
      await f.page.locator('#end').click();await f.page.waitForFunction(()=>!document.querySelector('#connect').disabled);
      return {receipt_source:'test_injected_old_receipt',old_receipt_rejected:true,continuation_kept_session_open:true,closed_by:'manual_cleanup'};
    });
  }
}finally{
  await browser?.close();await backend.close();await mkdir('.local/thai-support-spike',{recursive:true});
  const report={kind:'thai_oral_close_browser_regression',baseline,synthetic_provider:true,synthetic_browser_audio:true,real_provider:false,human_listening:false,production_playback_timeout_ms:35000,results};
  await writeFile('.local/thai-support-spike/closing-'+(baseline?'baseline':'fixed')+'-browser.json',JSON.stringify(report,null,2)+'\n');
}
