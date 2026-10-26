import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import WebSocket from 'ws';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';
import {createGateway} from '../../apps/realtime-gateway/src/server.js';
import {createDoubaoProvider} from '../../packages/provider-doubao/seeduplex.js';
import {loadProfile} from '../../packages/provider-doubao/probe.js';
import {wavPCM} from '../prepare-fc-probe-inputs.js';
// Real provider + ordinary Gateway. Renderer and playback receipts are explicitly
// synthetic. No real microphone, browser output, listening or learning evidence.
const directory='.local/pinyin-caption-spike',delay=ms=>new Promise(r=>setTimeout(r,ms));
if(!process.argv.includes('--live')){console.log('Needs --live; off → on → off via ordinary Gateway; synthetic UI and playback receipts.');process.exit(0);}
const profile=await loadProfile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json');
const inputs=[];for(const id of ['off','on','off']){const pcm=wavPCM(await readFile(directory+'/'+id+'.wav')),e=JSON.parse(await readFile(directory+'/native-'+id+'.json'));if(createHash('sha256').update(pcm).digest('hex')!==e.input_sha256)throw Error('AUTHORED_INPUT_HASH_MISMATCH');inputs.push({id,pcm,expected:id==='on'});}
const mock=await startMockBackend();let provider,ws,failure=null,ready=false,pumping=false,queue=[],offset=0,lastState=null,finalCount=0,fixedAudio=0;const receipts=new Set(),spoken=[],steps=[];
const server=createGateway({bridge:mock.bridge,memoryPort:mock.memoryPort,pocPort:mock.pocPort,providerKind:'doubao',speechPaceSupported:true,maxSessionMs:100000,providerFactory:ticket=>{provider=createDoubaoProvider({profile,speechPace:ticket.speech_pace});const original=provider.speakFixedText.bind(provider);provider.speakFixedText=(text,control)=>{spoken.push({after_renderer_ack:receipts.has(control?.request_id),request_id:control?.request_id});return original(text,control);};return provider;}});
async function until(check){const end=Date.now()+25000;while(!check()){if(failure)throw Error(failure);if(Date.now()>end)throw Error('PINYIN_GATEWAY_TIMEOUT');await delay(20);}}
let pumpPromise;
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
 const launch=await fetch(origin+'/api/poc/launch',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}),cookie=launch.headers.get('set-cookie')?.split(';')[0];
 const response=await fetch(origin+'/api/sessions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({mode:'free'})});if(!response.ok)throw Error('PINYIN_TICKET_FAILED');const ticket=await response.json();
 ws=new WebSocket(origin.replace('http:','ws:')+'/api/realtime',['ask-kai.v1',`ticket.${ticket.ticket}`],{origin});
 const send=p=>{if(ws.readyState===1)ws.send(JSON.stringify(p));};
 ws.on('message',bytes=>{const p=JSON.parse(bytes.toString());if(p.type==='session.failed')failure=p.code;
  if(p.event?.type==='session.ready')ready=p.provider_connected===true&&p.synthetic===false;
  if(p.event?.type==='user.final')finalCount++;
  if(p.speech_control&&p.event?.type==='response.audio.chunk')fixedAudio+=p.event.payload.byte_length;
  if(p.type==='caption.settings'){receipts.add(p.request_id);send({type:'caption.ack',session_id:p.session_id,request_id:p.request_id,revision:p.revision,pinyin_enabled:p.pinyin_enabled,status:'applied'});}
  if(p.type==='caption.state'){lastState=p;if(p.phase==='awaiting_after_playback')send({type:'caption.playback',request_id:p.request_id,response_id:p.response_id,phase:'after',state:'played',audio_ms:p.audio_ms});}
 });ws.on('error',()=>failure='PINYIN_GATEWAY_SOCKET_ERROR');await once(ws,'open');await until(()=>ready);
 pumping=true;pumpPromise=(async()=>{let at=performance.now();while(pumping&&ws.readyState===1){let pcm=Buffer.alloc(640);if(queue.length){pcm=queue[0].subarray(offset,offset+640);offset+=640;if(offset>=queue[0].length){queue.shift();offset=0;}if(pcm.length<640)pcm=Buffer.concat([pcm,Buffer.alloc(640-pcm.length)]);}ws.send(pcm);at+=20;await delay(Math.max(0,at-performance.now()));}})();
 for(const input of inputs){await until(()=>!provider.pendingControl&&!provider.pendingFixed&&!provider.activeReply);const before=spoken.length,asr=finalCount,audio=fixedAudio,revision=lastState?.revision??0;queue.push(input.pcm);const at=performance.now();await until(()=>queue.length===0);await until(()=>lastState?.phase==='complete'&&lastState.revision>revision&&!provider.pendingControl);steps.push({id:input.id,expected:input.expected,actual:lastState.pinyin_enabled,confirmed:lastState.pinyin_enabled===input.expected,asr_received:finalCount>asr,fixed_utterances:spoken.length-before,all_spoken_after_synthetic_renderer_ack:spoken.slice(before).every(r=>r.after_renderer_ack),fixed_audio_bytes:fixedAudio-audio,elapsed_ms:Math.round(performance.now()-at)});}
}catch(e){failure=/^[A-Z0-9_]+$/.test(e.message)?e.message:'PINYIN_GATEWAY_FAILED';}
finally{pumping=false;await pumpPromise?.catch(()=>{});if(ws?.readyState===1){ws.send(JSON.stringify({type:'session.end'}));await Promise.race([once(ws,'close'),delay(3000)]);}ws?.terminate();server.stopRealtime();server.closeAllConnections();await new Promise(r=>server.close(r));await mock.close();}
const report={version:1,real_provider:ready,ordinary_gateway:true,synthetic_renderer_receipts:true,synthetic_playback_receipts:true,microphone:false,browser_audio_tested:false,human_listening:false,sequence:['off','on','off'],steps,failure,passed:!failure&&steps.length===3&&steps.every(s=>s.confirmed&&s.asr_received&&s.fixed_utterances===1&&s.all_spoken_after_synthetic_renderer_ack&&s.fixed_audio_bytes>0)};
await mkdir(directory,{recursive:true,mode:0o700});await writeFile(directory+'/gateway-report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
