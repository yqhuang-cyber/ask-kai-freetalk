import WebSocket from 'ws';
import {randomUUID,createHash} from 'node:crypto';
import {encodeAsr,decodeAsr,asrRequest,scriptCounts,normalized} from './protocol.js';
import {validateSeeduplexProfile} from '../../../packages/provider-doubao/seeduplex.js';
import {readAsrConfig} from './config.js';

export const hash=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const S2S_ENDPOINT='wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue';
function safeNumber(value){return /^\d{1,12}$/.test(String(value??''))?Number(value):null;}
function denialCategory(message) {
  if(/(?:not granted|not authorized|not allowed|未开通|没有权限|未授权)/i.test(message)&&/resource|model|服务|资源/i.test(message))return 'resource_access_not_granted';
  if(/(?:insufficient|欠费|余额不足)/i.test(message))return 'insufficient_balance';
  if(/(?:invalid|expired|无效|过期).{0,40}(?:key|token|credential|密钥)/i.test(message))return 'invalid_credential';
  return 'unclassified_handshake_rejection';
}

export async function recognize({pcm,language,auto=false,resource:resourceOverride,env=process.env}) {
  if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length>480000||pcm.length%2)throw Error('INVALID_ASR_PROBE');
  const {endpoint,resource,credential}=readAsrConfig(env,{resource:resourceOverride});
  const meta={resource,mode:auto?'auto':language,upgrade:false,final:false,packets_sent:0,pcm_bytes:pcm.length,pcm_sha256:hash(pcm),error_code:null,http_status:null};
  if(!credential)return {meta:{...meta,ended:'missing_credential'},text:''};
  const config=asrRequest({language,auto});
  let finalText='',lastSent=null,finished=false,timer;
  const started=performance.now();
  return new Promise(resolve=>{
    const socket=new WebSocket(endpoint,{headers:{'X-Api-Key':credential,'X-Api-Resource-Id':resource,'X-Api-Request-Id':randomUUID(),'X-Api-Sequence':'-1'},maxPayload:512*1024,perMessageDeflate:false,followRedirects:false,handshakeTimeout:5000});
    const finish=ended=>{
      if(finished)return;finished=true;clearTimeout(timer);socket.terminate();
      Object.assign(meta,{ended,elapsed_ms:Math.round(performance.now()-started),text_sha256:hash(finalText),...scriptCounts(finalText)});
      resolve({meta,text:finalText});
    };
    timer=setTimeout(()=>finish('deadline'),25000);
    socket.on('unexpected-response',(_req,res)=>{
      meta.http_status=res.statusCode;meta.error_code=safeNumber(res.headers['x-api-status-code']);
      let body='';
      res.on('data',chunk=>{if(body.length<8192)body+=chunk.toString('utf8').slice(0,8192-body.length);});
      res.on('end',()=>{
        try{const data=JSON.parse(body);meta.error_code??=safeNumber(data.code??data.error?.code);}catch{/* Never print an HTTP body. */}
        meta.denial_category=denialCategory(String(res.headers['x-api-message']??'')+' '+body);body='';finish('handshake_rejected');
      });res.on('error',()=>finish('handshake_rejected'));
    });
    socket.on('error',()=>finish('network_error'));
    socket.on('close',()=>finish('closed_before_final'));
    socket.on('open',async()=>{
      meta.upgrade=true;
      try{
        socket.send(encodeAsr('config',config));
        for(let offset=0;offset<pcm.length&&!finished;offset+=6400){
          const end=Math.min(offset+6400,pcm.length),last=end===pcm.length;
          socket.send(encodeAsr('audio',pcm.subarray(offset,end),{last}));meta.packets_sent++;
          if(last)lastSent=performance.now();else await sleep(200);
        }
      }catch{finish('send_failed');}
    });
    socket.on('message',(bytes,binary)=>{
      if(finished)return;
      try{
        if(!binary)throw Error('EXPECTED_BINARY');
        const result=decodeAsr(Buffer.from(bytes));
        if(result.error){meta.error_code=result.code;return finish('provider_error');}
        if(result.text||result.final)finalText=result.text;
        if(result.final){
          meta.final=true;meta.final_after_last_packet_ms=lastSent===null?null:Math.round(performance.now()-lastSent);
          finish('final');
        }
      }catch{finish('invalid_response');}
    });
  });
}

