import {createHash,randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {SeeduplexProvider} from './seeduplex.js';
import {preflight} from './probe.js';
import {REPLY_INSTRUCTIONS} from '../agent-core/reply-policy.js';
import {OUTPUT_PROBE_TEXT} from './output-probe.js';

/** Uses the production adapter. Only fixed authored TTS, never learner audio.
 * The temporary attestation is probe-only; ordinary Web startup rejects it.
 */
export async function runAdapterProbe({profile,request,env={},signal,durationMs=30000,
  socketFactory=(url,options)=>new WebSocket(url,options)}) {
  const hash=createHash('sha256').update(JSON.stringify(profile)).digest('hex');
  if(request?.version!==1||request.kind!=='doubao_adapter_smoke'||
    !/^adapter-\d{4}-\d{2}-\d{2}-\d{2}$/.test(request.request_id??'')||request.profile_sha256!==hash||
    profile.review_scope!=='static_session_connect_only'||profile.realtime?.reviewed!==false||
    profile.realtime?.ordered_acks_reviewed!==false||profile.auth?.env!=='DOUBAO_API_KEY'||
    !Number.isSafeInteger(durationMs)||durationMs<1||durationMs>30000)throw Error('INVALID_ADAPTER_REQUEST');
  const metrics=()=>({chunks:0,bytes:0,nonzero_samples:0});
  const report={version:1,kind:'live_doubao_adapter_probe',request_id:request.request_id,
    candidate_revision:/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')?env.GITHUB_SHA:null,
    profile_sha256:hash,adapter_protocol_path:true,runtime_profile_scope:'protocol_smoke',
    input_source:'fixed_authored_tts_text',microphone_uploaded:false,asr_tested:false,
    model_content_quality_evaluated:false,real_experience_accepted:false,web_profile_enabled:false,
    realtime_reviewed:false,ordered_acks_reviewed:false,provider_connected:false,
    session_ready_observed:false,context_ack_versions:[],cancel_ack_observed:false,session_closed_observed:false,
    normalized:{started:0,done:0,cancelled:0},wire:{frames:0,idless_audio_chunks:0,usage_only_terminals:0,
      in_flight_cancel_chunks:0,post_cancel_usage_observed:false},
    audio:{complete:metrics(),cancel:metrics(),resume:metrics()},forwarded_cancel_audio_after_request:0};
  if(!preflight(profile,env).live_eligible)return {...report,status:'blocked',ended:'missing_credential'};
  if(signal?.aborted)return {...report,status:'failed',ended:'aborted'};
  const scoped=structuredClone(profile);
  scoped.realtime={...scoped.realtime,reviewed:true,ordered_acks_reviewed:true,review_scope:'protocol_smoke'};
  return await new Promise(resolve=>{
    let phase='connecting',provider,finished=false,closing=false,owner;
    const owners=new Set();
    const finish=async reason=>{
      if(closing||finished)return;closing=true;phase='closing';clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      try{report.session_closed_observed=(await provider?.close())?.acknowledged===true;}catch{}
      if(finished)return;finished=true;
      for(const value of Object.values(report.audio))value.pcm_duration_ms=Math.round(value.bytes/48);
      report.provider_connected=false;report.ended=reason;
      report.status=reason==='completed'&&report.session_closed_observed&&report.session_ready_observed&&
        report.context_ack_versions.join(',')==='1,2'&&report.cancel_ack_observed&&
        report.normalized.started===3&&report.normalized.done===2&&report.normalized.cancelled===1&&
        report.forwarded_cancel_audio_after_request===0&&report.wire.post_cancel_usage_observed&&
        Object.values(report.audio).every(a=>a.nonzero_samples>0)?'passed':'failed';
      resolve(report);
    };
    const timer=setTimeout(()=>finish('duration_limit'),durationMs);
    const onAbort=()=>finish('aborted');
    const commit=(next,text)=>{phase=next;provider.send({type:'speech_text_buffer.commit',event_id:randomUUID(),text});};
    const observeWire=(bytes,binary)=>{
      if(closing||finished)return;
      if(binary||bytes.length>131072||++report.wire.frames>256)return void finish('wire_limit');
      let raw;try{raw=JSON.parse(bytes.toString());}catch{return void finish('invalid_wire_json');}
      if(raw?.type==='response.output_audio.delta'&&raw.response_id===undefined){
        report.wire.idless_audio_chunks++;
        if(['cancel_pending','after_cancel'].includes(phase))report.wire.in_flight_cancel_chunks++;
      }
      if(raw?.type==='response.done'&&raw.response_id===undefined&&raw.response?.usage){
        report.wire.usage_only_terminals++;
        if(phase==='after_cancel'){
          report.wire.post_cancel_usage_observed=true;
          // Only sequences the authored probe. This telemetry has no reply owner.
          try{commit('resume','谢谢。Thank you.');}catch{void finish('probe_control_failed');}
        }
      }
    };
    const onEvent=packet=>{
      if(closing||finished)return;
      try{
        const event=packet.event;
        if(event?.type==='session.ready'){
          report.session_ready_observed=true;report.provider_connected=true;phase='update1';
          provider.send({type:'input_audio_mute.commit',event_id:randomUUID()});
          provider.updateContext({instructions:REPLY_INSTRUCTIONS,version:1});
        }else if(packet.control==='context.updated'){
          if((phase==='update1'&&packet.version!==1)||(phase==='update2'&&packet.version!==2)||
            !['update1','update2'].includes(phase))throw Error('ack order');
          report.context_ack_versions.push(packet.version);
          commit(packet.version===1?'complete':'cancel',packet.version===1?OUTPUT_PROBE_TEXT.complete:OUTPUT_PROBE_TEXT.cancel);
        }else if(event?.type==='response.started'){
          if(!['complete','cancel','resume'].includes(phase)||owners.has(event.response_id))throw Error('start order');
          owner=event.response_id;owners.add(owner);report.normalized.started++;
        }else if(event?.type==='response.audio.chunk'){
          if(event.response_id!==owner)throw Error('foreign owner');
          if(['cancel_pending','after_cancel'].includes(phase)){
            report.forwarded_cancel_audio_after_request++;throw Error('cancel audio');
          }
          const a=report.audio[phase];if(!a)throw Error('audio phase');
          const bytes=Buffer.from(packet.audio,'base64');a.chunks++;a.bytes+=bytes.length;
          for(let i=0;i<bytes.length;i+=2)if(bytes.readInt16LE(i)!==0)a.nonzero_samples++;
          if(phase==='cancel'&&a.chunks===2){phase='cancel_pending';provider.cancel(owner);}
        }else if(event?.type==='response.done'){
          if(event.response_id!==owner)throw Error('foreign done');
          report.normalized.done++;
          if(phase==='complete'){
            // Audio boundary, rather than later usage, unblocks actual context update.
            phase='update2';provider.updateContext({instructions:REPLY_INSTRUCTIONS,version:2});
          }else if(phase==='resume')void finish('completed');
          else throw Error('unexpected done');
        }else if(event?.type==='response.cancelled'){
          if(phase!=='cancel_pending'||event.response_id!==owner)throw Error('foreign cancel');
          report.normalized.cancelled++;report.cancel_ack_observed=true;phase='after_cancel';
        }
      }catch{void finish('adapter_sequence_failed');}
    };
    try{
      provider=new SeeduplexProvider({profile:scoped,env,protocolProbe:true,socketFactory:(url,options)=>{
        const socket=socketFactory(url,options);socket.on('message',observeWire);
        socket.on('unexpected-response',(_req,response)=>{response.resume();socket.terminate();});
        return socket;
      }});
      provider.open({sessionId:randomUUID(),instructions:REPLY_INSTRUCTIONS,onEvent,
        onFailure:code=>{report.adapter_failure=code;void finish('adapter_failed');}});
      signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
    }catch{void finish('adapter_initialization_failed');}
  });
}
