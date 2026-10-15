import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { preflight, DUPLEX_ENDPOINT } from './probe.js';

export const OUTPUT_PROBE_TEXT = {
  complete:'你好。Hello.',
  cancel:'你好，我是凯。我们可以慢慢聊足球。Hello, I am Kai. We can talk about football slowly.'
};

/** Isolated wire probe. Fixed authored TTS input, no student data and no Web review approval. */
export async function runOutputProbe({profile,request,env={},signal,durationMs=25000,
  socketFactory=(url,options)=>new WebSocket(url,options)}) {
  const hash=createHash('sha256').update(JSON.stringify(profile)).digest('hex');
  if (request?.version!==1 || request.kind!=='doubao_fixed_output' ||
      !/^output-\d{4}-\d{2}-\d{2}-\d{2}$/.test(request.request_id??'') || request.profile_sha256!==hash ||
      profile.review_scope!=='static_session_connect_only' || profile.realtime?.reviewed!==false ||
      profile.realtime?.ordered_acks_reviewed!==false || profile.auth?.env!=='DOUBAO_API_KEY' ||
      profile.session_create?.session?.audio?.output?.format?.type!=='pcm_s16le' ||
      profile.session_create?.session?.audio?.output?.format?.rate!==24000 ||
      !Number.isSafeInteger(durationMs) || durationMs<1 || durationMs>25000) throw Error('INVALID_OUTPUT_REQUEST');
  const checked=preflight(profile,env);
  if(!checked.live_eligible)throw Error('OUTPUT_PREFLIGHT_BLOCKED');
  const key=env[profile.auth.env];
  if(typeof key!=='string'||key.length>8192||/[^\x21-\x7e]/.test(key))throw Error('INVALID_CREDENTIAL_FORMAT');
  const report={version:1,kind:'live_doubao_output_probe',request_id:request.request_id,
    candidate_revision:/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')?env.GITHUB_SHA:null,
    profile_sha256:hash,input_source:'fixed_authored_tts_text',microphone_uploaded:false,
    asr_tested:false,model_content_quality_evaluated:false,real_experience_accepted:false,
    realtime_reviewed:false,ordered_acks_reviewed:false,provider_connected:false,
    session_ready_observed:false,update_ack_observed:false,cancel_ack_observed:false,
    session_closed_observed:false,http_status:null,events:[],terminal_shapes:[],
    audio:{complete:{chunks:0,bytes:0,nonzero_samples:0},cancel:{chunks:0,bytes:0,nonzero_samples:0}}};
  if(signal?.aborted)return {...report,status:'failed',ended:'aborted'};
  const started=performance.now(),salt=randomBytes(32);
  const socket=socketFactory(DUPLEX_ENDPOINT,{headers:{[profile.auth.header]:profile.auth.prefix+key},
    maxPayload:131072,perMessageDeflate:false,handshakeTimeout:5000,followRedirects:false});
  socket.binaryType='arraybuffer';
  return await new Promise(resolve=>{
    let phase='connecting',sessionId,updateId,cancelId,activeReply,closingReason='completed',finished=false,closeTimer;
    const timer=setTimeout(()=>beginClose('duration_limit'),durationMs);
    const finish=reason=>{
      if(finished)return;finished=true;clearTimeout(timer);clearTimeout(closeTimer);
      signal?.removeEventListener('abort',onAbort);
      for(const [event,handler]of [['open',onOpen],['message',onMessage],['error',onError],['close',onClose]])socket.removeEventListener(event,handler);
      socket.addEventListener('error',()=>{}, {once:true});
      try{socket.close();}catch{}
      for(const metrics of Object.values(report.audio))metrics.pcm_duration_ms=Math.round(metrics.bytes/48);
      report.provider_connected=false;report.ended=reason;
      report.status=reason==='completed'&&report.session_ready_observed&&report.update_ack_observed&&
        report.cancel_ack_observed&&report.session_closed_observed&&report.audio.complete.nonzero_samples>0&&
        report.audio.cancel.nonzero_samples>0?'passed':'failed';
      resolve(report);
    };
    const send=payload=>{try{socket.send(JSON.stringify(payload));return true;}catch{finish('send_failed');return false;}};
    const beginClose=reason=>{
      if(finished)return;
      if(phase==='closing')return finish(reason);
      closingReason=reason;phase='closing';
      if(!report.session_ready_observed)return finish(reason);
      send({type:'session.close',event_id:randomUUID()});
      closeTimer=setTimeout(()=>finish(reason==='completed'?'close_ack_timeout':reason),2000);
    };
    const onAbort=()=>beginClose('aborted');
    const onError=event=>{
      const code=event.error?.code;
      if(['WS_ERR_UNSUPPORTED_MESSAGE_LENGTH','WS_ERR_INVALID_UTF8','WS_ERR_UNEXPECTED_RSV_1',
        'ECONNRESET','ETIMEDOUT','ECONNREFUSED','EAI_AGAIN','ENOTFOUND','ERR_TLS_CERT_ALTNAME_INVALID',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code))report.transport_code=code;
      finish('transport_error');
    };
    const onClose=()=>finish(phase==='closing'&&report.session_closed_observed?closingReason:'remote_closed');
    const onOpen=()=>{phase='ready_pending';send(profile.session_create);};
    const onMessage=event=>{
      if(finished)return;
      if(typeof event.data!=='string'||Buffer.byteLength(event.data)>131072||report.events.length>=128)return beginClose('frame_limit');
      let raw;try{raw=JSON.parse(event.data);}catch{return beginClose('invalid_json');}
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return beginClose('invalid_json_shape');
      const allowed=new Set([...profile.observed_event_types,'conversation.item.added']);
      const identity_refs={};
      for(const [name,value]of Object.entries({event_id:raw.event_id,response_id:raw.response_id,question_id:raw.question_id,'session.id':raw.session?.id,'response.id':raw.response?.id,'response.response_id':raw.response?.response_id})){
        if(typeof value==='string'&&value.length>0&&value.length<=128)identity_refs[name]=createHmac('sha256',salt).update(value).digest('hex').slice(0,24);
      }
      report.events.push({time_ms:Math.round(performance.now()-started),type:allowed.has(raw.type)?raw.type:'unmapped',
        byte_length:Buffer.byteLength(event.data),keys:Object.keys(raw).filter(k=>/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(k)).slice(0,32),identity_refs});
      if(raw.type==='error')return beginClose('provider_error');
      if(raw.type==='session.created'&&phase==='ready_pending'){
        if(typeof raw.session?.id!=='string'||!raw.session.id||raw.session.id.length>128)return beginClose('invalid_ready');
        sessionId=raw.session.id;report.session_ready_observed=true;report.provider_connected=true;
        send({type:'input_audio_mute.commit',event_id:randomUUID()});
        updateId=randomUUID();phase='update_pending';
        send({type:'session.update',event_id:updateId,session:{instructions:profile.session_create.session.instructions}});
      }else if(raw.type==='session.updated'&&phase==='update_pending'){
        report.update_ack_shape={session_matches:raw.session?.id===sessionId,event_id_present:typeof raw.event_id==='string',client_event_id_echo:raw.event_id===updateId};
        if(raw.session?.id!==sessionId)return beginClose('foreign_update_ack');
        report.update_ack_observed=true;phase='complete';
        send({type:'speech_text_buffer.commit',event_id:randomUUID(),text:OUTPUT_PROBE_TEXT.complete});
      }else if(raw.type==='response.output_audio.started'&&['complete','cancel'].includes(phase)){
        activeReply=typeof raw.response_id==='string'?raw.response_id:null;
      }else if(raw.type==='response.output_audio.delta'&&['complete','cancel','cancel_pending'].includes(phase)){
        if(typeof raw.delta!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.delta))return beginClose('invalid_audio');
        const bytes=Buffer.from(raw.delta,'base64');
        if(!bytes.length||bytes.length%2||bytes.length>65536)return beginClose('invalid_audio');
        const metrics=report.audio[phase==='complete'?'complete':'cancel'];metrics.chunks++;metrics.bytes+=bytes.length;
        for(let offset=0;offset<bytes.length;offset+=2)if(bytes.readInt16LE(offset)!==0)metrics.nonzero_samples++;
        if(phase==='cancel'&&metrics.chunks>=2){
          if(typeof raw.response_id==='string')activeReply=raw.response_id;
          cancelId=randomUUID();phase='cancel_pending';send({type:'response.cancel',event_id:cancelId});
        }
      }else if(raw.type==='response.done'){
        report.terminal_shapes.push({phase,response_id_present:typeof raw.response_id==='string',question_id_present:typeof raw.question_id==='string',event_id_present:typeof raw.event_id==='string',
          response_keys:raw.response&&typeof raw.response==='object'&&!Array.isArray(raw.response)?Object.keys(raw.response).filter(k=>/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(k)).slice(0,32):[],
          nested_id_present:typeof raw.response?.id==='string',nested_id_matches:typeof raw.response?.id==='string'?raw.response.id===activeReply:null});
        if(phase==='complete'){
          if(!report.audio.complete.bytes)return beginClose('missing_complete_audio');
          phase='cancel';activeReply=null;
          send({type:'speech_text_buffer.commit',event_id:randomUUID(),text:OUTPUT_PROBE_TEXT.cancel});
        }else if(phase==='cancel')return beginClose('completed_before_cancel');
      }else if(raw.type==='response.canceled'&&phase==='cancel_pending'){
        report.cancel_ack_shape={event_id_present:typeof raw.event_id==='string',client_event_id_echo:raw.event_id===cancelId,
          response_id_present:typeof raw.response_id==='string',response_matches:raw.response_id===undefined?null:raw.response_id===activeReply};
        if(raw.response_id!==undefined&&raw.response_id!==activeReply)return beginClose('foreign_cancel_ack');
        report.cancel_ack_observed=true;beginClose('completed');
      }else if(raw.type==='session.closed'&&phase==='closing'){
        report.session_closed_observed=true;finish(closingReason);
      }
    };
    socket.on?.('unexpected-response',(_req,response)=>{
      if(Number.isInteger(response.statusCode))report.http_status=response.statusCode;
      response.resume();socket.terminate();
    });
    socket.on?.('error',()=>{});
    for(const [event,handler]of [['open',onOpen],['message',onMessage],['error',onError],['close',onClose]])socket.addEventListener(event,handler);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)onAbort();
  });
}