export async function nativeProbe({profile,env=process.env,mode,text,pcm,source='authored_text',windowMs=10000,historyContentType='input_text',verifyHistory=false,audioExpectedText=text,history=[],requireHistoryReadback=false,instructions}) {
  validateSeeduplexProfile(profile);
  if(!['audio','history_user','history_pair','history_audio_trigger','initial_history_audio_trigger','recitation'].includes(mode)||typeof text!=='string'||!text||text.length>1000||!['input_text','text'].includes(historyContentType)||['audio','history_audio_trigger','initial_history_audio_trigger'].includes(mode)&&!Buffer.isBuffer(pcm))throw Error('INVALID_NATIVE_PROBE');
  if(!Array.isArray(history)||history.length>38||history.length%2||history.some((item,index)=>item?.role!==(index%2?'assistant':'user')||typeof item.text!=='string'||!item.text.length||item.text.length>4000)||JSON.stringify(history).length>20000)throw Error('INVALID_PROBE_HISTORY');
  const credential=env[profile.auth.env];if(!credential)throw Error('MISSING_S2S_CREDENTIAL');
  const meta={mode,input_source:source,input_text_sha256:hash(text),prior_history_messages:history.length,ready:false,history_ack:false,asr_final_count:0,audio_bytes:0,audio_non_silent:false,response_complete:false,session_closed_ack:false,event_counts:{},error_code:null};
  if(mode.startsWith('history'))meta.history_content_type=historyContentType;
  let output='',outputFinal=null,asr='',position=0,settled=false,closing=false,timer,pump,closeTimer,completeTimer,submittedAt,inputEndAt,audioEnabled=mode==='audio'&&history.length===0;
  const replies=new Set(),turns=new Set(),started=performance.now(),historyReview=[];
  return new Promise(resolve=>{
    const socket=new WebSocket(S2S_ENDPOINT,{headers:{'X-Api-Key':credential},maxPayload:512*1024,perMessageDeflate:false,followRedirects:false,handshakeTimeout:5000});
    const send=event=>socket.send(JSON.stringify(event));
    const finish=ended=>{
      if(settled||closing)return;closing=true;meta.ended=ended;clearTimeout(timer);clearTimeout(completeTimer);clearInterval(pump);
      const finalize=()=>{
        if(settled)return;settled=true;clearTimeout(closeTimer);socket.terminate();
        Object.assign(meta,{elapsed_ms:Math.round(performance.now()-started),output_text_sha256:hash(output),output_characters:output.length,...scriptCounts(output),echo:normalized(output)===normalized(text),arithmetic_eight:/(?:八|8|แปด)/u.test(output),native_reply_ids:replies.size,native_turn_ids:turns.size,asr_matches_audio_script:asr?normalized(asr)===normalized(audioExpectedText):null});
        Object.assign(meta,{final_text_present:typeof outputFinal==='string',final_matches_stream:outputFinal===null?null:outputFinal===output,final_text_replacement_characters:outputFinal===null?null:(outputFinal.match(/\ufffd/gu)??[]).length,stream_replacement_characters:(output.match(/\ufffd/gu)??[]).length});
        resolve({meta,output,outputFinal,asr,historyReview});
      };
      closeTimer=setTimeout(finalize,1200);
      if(socket.readyState===WebSocket.OPEN){try{send({type:'session.close',event_id:randomUUID()});}catch{finalize();}}
      else finalize();
      meta._finalize=finalize;
    };
    timer=setTimeout(()=>finish('initial_deadline'),8000);
    socket.on('unexpected-response',(_req,res)=>{meta.http_status=res.statusCode;res.resume();finish('handshake_rejected');});
    socket.on('error',()=>finish('network_error'));
    socket.on('close',()=>{if(closing)meta._finalize?.();else finish('closed_before_completion');});
    socket.on('open',()=>{
      const create=structuredClone(profile.session_create);
      create.session.instructions='你是Kai。这是独立自由对话能力测试，不要主动开场。收到用户问题后，简短直接回答，先一句中文，再一句对应泰语，只用中文和泰语，不要复述问题。数学问题直接说出计算结果。';
      if(instructions!==undefined){if(typeof instructions!=='string'||!instructions.length||instructions.length>16000)throw Error('INVALID_PROBE_INSTRUCTIONS');create.session.instructions=instructions;}
      if(mode==='initial_history_audio_trigger'||history.length){
        create.extension??={};create.extension.dialog??={};
        create.extension.dialog.dialog_context=[...structuredClone(history),...(mode==='initial_history_audio_trigger'?[{role:'user',text},{role:'assistant',text:'我先记下这个问题。'}]:[])];
      }
      try{send(create);}catch{finish('create_failed');}
    });
    socket.on('message',(bytes,binary)=>{
      if(settled)return;
      try{
        if(binary)throw Error('EXPECTED_JSON');
        const raw=JSON.parse(bytes.toString('utf8')),type=raw.type;
        if(typeof type!=='string'||!/^[a-z][a-z0-9_.]{0,100}$/.test(type))throw Error('INVALID_EVENT_TYPE');
        if(type==='session.closed'){meta.session_closed_ack=true;if(closing)meta._finalize?.();return;}
        if(closing)return;
        if(Object.keys(meta.event_counts).length>=40&&!Object.hasOwn(meta.event_counts,type))throw Error('EVENT_TYPE_LIMIT');
        meta.event_counts[type]=(meta.event_counts[type]??0)+1;
        if(type==='error'){meta.error_code=safeNumber(raw.error?.code??raw.code);return finish('provider_error');}
        if(type==='session.created'){
          if(meta.ready)throw Error('DUPLICATE_READY');meta.ready=true;clearTimeout(timer);submittedAt=performance.now();meta.session_ready_after_open_ms=Math.round(submittedAt-started);
          pump=setInterval(()=>{
            try{
              const frame=Buffer.alloc(640);
              if(audioEnabled){pcm.copy(frame,0,position,Math.min(position+640,pcm.length));position=Math.min(position+640,pcm.length);if(position===pcm.length&&inputEndAt===undefined)inputEndAt=performance.now();}
              send({type:'input_audio_buffer.append',audio:frame.toString('base64')});
            }catch{finish('audio_pump_failed');}
          },20);
          if(mode.startsWith('history')){
            const items=[{id:randomUUID(),type:'message',role:'user',content:[{type:historyContentType,text}]}];
            // An authored fixture, not an actual previous model answer.
            if(['history_pair','history_audio_trigger'].includes(mode))items.push({id:randomUUID(),type:'message',role:'assistant',content:[{type:'text',text:mode==='history_audio_trigger'?'我先记下这个问题。':'八。 แปด'}]});
            send({type:'conversation.item.create',event_id:randomUUID(),items});
          }
          if(mode==='recitation')send({type:'speech_text_buffer.commit',event_id:randomUUID(),text});
          if(mode==='initial_history_audio_trigger'||history.length)send({type:'conversation.item.retrieve',event_id:randomUUID(),items:[]});
          timer=setTimeout(()=>finish('observation_window'),['audio','history_audio_trigger','initial_history_audio_trigger','recitation'].includes(mode)?35000:windowMs);
        }
        if(type==='conversation.item.added'){
          meta.history_ack=true;
          if(verifyHistory)send({type:'conversation.item.retrieve',event_id:randomUUID(),items:[]});
          else if(mode==='history_audio_trigger'&&!audioEnabled){audioEnabled=true;meta.audio_trigger_after_history_ack=true;}
        }
        if(type==='conversation.item.retrieved'){
          const items=Array.isArray(raw.items)?raw.items:[];
          meta.history_retrieved_items=items.length;
          meta.prior_history_readback_matched=history.every((entry,index)=>items[index]?.role===entry.role&&Array.isArray(items[index]?.content)&&items[index].content.some(part=>part.text===entry.text));
          meta.history_item_shapes=items.slice(0,4).map(item=>({keys:Object.keys(item).slice(0,12),role:['user','assistant'].includes(item.role)?item.role:'other',content_keys:Array.isArray(item.content)?item.content.slice(0,2).map(part=>Object.keys(part).slice(0,8)):[]}));
          historyReview.push(...items.slice(0,4).map(item=>({role:['user','assistant'].includes(item.role)?item.role:'other',texts:Array.isArray(item.content)?item.content.map(part=>typeof part.text==='string'?part.text.slice(0,1000):''):[]})));
          meta.history_query_observed=items.some(item=>item.role==='user'&&Array.isArray(item.content)&&item.content.some(part=>part.text===text));
          meta.history_returned_content_types=[...new Set(items.flatMap(item=>Array.isArray(item.content)?item.content.map(part=>part.type).filter(type=>['input_text','text','output_text'].includes(type)):[]))];
          if(requireHistoryReadback&&(!meta.prior_history_readback_matched||mode!=='audio'&&!meta.history_query_observed))return finish('history_readback_mismatch');
          if(['audio','history_audio_trigger','initial_history_audio_trigger'].includes(mode)&&!audioEnabled){audioEnabled=true;meta.audio_trigger_after_history_ack=meta.history_ack;meta.audio_trigger_after_history_readback=true;}
        }
        if(type==='conversation.item.input_audio_transcription.completed'){
          meta.asr_final_count++;asr=typeof raw.text==='string'?raw.text:'';
        }
        if(type.startsWith('response.')){
          if(typeof raw.response_id==='string')replies.add(raw.response_id);
          if(typeof raw.question_id==='string')turns.add(raw.question_id);
        }
        if(type==='response.output_text.delta'&&typeof raw.delta==='string')output+=raw.delta;
        if(type==='response.output_text.done'&&typeof raw.text==='string'){
          if(raw.text.length>4000)throw Error('OUTPUT_LIMIT');
          outputFinal=raw.text;if(!output)output=raw.text;
        }
        if(output.length>4000)throw Error('OUTPUT_LIMIT');
        if(type==='response.output_audio.delta'&&typeof raw.delta==='string'){
          const pcmChunk=Buffer.from(raw.delta,'base64');meta.audio_bytes+=pcmChunk.length;
          if(meta.first_audio_after_submit_ms===undefined){meta.first_audio_after_submit_ms=Math.round(performance.now()-submittedAt);meta.first_audio_after_open_ms=Math.round(performance.now()-started);meta.first_audio_after_input_end_ms=inputEndAt===undefined?null:Math.round(performance.now()-inputEndAt);}
          for(let i=0;i+1<pcmChunk.length;i+=2)if(Math.abs(pcmChunk.readInt16LE(i))>300){meta.audio_non_silent=true;break;}
          if(meta.audio_bytes>1920000)throw Error('AUDIO_LIMIT');
        }
        if(type==='response.output_audio.done'){
          meta.response_complete=true;clearTimeout(completeTimer);completeTimer=setTimeout(()=>finish('audio_done'),300);
        }
      }catch{finish('invalid_response');}
    });
  }).then(result=>{delete result.meta._finalize;return result;});
}
