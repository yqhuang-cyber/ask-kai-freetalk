import {chromium} from 'playwright';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createThaiApp} from '../../apps/free-talk-thai/src/server.js';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';
import {TestProvider} from '../../tests/helpers/realtime.js';
class SyntheticProvider extends TestProvider{
  speechControlSupported=true;speechStartKind='asr_candidate';speechPace='slow';profile={realtime:{protocol:'seeduplex-1.2.6.1'},session_create:{session:{audio:{output:{speed:-20}}}}};
  open(input){super.open(input);queueMicrotask(()=>this.emit('session.ready'));}
  updateContext(value){super.updateContext(value);queueMicrotask(()=>this.control('context.updated',{version:value.version}));}
  cancel(id){super.cancel(id);queueMicrotask(()=>this.emit('response.cancelled',{}, {turn_id:this.turn,response_id:id}));}
  reply(text,control){
    const turn=control?.turn_id??randomUUID(),response=randomUUID();this.turn=turn;
    if(!control)this.emit('user.final',{text:'我喜欢音乐。'},{turn_id:turn});
    const extra=control?{speech_control:control}:{};
    this.emit('response.started',{}, {turn_id:turn,response_id:response},extra);
    this.emit('response.text.delta',{text},{turn_id:turn,response_id:response},extra);
    const pcm=Buffer.alloc(24000);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(Math.round(Math.sin(i/2/24000*440*Math.PI*2)*1000),i);
    this.emit('response.audio.chunk',{byte_length:pcm.length,format:'pcm_s16le'},{turn_id:turn,response_id:response},{...extra,audio:pcm.toString('base64'),sample_rate:24000});
    this.emit('response.done',{}, {turn_id:turn,response_id:response},extra);
  }
  speakFixedText(text,control){this.spoken=text;queueMicrotask(()=>this.reply(text,control));}
}
const backend=await startMockBackend(),providers=[],servers=[];let browser;
const start=async factory=>{const server=createThaiApp({backend,providerKind:'test',providerFactory:factory});server.listen(0,'127.0.0.1');await once(server,'listening');servers.push(server);return 'http://127.0.0.1:'+server.address().port;};
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext(),page=await context.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.microphoneRequests=0;const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...a)=>{window.microphoneRequests++;return original(...a);};});
  await page.goto(await start());await page.locator('#status').filter({hasText:'语音未配置'}).waitFor();assert.equal(await page.locator('#learner').inputValue(),'mock-dao-hsk4');assert(await page.locator('#connect').isDisabled());assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
  // Explicit test-only dependency replacement. Shipped readiness remains real-only.
  await context.route('**/voice-readiness.js',route=>route.fulfill({contentType:'text/javascript',body:'export function voiceReadiness(p,a){return p.synthetic===true&&a?{status:"合成联调中",real_provider:false}:null;}'}));
  await page.goto(await start(()=>{const p=new SyntheticProvider();providers.push(p);return p;}));await page.locator('#connect').waitFor();await page.locator('#connect').click();await page.locator('#message').filter({hasText:'可以开始说中文'}).waitFor();assert.equal(await page.evaluate(()=>window.microphoneRequests),1);
  const p=providers.at(-1);p.reply('我喜欢音乐。 ฉันชอบดนตรี');await page.locator('#caption').filter({hasText:'ฉันชอบดนตรี'}).waitFor();assert(await page.locator('#caption ruby').count()>0);assert((await page.locator('#caption').textContent()).includes('ฉันชอบดนตรี'));
  await page.locator('#pinyin').uncheck();await page.waitForFunction(()=>document.querySelector('#caption').dataset.pinyin==='off');assert.equal(await page.locator('#caption ruby').count(),0);
  await page.locator('#pinyin').check();await page.waitForFunction(()=>document.querySelector('#caption').dataset.pinyin==='on');
  const controlTurn=randomUUID();p.turn=controlTurn;p.emit('user.final',{text:'关闭拼音。'},{turn_id:controlTurn});p.emit('response.started',{}, {turn_id:controlTurn,response_id:'caption-auto'});p.emit('response.done',{}, {turn_id:controlTurn,response_id:'caption-auto'});
  await page.locator('#caption').filter({hasText:'已关闭字幕拼音'}).waitFor();assert(/\p{Script=Thai}/u.test(p.spoken));await page.waitForTimeout(1400);
  p.reply('这是一段中文。 นี่คือประโยคภาษาจีน');await page.locator('#caption').filter({hasText:'นี่คือ'}).waitFor();await page.locator('#interrupt').click();assert.equal(await page.locator('#caption').textContent(),'');
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#end').click();await page.locator('#summary').waitFor();await page.waitForFunction(()=>document.querySelector('#end').disabled);assert.equal(errors.length,0,errors.join('\n'));
  await mkdir('.local/thai-support-spike',{recursive:true});await page.screenshot({path:'.local/thai-support-spike/browser-mobile.png',fullPage:true});
  const report={synthetic_provider:true,synthetic_browser_microphone:true,real_provider:false,human_listening:false,preview_blocks_microphone:true,independent_entry:true,thai_captions_and_chinese_pinyin:true,manual_and_voice_pinyin:true,interrupt_clears_captions:true,mobile_overflow:false,summary:true,page_errors:errors.length};
  await writeFile('.local/thai-support-spike/browser-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){console.error(JSON.stringify({failure:e.message,synthetic_spoken:providers.at(-1)?.spoken??null,contexts:providers.at(-1)?.contexts.length??0}));throw e;}finally{await browser?.close();for(const s of servers){s.stopRealtime();s.close();s.closeAllConnections();}await backend.close();}
