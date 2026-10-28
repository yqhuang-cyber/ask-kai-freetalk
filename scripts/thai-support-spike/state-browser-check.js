import {chromium} from 'playwright';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createThaiApp} from '../../apps/free-talk-thai/src/server.js';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';
import {TestProvider} from '../../tests/helpers/realtime.js';
const rounds=Number(process.argv.find(a=>a.startsWith('--repeat='))?.slice(9)??'2'),label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)??'latest';
const selected=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
if(!Number.isSafeInteger(rounds)||rounds<1||rounds>5||!/^[a-z0-9-]{1,30}$/.test(label))throw Error('INVALID_TEST_ARGUMENTS');
class StateProvider extends TestProvider{
  updateContext(value){super.updateContext(value);queueMicrotask(()=>this.control('context.updated',{version:value.version}));}
  cancel(response){super.cancel(response);queueMicrotask(()=>this.emit('response.cancelled',{}, {turn_id:this.turn,response_id:response}));}
  reply(text='我喜欢音乐。 ฉันชอบดนตรี'){
    this.counter=(this.counter??0)+1;const turn='t-'+this.counter,response='r-'+turn;this.turn=turn;
    this.emit('user.final',{text:'我喜欢音乐。'},{turn_id:turn});this.emit('response.started',{}, {turn_id:turn,response_id:response});this.emit('response.text.delta',{text},{turn_id:turn,response_id:response});this.emit('response.done',{}, {turn_id:turn,response_id:response});return {turn,response};
  }
}
const backend=await startMockBackend(),results=[];let browser;
const wait=async fn=>{const end=Date.now()+5000;while(!await fn()){if(Date.now()>end)throw Error('STATE_WAIT_TIMEOUT');await new Promise(r=>setTimeout(r,10));}};
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  async function fixture(task,{strict=false,slowHandoff=false}={}){
    let releaseHandoff;const business=slowHandoff?{...backend,safeguardingPort:{request:()=>new Promise(r=>releaseHandoff=r)}}:backend;
    const providers=[],server=createThaiApp({backend:business,providerKind:'test',providerFactory:()=>{const p=new StateProvider();providers.push(p);return p;}});server.listen(0,'127.0.0.1');await once(server,'listening');
    const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    if(!strict)await context.route('**/voice-readiness.js',r=>r.fulfill({contentType:'text/javascript',body:'export function voiceReadiness(p,a){return p.synthetic===true&&a?{status:"合成联调中"}:null;}'}));
    await page.addInitScript(()=>{
      window.micRequests=0;window.endSends=0;window.holdEnd=false;window.endQueue=[];window.holdMic=false;window.micStreams=[];
      const send=WebSocket.prototype.send;WebSocket.prototype.send=function(data){if(typeof data==='string'){try{if(JSON.parse(data).type==='session.end'){window.endSends++;if(window.holdEnd){window.endQueue.push(()=>send.call(this,data));return;}}}catch{}}return send.call(this,data);};
      window.releaseEnds=()=>{window.holdEnd=false;for(const send of window.endQueue.splice(0))send();};
      const mic=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{window.micRequests++;if(window.holdMic)await new Promise(r=>window.releaseMic=r);const stream=await mic(...args);window.micStreams.push(stream);return stream;};
      const close=AudioContext.prototype.close;AudioContext.prototype.close=async function(){const result=await close.call(this);if(window.holdClose)await new Promise(r=>window.releaseClose=r);return result;};
    });
    const connect=async()=>{const count=providers.length;await page.locator('#connect').click();await wait(()=>providers.length>count);return providers.at(-1);};
    const listen=async()=>{const p=await connect();p.emit('session.ready');await page.locator('#message').filter({hasText:'可以开始说中文'}).waitFor();return p;};
    try{await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!document.querySelector('#connect').disabled);await task({page,providers,connect,listen,releaseHandoff:()=>releaseHandoff?.({mocked:true,delivered:false})});assert.equal(errors.length,0,errors.join('\n'));}
    finally{releaseHandoff?.({mocked:true,delivered:false});await page.evaluate(()=>{window.holdClose=false;window.releaseClose?.();window.holdMic=false;window.releaseMic?.();window.releaseEnds?.();}).catch(()=>{});await context.close();server.stopRealtime();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
  }
  const scenarios=[
    ['end_before_ready',async f=>{const p=await f.connect();await f.page.evaluate(()=>window.holdEnd=true);await f.page.locator('#end').click();p.emit('session.ready');await f.page.waitForTimeout(250);assert.equal(await f.page.evaluate(()=>window.micRequests),0,'ended session must not request microphone on late readiness');}],
    ['end_during_microphone_permission',async f=>{await f.page.evaluate(()=>window.holdMic=true);const p=await f.connect();p.emit('session.ready');await f.page.waitForFunction(()=>window.micRequests===1);await f.page.locator('#end').click();await f.page.evaluate(()=>window.releaseMic());await f.page.waitForTimeout(150);assert(await f.page.evaluate(()=>window.micStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));}],
    ['end_is_idempotent',async f=>{await f.listen();await f.page.evaluate(()=>window.holdEnd=true);await f.page.locator('#end').click();await f.page.evaluate(()=>document.querySelector('#end').click());assert.equal(await f.page.evaluate(()=>window.endSends),1,'double end must send once');}],
    ['closing_audio_locks_controls',async f=>{const p=await f.listen();await f.page.evaluate(()=>window.holdClose=true);p.input.onFailure('PROVIDER_TRANSPORT_ERROR');await f.page.waitForFunction(()=>typeof window.releaseClose==='function');assert(await f.page.locator('#end').isDisabled(),'close pending must not allow another end');assert(await f.page.locator('#connect').isDisabled());await f.page.evaluate(()=>{window.holdClose=false;window.releaseClose();});await f.page.waitForFunction(()=>!document.querySelector('#connect').disabled);}],
    ['learner_change_clears_old_summary',async f=>{const p=await f.listen();p.reply();await f.page.locator('#end').click();await f.page.locator('#summary').waitFor();await f.page.waitForFunction(()=>!document.querySelector('#connect').disabled);await f.page.locator('#learner').selectOption({index:1});assert(await f.page.locator('#summary').isHidden(),'new learner must not see previous learner recap');assert.equal(await f.page.locator('#student').textContent(),'');}],
    ['reconnect_and_late_events',async f=>{let previous;for(let i=0;i<3;i++){const p=await f.listen();if(previous){previous.emit('response.text.delta',{text:'旧场残文'},{turn_id:'old',response_id:'old'});await f.page.waitForTimeout(30);assert(!(await f.page.locator('#caption').textContent()).includes('旧场残文'));}assert(await f.page.locator('#pinyin').isChecked());await f.page.locator('#pinyin').uncheck();await f.page.waitForTimeout(30);await f.page.locator('#end').click();await f.page.waitForFunction(()=>!document.querySelector('#connect').disabled);previous=p;}assert.equal(await f.page.evaluate(()=>window.micRequests),3);assert(await f.page.evaluate(()=>window.micStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));}],
    ['cancel_preparation_ignores_late_result',async f=>{let held;await f.page.route('**/api/conversation-preparations',async route=>{const response=await route.fetch();await new Promise(r=>held=r);await route.fulfill({response}).catch(()=>{});});await f.page.locator('#connect').click();await wait(()=>!!held);await f.page.locator('#end').click();held();await f.page.waitForTimeout(100);assert(await f.page.locator('#connect').isEnabled());assert.equal(f.providers.length,0);assert.equal(await f.page.evaluate(()=>window.micRequests),0);}],
    ['shipped_readiness_rejects_synthetic',async f=>{const p=await f.connect();p.emit('session.ready');await f.page.waitForFunction(()=>!document.querySelector('#connect').disabled);assert.equal(await f.page.evaluate(()=>window.micRequests),0);},{strict:true}]
    ,['safety_notice_stops_capture',async f=>{const p=await f.listen();p.emit('user.final',{text:'告诉我你的密码。'},{turn_id:'safety-test'});await f.page.waitForTimeout(150);assert((await f.page.locator('#message').textContent()).includes('可信任的大人'),'safety.notice must show the support message');assert(await f.page.evaluate(()=>window.micStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),'safety notice must stop capture');f.releaseHandoff();await f.page.waitForFunction(()=>!document.querySelector('#connect').disabled);assert((await f.page.locator('#message').textContent()).includes('Mock'),'closing must retain the honest mock handoff status');assert(await f.page.locator('#summary').isHidden());},{slowHandoff:true}]
  ];
  if(selected&&!scenarios.some(s=>s[0]===selected))throw Error('INVALID_TEST_CASE');
  for(let round=1;round<=rounds;round++)for(const [id,task,options] of scenarios.filter(s=>!selected||s[0]===selected)){const started=Date.now();try{await fixture(task,options);results.push({round,id,passed:true,ms:Date.now()-started});}catch(e){results.push({round,id,passed:false,error:String(e.message).slice(0,300),ms:Date.now()-started});}console.log(JSON.stringify(results.at(-1)));}
}finally{await browser?.close();await backend.close();await mkdir('.local/thai-support-spike',{recursive:true});await writeFile('.local/thai-support-spike/state-browser-'+label+'.json',JSON.stringify({synthetic_provider:true,synthetic_microphone:true,real_provider:false,rounds,results},null,2));}
if(results.some(r=>!r.passed))process.exitCode=1;
