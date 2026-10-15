import { randomUUID,createHash } from 'node:crypto';
import WebSocket from 'ws';
import { validateSeeduplexProfile } from './seeduplex.js';
export const FC_PROBE_VERSION='seeduplex-fc-planning-probe-v2';
export const FC_TOOL_NAME='plan_next_turn';
const id=v=>typeof v==='string'&&v.length>0&&v.length<=120;
export const FC_TOOL=Object.freeze({type:'function',name:FC_TOOL_NAME,description:'Before responding to every student input, call this tool and wait for its reply directive. Do not answer before receiving the tool result.',parameters:{type:'object',properties:{intent:{type:'string',description:'Short current student intent'}},required:['intent']}});
// Experimental wire path only. It cannot create a Web ticket, override the
// ordinary adapter's tool prohibition, or set generation_gate_verified.
export async function runFcPlanningProbe({profile,pcm,manifest,env=process.env,planTurn,signal,holdMs=1200,durationMs=20000,socketFactory=(url,options)=>new WebSocket(url,options)}={}) {
  validateSeeduplexProfile(profile);
  if(!Buffer.isBuffer(pcm)||pcm.length<640||pcm.length>480000||pcm.length%2||manifest?.source!=='local_os_authored_speech'||manifest.pcm_sha256!==createHash('sha256').update(pcm).digest('hex')||manifest.sample_rate!==16000||manifest.channels!==1||typeof planTurn!=='function'||!Number.isSafeInteger(holdMs)||holdMs<0||holdMs>3000||!Number.isSafeInteger(durationMs)||durationMs<100||durationMs>25000)throw new Error('INVALID_FC_PROBE_INPUT');
  const key=env[profile.auth.env];if(typeof key!=='string'||key.length<1||key.length>8192||/[^\x21-\x7e]/.test(key))throw new Error('FC_PROBE_CREDENTIAL_REQUIRED');
  const request=structuredClone(profile.session_create);
  request.session.tools=[FC_TOOL];
  request.session.instructions='你是Kai，用一句简短中文回应当前学生。每个学生输入都必须且只调用plan_next_turn工具一次；调用之前不生成回复文本或音频，等待工具结果后按reply_directive回应。工具等待或失败期间不能绕过规划。不要主动开场。';
  const report={version:FC_PROBE_VERSION,input_source:manifest.source,input_sha256:manifest.pcm_sha256,microphone_uploaded:false,contains_transcripts:false,contains_audio:false,provider_ready:false,session_closed_ack:false,asr_final_observed:false,asr_final_count:0,tool_call_batches:0,tool_results_sent:0,plan_accepted:false,planner_kind:null,degraded_reason:null,plan_hash:null,pre_tool_output_events:0,waiting_tool_output_events:0,post_tool_output_events:0,audio_bytes:0,input_frames:0,input_frames_while_waiting:0,hold_ms:holdMs,timeline:[],current_turn_generation_gate_verified:false,mandatory_tool_api_verified:false,real_experience_accepted:false};
  if(signal?.aborted)return {...report,ended:'aborted',status:'incomplete'};
  const started=performance.now(),controller=new AbortController();
  let socket,closed=false,closing=false,closeReason,interval,timer,closeTimer,position=0,finalInput=null,pending=null,epoch=1,wireFrames=0,replyOwner=null,settleFinal;
  const now=()=>Math.round(performance.now()-started),mark=(name,fields={})=>{if(report.timeline.length<40)report.timeline.push({name,at_ms:now(),...fields});};
  return await new Promise(resolve=> {
    const finish=reason=>{if(closed)return;closed=true;epoch++;controller.abort();clearTimeout(timer);clearTimeout(closeTimer);clearInterval(interval);signal?.removeEventListener('abort',abort);try{socket?.close();}catch{}report.ended=reason;report.status=report.plan_accepted&&report.tool_results_sent===1&&report.post_tool_output_events>0&&!report.pre_tool_output_events&&!report.waiting_tool_output_events?'sample_order_observed':report.pre_tool_output_events||report.waiting_tool_output_events?'uncontrolled_output_observed':'incomplete';resolve(report);};
    const send=value=>{if(closed||closing&&value.type!=='session.close')return false;try{socket.send(JSON.stringify({...value,event_id:randomUUID()}));return true;}catch{finish('send_failed');return false;}};
    const end=reason=>{if(closed||closing)return;closing=true;closeReason=reason;epoch++;controller.abort();clearInterval(interval);clearTimeout(timer);mark('close_requested');if(report.provider_ready){send({type:'session.close'});closeTimer=setTimeout(()=>finish(reason),1500);}else finish(reason);};
    const abort=()=>end('aborted');
    const output=raw=> {
      const isText=raw.type==='response.output_text.delta'||raw.type==='response.output_text.done',isAudio=raw.type==='response.output_audio.started'||raw.type==='response.output_audio.delta'||raw.type==='response.output_audio.done';
      if(!isText&&!isAudio)return;
      const bucket=report.tool_results_sent?'post_tool_output_events':pending?'waiting_tool_output_events':'pre_tool_output_events';report[bucket]++;
      if(report[bucket]===1)mark(bucket);
      if(raw.type==='response.output_audio.delta'&&typeof raw.delta==='string')report.audio_bytes+=Math.floor(raw.delta.length*3/4);
      if(raw.response_id!==undefined){if(!id(raw.response_id))return end('invalid_reply_identity');if(replyOwner!==null&&replyOwner!==raw.response_id)return end('overlapping_reply');replyOwner=raw.response_id;}
      if(raw.type==='response.output_audio.done'&&report.tool_results_sent)end('reply_output_done');
    };
    const processTool=async raw=> {
      if(pending||report.tool_call_batches)return end('duplicate_tool_batch');
      report.tool_call_batches++;mark('tool_call_received');
      if(!Array.isArray(raw.items)||raw.items.length!==1)return end('unsupported_tool_batch');
      const item=raw.items[0];let args;try{args=JSON.parse(item.arguments);}catch{return end('invalid_tool_arguments');}
      if(item.name!==FC_TOOL_NAME||!id(item.call_id)||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>k!=='intent')||typeof args.intent!=='string'||args.intent.length>100)return end('invalid_tool_arguments');
      const token=epoch;pending={token,call_id:item.call_id};mark('tool_wait_started');
      if(!finalInput)await Promise.race([new Promise(r=>{settleFinal=r;}),new Promise(r=>setTimeout(r,1500))]);
      if(closed||closing||epoch!==token)return;
      if(!finalInput)return end('tool_before_unavailable_final');
      try {
        const accepted=Promise.resolve(planTurn(finalInput,{signal:controller.signal})).then(plan=>{
          if(closed||closing||epoch!==token||controller.signal.aborted)return null;
          if(!plan?.reply_directive||!id(plan.proposal_id)||!['llm','rule'].includes(plan.planner_kind)||!/^[a-f0-9]{64}$/.test(plan.hash??'')||!Number.isSafeInteger(plan.expires_at)||plan.expires_at<=Date.now())throw new Error('PLAN_NOT_ACCEPTED');
          report.plan_accepted=true;report.planner_kind=plan.planner_kind;report.plan_hash=plan.hash;mark('plan_accepted');
          report.degraded_reason=['planner_timeout','planner_validation_failed','planner_unavailable','planner_unconfigured'].includes(plan.degraded_reason)?plan.degraded_reason:null;
          return plan;
        });
        const [plan]=await Promise.all([accepted,new Promise(r=>setTimeout(r,holdMs))]);
        if(closed||closing||epoch!==token||controller.signal.aborted)return;
        if(!plan)return end('plan_not_accepted');
        if(plan.expires_at<=Date.now())return end('plan_expired_before_result');
        if(send({type:'conversation.item.create',items:[{call_id:pending.call_id,role:'tool',content:[{type:'input_text',text:JSON.stringify({reply_directive:plan.reply_directive,action:plan.action,plan_hash:plan.hash})}]}]})){report.tool_results_sent++;mark('tool_result_sent');}
      }catch{if(!closed&&!closing)end('planner_failed');}
    };
    const onMessage=event=> {
      if(closed)return;
      if(typeof event.data!=='string'||Buffer.byteLength(event.data)>262144||++wireFrames>1000)return end('frame_limit');
      let raw;try{raw=JSON.parse(event.data);}catch{return end('invalid_frame');}
      if(!raw||typeof raw!=='object'||typeof raw.type!=='string')return end('invalid_frame');
      if(raw.type==='session.closed'){report.session_closed_ack=true;return finish(closeReason??'remote_closed');}
      if(closing)return;
      if(raw.type==='error')return end('provider_error');
      if(raw.type==='session.created') {
        if(report.provider_ready||!id(raw.session?.id))return end('invalid_ready');
        report.provider_ready=true;mark('provider_ready');
        interval=setInterval(()=>{if(closed||closing)return;const bytes=position<pcm.length?pcm.subarray(position,position+640):Buffer.alloc(640);position+=640;const frame=bytes.length===640?bytes:Buffer.concat([bytes,Buffer.alloc(640-bytes.length)]);if(send({type:'input_audio_buffer.append',audio:frame.toString('base64')})){report.input_frames++;if(pending&&!report.tool_results_sent)report.input_frames_while_waiting++;}},20);
        return;
      }
      if(raw.type==='conversation.item.input_audio_transcription.completed') {
        const text=raw.text??raw.transcript;
        if(!id(raw.item_id)||typeof text!=='string'||!text.length||text.length>2000)return end('invalid_final');
        if(finalInput){if(finalInput.item_id!==raw.item_id||finalInput.text!==text)return end('new_input_during_tool');return;}
        finalInput={item_id:raw.item_id,text};report.asr_final_observed=true;report.asr_final_count++;mark('asr_final');settleFinal?.();return;
      }
      if(raw.type==='response.function_call_arguments.done'){void processTool(raw);return;}
      output(raw);
    };
    try {
      socket=socketFactory(profile.endpoint,{headers:{[profile.auth.header]:profile.auth.prefix+key},maxPayload:262144,perMessageDeflate:false,handshakeTimeout:5000,followRedirects:false});
      socket.binaryType='arraybuffer';
      socket.addEventListener('open',()=>{mark('socket_open');send(request);});
      socket.addEventListener('message',onMessage);
      socket.addEventListener('error',()=>finish('transport_error'));
      socket.addEventListener('close',()=>finish(closeReason??'remote_closed'));
      socket.on?.('unexpected-response',(_req,response)=>{report.http_status=response.statusCode;response.resume();finish('handshake_rejected');});
      timer=setTimeout(()=>end('duration_limit'),durationMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    }catch{finish('socket_failed');}
  });
}
