import {randomUUID, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import WebSocket from 'ws';
import {DUPLEX_ENDPOINT, preflight} from '../packages/provider-doubao/probe.js';
import {validateSeeduplexProfile} from '../packages/provider-doubao/seeduplex.js';

// Isolated experiment: no gateway changes, learner data, microphone, saved audio,
// raw provider events or transcripts. Only aggregate measurements leave memory.
const args=process.argv.slice(2);
const text='今天下午，我们一起去公园散步，看看树上的小鸟，再聊聊你喜欢的事情。';
const speeds=[0,-20,0,-40,0,-20,20,40,0];
const report={version:1,kind:'live_speech_pace_spike',status:'not_run',real_provider:false,
  same_connection:true,microphone_uploaded:false,browser_audio_tested:false,
  natural_language_control_tested:false,real_experience_accepted:false,
  fixed_text_sha256:createHash('sha256').update(text).digest('hex'),
  fixed_text_characters:[...text].length,update_shape:'full_session',samples:[]};
let socket,waiting,sessionId,current,overallTimer,stage='preflight',eventCount=0;
let closeAcknowledged=false;
function fail(code) {
  if(waiting){const task=waiting;waiting=null;clearTimeout(task.timer);task.reject(new Error(code));}
}
function expect(type,send,timeoutMs=10000) {
  if(waiting)throw new Error('PROBE_CONCURRENT_WAIT');
  return new Promise((resolve,reject)=>{
    waiting={type,resolve,reject,timer:setTimeout(()=>fail('PROBE_EVENT_TIMEOUT'),timeoutMs)};
    try{send();}catch{fail('PROBE_SEND_FAILED');}
  });
}
function send(value) {socket.send(JSON.stringify({event_id:randomUUID(),...value}));}
const abort=()=>{fail('PROBE_ABORTED');socket?.terminate();};
try {
  if(args.some(arg=>arg!=='--live'))throw new Error('INVALID_PROBE_ARGUMENTS');
  if(args.includes('--live')) {
    const profile=JSON.parse(await readFile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json','utf8'));
    validateSeeduplexProfile(profile);
    if(!preflight(profile).live_eligible)throw new Error('PROBE_PREFLIGHT_BLOCKED');
    const key=process.env[profile.auth.env];
    if(typeof key!=='string'||key.length>8192||/[^\x21-\x7e]/.test(key))throw new Error('INVALID_CREDENTIAL_FORMAT');
    process.once('SIGINT',abort);process.once('SIGTERM',abort);
    overallTimer=setTimeout(()=>{fail('PROBE_DURATION_LIMIT');socket?.terminate();},150000);
    const session=structuredClone(profile.session_create.session);
    session.audio.output.speed=0;
    session.instructions='用清楚自然的中文说话。';
    socket=new WebSocket(DUPLEX_ENDPOINT,{headers:{[profile.auth.header]:profile.auth.prefix+key},maxPayload:131072,
      perMessageDeflate:false,followRedirects:false,handshakeTimeout:5000});
    socket.on('error',()=>fail('PROBE_TRANSPORT_ERROR'));
    socket.on('close',()=>fail('PROBE_DISCONNECTED'));
    socket.on('message',(bytes,binary)=>{
      try {
        if(binary||++eventCount>3000)throw new Error('PROBE_FRAME_LIMIT');
        const raw=JSON.parse(bytes.toString());
        if(raw.type==='error')throw new Error('PROBE_PROVIDER_ERROR');
        if(raw.type==='session.closed')closeAcknowledged=true;
        if(raw.type==='session.created') {
          if(sessionId||typeof raw.session?.id!=='string'||!raw.session.id.length)throw new Error('PROBE_SESSION_ID');
          sessionId=raw.session.id;
        }
        if(raw.type==='session.updated'&&raw.session?.id!==sessionId)throw new Error('PROBE_FOREIGN_ACK');
        if(current) {
          if(['response.output_audio.started','response.output_text.delta','response.output_text.done'].includes(raw.type)) {
            if(raw.response_id!==undefined) {
              if(current.responseId&&current.responseId!==raw.response_id)throw new Error('PROBE_OVERLAPPING_REPLY');
              current.responseId=raw.response_id;
            }
          }
          if(raw.type==='response.output_audio.started'){
            current.audioStarted=true;
            current.questionShape={present:typeof raw.question_id==='string',matches_request:raw.question_id===current.requestId,empty:raw.question_id===''};
          }
          if(raw.type==='response.output_text.delta')current.outputText+=raw.delta??'';
          if(raw.type==='response.output_text.done'){current.outputText=raw.text??current.outputText;current.textDone=true;}
          if(raw.type==='response.output_audio.delta') {
            if(!current.audioStarted||!current.responseId)throw new Error('PROBE_UNBOUND_AUDIO');
            if(raw.response_id!==undefined&&raw.response_id!==current.responseId)throw new Error('PROBE_FOREIGN_REPLY');
            const pcm=Buffer.from(raw.delta,'base64');
            if(!pcm.length||pcm.length%2||pcm.toString('base64')!==raw.delta)throw new Error('PROBE_INVALID_PCM');
            current.pcmBytes+=pcm.length;
            if(current.pcmBytes>24000*2*30)throw new Error('PROBE_AUDIO_LIMIT');
          }
          if(raw.type==='response.output_audio.done') {
            if(!current.responseId||raw.response_id!==current.responseId)throw new Error('PROBE_FOREIGN_REPLY');
            current.audioDone=true;
          }
        }
        if(waiting?.type===raw.type) {
          const task=waiting;waiting=null;clearTimeout(task.timer);task.resolve();
        }
      }catch(error){fail(/^PROBE_[A-Z_]+$/.test(error.message)?error.message:'PROBE_INVALID_EVENT');socket.terminate();}
    });
    stage='connect';
    await expect('session.created',()=>socket.once('open',()=>send({...profile.session_create,session})),15000);
    report.real_provider=true;report.session_ready_observed=true;
    send({type:'input_audio_mute.commit'});
    for(let i=0;i<speeds.length;i++) {
      const speed=speeds[i];stage=`update_${i+1}`;
      session.audio.output.speed=speed;
      const start=performance.now();
      await expect('session.updated',()=>send({type:'session.update',session:{...session,id:sessionId}}));
      const sample={speed,update_acknowledged:true,ack_ms:Math.round(performance.now()-start)};
      // Fixed-text synthesis may return audio without text events. Only an
      // identified audio completion can finish a sample, never usage telemetry.
      current={responseId:null,audioStarted:false,outputText:'',pcmBytes:0,requestId:randomUUID()};
      stage=`output_${i+1}`;
      await expect('response.output_audio.done',()=>send({type:'speech_text_buffer.commit',text,event_id:current.requestId}),30000);
      const normalize=value=>value.replace(/[\p{P}\p{Z}\s]/gu,'');
      sample.output_text_observed=!!current.outputText;
      sample.output_matches_fixed_text=current.outputText?normalize(current.outputText)===normalize(text):null;
      sample.pcm_ms=Math.round(current.pcmBytes/48);
      sample.audio_received=current.pcmBytes>0;
      sample.question_shape=current.questionShape;
      report.samples.push(sample);current=null;
      console.error(JSON.stringify({sample:i+1,...sample}));
    }
    stage='close';await expect('session.closed',()=>send({type:'session.close'}),3000);
    const normals=report.samples.filter(s=>s.speed===0).map(s=>s.pcm_ms).sort((a,b)=>a-b);
    const baseline=(normals[Math.floor((normals.length-1)/2)]+normals[Math.floor(normals.length/2)])/2;
    report.baseline_median_pcm_ms=baseline;
    for(const sample of report.samples)sample.duration_vs_normal=Number((sample.pcm_ms/baseline).toFixed(3));
    report.all_samples_valid=report.samples.every(s=>s.update_acknowledged&&s.audio_received&&s.output_matches_fixed_text!==false);
    report.slow_samples_longer=report.samples.filter(s=>s.speed<0).every(s=>s.duration_vs_normal>1.1);
    report.fast_samples_shorter=report.samples.filter(s=>s.speed>0).every(s=>s.duration_vs_normal<0.95);
    report.status=report.all_samples_valid&&report.slow_samples_longer&&report.fast_samples_shorter?'passed':'inconclusive';
  }
}catch(error) {
  report.status='incomplete';report.stage=stage;
  if(current)report.incomplete_sample={audio_started:current.audioStarted,audio_done:current.audioDone===true,text_done:current.textDone===true,pcm_ms:Math.round(current.pcmBytes/48)};
  report.error=/^(PROBE_|INVALID_|DOUBAO_|SEEDUPLEX_|UNSUPPORTED_|UNREVIEWED_)[A-Z_]+$/.test(error.message)?error.message:'PROBE_FAILED';
}finally {
  clearTimeout(overallTimer);
  process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  if(socket?.readyState===WebSocket.OPEN&&!closeAcknowledged)try{send({type:'session.close'});}catch{}
  socket?.terminate();
}
report.close_acknowledged=closeAcknowledged;
console.log(JSON.stringify(report,null,2));
if(!['passed','not_run'].includes(report.status))process.exitCode=1;
