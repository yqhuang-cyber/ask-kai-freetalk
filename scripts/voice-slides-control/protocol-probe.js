import {randomUUID,createHash} from 'node:crypto';
import WebSocket from 'ws';
import {validateSeeduplexProfile} from '../../packages/provider-doubao/seeduplex.js';
import {SLIDES_TOOL,SLIDES_CANCEL_TOOL,resolveSlidesTarget,slidesReviewTools,validateSlidesIntent} from '../../packages/contracts/ui-actions.js';
import {probeInstructions} from './cases.js';
import {INSPECTION_TOOLS} from './batch-cases.js';
import {SourceEvidenceLedger,withSourceEvidence,SOURCE_INSTRUCTIONS} from './source-evidence.js';
import {SlidesCommandCapabilities,capabilityInstructions} from './command-capabilities.js';
import {CONTROL_INSTRUCTIONS} from './control-cases.js';
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=120;
const normalize=text=>text.normalize('NFKC').replace(/[\p{P}\p{Z}\p{S}\s]/gu,'').toLowerCase();
const hash=value=>createHash('sha256').update(value).digest('hex');

// Isolated native protocol experiment. It has no Web ticket or production enable path.
// Execution receipts and initial page history are SYNTHETIC, even with a real provider.
export async function runSlidesProtocolProbe({profile,pcm,manifest,testCase,env=process.env,holdMs=1200,durationMs=25000,toolScope='confirmed',sourceEvidence=false,epochCapabilities=false,signal,
  observeAuthoredReply,socketFactory=(url,options)=>new WebSocket(url,options)}={}) {
  validateSeeduplexProfile(profile);
  if(!Buffer.isBuffer(pcm)||pcm.length<640||pcm.length>480000||pcm.length%2||manifest?.source!=='local_os_authored_speech'||
    manifest.pcm_sha256!==hash(pcm)||manifest.script_sha256!==hash(testCase?.text??'')||manifest.sample_rate!==16000||manifest.channels!==1||
    !testCase?.expected||![1,2].includes(testCase.expected.call_count??1)||!['static','confirmed'].includes(toolScope)||typeof sourceEvidence!=='boolean'||typeof epochCapabilities!=='boolean'||sourceEvidence&&epochCapabilities||(sourceEvidence||epochCapabilities)&&(testCase.expected.call_count??1)!==1||!Number.isSafeInteger(holdMs)||holdMs<0||holdMs>3000||!Number.isSafeInteger(durationMs)||durationMs<100||durationMs>30000)throw new Error('INVALID_SLIDES_PROBE_INPUT');
  resolveSlidesTarget({action:'goto',page:testCase.state.page},testCase.state);
  const key=env[profile.auth.env];
  if(typeof key!=='string'||!key.length||key.length>8192||/[^\x21-\x7e]/.test(key))throw new Error('SLIDES_PROBE_CREDENTIAL_REQUIRED');
  const request=structuredClone(profile.session_create);
  const expectedCalls=testCase.expected.call_count??1;
  const inspection=testCase.id==='inspect-slide-batch',requiresTools=Boolean(testCase.expected.action||inspection);
  request.session.tools=toolScope==='confirmed'?slidesReviewTools(testCase.state):[structuredClone(SLIDES_TOOL)];request.session.instructions=probeInstructions(testCase.state);
  if(inspection){
    request.session.tools=structuredClone(INSPECTION_TOOLS);
    request.session.instructions='你是Kai，用简短自然中文回应。本次是只读批次协议诊断，不允许切页，也不调用导航工具。当前页与回看历史必须通过两个独立工具查询，不能从对话猜测。学习者同时问当前第几页及能回看哪些页时，在同一个批次中分别调用inspect_current_slide和inspect_review_history，两者参数都为空对象。两个查询彼此独立，不要等第一个结果才发第二个调用。两个结果由宿主聚合返回后再根据实际状态回答。所有数据为作者模拟，不证明真人学习或观看。';
  }else if(expectedCalls===2){
    if(!request.session.tools.length)throw new Error('INVALID_BATCH_PROBE_CAPABILITY');
    const tool=request.session.tools[0];tool.parameters.properties.action.enum=['previous'];
    delete tool.parameters.properties.page;delete tool.parameters.properties.replace_pending;
    request.session.instructions+='\n本次是批次协议诊断：学习者要求连续回看两次时，在同一个工具调用批次中返回两个 navigate_slides 调用，每个参数均为 {"action":"previous"}。不要合并成goto，不要先调用一次等待结果。宿主会按数组顺序执行，再将两个结果聚合为一次回传。此明确的两次请求优先于上文通常调用一次的说明。';
  }
  if(sourceEvidence){request.session.tools=withSourceEvidence(request.session.tools);request.session.instructions+=SOURCE_INSTRUCTIONS;}
  const capabilities=new SlidesCommandCapabilities(),registration=epochCapabilities?capabilities.registration(testCase.state):null;
  if(epochCapabilities){request.session.tools=registration.tools;request.session.instructions=capabilityInstructions(probeInstructions(testCase.state)+CONTROL_INSTRUCTIONS,registration);}
  const report={version:1,id:testCase.id,provider_ready:false,session_closed_ack:false,input_source:manifest.source,input_sha256:manifest.pcm_sha256,
    synthetic_viewer:true,synthetic_history:true,microphone_uploaded:false,browser_audio_tested:false,human_listening_tested:false,
    production_agent_changed:false,contains_transcripts:false,contains_audio:false,asr_final_count:0,asr_matches_authored:null,
    tool_batches:0,tool_calls:[],tool_results_sent:0,result_batches_sent:0,synthetic_actions_applied:0,input_frames:0,input_frames_while_waiting:0,
    tool_scope:toolScope,registered_navigation_tools:request.session.tools.filter(tool=>epochCapabilities?capabilities.kind(tool.name)==='navigate':tool.name===SLIDES_TOOL.name).length,
    registered_actions:request.session.tools[0]?.parameters.properties.action?.enum??[],scoped_review_pages:toolScope==='confirmed'?testCase.state.shown.filter(page=>page<=testCase.state.page):null,
    pre_result_output_events:0,post_result_output_events:0,audio_bytes:0,fc_identity_shapes:[],timeline:[],
    final_page:testCase.state.page,expected_page:testCase.expected.page??testCase.state.page,
    semantics_accepted:null,production_ownership_verified:false,mandatory_tool_api_verified:false,real_experience_accepted:false,
    source_evidence_enabled:sourceEvidence,source_evidence:[],epoch_capabilities_enabled:epochCapabilities,action_scope:epochCapabilities?'session_call':'diagnostic',capability_admissions:[]};
  if(signal?.aborted)return {...report,ended:'aborted',status:'incomplete'};
  let socket,finished=false,closing=false,reason,interval,deadline,closeTimer,toolTimer,settleTimer,position=0,frames=0;
  let finalId=null,candidateId=null,pending=null,replyId=null,questionId=null,replyText='',recognizedText='',textDone=false,audioDone=false,audioStarted=false;
  const state=structuredClone(testCase.state),started=performance.now(),at=()=>Math.round(performance.now()-started),ledger=new SourceEvidenceLedger(),authoredClaims=[];
  const mark=(name,fields={})=>{if(report.timeline.length<64)report.timeline.push({name,at_ms:at(),...fields});};
  return await new Promise(resolve=>{
    const finish=ended=>{
      if(finished)return;finished=true;clearInterval(interval);for(const timer of [deadline,closeTimer,toolTimer,settleTimer])clearTimeout(timer);
      signal?.removeEventListener('abort',abort);try{socket?.terminate?.();socket?.close?.();}catch{}
      report.ended=ended;report.final_page=state.page;
      const expected=testCase.expected;
      report.expected_action_observed=inspection?report.tool_calls.length===2&&INSPECTION_TOOLS.every(tool=>report.tool_calls.some(call=>call.name===tool.name)):
        expected.action?report.tool_calls.length===expectedCalls&&report.tool_calls.every(call=>call.action===expected.action):report.tool_calls.length===0;
      report.expected_execution_observed=requiresTools?report.tool_results_sent===expectedCalls&&report.synthetic_actions_applied===(inspection?0:expectedCalls):report.tool_calls.length===0;
      report.expected_page_observed=state.page===report.expected_page;
      report.tool_order_observed=requiresTools?report.tool_results_sent===expectedCalls&&report.result_batches_sent===1&&report.pre_result_output_events===0:null;
      report.reply_observed=textDone&&audioDone;
      report.reply_features={deferred:/(一会|稍后|后面|等会|之后|接下来).{0,20}(学|看|讲|到)|先.{0,12}(当前|现在|这页|这一页)/u.test(replyText),
        asks_clarification:/[？?]|哪一页|哪部分|哪里|还是/u.test(replyText),
        explains_boundary:/最后|只有三|一共三|不存在|没有第十|没有.*下一页/u.test(replyText),
        claims_page_changed:/(已经|已).{0,12}(回到|翻到|切到|切换)|现在.{0,6}第.{0,3}页/u.test(replyText)};
      report.status=ended==='reply_done'&&report.provider_ready&&report.session_closed_ack&&report.asr_final_count===1&&report.reply_observed&&report.expected_execution_observed&&report.expected_page_observed&&(!requiresTools||report.tool_order_observed)?'sample_observed':'needs_review';
      try{observeAuthoredReply?.({id:testCase.id,text:replyText,recognized_authored_input:recognizedText,...(sourceEvidence?{claimed_sources:authoredClaims}:{}),expected:expected.decision??expected.action});}catch{}
      ledger.close();
      capabilities.close();
      resolve(report);
    };
    const send=value=>{if(finished||closing&&value.type!=='session.close')return false;try{socket.send(JSON.stringify({event_id:randomUUID(),...value}));return true;}catch{finish('send_failed');return false;}};
    const end=ended=>{if(finished||closing)return;closing=true;reason=ended;clearInterval(interval);clearTimeout(deadline);clearTimeout(toolTimer);mark('close_requested');
      if(report.provider_ready){send({type:'session.close'});closeTimer=setTimeout(()=>finish(ended),1500);}else finish(ended);};
    const abort=()=>end('aborted');
    const result=()=>{
      if(finished||closing||!pending||!finalId)return;
      if(at()-pending.started<holdMs){clearTimeout(toolTimer);toolTimer=setTimeout(result,holdMs-(at()-pending.started));return;}
      const items=pending.calls.map(call=>{
        if(inspection){
          const outcome=call.name==='inspect_current_slide'?{page:state.page,total:3}:{current_page:state.page,allowed_review_pages:state.shown.filter(page=>page<=state.page)};
          return {call_id:call.callId,role:'tool',content:[{type:'input_text',text:JSON.stringify({...outcome,status:'observed',confirmed:true,execution_source:'synthetic_host_snapshot'})}]};
        }
        let evidence;
        if(sourceEvidence){
          evidence=ledger.claim(call.callId,call.sourceText,JSON.stringify(call.args));
          report.source_evidence.push({status:evidence.status,reason:evidence.reason??null,matched_reserved_input:evidence.status==='matched'&&evidence.input_id===finalId});
        }
        const denied=sourceEvidence&&evidence.status!=='matched'?evidence.reason:epochCapabilities&&call.capability.status!=='accepted'?call.capability.reason:null;
        const resolution=denied?{status:'rejected',reason:denied,page:state.page,total:3,confirmed:true}:epochCapabilities&&call.name===SLIDES_CANCEL_TOOL.name?{status:'unchanged',reason:'NO_PENDING_REVIEWS',page:state.page,total:3,confirmed:true}:resolveSlidesTarget(call.args,state);let outcome=resolution;
        if(resolution.status==='ready'){
          state.page=resolution.target_page;state.visits.push(state.page);state.visits=state.visits.slice(-20);
          report.synthetic_actions_applied++;mark('synthetic_viewer_ack',{page:state.page});
          outcome={status:'applied',reason:'PAGE_CHANGED',page:state.page,total:3,confirmed:true};
        }
        return {call_id:call.callId,role:'tool',content:[{type:'input_text',text:JSON.stringify({...outcome,execution_source:'synthetic_viewer',navigation_policy:'review_only'})}]};
      });
      if(send({type:'conversation.item.create',items})){
        report.tool_results_sent+=items.length;report.result_batches_sent++;mark('tool_result_sent',{count:items.length});pending=null;
      }
    };
    const onMessage=event=>{
      if(finished)return;
      if(typeof event.data!=='string'||Buffer.byteLength(event.data)>262144||++frames>2500)return end('frame_limit');
      let raw;try{raw=JSON.parse(event.data);}catch{return end('invalid_frame');}
      if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.type!=='string')return end('invalid_frame');
      if(raw.type==='session.closed'){report.session_closed_ack=true;return finish(reason??'remote_closed');}
      if(closing)return;
      if(raw.type==='error'){const code=raw.code??raw.status_code??raw.error?.code;if(typeof code==='number'&&Number.isSafeInteger(code)||typeof code==='string'&&/^[A-Z0-9_]{1,40}$/i.test(code))report.provider_error_code=code;return end('provider_error');}
      if(raw.type==='session.created'){
        if(report.provider_ready||!validId(raw.session?.id))return end('invalid_ready');
        report.provider_ready=true;mark('provider_ready');
        if(epochCapabilities&&!capabilities.acknowledge(registration.token))return end('capability_ack_failed');
        interval=setInterval(()=>{
          if(finished||closing)return;
          const part=position<pcm.length?pcm.subarray(position,position+640):Buffer.alloc(640);position+=640;
          const frame=part.length===640?part:Buffer.concat([part,Buffer.alloc(640-part.length)]);
          if(send({type:'input_audio_buffer.append',audio:frame.toString('base64')})){report.input_frames++;if(pending)report.input_frames_while_waiting++;}
        },20);return;
      }
      if(raw.type==='conversation.item.input_audio_transcription.started'){
        if(!validId(raw.item_id))return end('invalid_input_identity');
        if(candidateId&&candidateId!==raw.item_id||finalId&&finalId!==raw.item_id)return end('new_input_ownership_fence');
        candidateId=raw.item_id;ledger.begin(raw.item_id);if(epochCapabilities)capabilities.observeStarted(raw.item_id);mark('asr_candidate');return;
      }
      if(raw.type==='conversation.item.input_audio_transcription.completed'){
        const text=raw.text??raw.transcript;
        if(!validId(raw.item_id)||typeof text!=='string'||!text.length||text.length>2000||raw.text!==undefined&&raw.transcript!==undefined&&raw.text!==raw.transcript)return end('invalid_final');
        if(finalId){if(finalId!==raw.item_id)return end('new_input_ownership_fence');return;}
        if(candidateId&&candidateId!==raw.item_id)return end('new_input_ownership_fence');
        finalId=raw.item_id;recognizedText=text;report.asr_final_count++;report.asr_matches_authored=normalize(text)===normalize(testCase.text);mark('asr_final');
        if(sourceEvidence)ledger.complete(raw.item_id,text);
        if(epochCapabilities)capabilities.observeFinal(raw.item_id);
        if(questionId&&questionId!==finalId)return end('reply_input_mismatch');
        if(pending)result();return;
      }
      if(raw.type==='response.function_call_arguments.done'){
        report.tool_batches++;mark('tool_call');
        report.batch_sizes??=[];report.batch_sizes.push(Array.isArray(raw.items)?raw.items.length:null);
        if(pending||report.tool_results_sent||!Array.isArray(raw.items)||raw.items.length!==expectedCalls)return end('unsupported_or_duplicate_tool_batch');
        const calls=[];
        for(const wireItem of raw.items){
          const kind=epochCapabilities?capabilities.kind(wireItem.name):null;
          const item=epochCapabilities?{...wireItem,name:kind==='navigate'?SLIDES_TOOL.name:kind==='cancel'?SLIDES_CANCEL_TOOL.name:'unknown'}:wireItem;
          let args;try{args=JSON.parse(item.arguments);}catch{return end('invalid_tool_arguments');}
          if(!(epochCapabilities?kind!==null:inspection?INSPECTION_TOOLS.some(tool=>tool.name===item.name):item.name===SLIDES_TOOL.name)||!validId(item.call_id)||typeof item.arguments!=='string'||item.arguments.length>1024||typeof args!=='object'||args===null||Array.isArray(args)||calls.some(call=>call.callId===item.call_id))return end('invalid_tool_arguments');
          if(inspection?(Object.keys(args).length!==0||calls.some(call=>call.name===item.name)):expectedCalls===2&&(!validateSlidesIntent(args)||args.action!=='previous'||Object.keys(args).length!==1))return end('invalid_batch_arguments');
          let sourceText;
          if(sourceEvidence){
            sourceText=args.source_text;const {source_text,...intent}=args;
            if(typeof sourceText!=='string'||!sourceText.length||sourceText.length>400||!validateSlidesIntent(intent))return end('invalid_source_tool_arguments');
            args=intent;authoredClaims.push(sourceText);
          }
          const topKeys=['question_id','response_id','item_id','id'].filter(key=>Object.hasOwn(raw,key));
          const itemKeys=['question_id','response_id','item_id','id'].filter(key=>Object.hasOwn(item,key));
          const knownInput=finalId??candidateId;
          report.fc_identity_shapes.push({top_fields:topKeys,item_fields:itemKeys,input_identity_match:knownInput?[...topKeys.map(k=>raw[k]),...itemKeys.map(k=>item[k])].includes(knownInput):null});
          report.tool_calls.push({name:item.name,action:inspection?'inspect':['next','previous','recent','goto'].includes(args.action)?args.action:'invalid',...(Number.isSafeInteger(args.page)&&args.page>=1&&args.page<=3?{page:args.page}:{})});
          const capability=epochCapabilities?capabilities.admit({name:wireItem.name,callId:item.call_id,args},state):null;
          if(epochCapabilities)report.capability_admissions.push({status:capability.status,reason:capability.reason??null,kind,epoch_index:capability.epoch_index??null});
          calls.push({callId:item.call_id,name:item.name,args,sourceText,capability});
        }
        // Only the pre-reserved authored single-input slot is exercised here; no claim of live multi-turn ownership.
        pending={calls,started:at()};
        clearTimeout(toolTimer);toolTimer=setTimeout(()=>{if(!finalId)return end('tool_without_final');result();},Math.max(holdMs,1500));
        result();return;
      }
      if(!['response.output_text.delta','response.output_text.done','response.output_audio.started','response.output_audio.delta','response.output_audio.done'].includes(raw.type))return;
      const before=report.tool_results_sent===0;
      report[before?'pre_result_output_events':'post_result_output_events']++;
      if(report[before?'pre_result_output_events':'post_result_output_events']===1)mark(before?'output_before_result':'output_after_result');
      if(raw.response_id!==undefined){
        if(!validId(raw.response_id)||replyId&&replyId!==raw.response_id)return end('overlapping_reply');replyId=raw.response_id;
      }
      if(raw.question_id!==undefined){
        if(!validId(raw.question_id)||questionId&&questionId!==raw.question_id)return end('foreign_reply');questionId=raw.question_id;
        if(finalId&&questionId!==finalId)return end('reply_input_mismatch');
      }
      if(raw.type==='response.output_audio.started'){
        if(!replyId||!questionId)return end('unbound_audio');audioStarted=true;
      }
      if(raw.type==='response.output_text.delta'){
        if(typeof raw.delta!=='string')return end('invalid_text');replyText+=raw.delta;
      }
      if(raw.type==='response.output_text.done'){
        if(typeof raw.text!=='string'||!raw.text.startsWith(replyText))return end('invalid_text');replyText=raw.text;textDone=true;
      }
      if(replyText.length>4000)return end('text_limit');
      if(raw.type==='response.output_audio.delta'){
        if(!audioStarted||!replyId||!questionId||audioDone)return end('unbound_audio');
        if(typeof raw.delta!=='string'||raw.delta.length>131072)return end('audio_limit');
        const bytes=Buffer.from(raw.delta,'base64');if(bytes.toString('base64')!==raw.delta||bytes.length%2)return end('invalid_audio');
        report.audio_bytes+=bytes.length;if(report.audio_bytes>1920000)return end('audio_limit');
      }
      if(raw.type==='response.output_audio.done')audioDone=true;
      if(textDone&&audioDone&&!settleTimer)settleTimer=setTimeout(()=>end('reply_done'),300);
    };
    try{
      socket=socketFactory(profile.endpoint,{headers:{[profile.auth.header]:profile.auth.prefix+key},maxPayload:262144,perMessageDeflate:false,followRedirects:false,handshakeTimeout:5000});
      socket.addEventListener('open',()=>send(request));socket.addEventListener('message',onMessage);
      socket.addEventListener('error',()=>finish('transport_error'));socket.addEventListener('close',()=>finish(reason??'remote_closed'));
      socket.on?.('unexpected-response',(_req,response)=>{report.http_status=response.statusCode;response.resume();finish('handshake_rejected');});
      deadline=setTimeout(()=>end('duration_limit'),durationMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    }catch{finish('socket_failed');}
  });
}
