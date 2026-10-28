import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import WebSocket from 'ws';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';
import {createThaiApp} from '../../apps/free-talk-thai/src/server.js';
import {createDoubaoProvider,validateSeeduplexProfile} from '../../packages/provider-doubao/seeduplex.js';
import {configuredThaiPlanner} from '../../packages/free-talk-thai/planner.js';
import {wavPCM} from '../prepare-fc-probe-inputs.js';
const natural=process.argv.includes('--suite=natural');
const cases=natural?[{id:'natural_music',text:'你好，我喜欢音乐。',expected:'zh_th'},{id:'natural_happy',text:'今天我的心情很好。',expected:'zh_th'}]:[{id:'thai_help',text:'请解释散步是什么意思，先说中文再用泰语解释。',expected:'zh_th'},{id:'once_chinese',text:'这次回答只用中文。',expected:'zh'},{id:'restore_thai',text:'请解释放松是什么意思。',expected:'zh_th'}];
if(!process.argv.includes('--live')||process.argv.slice(2).some(a=>!['--live','--suite=natural'].includes(a)))throw Error('EXPLICIT_LIVE_REQUIRED');
const profile=JSON.parse(await readFile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json','utf8'));validateSeeduplexProfile(profile);
const dir='.local/thai-support-spike';await mkdir(dir,{recursive:true});
const inputs=[];for(const c of cases){const base=dir+'/gateway-'+c.id;execFileSync('/usr/bin/say',['-v','Tingting','-o',base+'.aiff',c.text]);execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',base+'.aiff',base+'.wav']);inputs.push(wavPCM(await readFile(base+'.wav')));}
let backend,server,ws,pump,current,ready=false,audio=Buffer.alloc(0),position=0,failure;
const report={kind:'free_thai_ordinary_gateway',suite:natural?'natural':'language_scope',real_provider:false,business:'independent_mock_hskai',authored_os_input:true,browser_audio:false,human_listening:false,thai_quality_accepted:false,samples:[]};
const wait=async predicate=>{const end=Date.now()+40000;while(!await predicate()){if(failure)throw Error(failure);if(Date.now()>end)throw Error('PROBE_TIMEOUT');await new Promise(r=>setTimeout(r,40));}};
const hash=v=>createHash('sha256').update(v).digest('hex');
try{
  backend=await startMockBackend();server=createThaiApp({backend,planner:configuredThaiPlanner(),providerFactory:t=>createDoubaoProvider({profile,speechPace:t.speech_pace})});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  const login=await fetch(origin+'/api/poc/launch',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({uid:'poc-learner'})}),cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw Error('LOGIN_FAILED');
  const call=async(path,body)=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok)throw Error('GATEWAY_REQUEST_FAILED');return r.json();};
  const entry={mode:'free',speech_pace:'slow'},prepared=await call('/api/conversation-preparations',entry);let view;
  await wait(async()=>{view=await call('/api/conversation-preparations/'+prepared.preparation_id);if(view.status==='failed')throw Error('PREPARATION_FAILED');return view.status==='ready';});report.planning=view.view?.planning;
  const ticket=await call('/api/sessions',{...entry,preparation_id:prepared.preparation_id});
  ws=new WebSocket(origin.replace('http:','ws:')+ticket.websocket_path,[ticket.protocol,'ticket.'+ticket.ticket],{origin});
  ws.on('error',()=>{failure='TRANSPORT_FAILED';});
  let closed=false;
  ws.on('message',bytes=>{try{
    const p=JSON.parse(bytes);
    if(p.type==='session.failed'){failure='SESSION_FAILED';return;}
    if(p.type==='session.closed'){closed=true;return;}
    if(p.type==='teaching.state'&&current)current.language=p.language_policy;
    const e=p.event;if(!e)return;
    if(e.type==='session.ready'){ready=p.synthetic===false&&p.provider_connected===true;report.real_provider=ready;return;}
    if(!current)return;
    if(e.type==='user.final'){current.turn=e.turn_id;current.asr_match=e.payload.text.normalize('NFKC').replace(/[\p{P}\s]/gu,'')===current.authored.replace(/[\p{P}\s]/gu,'');current.asr_scope={once:/这(?:一)?次|本次|这一句|这一轮/u.test(e.payload.text),chinese_only:/只.{0,4}中文/u.test(e.payload.text)};}
    if(e.type==='response.started'){if(current.reply&&current.reply!==e.response_id){failure='OVERLAPPING_REPLY';return;}current.reply=e.response_id;current.reply_turn=e.turn_id;}
    if(e.response_id!==current.reply)return;
    if(e.type==='response.text.delta')current.text+=e.payload.text;
    if(e.type==='response.audio.chunk')current.bytes+=e.payload.byte_length;
    if(e.type==='response.done')current.done=true;
  }catch{failure='INVALID_EVENT';}});
  await once(ws,'open');await wait(()=>ready);
  pump=setInterval(()=>{if(ws.readyState!==WebSocket.OPEN)return;const frame=Buffer.alloc(640);audio.copy(frame,0,position,Math.min(position+640,audio.length));position=Math.min(position+640,audio.length);ws.send(frame);},20);
  for(const [i,c] of cases.entries()){
    current={authored:c.text,text:'',bytes:0,done:false};audio=inputs[i];position=0;await wait(()=>current.done);
    const s=current,han=(s.text.match(/\p{Script=Han}/gu)??[]).length,thai=(s.text.match(/\p{Script=Thai}/gu)??[]).length,latin=(s.text.match(/[A-Za-z]+/g)??[]).length;
    report.samples.push({id:c.id,expected:c.expected,language_state:s.language,asr_match:s.asr_match,asr_scope:s.asr_scope,ownership_matched:!!s.turn&&s.turn===s.reply_turn,han,thai,latin,audio_bytes:s.bytes,audio_pcm_ms:Math.round(s.bytes/48),text_sha256:hash(s.text),surface_match:han>0&&latin===0&&(c.expected==='zh'?thai===0:thai>0),response_done:true});current=null;
    await new Promise(r=>setTimeout(r,600));
  }
  ws.send(JSON.stringify({type:'session.end'}));await wait(()=>closed);report.status=report.samples.every(s=>s.surface_match&&s.ownership_matched&&s.audio_bytes>0)?'observed_expected_surface':'needs_review';
}catch(error){report.status='incomplete';report.failure=failure??(/^[A-Z_]+$/.test(error.message)?error.message:'PROBE_FAILED');report.incomplete_turn=current?{asr_seen:!!current.turn,response_started:!!current.reply,audio_bytes:current.bytes}:null;process.exitCode=1;
}finally{
  clearInterval(pump);ws?.terminate();if(server){server.stopRealtime();server.close();server.closeAllConnections();}await backend?.close();
  await writeFile(dir+(natural?'/gateway-natural-result.json':'/gateway-result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}
