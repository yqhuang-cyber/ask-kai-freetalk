import {chromium} from 'playwright';
import {once,EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createGateway} from '../apps/realtime-gateway/src/server.js';
import {createDoubaoProvider} from '../packages/provider-doubao/seeduplex.js';

// Production provider adapter + native browser modules, authored wire fixtures
// and synthetic devices. This never passes the page's real-provider ready gate.
const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
profile.reviewed=true;profile.realtime.reviewed=true;profile.realtime.ordered_acks_reviewed=true;
let browser,wire,provider;const sent=[];let seq=0,speechSeq=0;
const server=createGateway({providerKind:'test',speechPaceSupported:true,providerFactory:ticket=>{
  const socket=new EventEmitter();
  wire=raw=>socket.emit('message',Buffer.from(JSON.stringify({event_id:`fixture-${++seq}`,...raw})),false);
  Object.assign(socket,{readyState:1,bufferedAmount:0,terminate:()=>{},send:value=>{
    const p=JSON.parse(value);sent.push(p);
    queueMicrotask(()=>{
      if(p.type==='session.create')wire({type:'session.created',session:{id:'fixture-session'}});
      if(p.type==='response.cancel')wire({type:'response.canceled'});
      if(p.type==='session.update')wire({type:'session.updated',session:{id:'fixture-session'}});
      if(p.type==='speech_text_buffer.commit'){
        const id=`fixture-speech-${++speechSeq}`,question_id=`fixture-fixed-${speechSeq}`;
        wire({type:'response.output_audio.started',response_id:id,question_id});
        wire({type:'response.output_audio.delta',response_id:id,delta:Buffer.alloc(19200).toString('base64')});
        wire({type:'response.output_audio.done',response_id:id,question_id});
      }
    });
  }});
  provider=createDoubaoProvider({profile,speechPace:ticket.speech_pace,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});
  const open=provider.open.bind(provider);provider.open=input=>{open(input);socket.emit('open');};return provider;
}});
server.listen(0,'127.0.0.1');await once(server,'listening');
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.ASK_KAI_BROWSER_EXECUTABLE,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async()=>{
    const [{AudioIO},{Presentation},{SpeechPlayback,speechStateMessage}]=await Promise.all(['/audio.js','/presentation.js','/speech-playback.js'].map(p=>import(p)));
    const ticket=await(await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'free',speech_pace:'slow'})})).json();
    const f=window.speechFixture={packets:[],failure:null};
    f.io=new AudioIO({onFrame:()=>{},onFailure:e=>f.failure=e});await f.io.prepare();await f.io.start({input_rate:16000,output_rate:24000});
    f.ws=new WebSocket(`${location.origin.replace('http','ws')}${ticket.websocket_path}`,[ticket.protocol,`ticket.${ticket.ticket}`]);
    f.presentation=new Presentation({render:text=>document.querySelector('#caption').textContent=text,play:(audio,rate,id)=>f.io.play(audio,rate,id),getPlayback:id=>f.io.playback(id),stopAudio:()=>f.io.stopPlayback(),onMode:mode=>{if(mode==='complete')f.playback.check();}});
    f.playback=new SpeechPlayback({presentation:f.presentation,getPlayback:id=>f.io.playback(id),isMuted:()=>false,send:p=>f.ws.send(JSON.stringify(p))});
    f.ws.onmessage=message=>{
      const p=JSON.parse(message.data);f.packets.push(p);if(p.type==='session.failed')f.failure=p.code;
      if(p.type==='speech.state'){document.querySelector('#speech-pace-hint').textContent=speechStateMessage(p);f.playback.update(p);}
      if(p.type==='output.stop')f.presentation.stop(p.response_id);
      const e=p.event;if(e?.type==='response.started')f.presentation.begin(e.response_id);
      if(e?.type==='response.text.delta')f.presentation.append(e.response_id,e.payload.text);
      if(e?.type==='response.audio.chunk')f.presentation.audio(e.response_id,p.audio,p.sample_rate);
      if(e?.type==='response.done')f.presentation.done(e.response_id);
    };
  });
  await page.waitForFunction(()=>window.speechFixture.packets.some(p=>p.event?.type==='session.ready'));
  const request=(text,turn)=>{
    wire({type:'conversation.item.input_audio_transcription.completed',item_id:turn,text});
    wire({type:'response.output_text.delta',question_id:turn,response_id:`auto-${turn}`,delta:'未受控自动回复'});
  };
  request('慢一点','slower');
  await page.waitForFunction(()=>window.speechFixture.playback.current?.phase==='awaiting_before_playback');
  await page.evaluate(()=>window.speechFixture.io.context.suspend());await page.waitForTimeout(1100);
  assert.equal(sent.some(p=>p.type==='session.update'),false);
  await page.evaluate(()=>window.speechFixture.io.context.resume());
  await page.waitForFunction(()=>window.speechFixture.packets.some(p=>p.type==='speech.state'&&p.phase==='complete'));
  assert.equal(sent.find(p=>p.type==='session.update').session.audio.output.speed,-40);
  assert.match(await page.locator('#speech-pace-hint').textContent(),/更慢/);
  request('快一点','faster');
  await page.waitForFunction(()=>window.speechFixture.packets.filter(p=>p.type==='speech.state'&&p.phase==='complete').length===2);
  request('恢复正常语速','normal');
  await page.waitForFunction(()=>window.speechFixture.packets.filter(p=>p.type==='speech.state'&&p.phase==='complete').length===3);
  assert.equal(provider.profile.session_create.session.audio.output.speed,0);
  assert.match(await page.locator('#speech-pace-hint').textContent(),/正常/);
  assert.equal(await page.evaluate(()=>window.speechFixture.failure),null);assert.deepEqual(errors,[]);
  await page.evaluate(async()=>{window.speechFixture.ws.send(JSON.stringify({type:'session.end'}));await window.speechFixture.io.close();});
  console.log(JSON.stringify({browser:'chromium',provider:'synthetic_seeduplex_peer',input:'synthetic_device',real_provider:false,production_native_modules:true,spoken_control_transactions:3,pcm_and_captions_gate_update:true,pause_prevents_update:true,restores_normal:true,page_errors:0}));
}finally{await browser?.close();server.stopRealtime();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
