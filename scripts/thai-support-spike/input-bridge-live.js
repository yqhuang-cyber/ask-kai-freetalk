import {readFile,mkdir,writeFile} from 'node:fs/promises';import {once} from 'node:events';import {execFileSync} from 'node:child_process';import WebSocket from 'ws';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';import {createThaiApp} from '../../apps/free-talk-thai/src/server.js';import {ThaiInputBridge} from '../../apps/free-talk-thai/src/input-bridge.js';import {DoubaoThaiAsr} from '../../packages/provider-doubao/asr.js';import {wavPCM} from '../prepare-fc-probe-inputs.js';
if(!process.argv.includes('--live')){console.log(JSON.stringify({live:false,scope:'real_gateway_manual_zh_th_bridge',authored_only:true}));process.exit(0);}
const directory='.local/thai-support-spike/input-bridge-'+new Date().toISOString().replace(/[-:.]/g,'');await mkdir(directory,{recursive:true,mode:0o700});
const report={real_provider:false,mock_business:true,authored_only:true,browser_audio:false,playback_receipts:'simulated_client_after_complete_pcm',samples:[],states:[]},review=[];
let backend,server,ws,pump,current,ready=false,closed=false,failure,mode,closing,position=0,audio=Buffer.alloc(0),asrCalls=0;
const wait=async(fn,ms=45000)=>{const start=Date.now();while(!fn()){if(failure)throw Error(failure);if(Date.now()-start>ms)throw Error('PROBE_TIMEOUT');await new Promise(r=>setTimeout(r,30));}};
try{
 const profile=JSON.parse(await readFile(process.env.ASK_KAI_THAI_REALTIME_PROFILE??'.local/seeduplex-thai-profile.json','utf8')),triggerPcm=await readFile('apps/free-talk-thai/assets/trigger.pcm'),asr=new DoubaoThaiAsr();const startAsr=asr.start.bind(asr);asr.start=o=>{asrCalls++;return startAsr(o);};
 backend=await startMockBackend();server=createThaiApp({backend,inputBridge:true,providerFactory:t=>new ThaiInputBridge({profile,speechPace:t.speech_pace,inputMode:t.input_mode,triggerPcm,asr})});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const launched=await fetch(origin+'/api/poc/launch',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({uid:'mock-dao-hsk4'})});const cookie=launched.headers.get('set-cookie').split(';')[0];
 const call=async(path,body)=>{const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('HTTP_'+r.status);return r.json();};
 const entry={mode:'free',speech_pace:'normal',input_mode:'th'},prepared=await call('/api/conversation-preparations',entry);let preparation;do{preparation=await call('/api/conversation-preparations/'+prepared.preparation_id);if(preparation.status==='failed')throw Error('PREPARATION_FAILED');if(preparation.status!=='ready')await new Promise(r=>setTimeout(r,50));}while(preparation.status!=='ready');
 const ticket=await call('/api/sessions',{...entry,preparation_id:prepared.preparation_id});ws=new WebSocket(origin.replace('http:','ws:')+ticket.websocket_path,[ticket.protocol,'ticket.'+ticket.ticket],{origin});ws.on('error',()=>failure='SOCKET_FAILED');
 ws.on('message',bytes=>{
  try{const p=JSON.parse(bytes);if(p.type==='session.failed'){failure=p.code;return;}if(p.type==='session.closed'){closed=true;return;}if(p.type==='input.state'){mode=p.mode;report.states.push({mode:p.mode,phase:p.phase,message:!!p.message});return;}if(p.type==='session.closing')closing=p;
   const e=p.event;if(!e)return;if(e.type==='session.ready'){ready=p.provider_connected===true&&p.synthetic===false;report.real_provider=ready;return;}if(!current)return;
   if(e.type==='user.final'){current.user_finals++;current.turn=e.turn_id;review.push({case:current.id,kind:'asr',text:e.payload.text});}
   if(e.type==='response.started'){current.reply=e.response_id;current.reply_turn=e.turn_id;}
   if(e.response_id!==current.reply)return;if(e.type==='response.text.delta')current.text+=e.payload.text;if(e.type==='response.audio.chunk')current.audio_bytes+=e.payload.byte_length;if(e.type==='response.done')current.done=true;
  }catch{failure='INVALID_PACKET';}
 });await once(ws,'open');await wait(()=>ready);
 pump=setInterval(()=>{if(ws.readyState!==WebSocket.OPEN)return;const frame=Buffer.alloc(640);audio.copy(frame,0,position,Math.min(position+640,audio.length));position=Math.min(position+640,audio.length);ws.send(frame);},20);
 for(const c of [{id:'thai_math',mode:'th',text:'สามบวกห้าเท่ากับเท่าไร'},{id:'chinese_native',mode:'zh',text:'你好，我喜欢音乐。'},{id:'thai_end',mode:'th',text:'วันนี้พอแค่นี้ ขอบคุณ ลาก่อน'}]){
  if(mode!==c.mode){ws.send(JSON.stringify({type:'input.mode',mode:c.mode}));await wait(()=>mode===c.mode&&report.states.at(-1)?.phase==='listening');}
  const path=directory+'/'+c.id;execFileSync('/usr/bin/say',['-v',c.mode==='th'?'Kanya':'Tingting','-o',path+'.aiff',c.text]);execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path+'.aiff',path+'.wav']);
  const before=asrCalls;current={id:c.id,user_finals:0,text:'',audio_bytes:0,done:false};audio=wavPCM(await readFile(path+'.wav'));position=0;await wait(()=>current.done);
  report.samples.push({id:c.id,user_finals:current.user_finals,ownership_matched:current.turn===current.reply_turn,audio_bytes:current.audio_bytes,response_done:current.done,asr_calls:asrCalls-before,han:(current.text.match(/\p{Script=Han}/gu)??[]).length,thai:(current.text.match(/\p{Script=Thai}/gu)??[]).length});review.push({case:c.id,kind:'reply',text:current.text});
  if(c.id==='thai_end'){await wait(()=>closing?.phase==='awaiting_playback');ws.send(JSON.stringify({type:'closing.playback',closing_id:closing.closing_id,response_id:closing.response_id,summary_revision:closing.summary_revision,state:'played',audio_ms:current.audio_bytes/48}));await wait(()=>closed);}else{current=null;audio=Buffer.alloc(0);position=0;await new Promise(r=>setTimeout(r,600));}
 }
 report.status='completed';report.business_closed=closed;
}catch(error){report.status='failed';report.failure=/^[A-Z0-9_]+$/.test(error.message)?error.message:'PROBE_FAILED';report.incomplete=current?{id:current.id,user_finals:current.user_finals,audio_bytes:current.audio_bytes}:null;process.exitCode=1;}
finally{clearInterval(pump);ws?.terminate();server?.stopRealtime();server?.close();server?.closeAllConnections();await backend?.close();await writeFile(directory+'/metadata.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});await writeFile(directory+'/authored-review.json',JSON.stringify(review,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({directory,...report}));}
