import {chromium} from 'playwright';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createGateway} from '../apps/realtime-gateway/src/server.js';
import {startMockBackend} from '../apps/hskai-mock/src/backend.js';
import {TestProvider} from '../tests/helpers/realtime.js';
// Test provider + synthetic devices only. No real provider readiness is displayed.
const backend=await startMockBackend();let provider,browser;
const server=createGateway({...backend,providerKind:'test',providerFactory:()=>{provider=new TestProvider();provider.updateContext=v=>provider.control('context.updated',{version:v.version});return provider;}});
server.listen(0,'127.0.0.1');await once(server,'listening');
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.ASK_KAI_BROWSER_EXECUTABLE,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>!document.querySelector('#connect').disabled);
  await page.evaluate(async()=>{
    const [{AudioIO},{Presentation},{ClosingPlayback},{SummaryCards}]=await Promise.all(['/audio.js','/presentation.js','/closing-playback.js','/summary-cards.js'].map(p=>import(p)));
    const launch=await fetch('/api/poc/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!launch.ok)throw new Error('LAUNCH');
    const ticket=await(await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'free'})})).json();
    const f=window.closingFixture={ticket,packets:[],failure:null,closed:false};
    f.ws=new WebSocket(`${location.origin.replace('http','ws')}${ticket.websocket_path}`,[ticket.protocol,`ticket.${ticket.ticket}`]);
    f.io=new AudioIO({onFrame:()=>{},onFailure:e=>{f.failure=e;}});await f.io.prepare();
    // Explicit native module exercise, independent of the app's real-ready gate.
    await f.io.start({input_rate:16000,output_rate:24000});f.tracks=f.io.stream.getTracks();
    f.cards=new SummaryCards({root:document.querySelector('#session-summary'),link:document.querySelector('#summary-jump')});f.cards.begin(ticket.session_id,'free');
    f.presentation=new Presentation({render:text=>document.querySelector('#caption').textContent=text,play:(audio,rate,id)=>f.io.play(audio,rate,id),getPlayback:id=>f.io.playback(id),stopAudio:()=>f.io.stopPlayback(),onMode:mode=>{if(mode==='complete')f.playback.check();}});
    f.playback=new ClosingPlayback({presentation:f.presentation,getPlayback:id=>f.io.playback(id),isMuted:()=>false,send:p=>f.ws.send(JSON.stringify(p))});
    f.ws.onmessage=async message=>{const p=JSON.parse(message.data);f.packets.push(p);
      if(p.type==='session.closing'){f.playback.update(p,ticket.session_id);if(p.phase==='finalizing_record')f.io.stopCapture();}
      if(p.type==='teaching.summary.preview')f.cards.preview(p);
      if(p.type==='conversation.record.receipt')f.cards.record(p);
      if(p.type==='teaching.summary'){if(!f.cards.accept(p))throw new Error('SUMMARY_REJECTED');}
      if(p.type==='session.closed'){f.cards.finish();await f.io.close();f.closed=true;}
      if(p.type==='session.failed')f.failure=p.code;
      const e=p.event;if(e?.type==='response.started')f.presentation.begin(e.response_id);
      if(e?.type==='response.text.delta')f.presentation.append(e.response_id,e.payload.text);
      if(e?.type==='response.audio.chunk')f.presentation.audio(e.response_id,p.audio,p.sample_rate);
      if(e?.type==='response.done')f.presentation.done(e.response_id);
      if(p.type==='output.stop')f.presentation.stop(p.response_id);
    };
    await new Promise(r=>{if(f.ws.readyState===WebSocket.OPEN)r();else f.ws.onopen=r;});
  });
  provider.emit('session.ready');
  const reply=(turn,id,text,ms)=>{provider.emit('response.started',{}, {turn_id:turn,response_id:id});provider.emit('response.text.delta',{text},{turn_id:turn,response_id:id});provider.emit('response.audio.chunk',{byte_length:ms*48,format:'pcm_s16le'},{turn_id:turn,response_id:id},{audio:Buffer.alloc(ms*48).toString('base64'),sample_rate:24000});provider.emit('response.done',{}, {turn_id:turn,response_id:id});};
  provider.emit('user.final',{text:'subway中文怎么说？'},{turn_id:'help'});reply('help','help-r','中文可以说“地铁”。',100);
  await page.waitForFunction(()=>window.closingFixture.presentation.mode==='complete');
  provider.emit('user.final',{text:'就聊到这儿吧。'},{turn_id:'end'});reply('end','end-r','今天我们聊了出行，说到了地铁这个词。再见。',1200);
  await page.waitForFunction(()=>window.closingFixture.playback.current?.phase==='awaiting_playback');assert.equal(provider.closed,undefined);
  await page.evaluate(()=>window.closingFixture.io.context.suspend());await page.waitForTimeout(1500);assert.equal(provider.closed,undefined);assert.equal(await page.evaluate(()=>window.closingFixture.closed),false);
  await page.evaluate(()=>window.closingFixture.io.context.resume());await page.waitForFunction(()=>window.closingFixture.closed);
  assert.equal(provider.closed,true);assert.equal(await page.evaluate(()=>window.closingFixture.failure),null);
  assert.equal(await page.evaluate(()=>window.closingFixture.tracks.every(t=>t.readyState==='ended')),true);
  assert.match(await page.locator('#session-summary').textContent(),/本次目标/);assert.match(await page.locator('#session-summary').textContent(),/词汇：地铁/);assert.match(await page.locator('#session-summary').textContent(),/已保存到本地 mock 内存/);
  assert.equal(await page.locator('#connection-status').textContent(),'未连接');
  const read=await page.evaluate(async()=>{const r=await fetch(`/api/conversations/${window.closingFixture.ticket.session_id}`);return r.json();});assert.equal(read.status,'accepted');assert.equal(read.record.summary_delivery,'advisory_played');assert.equal(read.record.summary.knowledge_points[0].text,'地铁');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browser:'chromium',provider:'synthetic_test_provider',input:'synthetic_device',real_provider:false,production_native_modules:true,owned_playback_ack:true,pause_prevents_close:true,automatic_close:true,recap_card:true,server_readback:true,microphone_released:true,page_errors:0}));
}finally{await browser?.close();server.stopRealtime();await new Promise(r=>{server.close(r);server.closeAllConnections();});await backend.close();}
