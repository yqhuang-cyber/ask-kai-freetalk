import {CaptionSettings} from './caption-settings.js';
import { ClosingCoordinator } from './closing-coordinator.js';
import { SpeechPaceCoordinator } from './speech-pace-coordinator.js';
import { SlidesSession } from './slides-session.js';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { SessionRuntime } from '../../../packages/agent-core/session.js';
import { TeachingSession } from '../../../packages/agent-core/teaching.js';
import { SafetyPolicy,SAFETY_MESSAGE } from '../../../packages/policy/safety.js';
import { metadata } from '../public/diagnostics.js';
import { SEEDUPLEX_PROTOCOL } from '../../../packages/provider-doubao/seeduplex.js';
import { hasSpeechText } from '../../../packages/agent-core/turn-taking.js';
import { TurnOutputGate } from './output-gate.js';
import { ReplyAudit,REPLY_POLICY_VERSION } from '../../../packages/agent-core/reply-policy.js';
import { sameLanguageSupport } from '../../../packages/agent-core/language-support.js';
import { assistantFarewell,providerExitSuppressed,controlText } from '../../../packages/agent-core/natural-teaching.js';

export function attachRealtime(server,{providerFactory,providerKind='doubao',businessSource='unconfigured',planner,planningPort,maxConnections=8,readyTimeoutMs=8000,maxSessionMs=600000,cancelTimeoutMs=1500,contextTimeoutMs=8000,replyGraceMs=350,turnWaitMs=5000,closingWaitMs=12000,closingPlaybackMs=35000,safeguardingPort,metrics,observationReports,slidesControls=false,slidesDemoHistory=false,slidesHandshakeMs=5000,websocketPath='/api/realtime',protocol='ask-kai.v1',conversationFactory,sessionLifecycle}={}) {
  const tickets = new Map();
  const connections = new Set();
  const sessions=new Map();
  const wss = new WebSocketServer({noServer:true,maxPayload:65536,perMessageDeflate:false,handleProtocols:protocols=>protocols.has(protocol) ? protocol : false});
  const sweep = setInterval(() => { for(const [key,item] of tickets) if(item.expires <= Date.now()) tickets.delete(key); },1000);
  sweep.unref();
  const reject = (socket,status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  server.on('upgrade',async(req,socket,head) => {
    if (!providerFactory) return reject(socket,'501 Not Implemented');
    const expectedOrigin = `http://${req.headers.host}`;
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '') || req.headers.origin !== expectedOrigin) return reject(socket,'403 Forbidden');
    if (req.url !== websocketPath || !providerFactory) return reject(socket,'501 Not Implemented');
    const protocols = (req.headers['sec-websocket-protocol'] ?? '').split(',').map(p=>p.trim());
    const token = protocols.find(p=>p.startsWith('ticket.'))?.slice(7);
    const ticket = tickets.get(token);
    tickets.delete(token); // one use, including a failed attempt
    if (!protocols.includes(protocol) || !ticket || ticket.expires <= Date.now() || ticket.identity.expires<=Date.now() || ticket.origin !== expectedOrigin) return reject(socket,'401 Unauthorized');
    if(sessionLifecycle?.authorize){try{await sessionLifecycle.authorize(ticket);}catch{return reject(socket,'401 Unauthorized');}}
    if (connections.size >= maxConnections) return reject(socket,'429 Too Many Requests');
    wss.handleUpgrade(req,socket,head,ws => {
      connections.add(ws);
      const observation=ticket.planning?.trace;
      const runtime = new SessionRuntime(ticket.session_id,{target:null});
      const teaching=conversationFactory?conversationFactory(ticket):new TeachingSession({sessionId:ticket.session_id,mode:ticket.mode,memory:ticket.identity.memory,mission:ticket.identity.mission,speechPace:ticket.speech_pace,planning:ticket.planning,planner,resourceVerifier:planningPort?.checkResource?(resource,options)=>planningPort.checkResource(ticket.identity,resource,options):null,onPlanningRecord:(name,fields)=>diagnose(name,fields)});
      const policy=new SafetyPolicy();
      const started=performance.now();metrics?.count(providerKind,'sessions');
      let restricted=false,controlCount=0,controlAt=Date.now(),replyAt=null,firstAudio=false;
      let provider;
      let outputGate,closing,speech,captions,slides,initialUi,uiReplyTimer,slidesOffered=false;
      let contextWireVersion=1;
      const speechReplies=new Set();
      const advanceControls=()=>{speech?.advance();captions?.advance();};
      let ended = false;
      let ending=false;
      const finalText=new Map(),exitReplies=new Set(),replyText=new Map();
      let latestInputTurn=null,latestSpokenTurn=null;
      let recordController;
      let ready = false;
      let lastResponse = null;
      const pendingCancel = new Map();
      const speechCandidates=new Map();
      let appliedContext=teaching.contextSnapshot();
      let appliedVersion=1,appliedDecision=null,appliedLanguage=appliedContext.language,pendingContext=null;
      let diagnostics=false;
      const replyStats=new Map();
      const diagnose=(name,fields={})=>{
        if(name.startsWith('cancel.')||name==='event.dropped')observation?.record(`voice.${name}`,metadata(fields));
        if(!diagnostics || ws.readyState!==ws.OPEN || ws.bufferedAmount>131072)return;
        try{ws.send(JSON.stringify({type:'diagnostics.event',row:{name,at_ms:performance.now()-started,fields:metadata(fields)}}));}catch{/* Diagnostics do not control the session. */}
      };
      const sendObservation=row=>{
        if(ws.readyState!==ws.OPEN)return;
        try{const packet=JSON.stringify({type:'planning.observation',row});if(ws.bufferedAmount+Buffer.byteLength(packet)>131072)return;ws.send(packet);}catch{}
      };
      for(const row of observation?.snapshot().rows??[])sendObservation(row);
      const unsubscribeObservation=observation?.subscribe(sendObservation);
      observation?.record('voice.context.prepared',{session_id:ticket.session_id,provider_kind:providerKind,synthetic:providerKind!=='doubao',context_version:appliedVersion,context_hash:appliedContext.hash,instructions:appliedContext.instructions,advisory_turn_id:teaching.planning?.accepted?.turn_id??null,advisory_proposal_id:teaching.planning?.accepted?.proposal_id??null,speaking_constraints:teaching.planning?.speaking?.constraints()??null});
      const observedReplies=new Map();
      const traceClose=(title,note,body)=>{
        if(ws.readyState!==ws.OPEN)return;
        const packet={type:'close.trace',title,note};
        if(body&&typeof body==='object')packet.body=body;
        try{ws.send(JSON.stringify(packet));}catch{/* The trace never controls the session. */}
      };
      const completeStats=(id,state)=>{
        const s=replyStats.get(id);if(!s)return;
        if(s.audit)diagnose('reply.audit',{response_id:id,turn_id:s.turn,state,...s.audit.finish(state)});
        diagnose('response.complete',{response_id:id,turn_id:s.turn,state,text_chars:s.chars,text_deltas:s.deltas,audio_chunks:s.chunks,pcm_duration_ms:s.pcmMs,elapsed_ms:performance.now()-s.at});
        replyStats.delete(id);
      };
      let byteWindow = 0; let windowAt = Date.now();
      const send = data => {
        if (ended || ws.readyState !== ws.OPEN) return false;
        if (ws.bufferedAmount > 262144) return finish('CLIENT_BACKPRESSURE');
        ws.send(JSON.stringify(data));
        if(data.speech_control){teaching.forwardControl?.(data);(captions?.owns(data)?captions:speech)?.forward(data);return true;}
        const before=teaching.version;
        teaching.forward(data); // Only forwarded packets, after safety/output hold.
        teaching.planning?.observe(data);
        const event=data.type==='event'?data.event:null;
        if(event?.type==='response.started'){replyText.set(event.response_id,'');if(observation)observedReplies.set(event.response_id,{text:'',truncated:false,turn_id:event.turn_id});}
        const observedReply=observedReplies.get(event?.response_id);
        if(observedReply&&event.type==='response.text.delta'){const text=observedReply.text+event.payload.text;observedReply.text=text.slice(0,16000);observedReply.truncated||=text.length>16000;}
        if(observedReply&&['response.done','response.cancelled'].includes(event.type)){observation.record('voice.reply.forwarded',{turn_id:event.turn_id,response_id:event.response_id,status:event.type,text:observedReply.text,truncated:observedReply.truncated,playback_confirmed:false});observedReplies.delete(event.response_id);}
        if(event?.type==='response.text.delta'&&replyText.has(event.response_id))replyText.set(event.response_id,(replyText.get(event.response_id)+event.payload.text).slice(0,240));
        // Retain this POC's exit-code/farewell fallback, but only bind an owned,
        // forwarded reply. Never cancel a finished goodbye to request another one.
        if(event?.type==='response.done'){
          const heard=finalText.get(event.turn_id);
          const farewell=assistantFarewell(replyText.get(event.response_id));
          const marked=exitReplies.has(event.response_id);
          const stale=runtime.finalTurns.has(event.turn_id)&&latestInputTurn!==event.turn_id;
          const suppressed=!!heard&&providerExitSuppressed(heard);
          const enter=!diagnostics&&!closing?.current&&!stale&&!suppressed&&(marked||farewell);
          traceClose(enter?'这句回复进入收束':'这句回复没有进入收束',diagnostics?'诊断开关开着，不进入收束。':closing?.current?'已经在收束里。':stale?'这句回复不属于最新的学生话。':suppressed?'学生这句被当成问词义或疑问，不收束。':marked?'这句带了退出码。':farewell?'回复像告别。':'没有退出码，回复也不像告别。');
          if(enter){
            teaching.planning?.invalidate('student_end');
            teaching.recap.input(event,{closing:true});
            closing.input(event,{action:'CLOSE'},teaching.summarySnapshot());
          }
          exitReplies.delete(event.response_id);replyText.delete(event.response_id);
        }
        if(event?.type==='response.cancelled'){exitReplies.delete(event.response_id);replyText.delete(event.response_id);}
        closing?.forward(data);
        if(teaching.version!==before)send({type:'teaching.state',...teaching.view()});
        return true;
      };
      const finish = async (code,endReason) => {
        if (ended) {if(['AUTHORIZATION_REVOKED','SAFETY_RESTRICTED'].includes(code)){recordController?.abort();if(ws.readyState===ws.OPEN){ws.send(JSON.stringify({type:'session.failed',code}));ws.close();}}return;}
        if(code||endReason==='transport_closed')recordController?.abort();
        for(const id of replyStats.keys())completeStats(id,code?'failed':'closed');
        diagnose('session.end',{state:code?'failed':'closed',code:code??undefined});
        for(const [responseId,reply] of observedReplies)observation?.record('voice.reply.forwarded',{response_id:responseId,turn_id:reply.turn_id,text:reply.text,truncated:reply.truncated,status:'interrupted',playback_confirmed:false});
        observation?.record('session.ended',{state:code?'failed':'closed',code:code??null});const observationReport=observation?.summarySnapshot();unsubscribeObservation?.();observation?.clear();observedReplies.clear();
        ended = true;ending=true;
        speech?.close();captions?.close();speechReplies.clear();slides?.close();clearTimeout(uiReplyTimer);
        const delivery=closing?.delivery??'skipped';closing?.close();
        outputGate?.close();speechCandidates.clear();
        finalText.clear();exitReplies.clear();replyText.clear();
        const reason=endReason??(code==='AUTHORIZATION_REVOKED'?'authorization_revoked':code==='SAFETY_RESTRICTED'?'safety_restricted':code==='SESSION_DURATION_LIMIT'?'session_limit':code?'service_failure':'student_end');
        const summary=teaching.finalize({outcome:code?'failed':'ended',endReason:reason,businessSource,providerKind,ready});
        diagnose('summary.finalized',{summary_policy_version:summary.policy_version,summary_focus:summary.focus,summary_outcome:summary.outcome,summary_partial:summary.partial,summary_attempts:summary.counts.attempts,summary_items:summary.learning_items.length});
        clearTimeout(readyTimer); clearTimeout(lifetime);
        clearInterval(heartbeat);clearInterval(authorizationLease);
        if(code)metrics?.count(providerKind,'failures');
        for(const pending of pendingCancel.values())clearTimeout(pending.timer);
        pendingCancel.clear();
        if(pendingContext)clearTimeout(pendingContext.timer);
        try { provider?.close(); } catch {}
        let homeworkReceipt=null;
        if(sessionLifecycle?.finalize){try{homeworkReceipt=await sessionLifecycle.finalize({ticket,controller:teaching,summary,code,reason});}catch{homeworkReceipt={state:'pending',attempt_id:ticket.homework?.attempt_id};}}
        let observationReceipt=null;
        if(observationReport&&observationReports&&!['AUTHORIZATION_REVOKED','SAFETY_RESTRICTED'].includes(code)){try{observationReceipt=await observationReports.save(ticket.identity,observationReport);}catch{observationReceipt={status:'failed'};}}
        let receipt={status:'unavailable',session_id:ticket.session_id};
        if(summary.session_recap&&ticket.conversation_registered&&planningPort?.saveConversation&&ticket.identity.authorization_until>Date.now()&&ticket.identity.scopes.includes('learning:write')) {
          recordController=new AbortController();
          const record={schema_version:'conversation-record-v1',session_id:ticket.session_id,summary:summary.session_recap,outcome:code||reason==='transport_closed'?'partial':'ended',end_reason:reason,summary_delivery:delivery};
          let deadline;
          const timeout=new Promise((_,reject)=>{deadline=setTimeout(()=>{recordController.abort();reject(new Error('RECORD_TIMEOUT'));},2200);});
          try{receipt=await Promise.race([planningPort.saveConversation(ticket.identity,record,{signal:recordController.signal}),timeout]);}
          catch{receipt={status:recordController.signal.aborted?'pending':'failed',session_id:ticket.session_id};}
          finally{clearTimeout(deadline);}
        }
        if (ws.readyState === ws.OPEN) {
          if(homeworkReceipt)ws.send(JSON.stringify({type:'homework.attempt.receipt',...homeworkReceipt}));
          if(observationReceipt)ws.send(JSON.stringify({type:'observation.report.saved',session_id:ticket.session_id,...observationReceipt}));
          ws.send(JSON.stringify({type:'conversation.record.receipt',...receipt}));
          const view=summary.focus==='unavailable'?{mode:ticket.mode,goal:'',start_tip:'',cards:[],attempts:[],attempt_count:0,attempts_truncated:false,notice:'本轮总结不可用。'}:teaching.view();
          ws.send(JSON.stringify({type:'teaching.summary',session_id:ticket.session_id,...view,summary,summary_delivery:delivery}));
          ws.send(JSON.stringify({type:code ? 'session.failed':'session.closed',code:code ?? undefined,provider_connected:false}));
        }
        ws.close(code ? 1011:1000,'session ended');
        connections.delete(ws);
        sessions.delete(ws);
      };
      closing=new ClosingCoordinator({sessionId:ticket.session_id,send,finish:()=>void finish(),waitMs:closingWaitMs,playbackMs:closingPlaybackMs});
      let readyTimer = setTimeout(()=>finish('PROVIDER_READY_TIMEOUT'),readyTimeoutMs+(slidesControls?slidesHandshakeMs:0));
      const lifetime = setTimeout(()=>finish('SESSION_DURATION_LIMIT'),Math.min(maxSessionMs,ticket.identity.authorization_until-Date.now()));
      let alive=true;
      const heartbeat=setInterval(()=>{if(!alive){finish('CLIENT_HEARTBEAT_TIMEOUT');ws.terminate();return;}alive=false;if(ws.readyState===ws.OPEN)ws.ping();},15000);
      ws.on('pong',()=>{alive=true;});
      let leaseChecking=false;
      const authorizationLease=sessionLifecycle?.authorize?setInterval(async()=>{if(ended||leaseChecking)return;leaseChecking=true;try{await sessionLifecycle.authorize(ticket);}catch{void finish('AUTHORIZATION_REVOKED');}finally{leaseChecking=false;}},3000):undefined;
      const flushContext = () => {
        if(ended || ending || !ready || runtime.active || provider?.pendingFixed || provider?.uiBusy || pendingCancel.size || pendingContext || speech?.blocksContext() || captions?.blocksContext() || appliedVersion===teaching.version&&!slides?.dirty){if(!ended&&!ending&&appliedVersion!==teaching.version)observation?.record('voice.context.waiting',{context_version:teaching.version,applied_context_version:appliedVersion,active_reply:!!runtime.active,pending_cancel:pendingCancel.size>0,pending_context:!!pendingContext,ready});return;}
        let ui;try{ui=slides?.configuration();}catch{return finish('SLIDES_CAPABILITY_LIMIT');}
        const base=teaching.contextSnapshot(),snapshot=slides?slides.contextSnapshot(base,ui):base,version=slides?++contextWireVersion:snapshot.version,decision=snapshot.decision;
        diagnose('context.requested',{context_version:version,turn_id:decision?.turn_id,context_hash:snapshot.hash,context_policy_version:snapshot.policy_version,context_scope:snapshot.scope});
        observation?.record('voice.context.requested',{context_version:version,context_hash:snapshot.hash,turn_id:decision?.turn_id??null,instructions:snapshot.instructions,advisory_turn_id:teaching.planning?.accepted?.turn_id??null,advisory_proposal_id:teaching.planning?.accepted?.proposal_id??null,speaking_constraints:teaching.planning?.speaking?.constraints()??null});
        pendingContext={version,decision,language:snapshot.language,snapshot,ui,timer:setTimeout(()=>finish('CONTEXT_ACK_TIMEOUT'),contextTimeoutMs)};
        try{provider.updateContext({version,instructions:snapshot.instructions,...(ui?{uiTools:ui.tools}:{}),...(teaching.speech.enabled?{speechSpeed:snapshot.speech.speed}:{})});}catch{finish('PROVIDER_CONTEXT_FAILED');}
      };
      const cancelSent=id=> {
        const pending=pendingCancel.get(id);if(!pending || pending.timer!==undefined)return;
        pending.sentAt=performance.now();
        diagnose('cancel.sent',{response_id:id,turn_id:pending.turn,source:pending.source,elapsed_ms:pending.sentAt-pending.at});
        pending.timer=setTimeout(()=>{
          if(pendingCancel.get(id)!==pending)return;
          diagnose('cancel.timeout',{response_id:id,turn_id:pending.turn,source:pending.source,elapsed_ms:performance.now()-pending.sentAt,cancel_timeout_ms:cancelTimeoutMs,pending_context:!!pendingContext});
          finish('CANCEL_ACK_TIMEOUT');
        },cancelTimeoutMs);
      };
      const interrupt = (responseId,source='manual') => {
        const active = runtime.active;
        const id=responseId ?? active?.id ?? lastResponse?.id;
        if(source==='manual'||speechReplies.has(id)&&['asr_confirmed','provider_speech_start'].includes(source)){
          speech?.cancel();
          // A final-only ASR can install the new setting before confirming a
          // barge-in against the previous fixed reply. Cancel only the older
          // control, never the request belonging to this newest spoken turn.
          if(source==='manual'||captions?.current?.turn_id!==latestSpokenTurn)captions?.cancelVoice();
        }
        if(responseId===undefined||responseId===active?.id||responseId===lastResponse?.id)teaching.planning?.invalidate('student_interruption');
        if (!id) return;
        if(closing.current?.response_id===id){if(source==='manual')closing.cancel();else closing.suspend();}
        if(pendingCancel.has(id)){diagnose('cancel.ignored',{response_id:id,source,reason:'duplicate'});return;}
        diagnose('cancel.requested',{response_id:id,source,active:!!active && active.id===id,pending_context:!!pendingContext,pending_cancel:pendingCancel.size>0});
        outputGate?.stop(id);send({type:'output.stop',response_id:id});
        metrics?.count(providerKind,'interruptions');
        if (!active || active.id!==id) return;
        const stats=replyStats.get(id);if(stats)stats.cancelAt=performance.now();
        runtime.ingest({version:1,event_id:randomUUID(),session_id:ticket.session_id,seq:0,at_ms:0,type:'response.cancel.requested',turn_id:active.turn,response_id:id,payload:{}});
        pendingCancel.set(id,{turn:active.turn,source,at:performance.now()});
        try {const state=provider.cancel(id);if(state!=='queued')cancelSent(id);}catch{finish('PROVIDER_CANCEL_FAILED');}
      };
      const captureSpeech=turnId=> {
        if(speechCandidates.has(turnId))return speechCandidates.get(turnId);
        if(speechCandidates.size>=1000){finish('TURN_LIMIT');return null;}
        const reply=runtime.active ? {id:runtime.active.id,turn:runtime.active.turn}:lastResponse;
        const candidate={target:reply?.turn!==turnId?reply?.id:null,ownerTurn:reply?.turn,confirmed:false};
        speechCandidates.set(turnId,candidate);return candidate;
      };
      sessions.set(ws,{identity:ticket.identity,attemptId:ticket.homework?.attempt_id,teaching,finish,flushContext});
      const restrict = (risk,event) => {
        restricted=true;metrics?.count(providerKind,'restricted');
        slides?.close();
        outputGate?.close();
        diagnose('cancel.requested',{response_id:runtime.active?.id??lastResponse?.id,source:'safety',active:!!runtime.active,pending_context:!!pendingContext});
        send({type:'output.stop',response_id:runtime.active?.id ?? lastResponse?.id});
        try{if(runtime.active)provider.cancel(runtime.active.id);}catch{}
        send({type:'safety.notice',message:SAFETY_MESSAGE,handoff:'pending',policy_version:risk.policy_version});
        const request={identity:ticket.identity,session_id:ticket.session_id,source_event_id:event.event_id,reason:risk.reason,policy_version:risk.policy_version};
        const delivery=safeguardingPort ? Promise.resolve().then(()=>safeguardingPort.request(request)):Promise.reject(new Error('NO_HANDOFF_PORT'));
        let timer;
        Promise.race([delivery,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('HANDOFF_TIMEOUT')),1800);})]).then(result=> {
          if(result?.mocked===true){send({type:'safety.handoff',delivered:false,mocked:true});return;}
          if(result?.delivered!==true)throw new Error('HANDOFF_NOT_CONFIRMED');
          metrics?.count(providerKind,'handoffs_delivered');send({type:'safety.handoff',delivered:true});
        }).catch(()=>send({type:'safety.handoff',delivered:false})).finally(()=>{clearTimeout(timer);finish('SAFETY_RESTRICTED');});
      };
      ws.on('close',()=>finish(undefined,'transport_closed')); ws.on('error',()=>finish('CLIENT_TRANSPORT_ERROR'));
      ws.on('message',(bytes,binary) => {
        if(ended || ending || restricted)return;
        try {
          if (binary) {
            if (!ready) throw new Error('AUDIO_BEFORE_READY');
            const input=teaching.decodeAudio?.(bytes)??{pcm:bytes};
            if (Date.now()-windowAt >= 1000) {windowAt=Date.now();byteWindow=0;}
            byteWindow += input.pcm.length;
            if (byteWindow > provider.audio.input_rate*2*1.25) throw new Error('AUDIO_RATE_LIMIT');
            provider.sendAudio(input.pcm);
            teaching.acceptAudio?.(input.pcm,provider.audio,input.metadata);
          } else {
            if(Date.now()-controlAt>=1000){controlAt=Date.now();controlCount=0;}
            if(++controlCount>20){metrics?.count(providerKind,'control_rate_limited');return finish('CONTROL_RATE_LIMIT');}
            if (bytes.length > 1024) throw new Error('CONTROL_TOO_LARGE');
            const value = JSON.parse(bytes.toString());
            if(value?.type?.startsWith('slides.')){
              if(!slides){if(slidesOffered)return;throw new Error('SLIDES_DISABLED');}
              slides.receive(value);return;
            }
          if (value?.type === 'session.end' && Object.keys(value).every(k=>['type','save_learning'].includes(k)) && (value.save_learning===undefined||typeof value.save_learning==='boolean')) {
            // Explicit opt-in only. Submitted facts remain attempted-only mock
            // observations; no transcript/audio, automatic mastery or retries.
            if(value.save_learning===true&&planningPort&&teaching.planning&&!teaching.closed&&ticket.identity.authorization_until>Date.now()&&ticket.identity.scopes.includes('learning:write')) {
              const record=teaching.learningRecord();
              if(record){ending=true;recordController=new AbortController();teaching.planning.close();send({type:'output.stop'});void planningPort.append(ticket.identity,record,ticket.session_id,{signal:recordController.signal}).then(receipt=>{send({type:'learning.record.receipt',status:receipt.status,mocked:true});metrics?.count(providerKind,receipt.status==='accepted'?'mock_records_saved':'mock_records_pending');}).catch(()=>{send({type:'learning.record.receipt',status:'failed',mocked:true});metrics?.count(providerKind,'mock_records_failed');}).finally(()=>finish());return;}
            }
            finish();
          }
            else if(value?.type==='diagnostics.enable' && Object.keys(value).length===1) {
              if(!diagnostics) {
                diagnostics=true;
                diagnose('backend.config',{business_source:businessSource});
                const output=provider.profile?.session_create?.session?.audio?.output;
                diagnose('session.config',{synthetic:providerKind!=='doubao',protocol:providerKind!=='doubao'?'synthetic':provider.profile?.realtime?.protocol===SEEDUPLEX_PROTOCOL?SEEDUPLEX_PROTOCOL:'reviewed_mapping',reply_policy_version:REPLY_POLICY_VERSION,input_rate:provider.audio.input_rate,output_rate:provider.audio.output_rate,frame_ms:provider.audio.frame_ms,speech_pace:provider.speechPace,speech_pace_supported:provider.profile?.realtime?.protocol===SEEDUPLEX_PROTOCOL,output_speed:output?.speed,speed_explicit:Number.isFinite(output?.speed),cancel_timeout_ms:cancelTimeoutMs,context_timeout_ms:contextTimeoutMs,ready_timeout_ms:readyTimeoutMs,grace_ms:outputGate?replyGraceMs:0,turn_wait_ms:outputGate?turnWaitMs:0});
                if(ready)diagnose('session.ready',{provider_ready:true,elapsed_ms:performance.now()-started});
              }
            }
            else if (value?.type==='response.cancel' && ready && Object.keys(value).every(k=>['type','response_id'].includes(k)) && (value.response_id===undefined || /^[a-zA-Z0-9_.:-]{1,128}$/.test(value.response_id))) interrupt(value.response_id);
            else if(value?.type==='closing.playback'&&Object.keys(value).every(k=>['type','closing_id','response_id','summary_revision','state','audio_ms'].includes(k)))closing.report(value);
            else if(value?.type==='caption.set'&&ready&&value.session_id===ticket.session_id&&typeof value.pinyin_enabled==='boolean'&&Object.keys(value).every(k=>['type','session_id','pinyin_enabled'].includes(k))){captions.set(value.pinyin_enabled);}
            else if(value?.type==='caption.ack'&&Object.keys(value).every(k=>['type','session_id','revision','request_id','pinyin_enabled','status'].includes(k))){captions?.acknowledge(value);advanceControls();flushContext();}
            else if(value?.type==='caption.playback'&&Object.keys(value).every(k=>['type','request_id','response_id','phase','state','audio_ms'].includes(k))){captions?.report(value);advanceControls();flushContext();}
            else if(value?.type==='speech.playback'&&Object.keys(value).every(k=>['type','request_id','response_id','phase','state','audio_ms'].includes(k))){speech?.report(value);advanceControls();flushContext();}
            else if(value?.type==='playback.report' && Object.keys(value).every(k=>['type','response_id','state','audio_ms'].includes(k))){if(teaching.planning?.consumption(value.response_id,value))observation?.record('voice.playback.report',{response_id:value.response_id,state:value.state,audio_ms:value.audio_ms});}
            else throw new Error('INVALID_CONTROL');
          }
        } catch { finish('INVALID_CLIENT_MESSAGE'); }
      });
      try {
        provider = providerFactory(ticket);
        if(slidesControls){
          if(typeof provider.enableSlidesTools!=='function'||typeof provider.sendUiResults!=='function')throw new Error('SLIDES_PROVIDER_UNSUPPORTED');
          slides=new SlidesSession({sessionId:ticket.session_id,send,changed:flushContext,observe:diagnose,demoHistory:slidesDemoHistory,handshakeMs:slidesHandshakeMs,
            isAuthorized:()=>!ended&&!ending&&!restricted&&!closing.current&&ticket.identity.authorization_until>Date.now()});
        }
        if(provider.speechControlSupported===true){
          teaching.speech.enable(provider.profile?.session_create?.session?.audio?.output?.speed??(ticket.speech_pace==='normal'?0:-20));
          appliedContext=teaching.contextSnapshot();
          speech=new SpeechPaceCoordinator({sessionId:ticket.session_id,teaching,send,fail:finish,
            speak:(text,control)=>provider.speakFixedText(text,control),apply:flushContext,
            available:()=>ready&&!ended&&!ending&&!restricted&&!runtime.active&&!pendingContext&&!pendingCancel.size&&!provider.pendingFixed&&!provider.uiBusy&&!captions?.blocksContext(),
            settled:turn=>[...runtime.responses].some(([id,r])=>r.turn===turn&&!speechReplies.has(id)&&['done','cancelled'].includes(r.status))});
        }
        teaching.captionControls=provider.speechControlSupported===true;
        appliedContext=teaching.contextSnapshot();
        captions=new CaptionSettings({sessionId:ticket.session_id,send,voiceSupported:teaching.captionControls,english:()=>teaching.languageSnapshot().english_support==='required',
          speak:(text,control)=>provider.speakFixedText(text,control),
          available:()=>ready&&!ended&&!ending&&!restricted&&!closing.current&&!runtime.active&&!pendingContext&&!pendingCancel.size&&!provider.pendingFixed&&!provider.uiBusy&&!speech?.blocksContext(),
          settled:turn=>[...runtime.responses].some(([id,r])=>r.turn===turn&&!speechReplies.has(id)&&['done','cancelled'].includes(r.status)),
          onApplied:enabled=>{teaching.setCaptionPinyin(enabled);flushContext();}});
        if(observation)provider.observeIdentity=identity=>observation.record('voice.provider.identity',identity);
        if(observation)provider.observeConnection=metadata=>observation.record('voice.connection',metadata);
        if(observation)provider.observeRequest=body=>observation.record('voice.request.sent',{provider_kind:providerKind,synthetic:providerKind!=='doubao',context_version:pendingContext?.version??appliedVersion,context_hash:pendingContext?.snapshot.hash??appliedContext.hash,body});
        if(provider.speechStartKind==='asr_candidate')outputGate=new TurnOutputGate({send,fail:finish,observe:diagnose,graceMs:replyGraceMs,maxWaitMs:turnWaitMs});
        const openProvider=()=>{
          clearTimeout(readyTimer);readyTimer=setTimeout(()=>finish('PROVIDER_READY_TIMEOUT'),readyTimeoutMs);
          return provider.open({sessionId:ticket.session_id,instructions:appliedContext.instructions,onFailure:code=>finish(code),onEvent:packet=> {
          if (ended || ending || restricted) return;
          if(packet.control==='ui.calls'){
            if(!slides)return finish('UNEXPECTED_PROVIDER_TOOL');
            clearTimeout(uiReplyTimer);uiReplyTimer=setTimeout(()=>finish('UI_REPLY_TIMEOUT'),30000);
            const results=slides.calls(packet.calls);
            void Promise.all(results).then(values=>{if(!ended&&!ending&&!restricted)provider.sendUiResults(values);}).catch(()=>finish('UI_TOOL_RESULT_FAILED'));
            return;
          }
          if(packet.control==='ui.reply.settled'){clearTimeout(uiReplyTimer);advanceControls();flushContext();return;}
          if(packet.control==='user.speech.candidate') {
            slides?.observeStarted(packet.turn_id);
            if(!ready || !/^[a-zA-Z0-9_-]{1,128}$/.test(packet.turn_id??'') || runtime.finalTurns.has(packet.turn_id))return;
            const candidate=captureSpeech(packet.turn_id);outputGate?.candidate(packet.turn_id);
            diagnose('speech.candidate',{turn_id:packet.turn_id,response_id:candidate?.target,source:'asr_start'});return;
          }
          if(packet.control==='cancel.sent') {if(pendingCancel.get(packet.response_id)?.turn===packet.turn_id)cancelSent(packet.response_id);return;}
          if(packet.control==='cancel.skipped') {
            const pending=pendingCancel.get(packet.response_id);if(!pending || pending.turn!==packet.turn_id)return;
            clearTimeout(pending.timer);pendingCancel.delete(packet.response_id);
            diagnose('cancel.skipped',{response_id:packet.response_id,turn_id:packet.turn_id,reason:packet.reason,source:pending.source});
            completeStats(packet.response_id,'cancelled');speech?.settle(packet.turn_id);captions?.settle(packet.turn_id);advanceControls();flushContext();return;
          }
          if (packet.control==='user.speech.started') {diagnose('user.speech.started',{turn_id:packet.turn_id,source:'provider_speech_start',active:!!runtime.active});if(ready)interrupt(undefined,'provider_speech_start');return;}
          if(packet.control==='audio.done.observed'){
            const code=packet.body?.status_code;
            const recognized=code==='20000002'||code===20000002;
            traceClose(recognized?'豆包返回了退出码':'豆包这帧音频结束，没有退出码',code==null?'这一帧没有 status_code 字段。':`status_code 是 ${code}。`,packet.body);
            return;
          }
          if(packet.control==='user.exit.intent'){
            diagnose('user.exit.intent',{turn_id:packet.turn_id,response_id:packet.response_id});
            const suppressed=providerExitSuppressed(finalText.get(packet.turn_id));
            const owned=runtime.responses.get(packet.response_id);
            const stale=runtime.finalTurns.has(packet.turn_id)&&latestInputTurn!==packet.turn_id;
            const ownedOk=!!owned&&owned.turn===packet.turn_id&&['active','done'].includes(owned.status)&&!stale;
            const reason=diagnostics?'诊断开关开着，信号被忽略。':closing.current?'已经在收束里。':suppressed?'学生这句被当成问词义或疑问，信号被忽略。':!owned?'还没有对上这句回复。':owned.turn!==packet.turn_id?'回复和这一轮对不上。':!['active','done'].includes(owned.status)?'这句回复已经不能再收束。':stale?'不是最新的学生话。':'';
            if(reason||!ownedOk){traceClose('网关没有用这个退出码进入收束',reason||'回复归属没有通过。');return;}
            const reply=closing.replies.get(packet.response_id);
            if(reply?.done){traceClose('退出码进入收束','这句回复已经说完，开始收束。');teaching.planning?.invalidate('student_end');closing.input({turn_id:reply.turn_id},{action:'CLOSE'},teaching.summarySnapshot());}
            else {traceClose('退出码先记下','等这句回复结束后再收束。');exitReplies.add(packet.response_id);}
            return;
          }
          if(packet.control==='context.updated') {
            if(pendingContext && packet.version===pendingContext.version){clearTimeout(pendingContext.timer);if(pendingContext.ui)slides.confirm(pendingContext.ui);appliedContext=pendingContext.snapshot;appliedVersion=appliedContext.version;appliedDecision=appliedContext.decision;appliedLanguage=appliedContext.language;pendingContext=null;teaching.speech.confirm(appliedContext.speech);observation?.record('voice.context.confirmed',{context_version:appliedVersion,context_hash:appliedContext.hash,turn_id:appliedDecision?.turn_id??null});diagnose('context.applied',{context_version:appliedVersion,turn_id:appliedDecision?.turn_id,context_hash:appliedContext.hash,context_policy_version:appliedContext.policy_version});send({type:'teaching.context.applied',version:appliedVersion,context_hash:appliedContext.hash});speech?.confirmed(appliedContext);advanceControls();flushContext();}
            else diagnose('context.confirmation.ignored',{reason:pendingContext?'wrong_version':'no_pending'});
            return;
          }
          if (!packet.event) return;
          const result = runtime.ingest(packet.event);
          if (!result.accepted) {
            diagnose('event.dropped',{response_id:packet.event.response_id,turn_id:packet.event.turn_id,reason:result.reason});
            metrics?.count(providerKind,'dropped_events');
            if (result.reason === 'event_limit' || result.reason === 'invalid_event') finish('PROVIDER_PROTOCOL_ERROR');
            return;
          }
          if(slides&&!packet.speech_control&&packet.event.type==='response.started'&&latestSpokenTurn&&packet.event.turn_id!==latestSpokenTurn&&
            (runtime.finalTurns.has(packet.event.turn_id)||speechCandidates.has(packet.event.turn_id))){
            const event=packet.event;
            runtime.ingest({version:1,event_id:randomUUID(),session_id:ticket.session_id,seq:0,at_ms:0,type:'response.cancel.requested',turn_id:event.turn_id,response_id:event.response_id,payload:{}});
            outputGate?.stop(event.response_id);send({type:'output.stop',response_id:event.response_id});
            diagnose('event.dropped',{turn_id:event.turn_id,response_id:event.response_id,reason:'ownership'});
            try{provider.discardReply(event.response_id);}catch{finish('PROVIDER_CANCEL_FAILED');}return;
          }
          if(packet.speech_control){
            const event=packet.event;
            if(event.type==='response.started'){lastResponse={id:event.response_id,turn:event.turn_id};speechReplies.add(event.response_id);}
            if(event.type==='response.cancelled'){clearTimeout(pendingCancel.get(event.response_id)?.timer);pendingCancel.delete(event.response_id);if(captions?.owns(packet))captions.cancelVoice();advanceControls();flushContext();return;}
            if(!speech?.owns(packet)&&!captions?.owns(packet)){if(event.type==='response.started')interrupt(event.response_id,'stale_speech_control');return;}
            send({type:'event',event,audio:packet.audio,sample_rate:packet.sample_rate,speech_control:packet.speech_control,provider_connected:ready&&providerKind==='doubao',synthetic:providerKind!=='doubao'});
            return;
          }
          if((speech?.suppresses(packet.event.turn_id)||captions?.suppresses(packet.event.turn_id))&&packet.event.type.startsWith('response.')){
            const event=packet.event;
            if(event.type==='response.started'){lastResponse={id:event.response_id,turn:event.turn_id};interrupt(event.response_id,captions?.suppresses(event.turn_id)?'caption_settings_request':'speech_pace_request');}
            if(['response.done','response.cancelled'].includes(event.type)){
              const pending=pendingCancel.get(event.response_id);clearTimeout(pending?.timer);pendingCancel.delete(event.response_id);
              speech?.settle(event.turn_id);captions?.settle(event.turn_id);advanceControls();flushContext();
            }
            return;
          }
          if (packet.event.type === 'session.ready') {ready=true;if(initialUi)slides.confirm(initialUi);clearTimeout(readyTimer);metrics?.count(providerKind,'ready');metrics?.observe(providerKind,'ready_ms',performance.now()-started);}
          if(packet.event.type==='session.ready')observation?.record('voice.ready',{provider_kind:providerKind,synthetic:providerKind!=='doubao',context_version:appliedVersion,context_hash:appliedContext.hash,provider_session_id:packet.provider_session_id??null});
          if(packet.event.type==='session.ready')diagnose('session.ready',{provider_ready:true,elapsed_ms:performance.now()-started});
          if(packet.event.type==='session.closed'){finish(undefined,'provider_closed');return;}
          if(packet.event.type==='session.failed'){finish('PROVIDER_SESSION_FAILED');return;}
          if (packet.event.type==='response.started'){lastResponse={id:packet.event.response_id,turn:packet.event.turn_id};policy.newResponse();replyAt=performance.now();firstAudio=false;}
          const event=packet.event,ids={response_id:event.response_id,turn_id:event.turn_id};
          if(event.type==='response.started') {
            observation?.record('voice.reply.started',{...ids,applied_context_version:appliedVersion,applied_context_hash:appliedContext.hash,current_context_version:teaching.version,provider_response_id:packet.provider_response_id??null,pending_context:!!pendingContext,decision_turn_id:appliedDecision?.turn_id??null,generation_basis:'unknown'});
            const languageContextMatched=!pendingContext && sameLanguageSupport(appliedLanguage,teaching.languageSnapshot());
            replyStats.set(event.response_id,{at:performance.now(),turn:event.turn_id,chars:0,deltas:0,chunks:0,pcmMs:0,audit:diagnostics?new ReplyAudit({englishSupport:appliedLanguage.english_support,languageContextMatched}):null});
            diagnose('response.started',{...ids,pending_context:!!pendingContext,pending_cancel:pendingCancel.size>0});
            // Snapshot at the first accepted response-start notification, which
            // can arrive after generation began. This proves ACK/turn matching,
            // not model compliance or that already generated audio used it.
            diagnose('teaching.response',{...ids,applied_context_version:appliedVersion,applied_context_hash:appliedContext.hash,context_policy_version:appliedContext.policy_version,current_state_version:teaching.version,current_decision_context_version:teaching.view().decision?.context_version,decision_context_version:appliedDecision?.context_version,decision_context_matched:appliedDecision?.turn_id===event.turn_id,pending_context:!!pendingContext,...(teaching.mode==='free'?{speaking_generation_basis:teaching.planning?.executions.get(event.response_id)?.speaking_generation_basis??'unknown'}:{})});
          }
          if(['user.partial','user.final'].includes(event.type))diagnose(event.type,{...ids,chars:Array.from(event.payload.text).length});
          const stats=replyStats.get(event.response_id);
          if(stats && event.type==='response.text.delta') {
            stats.chars+=Array.from(event.payload.text).length;stats.deltas++;
            stats.audit?.append(event.payload.text);
            if(stats.deltas===1)diagnose('response.first_text',{...ids,elapsed_ms:performance.now()-stats.at});
          }
          if(stats && event.type==='response.audio.chunk') {
            stats.chunks++;stats.pcmMs+=event.payload.byte_length/(packet.sample_rate??provider.audio.output_rate)/2*1000;
            if(stats.chunks===1)diagnose('response.first_audio',{...ids,elapsed_ms:performance.now()-stats.at});
          }
          if(event.type==='response.cancelled') {
            const pending=pendingCancel.get(event.response_id);
            if(pending?.sentAt!==undefined)diagnose('cancel.ack',{...ids,ack_ms:performance.now()-pending.sentAt});
            completeStats(event.response_id,'cancelled');
          }
          if(event.type==='response.done')completeStats(event.response_id,'done');
          if(['user.partial','user.final','response.text.delta'].includes(packet.event.type)) {
            const risk=policy.inspect(packet.event.payload.text,{output:packet.event.type==='response.text.delta'});
            if(risk.restricted){restrict(risk,packet.event);return;}
          }
          if(['user.partial','user.final'].includes(event.type)&&hasSpeechText(event.payload.text))latestSpokenTurn=event.turn_id;
          if(event.type==='user.final')slides?.observeFinal(event.turn_id);
          if(packet.event.type==='response.audio.chunk' && !firstAudio && replyAt!==null){firstAudio=true;metrics?.observe(providerKind,'first_audio_ms',performance.now()-replyAt);}
          // Register accepted input/request provenance after safety, before a
          // final releases held teacher text. Plans alone remain no evidence.
          const acceptedTeaching=teaching.accept(packet.event);
          if(acceptedTeaching){observation?.record('student.input.accepted',{turn_id:event.turn_id,source_event_id:event.event_id,text:event.payload.text});latestInputTurn=event.turn_id;finalText.set(event.turn_id,event.payload.text);}
          if(acceptedTeaching&&captions){
            const request=teaching.captionRequest?.turn_id===event.turn_id?teaching.captionRequest:null;
            captions.input(event,request);
            if(request){for(const [id,reply] of runtime.responses)if(reply.turn===event.turn_id&&!speechReplies.has(id)){
              if(runtime.active?.id===id)interrupt(id,'caption_settings_request');else{outputGate?.stop(id);send({type:'output.stop',response_id:id});}
            }}
          }
          if(acceptedTeaching&&teaching.view().decision.action==='CLOSE'&&/(?:不用总结|不(?:用|要)回顾|(?:现在|马上|立刻)(?:就)?结束|(?:end|stop) (?:right now|immediately)|no (?:recap|summary))/iu.test(controlText(event.payload.text))){closing.delivery='skipped';void finish();return;}
          if(acceptedTeaching&&!diagnostics){closing.input(event,teaching.view().decision,teaching.summarySnapshot());if(teaching.view().decision.action==='CLOSE')teaching.planning?.invalidate('student_end');}
          if(outputGate && ['user.partial','user.final'].includes(event.type)) {
            if(event.type==='user.final' || !runtime.finalTurns.has(event.turn_id)) {
              const candidate=captureSpeech(event.turn_id);
              if(candidate && !candidate.confirmed && hasSpeechText(event.payload.text)) {
                if(!candidate.target && candidate.ownerTurn===undefined){const reply=runtime.active??lastResponse;if(reply?.turn!==event.turn_id)candidate.target=reply?.id;}
                candidate.confirmed=true;
                diagnose('speech.confirmed',{turn_id:event.turn_id,response_id:candidate.target,source:'asr_confirmed'});
                if(candidate.target)interrupt(candidate.target,'asr_confirmed');
              }
              outputGate.user(event);
            }
          }
          if (packet.event.type==='response.cancelled') {clearTimeout(pendingCancel.get(packet.event.response_id)?.timer);pendingCancel.delete(packet.event.response_id);}
          if(acceptedTeaching&&speech){
            const request=teaching.speech.request?.turn_id===event.turn_id?teaching.speech.request:null;
            speech.input(event,request);
            if(request){
              for(const [id,reply] of runtime.responses)if(reply.turn===event.turn_id&&!speechReplies.has(id)){
                if(runtime.active?.id===id)interrupt(id,'speech_pace_request');
                else{outputGate?.stop(id);send({type:'output.stop',response_id:id});}
              }
              speech.advance();
            }
          }
          if(acceptedTeaching) {
            const view=teaching.view(),decision=view.decision;
            const language=teaching.languageSnapshot();
            diagnose('language.decision',{turn_id:event.turn_id,context_version:teaching.version,language_policy_version:language.policy_version,english_support:language.english_support,language_reason:language.reason,known_expression_count:language.known_expressions.length});
            diagnose('teaching.decision',{turn_id:decision.turn_id,context_version:decision.context_version,teaching_policy_version:decision.policy_version,mode:decision.mode,action:decision.action,decision_reason:decision.reason,interaction:decision.interaction,support_level:decision.support_level,new_points:decision.new_points,turn_count:decision.turn_count,goal_attempt_observed:decision.goal_attempt_observed,teaching_paused:decision.teaching_paused,clarification_pending:decision.clarification_pending,teaching_cooldown:decision.teaching_cooldown});
            if(event.type==='user.final')traceClose(decision.action==='CLOSE'&&decision.reason==='student_end'?'你的话被判成结束':'你的话没有被判成结束',`动作 ${decision.action}，原因 ${decision.reason}。`);
            send({type:'teaching.state',...view});
            diagnose('context.queued',{context_version:teaching.version,turn_id:decision.turn_id});
            // A final can arrive after this reply's observed terminal boundary.
            // Flush only that owned completed turn, never an arbitrary early final.
            if(teaching.completedReplyTurns.has(event.turn_id))flushContext();
            if(teaching.planning&&decision.action!=='CLOSE')void teaching.planTurn(event).then(plan=> {
              if(!plan||ended)return;
              send({type:'teaching.state',...teaching.view()});flushContext();
            }).catch(()=>diagnose('planning.rejected',{turn_id:event.turn_id,reason:'planning_failed'}));
          }
          const projected={type:'event',event:packet.event,audio:packet.audio,sample_rate:packet.sample_rate,provider_connected:ready && providerKind==='doubao',synthetic:providerKind!=='doubao'};
          if(outputGate && ['response.started','response.text.delta','response.audio.chunk','response.done'].includes(event.type))outputGate.push(projected);else send(projected);
          if(teaching.completeReply(event)) {
            send({type:'teaching.state',...teaching.view()});
            diagnose('language.reply.completed',{turn_id:event.turn_id,context_version:teaching.version});
          }
          if(['response.done','response.cancelled'].includes(packet.event.type)){if(!provider.uiBusy)clearTimeout(uiReplyTimer);advanceControls();flushContext();}
        }});};
        send({type:'session.config',session_id:ticket.session_id,captions:captions.snapshot(),audio:provider.audio,speech:{supported:provider.profile?.realtime?.protocol===SEEDUPLEX_PROTOCOL,pace:provider.speechPace??null,output_speed:provider.profile?.session_create?.session?.audio?.output?.speed??null},provider_connected:false,synthetic:providerKind!=='doubao'});
        if(slides){
          slidesOffered=true;
          void slides.ready.then(configuration=>{if(ended)return;try{initialUi=configuration;appliedContext=slides.contextSnapshot(teaching.contextSnapshot(),configuration);provider.enableSlidesTools(configuration.tools);observation?.record('voice.context.prepared',{session_id:ticket.session_id,provider_kind:providerKind,synthetic:providerKind!=='doubao',context_version:appliedVersion,context_hash:appliedContext.hash,instructions:appliedContext.instructions,slides_revision:configuration.revision});openProvider();}catch{finish('PROVIDER_CONFIGURATION_ERROR');}},()=>{
            if(ended)return;slides?.close();slides=null;initialUi=null;
            send({type:'slides.unavailable',reason:'VIEWER_UNAVAILABLE'});
            try{openProvider();}catch{finish('PROVIDER_CONFIGURATION_ERROR');}
          });
          slides.offer();
        }else openProvider();
        send({type:'teaching.state',...teaching.view()});
      } catch { finish('PROVIDER_CONFIGURATION_ERROR'); }
    });
  });
  return {
    available:!!providerFactory,
    async create({origin,mode,identity,speechPace,planning,bindPlanning,homework}) {
      if (!providerFactory) return null;
      if (tickets.size+connections.size >= maxConnections) throw new Error('SESSION_CAPACITY');
      const token = randomUUID();
      const ticket = {session_id:randomUUID(),mode,speech_pace:speechPace,origin,identity,expires:Math.min(Date.now()+30000,identity.expires)};
      if(homework)ticket.homework=homework;
      if(sessionLifecycle?.open)await sessionLifecycle.open(ticket);
      if(planning)ticket.planning=bindPlanning(planning,ticket.session_id);
      tickets.set(token,ticket);
      try{if(planningPort?.openConversation){await planningPort.openConversation(identity,ticket.session_id,mode);ticket.conversation_registered=true;}}catch{tickets.delete(token);throw new Error('CONVERSATION_RECORD_UNAVAILABLE');}
      return {session_id:ticket.session_id,ticket:token,websocket_path:websocketPath,protocol,expires_in:30,provider_connected:false};
    },
    async updateMemory(identity,memory) {
      const matches=[...sessions.values()].filter(s=>s.identity.owner_id===identity.owner_id&&s.identity.learner_id===identity.learner_id);
      for(const session of matches)session.teaching.updateMemory(memory);
      const context=matches.some(s=>s.teaching.planning)&&planningPort?await planningPort.read(identity):null;
      for(const session of matches)if(!session.teaching.closed){if(context)session.teaching.updateLearnerContext(context);session.flushContext();}
    },
    revoke(identity) {
      for(const [key,ticket] of tickets)if(ticket.identity.owner_id===identity.owner_id && ticket.identity.learner_id===identity.learner_id)tickets.delete(key);
      for(const session of sessions.values())if(session.identity.owner_id===identity.owner_id && session.identity.learner_id===identity.learner_id)session.finish('AUTHORIZATION_REVOKED');
    },
    stopHomeworkRecording(attemptId,{text=false,audio=false}={}) {
      for(const ticket of tickets.values())if(ticket.homework?.attempt_id===attemptId){if(text)ticket.homework.recorder?.stopLocal();if(audio)ticket.homework.audioRecorder?.stopLocal();}
      for(const session of sessions.values())if(session.attemptId===attemptId){if(text)session.teaching.transcriptRecorder?.stopLocal();if(audio)session.teaching.audioRecorder?.stopLocal();}
    },
    close() {clearInterval(sweep);tickets.clear();for(const ws of connections)ws.terminate();wss.close();}
  };
}
