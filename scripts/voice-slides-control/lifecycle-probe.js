import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loadProfile} from '../../packages/provider-doubao/probe.js';
import {validateSeeduplexProfile} from '../../packages/provider-doubao/seeduplex.js';
import {SLIDES_TOOL,SLIDES_CANCEL_TOOL,resolveSlidesTarget,validateSlidesIntent,validateSlidesCancellation,slidesReviewTools} from '../../packages/contracts/ui-actions.js';
import {SLIDES_CASES,probeInstructions} from './cases.js';
import {SLIDES_CONTROL_CASES,CONTROL_INSTRUCTIONS} from './control-cases.js';
import {hash,INPUT_DIRECTORY} from './prepare.js';
import {SourceEvidenceLedger,withSourceEvidence,SOURCE_INSTRUCTIONS} from './source-evidence.js';
import {SlidesCommandCapabilities,capabilityInstructions} from './command-capabilities.js';
const id=value=>typeof value==='string'&&value.length>0&&value.length<=120;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const normalize=text=>text.normalize('NFKC').replace(/[\p{P}\p{Z}\p{S}\s]/gu,'').toLowerCase();
export const LIFECYCLE_MODES=Object.freeze(['sequential','inspect-context','scope-update','source-repeat','source-delayed-old','epoch-repeat','epoch-resume','epoch-delayed-old','epoch-add-explicit','interrupt-cancel','interrupt-cancel-result','close-waiting','interrupt-finish','interrupt-add','interrupt-question',
  'control-correct-queued','control-correct-dispatched','control-revoke-queued','control-revoke-dispatched']);

