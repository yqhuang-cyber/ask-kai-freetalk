import {execFileSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createGateway} from '../apps/realtime-gateway/src/server.js';
import {startMockBackend} from '../apps/hskai-mock/src/backend.js';
import {createDoubaoProvider} from '../packages/provider-doubao/seeduplex.js';
import {wavPCM} from './prepare-fc-probe-inputs.js';

// Author-generated speech -> production gateway -> real provider. Playback
// receipts are explicitly synthetic CLI receipts, never browser/human evidence.
const report={kind:'live_spoken_speech_pace_probe',status:'not_run',real_provider:false,
  input_source:'local_os_authored_speech',microphone_uploaded:false,browser_audio_tested:false,
  playback_receipts:'synthetic_cli_muted',real_experience_accepted:false,turns:[]};
let server,backend,ws,pump,deadline,failure,ready=false,queued=Buffer.alloc(0),position=0;
let current=null,stage='preflight',provider;
const wait=async predicate=>{
  const end=Date.now()+45000;
  while(!predicate()){if(failure)throw new Error(failure);if(Date.now()>end)throw new Error('SPOKEN_PROBE_TIMEOUT');await new Promise(r=>setTimeout(r,20));}
};
try{
  if(process.argv.slice(2).some(a=>a!=='--live'))throw new Error('INVALID_PROBE_ARGUMENTS');
  if(process.argv.includes('--live')){
    const profile=JSON.parse(await readFile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json','utf8'));
    const directory='.local/spoken-pace-probe';await mkdir(directory,{recursive:true,mode:0o700});
    const inputs=[];
    for(const [i,text] of ['请说慢一点。','请说快一点。','请恢复正常语速。'].entries()){
      const path=`${directory}/input-${i}`;execFileSync('/usr/bin/say',['-v','Tingting','-o',path+'.aiff',text]);
      execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path+'.aiff',path+'.wav']);
      inputs.push(wavPCM(await readFile(path+'.wav')));
    }
    backend=await startMockBackend();
    server=createGateway({...backend,speechPaceSupported:true,providerKind:'doubao',providerFactory:ticket=>{
      provider=createDoubaoProvider({profile,env:process.env,speechPace:ticket.speech_pace});return provider;
    }});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin=`http://127.0.0.1:${server.address().port}`;
    const post=async(path,body,cookie)=>{
      const r=await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
      if(!r.ok)throw new Error('SPOKEN_PROBE_HTTP');return r;
    };
    const launch=await post('/api/poc/launch',{}),cookie=launch.headers.get('set-cookie')?.split(';')[0];
    const ticket=await(await post('/api/sessions',{mode:'free',speech_pace:'slow'},cookie)).json();
    ws=new WebSocket(origin.replace('http','ws')+ticket.websocket_path,[ticket.protocol,`ticket.${ticket.ticket}`],{origin});
    ws.on('error',()=>failure='SPOKEN_PROBE_TRANSPORT');
    ws.on('message',bytes=>{
      try{
        const p=JSON.parse(bytes.toString());
        if(p.type==='session.failed')failure=/^[A-Z_]{1,80}$/.test(p.code)?p.code:'SPOKEN_PROBE_FAILED';
        if(p.event?.type==='session.ready'){ready=true;report.real_provider=p.provider_connected&&!p.synthetic;}
        if(current&&p.event?.type==='user.final')current.asr_control_observed=true;
        if(current&&p.speech_control&&p.event?.type==='response.text.delta'){
          if(p.speech_control.phase==='before')current.request_confirmation_observed=/我来/u.test(p.event.payload.text);
          if(p.speech_control.phase==='after')current.success_confirmation_observed=/已经/u.test(p.event.payload.text);
        }
        if(current&&p.type==='speech.state'){
          current.last_phase=p.phase;current.output_speed=p.output_speed;
          if(p.phase==='complete')current.complete=true;
          if(['awaiting_before_playback','awaiting_after_playback'].includes(p.phase)){
            current[p.phase==='awaiting_before_playback'?'before_pcm_ms':'after_pcm_ms']=p.audio_ms;
            ws.send(JSON.stringify({type:'speech.playback',request_id:p.request_id,response_id:p.response_id,phase:p.phase==='awaiting_before_playback'?'before':'after',state:'muted',audio_ms:p.audio_ms}));
          }
        }
      }catch{failure='SPOKEN_PROBE_PACKET';}
    });
    stage='connect';await wait(()=>ready);deadline=setTimeout(()=>{failure='SPOKEN_PROBE_DURATION_LIMIT';ws.terminate();},150000);
    const tick=()=>{
      if(ws.readyState!==WebSocket.OPEN)return;
      const frame=Buffer.alloc(640);if(position<queued.length){queued.copy(frame,0,position,Math.min(position+640,queued.length));position+=640;}
      ws.send(frame);pump=setTimeout(tick,20);
    };tick();
    for(let i=0;i<inputs.length;i++){
      stage=`request_${i+1}`;current={request:i+1,asr_control_observed:false,complete:false};report.turns.push(current);
      queued=Buffer.concat([Buffer.alloc(3200),inputs[i]]);position=0;
      await wait(()=>current.complete);console.error(JSON.stringify(current));
    }
    report.status=report.turns.every(t=>t.complete&&t.request_confirmation_observed&&t.success_confirmation_observed)?'passed':'inconclusive';
  }
}catch(error){report.status='incomplete';report.stage=stage;report.error=/^[A-Z_]{1,80}$/.test(error.message)?error.message:'SPOKEN_PROBE_FAILED';}
finally{
  clearTimeout(pump);clearTimeout(deadline);
  if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'session.end'}));
  ws?.terminate();
  if(server){server.stopRealtime();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
  await backend?.close();
}
console.log(JSON.stringify(report,null,2));if(!['passed','not_run'].includes(report.status))process.exitCode=1;