// Diagnostic native lifecycle only. No browser/Agent execution, no guessed tool ownership.
export async function runSlidesLifecycleProbe({profile,inputs,mode='sequential',env=process.env,holdMs=1200,sourceEvidence=mode.startsWith('source-'),epochCapabilities=mode.startsWith('epoch-'),signal,
  socketFactory=(url,options)=>new WebSocket(url,options),observeAuthoredReply}={}){
  validateSeeduplexProfile(profile);
  if(!LIFECYCLE_MODES.includes(mode)||!Array.isArray(inputs)||inputs.length!==(['epoch-resume','epoch-delayed-old'].includes(mode)?3:2)||
    typeof sourceEvidence!=='boolean'||typeof epochCapabilities!=='boolean'||sourceEvidence&&epochCapabilities||mode.startsWith('source-')&&!sourceEvidence||mode.startsWith('epoch-')&&!epochCapabilities||epochCapabilities&&mode==='scope-update'||!Number.isSafeInteger(holdMs)||holdMs<0||holdMs>3000||inputs.some(item=>!Buffer.isBuffer(item.pcm)||item.pcm.length<640||item.pcm.length>480000||item.pcm.length%2||
      item.manifest?.source!=='local_os_authored_speech'||item.manifest.sample_rate!==16000||item.manifest.channels!==1||item.manifest.pcm_sha256!==hash(item.pcm)||item.manifest.script_sha256!==hash(item.testCase?.text??'')))throw new Error('INVALID_LIFECYCLE_INPUT');
  const key=env[profile.auth.env];if(typeof key!=='string'||!key.length||key.length>8192||/[^\x21-\x7e]/.test(key))throw new Error('LIFECYCLE_CREDENTIAL_REQUIRED');
  const report={version:1,mode,provider_ready:false,session_closed_ack:false,synthetic_viewer:true,synthetic_history:true,production_agent_changed:false,
    browser_audio_tested:false,human_listening_tested:false,microphone_uploaded:false,contains_audio:false,contains_transcripts:false,
    inputs_started:0,asr_finals:0,tool_batches:[],results_sent:0,synthetic_actions_applied:0,cancel_sent:false,cancel_ack:false,
    old_result_returned_after_cancel:false,old_reply_after_cancel:false,input_frames:0,input_frames_while_tool_waiting:0,
    output_while_tool_waiting:0,reply_owners:[],timeline:[],production_ownership_verified:false,enable_allowed:false,
    old_reply_after_new_input:false,stale_text_events_discarded:0,stale_audio_chunks_discarded:0,new_audio_chunks:0,audio_bytes:0,audio_lane_conflict:false,
    first_action_dispatched:null,correction_flag_observed:null,cancelled_queued_actions:0,wire_correlations:[],context_queries_sent:0,context_query_shapes:[],
    scoped_tools_update_sent:false,scoped_tools_update_ack:false,asr_matches_authored:[],semantics_accepted:null,
    source_evidence_enabled:sourceEvidence,source_evidence:[],local_delivery_delay_injected:['source-delayed-old','epoch-delayed-old'].includes(mode),
    epoch_capabilities_enabled:epochCapabilities,action_scope:epochCapabilities?'session_call':'diagnostic',capability_admissions:[]};
  const started=performance.now(),mark=(name,fields={})=>{if(report.timeline.length<100)report.timeline.push({name,at_ms:Math.round(performance.now()-started),...fields});};
  let socket,pump,frameCount=0,failure=null,closing=false,closed=false,position=0,source=null,cancelRequested=false,settleClose,audioLane=null,rawSessionId=null;
  const waiters=new Set(),candidates=[],finals=new Set(),tools=[],replies=new Map(),sentEvents=new Map(),recognizedInputs=new Map();
  const state=structuredClone(inputs[0].testCase.state),ledger=new SourceEvidenceLedger(),capabilities=new SlidesCommandCapabilities();
  let registration=epochCapabilities?capabilities.registration(state):null;
  const admit=tool=>{
    if(tool.capability)return tool.capability;
    tool.capability=capabilities.admit({name:tool.wireName,callId:tool.callId,args:tool.args},state);
    report.capability_admissions.push({status:tool.capability.status,reason:tool.capability.reason??null,
      kind:tool.capability.kind??capabilities.kind(tool.wireName),epoch_index:tool.capability.epoch_index??null,rotated:tool.capability.rotated??false});
    return tool.capability;
  };
  const notify=()=>{for(const waiter of [...waiters]){if(failure){clearTimeout(waiter.timer);waiters.delete(waiter);waiter.reject(new Error(failure));}else if(waiter.predicate()){clearTimeout(waiter.timer);waiters.delete(waiter);waiter.resolve();}}};
  const fail=code=>{failure??=code;notify();};
  const until=(predicate,ms=15000)=>new Promise((resolve,reject)=>{if(failure)return reject(new Error(failure));if(predicate())return resolve();
    const waiter={predicate,resolve,reject};waiter.timer=setTimeout(()=>{waiters.delete(waiter);reject(new Error('LIFECYCLE_WAIT_TIMEOUT'));},ms);waiters.add(waiter);});
  const send=value=>{
    const eventId=randomUUID();
    if(sentEvents.size>=5000)throw new Error('LIFECYCLE_OUTBOUND_LIMIT');
    sentEvents.set(eventId,{type:value.type,authored_input_index:value.type==='input_audio_buffer.append'?report.inputs_started-1:null});
    socket.send(JSON.stringify({event_id:eventId,...value}));
  };
  const startInput=index=>{source=inputs[index].pcm;position=0;report.inputs_started++;mark('authored_input_started',{index});};
  const result=(tool,outcome)=>{
    send({type:'conversation.item.create',items:[{call_id:tool.callId,role:'tool',content:[{type:'input_text',text:JSON.stringify({...outcome,execution_source:'synthetic_viewer',navigation_policy:'review_only'})}]}]});
    tool.returned=true;report.results_sent++;mark('tool_result_sent',{status:outcome.status});
  };
  const apply=tool=>{
    const resolved=resolveSlidesTarget(tool.args,state);let outcome=resolved;
    if(resolved.status==='ready'){state.page=resolved.target_page;state.visits.push(state.page);state.visits=state.visits.slice(-20);report.synthetic_actions_applied++;
      outcome={status:'applied',reason:'PAGE_CHANGED',page:state.page,total:3,confirmed:true};mark('synthetic_viewer_ack',{page:state.page});}
    return outcome;
  };
  const correlate=tool=>{
    if(epochCapabilities){const decision=admit(tool);return decision.status==='accepted'?{status:'matched',basis:'session_capability'}:{status:'rejected',reason:decision.reason};}
    if(!sourceEvidence)return {status:'matched'};
    if(tool.evidence)return tool.evidence;
    tool.evidence=ledger.claim(tool.callId,tool.sourceText,JSON.stringify({name:tool.name,...tool.args}));
    report.source_evidence.push({status:tool.evidence.status,reason:tool.evidence.reason??null,
      ...(tool.evidence.status==='matched'?{input_index:candidates.indexOf(tool.evidence.input_id)}:{})});return tool.evidence;
  };
  const rejection=evidence=>({status:'rejected',reason:evidence.reason,page:state.page,total:3,confirmed:true});
  const execute=tool=>{const evidence=correlate(tool);result(tool,evidence.status==='matched'?apply(tool):rejection(evidence));};
  const onMessage=event=>{
    try{
      if(typeof event.data!=='string'||Buffer.byteLength(event.data)>262144||++frameCount>5000)throw new Error('LIFECYCLE_FRAME_LIMIT');
      const raw=JSON.parse(event.data);
      if(raw.type==='session.closed'){report.session_closed_ack=true;settleClose?.();notify();return;}
      if(closing)return;
      if(raw.type==='error'){
        const code=raw.code??raw.status_code;
        if(typeof code==='number'&&Number.isSafeInteger(code)||typeof code==='string'&&/^[A-Z0-9_]{1,40}$/i.test(code))report.provider_error_code=code;
        throw new Error('LIFECYCLE_PROVIDER_ERROR');
      }
      if(raw.type==='conversation.item.retrieved'&&mode==='inspect-context'){
        if(!Array.isArray(raw.items)||raw.items.length>10)throw new Error('LIFECYCLE_CONTEXT_INVALID');
        report.context_query_shapes.push({event_id_echoes_outbound:sentEvents.has(raw.event_id),items:raw.items.map(item=>({
          fields:Object.keys(item).filter(key=>/^[a-z_]{1,40}$/.test(key)).slice(0,24),
          role:['user','assistant','tool'].includes(item.role)?item.role:'other',known_input_id:candidates.includes(item.id),
          call_id_present:id(item.call_id),call_id_matches_known_tool:tools.some(tool=>tool.callId===item.call_id)
        }))});
      }
      if(raw.type==='session.created'){if(report.provider_ready||!id(raw.session?.id))throw new Error('LIFECYCLE_READY_INVALID');rawSessionId=raw.session.id;report.provider_ready=true;if(epochCapabilities&&!capabilities.acknowledge(registration.token))throw new Error('LIFECYCLE_CAPABILITY_ACK');mark('provider_ready');}
      if(raw.type==='session.updated'){
        if(!['scope-update','epoch-resume','epoch-delayed-old'].includes(mode)||!report.scoped_tools_update_sent||report.scoped_tools_update_ack||raw.session?.id!==rawSessionId)throw new Error('LIFECYCLE_UNBOUND_UPDATE');
        if(epochCapabilities&&!capabilities.acknowledge(registration.token))throw new Error('LIFECYCLE_CAPABILITY_ACK');
        report.scoped_tools_update_ack=true;mark('scoped_tools_update_ack');
      }
      if(raw.type==='conversation.item.input_audio_transcription.started'||raw.type==='conversation.item.input_audio_transcription.completed'){
        if(!id(raw.item_id))throw new Error('LIFECYCLE_INPUT_INVALID');
        if(raw.type.endsWith('.started'))ledger.begin(raw.item_id);
        if(epochCapabilities&&raw.type.endsWith('.started'))capabilities.observeStarted(raw.item_id);
        if(!candidates.includes(raw.item_id)){candidates.push(raw.item_id);if(candidates.length>inputs.length)throw new Error('LIFECYCLE_UNEXPECTED_INPUT');mark('input_candidate',{index:candidates.length-1});}
        if(raw.type.endsWith('.completed')){
          const text=raw.text??raw.transcript,index=candidates.indexOf(raw.item_id);
          if(typeof text!=='string'||!text.length||text.length>2000)throw new Error('LIFECYCLE_INPUT_INVALID');
          recognizedInputs.set(raw.item_id,text);report.asr_matches_authored[index]=normalize(text)===normalize(inputs[index].testCase.text);
          if(sourceEvidence)ledger.complete(raw.item_id,text);
          if(epochCapabilities)capabilities.observeFinal(raw.item_id);
          finals.add(raw.item_id);report.asr_finals=finals.size;mark('asr_final',{index});
        }
        if(['interrupt-cancel','interrupt-cancel-result'].includes(mode)&&candidates.length===2&&!cancelRequested){
          cancelRequested=true;send({type:'response.cancel'});report.cancel_sent=true;mark('cancel_sent');
        }
      }
      if(raw.type==='response.canceled'){if(!cancelRequested)throw new Error('LIFECYCLE_UNBOUND_CANCEL');report.cancel_ack=true;mark('cancel_ack');}
      if(raw.type==='response.function_call_arguments.done'){
        if(!Array.isArray(raw.items)||raw.items.length!==1||tools.length>=inputs.length)throw new Error('LIFECYCLE_BATCH_INVALID');
        const wireItem=raw.items[0],wireName=wireItem.name,kind=epochCapabilities?capabilities.kind(wireName):null;
        const item=epochCapabilities?{...wireItem,name:kind==='navigate'?SLIDES_TOOL.name:kind==='cancel'?SLIDES_CANCEL_TOOL.name:'unknown'}:wireItem;
        if(![SLIDES_TOOL.name,...(epochCapabilities||mode.startsWith('control-')||mode==='source-delayed-old'?[SLIDES_CANCEL_TOOL.name]:[])].includes(item.name)||!id(item.call_id)||typeof item.arguments!=='string'||item.arguments.length>1024)throw new Error('LIFECYCLE_TOOL_INVALID');
        // Structural evidence and equality checks only; do not persist wire identifiers or payloads.
        const keys=value=>Object.keys(value).filter(key=>/^[a-z_]{1,40}$/.test(key)).slice(0,24);
        const echo=sentEvents.get(raw.event_id);
        report.wire_correlations.push({top_fields:keys(raw),item_fields:keys(item),
          event_id_echoes_outbound:Boolean(echo),...(echo?{echo_type:echo.type,echo_authored_input_index:echo.authored_input_index}:{}),
          call_id_equals_input:candidates.includes(item.call_id),
          call_id_contains_input:candidates.some(input=>item.call_id.includes(input)),
          item_id_equals_input:candidates.includes(item.id),event_id_equals_input:candidates.includes(raw.event_id),
          response_object_fields:raw.response&&typeof raw.response==='object'?keys(raw.response):[],
          metadata_fields:raw.metadata&&typeof raw.metadata==='object'?keys(raw.metadata):[]});
        if(tools.some(tool=>tool.callId===item.call_id))throw new Error('LIFECYCLE_DUPLICATE_TOOL');
        let args=JSON.parse(item.arguments),sourceText;
        if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('LIFECYCLE_TOOL_INVALID');
        if(sourceEvidence){
          sourceText=args.source_text;const {source_text,...intent}=args;
          if(typeof sourceText!=='string'||!sourceText.length||sourceText.length>400)throw new Error('LIFECYCLE_SOURCE_ARGUMENTS');args=intent;
        }
        if(item.name===SLIDES_CANCEL_TOOL.name?!validateSlidesCancellation(args):!validateSlidesIntent(args)){
          // Bounded structural diagnostics only: never include arbitrary argument values or provider IDs.
          report.invalid_tool_arguments={name:item.name,keys:Object.keys(args).filter(key=>['action','page','replace_pending'].includes(key)),
            extra_key_count:Object.keys(args).filter(key=>!['action','page','replace_pending'].includes(key)).length,
            action:['previous','recent','goto'].includes(args.action)?args.action:'invalid',page_type:typeof args.page,
            ...(Number.isSafeInteger(args.page)&&args.page>=1&&args.page<=3?{page:args.page}:{}),replace_pending_type:typeof args.replace_pending,
            ...([true,false,'true','false',null].includes(args.replace_pending)?{replace_pending:args.replace_pending}:{})};
          throw new Error('LIFECYCLE_TOOL_ARGUMENTS');
        }
        const identityValues=[raw.question_id,raw.response_id,raw.item_id,item.question_id,item.response_id,item.item_id].filter(value=>value!==undefined);
        const tool={callId:item.call_id,name:item.name,wireName,args,sourceText,returned:false};
        if(epochCapabilities&&!(mode==='epoch-delayed-old'&&tools.length===0))admit(tool);
        tools.push(tool);
        if(mode==='inspect-context'){
          send({type:'conversation.item.retrieve',items:candidates.map(inputId=>({id:inputId}))});report.context_queries_sent++;
        }
        report.tool_batches.push({name:item.name,action:item.name===SLIDES_CANCEL_TOOL.name?'cancel_pending':['previous','recent','goto','next'].includes(args.action)?args.action:'invalid',...(Number.isSafeInteger(args.page)&&args.page>=1&&args.page<=3?{page:args.page}:{}),...(args.replace_pending===true?{replace_pending:true}:{}),
          input_finals_at_call:finals.size,after_cancel:report.cancel_ack,input_identity_present:identityValues.length>0,input_identity_matches:identityValues.some(value=>candidates.includes(value))});
        mark('tool_received',{index:tools.length-1});
      }
      if(raw.type==='response.output_audio.delta'){
        const lane=raw.response_id!==undefined?replies.get(raw.response_id):audioLane;
        if(!lane||lane.audioDone||typeof raw.delta!=='string'||raw.delta.length>131072)throw new Error('LIFECYCLE_UNBOUND_AUDIO');
        const pcm=Buffer.from(raw.delta,'base64');if(!pcm.length||pcm.length%2||pcm.toString('base64')!==raw.delta)throw new Error('LIFECYCLE_INVALID_AUDIO');
        if(raw.question_id!==undefined&&raw.question_id!==candidates[lane.owner])throw new Error('LIFECYCLE_FOREIGN_OUTPUT');
        report.audio_bytes+=pcm.length;if(report.audio_bytes>3840000)throw new Error('LIFECYCLE_AUDIO_LIMIT');
        if(lane.owner<candidates.length-1)report.stale_audio_chunks_discarded++;else if(lane.owner>0)report.new_audio_chunks++;
      }
      if(['response.output_audio.started','response.output_text.delta','response.output_text.done','response.output_audio.done'].includes(raw.type)){
        if(!id(raw.response_id)||!id(raw.question_id))throw new Error('LIFECYCLE_OUTPUT_IDENTITY');
        const owner=candidates.indexOf(raw.question_id);
        if(owner<0)throw new Error('LIFECYCLE_FOREIGN_OUTPUT');
        let reply=replies.get(raw.response_id);
        if(!reply){reply={owner,text:'',textDone:false,audioDone:false};replies.set(raw.response_id,reply);report.reply_owners.push(owner);mark('reply_started',{owner});}
        if(reply.owner!==owner)throw new Error('LIFECYCLE_FOREIGN_OUTPUT');
        if(raw.type==='response.output_audio.started'){
          if(audioLane&&audioLane!==reply&&!audioLane.audioDone){report.audio_lane_conflict=true;throw new Error('LIFECYCLE_AUDIO_LANE_CONFLICT');}
          audioLane=reply;
        }
        if(candidates.length>1&&owner===0){report.old_reply_after_new_input=true;if(raw.type.startsWith('response.output_text.'))report.stale_text_events_discarded++;}
        if(tools.some(tool=>!tool.returned))report.output_while_tool_waiting++;
        if(report.cancel_ack&&owner===0)report.old_reply_after_cancel=true;
        if(raw.type==='response.output_text.delta'){if(typeof raw.delta!=='string')throw new Error('LIFECYCLE_TEXT_INVALID');reply.text+=raw.delta;}
        if(raw.type==='response.output_text.done'){if(typeof raw.text!=='string'||!raw.text.startsWith(reply.text))throw new Error('LIFECYCLE_TEXT_INVALID');reply.text=raw.text;reply.textDone=true;}
        if(reply.text.length>4000)throw new Error('LIFECYCLE_TEXT_LIMIT');
        if(raw.type==='response.output_audio.done'){reply.audioDone=true;if(audioLane===reply)audioLane=null;}
        if(sourceEvidence&&reply.textDone&&reply.audioDone)ledger.settleReply(candidates[owner]);
      }
      notify();
    }catch(error){fail(/^LIFECYCLE_[A-Z_]+$/.test(error.message)?error.message:'LIFECYCLE_INVALID_FRAME');}
  };
  const abort=()=>fail('LIFECYCLE_ABORTED');signal?.addEventListener('abort',abort,{once:true});
  try{
    if(signal?.aborted)throw new Error('LIFECYCLE_ABORTED');
    const control=epochCapabilities||mode.startsWith('control-')||mode==='source-delayed-old';
    const request=structuredClone(profile.session_create);request.session.tools=mode==='scope-update'?slidesReviewTools(state):[structuredClone(SLIDES_TOOL),...(control?[structuredClone(SLIDES_CANCEL_TOOL)]:[])];request.session.instructions=probeInstructions(state)+(control?CONTROL_INSTRUCTIONS:'');
    if(sourceEvidence){request.session.tools=withSourceEvidence(request.session.tools);request.session.instructions+=SOURCE_INSTRUCTIONS;}
    if(epochCapabilities){request.session.tools=registration.tools;request.session.instructions=capabilityInstructions(request.session.instructions,registration);}
    socket=socketFactory(profile.endpoint,{headers:{[profile.auth.header]:profile.auth.prefix+key},maxPayload:262144,perMessageDeflate:false,followRedirects:false,handshakeTimeout:5000});
    socket.addEventListener('message',onMessage);socket.addEventListener('error',()=>fail('LIFECYCLE_TRANSPORT_ERROR'));
    socket.addEventListener('close',()=>{closed=true;if(!closing)fail('LIFECYCLE_REMOTE_CLOSED');notify();});
    socket.addEventListener('open',()=>send(request));
    socket.on?.('unexpected-response',(_req,response)=>{report.http_status=response.statusCode;response.resume();fail('LIFECYCLE_HANDSHAKE_REJECTED');});
    await until(()=>report.provider_ready);
    startInput(0);pump=setInterval(()=>{
      if(closing||closed||failure)return;
      const part=position<source.length?source.subarray(position,position+640):Buffer.alloc(640);position+=640;
      try{send({type:'input_audio_buffer.append',audio:(part.length===640?part:Buffer.concat([part,Buffer.alloc(640-part.length)])).toString('base64')});report.input_frames++;
        if(tools.some(tool=>!tool.returned))report.input_frames_while_tool_waiting++;}catch{fail('LIFECYCLE_SEND_FAILED');}
    },20);
    await until(()=>tools.length===1&&finals.size===1);
    if(sourceEvidence&&mode!=='source-delayed-old'){
      const evidence=correlate(tools[0]);
      if(evidence.status!=='matched'){result(tools[0],rejection(evidence));await until(()=>[...replies.values()].some(reply=>reply.owner===0&&reply.textDone&&reply.audioDone));throw new Error('LIFECYCLE_SOURCE_REJECTED');}
    }
    if(['epoch-resume','epoch-delayed-old'].includes(mode)){
      startInput(1);await until(()=>tools.length===2&&finals.size===2);
      if(tools[1].name!==SLIDES_CANCEL_TOOL.name||correlate(tools[1]).status!=='matched')throw new Error('LIFECYCLE_CAPABILITY_CANCEL_FAILED');
      if(mode==='epoch-delayed-old'){
        const old=correlate(tools[0]);report.delayed_old_reason=old.reason;
        if(old.status!=='rejected')throw new Error('LIFECYCLE_CAPABILITY_FENCE_FAILED');
        result(tools[0],rejection(old));
      }else result(tools[0],{status:'cancelled',reason:'REQUEST_CANCELLED',page:state.page,total:3,confirmed:true});
      result(tools[1],{status:mode==='epoch-resume'?'cancelled':'unchanged',reason:'QUEUED_REVIEWS_CANCELLED',cancelled_count:mode==='epoch-resume'?1:0,in_flight:false,page:state.page,total:3,confirmed:true});
      await until(()=>[...replies.values()].some(reply=>reply.owner===1&&reply.textDone&&reply.audioDone));
      registration=capabilities.registration(state);const session=structuredClone(profile.session_create.session);
      session.id=rawSessionId;session.tools=registration.tools;session.instructions=capabilityInstructions(probeInstructions(state)+CONTROL_INSTRUCTIONS,registration);
      report.scoped_tools_update_sent=true;send({type:'session.update',session});await until(()=>report.scoped_tools_update_ack,5000);
      startInput(2);await until(()=>tools.length===3&&finals.size===3);
      execute(tools[2]);await until(()=>[...replies.values()].some(reply=>reply.owner===2&&reply.textDone&&reply.audioDone));
      report.ended=mode==='epoch-resume'?'epoch_cancelled_and_resumed':'epoch_old_call_fenced_and_resumed';
    }else if(mode==='source-delayed-old'){
      // Local delivery fault injection: the first received proposal is held before acceptance.
      startInput(1);await until(()=>candidates.length===2);
      const evidence=correlate(tools[0]);result(tools[0],rejection(evidence));
      await until(()=>finals.size===2);await until(()=>tools.length===2||[...replies.values()].some(reply=>reply.owner===1&&reply.textDone&&reply.audioDone));
      if(tools.length===2){
        const current=correlate(tools[1]);
        result(tools[1],current.status==='matched'&&tools[1].name===SLIDES_CANCEL_TOOL.name?{status:'unchanged',reason:'NO_PENDING_REVIEWS',cancelled_count:0,in_flight:false,page:state.page,total:3,confirmed:true}:rejection({reason:current.reason??'UNEXPECTED_CONTROL'}));
        await until(()=>[...replies.values()].some(reply=>reply.owner===1&&reply.textDone&&reply.audioDone));
      }
      report.ended=evidence.status==='rejected'?'source_delayed_call_fenced':'LIFECYCLE_SOURCE_FENCE_FAILED';
    }else if(mode==='close-waiting'){await delay(holdMs);report.ended='closed_while_tool_waiting';}
    else if(mode==='scope-update'){
      await delay(holdMs);if(failure)throw new Error(failure);
      const outcome=apply(tools[0]);result(tools[0],outcome);
      await until(()=>[...replies.values()].some(reply=>reply.owner===0&&reply.textDone&&reply.audioDone));
      const session=structuredClone(profile.session_create.session);
      session.id=rawSessionId;session.instructions=probeInstructions(state);session.tools=slidesReviewTools(state);
      report.scoped_tools_update_sent=true;report.navigation_tools_after_update=session.tools.length;report.scoped_update_boundary='after_original_reply';
      send({type:'session.update',session});mark('scoped_tools_update_sent');
      await until(()=>report.scoped_tools_update_ack,5000);
      startInput(1);await until(()=>finals.size===2);
      await until(()=>tools.length===2||[...replies.values()].some(reply=>reply.owner===1&&reply.textDone&&reply.audioDone));
      report.ended=tools.length===2?'unexpected_forward_tool_after_update':'scoped_forward_reply_observed';
    }else if(['sequential','inspect-context','source-repeat','epoch-repeat'].includes(mode)){
      await delay(holdMs);if(failure)throw new Error(failure);execute(tools[0]);
      await until(()=>[...replies.values()].some(reply=>reply.owner===0&&reply.textDone&&reply.audioDone));
      startInput(1);await until(()=>tools.length===2&&finals.size===2);
      await delay(holdMs);if(failure)throw new Error(failure);execute(tools[1]);
      await until(()=>[...replies.values()].some(reply=>reply.owner===1&&reply.textDone&&reply.audioDone));
      report.ended='two_replies_observed';
    }else if(mode.startsWith('control-')){
      const dispatched=mode.endsWith('-dispatched'),revoke=mode.startsWith('control-revoke');
      if(tools[0].name!==SLIDES_TOOL.name)throw new Error('LIFECYCLE_FIRST_TOOL_INVALID');
      report.first_action_dispatched=dispatched;mark(dispatched?'first_action_dispatched':'first_action_queued');
      startInput(1);await until(()=>tools.length===2&&finals.size===2);
      if(revoke&&tools[1].name!==SLIDES_CANCEL_TOOL.name)throw new Error('LIFECYCLE_CANCEL_TOOL_MISSING');
      if(!revoke&&tools[1].name!==SLIDES_TOOL.name)throw new Error('LIFECYCLE_CORRECTION_TOOL_MISSING');
      const evidence=correlate(tools[1]);
      if(evidence.status!=='matched'){
        if(dispatched)execute(tools[0]);else result(tools[0],{status:'cancelled',reason:'UNVERIFIED_CONTROL_WHILE_QUEUED',page:state.page,total:3,confirmed:true});
        result(tools[1],rejection(evidence));await until(()=>[...replies.values()].some(reply=>reply.owner===1&&reply.textDone&&reply.audioDone));throw new Error('LIFECYCLE_SOURCE_REJECTED');
      }
      report.correction_flag_observed=revoke?null:tools[1].args.replace_pending===true;
      const removeOld=!dispatched&&(revoke||tools[1].args.replace_pending===true);
      if(removeOld){report.cancelled_queued_actions=1;mark('queued_action_cancelled');result(tools[0],{status:'cancelled',reason:revoke?'REQUEST_CANCELLED':'REQUEST_REPLACED',page:state.page,total:3,confirmed:true});}
      else{await delay(holdMs);if(failure)throw new Error(failure);execute(tools[0]);}
      if(revoke)result(tools[1],{status:removeOld?'cancelled':'unchanged',reason:removeOld?'QUEUED_REVIEWS_CANCELLED':'ACTION_ALREADY_DISPATCHED',cancelled_count:removeOld?1:0,
        in_flight:false,page:state.page,total:3,confirmed:true});
      else execute(tools[1]);
      await until(()=>[...replies.values()].some(reply=>reply.owner===1&&reply.textDone&&reply.audioDone));report.ended='control_requests_settled';
    }else if(['interrupt-finish','interrupt-add','interrupt-question','epoch-add-explicit'].includes(mode)){
      startInput(1);
      await until(()=>candidates.length===2);await delay(holdMs);
      if(failure)throw new Error(failure);execute(tools[0]);
      await until(()=>finals.size===2);
      if(mode==='interrupt-question'){
        await until(()=>tools.length===2||[...replies.values()].some(reply=>reply.owner===1&&reply.textDone&&reply.audioDone));
        report.ended=tools.length===2?'unexpected_tool_for_question':'new_question_reply_observed';
      }else{
        await until(()=>tools.length===2);await delay(holdMs);if(failure)throw new Error(failure);execute(tools[1]);
        await until(()=>[...replies.values()].some(reply=>reply.owner===1&&reply.textDone&&reply.audioDone));report.ended='overlapping_inputs_settled';
      }
    }else{
      startInput(1);
      await until(()=>report.cancel_ack);
      if(mode==='interrupt-cancel-result'){
        result(tools[0],{status:'cancelled',reason:'NEW_INPUT',page:state.page,total:3,confirmed:true});report.old_result_returned_after_cancel=true;
      }
      await until(()=>finals.size===2);
      try{await until(()=>tools.length===2,6000);report.ended='second_tool_observed_no_execution';}
      catch(error){if(error.message!=='LIFECYCLE_WAIT_TIMEOUT')throw error;report.ended='no_second_tool_observed';}
      // Do not infer the second call's owner from timing or its arguments.
      // Close without executing it; this experiment does not establish production correlation.
    }
  }catch(error){report.ended=/^LIFECYCLE_[A-Z_]+$/.test(error.message)?error.message:'LIFECYCLE_FAILED';}
  finally{
    clearInterval(pump);closing=true;
    try{if(report.provider_ready&&!closed){await new Promise(resolve=>{const timer=setTimeout(resolve,1500);settleClose=()=>{clearTimeout(timer);resolve();};send({type:'session.close'});});}}catch{}
    try{socket?.terminate?.();socket?.close?.();}catch{}
    for(const waiter of waiters){clearTimeout(waiter.timer);waiter.reject(new Error('LIFECYCLE_CLOSED'));}waiters.clear();
    signal?.removeEventListener('abort',abort);
    for(const reply of replies.values())try{observeAuthoredReply?.({owner:reply.owner,text:reply.text,recognized_authored_input:recognizedInputs.get(candidates[reply.owner])??null,
      ...(sourceEvidence?{claimed_sources:tools.filter(tool=>tool.evidence?.input_id===candidates[reply.owner]||tools.indexOf(tool)===reply.owner).map(tool=>tool.sourceText)}:{})});}catch{}
    ledger.close();
    capabilities.close();
  }
  report.final_page=state.page;report.duration_ms=Math.round(performance.now()-started);return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
  try{
    const args=process.argv.slice(2),mode=args.find(arg=>arg.startsWith('--mode='))?.slice(7)??'sequential';
    const sourceEvidence=args.includes('--source-evidence')||mode.startsWith('source-');
    const epochCapabilities=args.includes('--capability-epochs')||mode.startsWith('epoch-');
    if(!args.includes('--live')||args.filter(arg=>arg.startsWith('--mode=')).length>1||args.some(arg=>arg!=='--live'&&arg!=='--source-evidence'&&arg!=='--capability-epochs'&&!arg.startsWith('--mode='))||!LIFECYCLE_MODES.includes(mode))throw new Error('INVALID_LIFECYCLE_ARGUMENTS');
    const profile=await loadProfile(process.env.DOUBAO_REALTIME_PROFILE),manifest=JSON.parse(await readFile(INPUT_DIRECTORY+'/manifest.json','utf8'));
    const inputs=[];
    const second=mode==='epoch-add-explicit'?'add-previous':['source-repeat','epoch-repeat'].includes(mode)?'previous':['source-delayed-old','epoch-resume','epoch-delayed-old'].includes(mode)?'revoke-review':mode==='scope-update'?'forward-already-shown':mode.startsWith('control-revoke')?'revoke-review':mode.startsWith('control-correct')?'correct-first':mode==='interrupt-question'?'quote':mode==='interrupt-add'?'previous':'first-from-two';
    const caseIds=[mode==='scope-update'?'goto-one':sourceEvidence||epochCapabilities?'previous':'recent',second,...(['epoch-resume','epoch-delayed-old'].includes(mode)?['previous']:[])];
    for(const caseId of caseIds){
      const testCase=[...SLIDES_CASES,...SLIDES_CONTROL_CASES].find(item=>item.id===caseId),entry=manifest.entries.find(item=>item.id===caseId);
      if(!entry||entry.path!==caseId+'.pcm')throw new Error('INVALID_LIFECYCLE_MANIFEST');
      inputs.push({testCase,pcm:await readFile(INPUT_DIRECTORY+'/'+entry.path),manifest:{...manifest,...entry}});
    }
    const sourceFiles=['scripts/voice-slides-control/lifecycle-probe.js','scripts/voice-slides-control/source-evidence.js','scripts/voice-slides-control/command-capabilities.js','apps/realtime-gateway/src/slides-command-gate.js','scripts/voice-slides-control/cases.js','scripts/voice-slides-control/control-cases.js','packages/contracts/ui-actions.js'];
    const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,hash(await readFile(path))]))),replies=[];
    const report=await runSlidesLifecycleProbe({profile,inputs,mode,sourceEvidence,epochCapabilities,signal:controller.signal,observeAuthoredReply:reply=>replies.push(reply)});
    const stem=(epochCapabilities?'epoch-':sourceEvidence?'source-':'')+'lifecycle-'+mode;
    await writeFile(INPUT_DIRECTORY+'/'+stem+'-report.json',JSON.stringify({source_hashes:sourceHashes,...report},null,2)+'\n',{mode:0o600});
    await writeFile(INPUT_DIRECTORY+'/'+stem+'-authored-replies.json',JSON.stringify(replies,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(report,null,2));
  }catch(error){console.error(/^[A-Z_]+$/.test(error.message)?error.message:'SLIDES_LIFECYCLE_PROBE_FAILED');process.exitCode=1;}
}
