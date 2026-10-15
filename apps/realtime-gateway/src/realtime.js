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

export function attachRealtime(server,{providerFactory,providerKind='doubao',businessSource='unconfigured',planner,planningPort,maxConnections=8,readyTimeoutMs=8000,maxSessionMs=600000,cancelTimeoutMs=1500,contextTimeoutMs=1500,replyGraceMs=350,turnWaitMs=5000,safeguardingPort,metrics}={}) {
  const tickets = new Map();
  const connections = new Set();
  const sessions=new Map();
  const wss = new WebSocketServer({noServer:true,maxPayload:65536,perMessageDeflate:false,handleProtocols:protocols=>protocols.has('ask-kai.v1') ? 'ask-kai.v1' : false});
  const sweep = setInterval(() => { for(const [key,item] of tickets) if(item.expires <= Date.now()) tickets.delete(key); },1000);
  sweep.unref();
  const reject = (socket,status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  server.on('upgrade',(req,socket,head) => {
    if (!providerFactory) return reject(socket,'501 Not Implemented');
    const expectedOrigin = `http://${req.headers.host}`;
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '') || req.headers.origin !== expectedOrigin) return reject(socket,'403 Forbidden');
    if (req.url !== '/api/realtime' || !providerFactory) return reject(socket,'501 Not Implemented');
    const protocols = (req.headers['sec-websocket-protocol'] ?? '').split(',').map(p=>p.trim());
    const token = protocols.find(p=>p.startsWith('ticket.'))?.slice(7);
    const ticket = tickets.get(token);
    tickets.delete(token); // one use, including a failed attempt
    if (!protocols.includes('ask-kai.v1') || !ticket || ticket.expires <= Date.now() || ticket.identity.expires<=Date.now() || ticket.origin !== expectedOrigin) return reject(socket,'401 Unauthorized');
    if (connections.size >= maxConnections) return reject(socket,'429 Too Many Requests');
    wss.handleUpgrade(req,socket,head,ws => {
      connections.add(ws);
      const runtime = new SessionRuntime(ticket.session_id,{target:null});
      const teaching=new TeachingSession({sessionId:ticket.session_id,mode:ticket.mode,memory:ticket.identity.memory,mission:ticket.identity.mission,speechPace:ticket.speech_pace,planning:ticket.planning,planner,resourceVerifier:planningPort?.checkResource?(resource,options)=>planningPort.checkResource(ticket.identity,resource,options):null,onPlanningRecord:(name,fields)=>diagnose(name,fields)});
      const policy=new SafetyPolicy();
      const started=performance.now();metrics?.count(providerKind,'sessions');
      let restricted=false,controlCount=0,controlAt=Date.now(),replyAt=null,firstAudio=false;
      let provider;
      let outputGate;
      let ended = false;
      let ending=false;
      let spokenClose=null;
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
        if(!diagnostics || ws.readyState!==ws.OPEN || ws.bufferedAmount>131072)return;
        try{ws.send(JSON.stringify({type:'diagnostics.event',row:{name,at_ms:performance.now()-started,fields:metadata(fields)}}));}catch{/* Diagnostics do not control the session. */}
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
        teaching.forward(data); // Only forwarded packets, after safety/output hold.
        teaching.planning?.observe(data);
        return true;
      };
      const finish = (code,endReason) => {
        if (ended) return;
        if(spokenClose?.timer)clearTimeout(spokenClose.timer);
        if(code||endReason==='transport_closed')recordController?.abort();
        for(const id of replyStats.keys())completeStats(id,code?'failed':'closed');
        diagnose('session.end',{state:code?'failed':'closed',code:code??undefined});
        ended = true;
        outputGate?.close();speechCandidates.clear();
        const reason=endReason??(code==='AUTHORIZATION_REVOKED'?'authorization_revoked':code==='SAFETY_RESTRICTED'?'safety_restricted':code==='SESSION_DURATION_LIMIT'?'session_limit':code?'service_failure':'student_end');
        const summary=teaching.finalize({outcome:code?'failed':'ended',endReason:reason,businessSource,providerKind,ready});
        diagnose('summary.finalized',{summary_policy_version:summary.policy_version,summary_focus:summary.focus,summary_outcome:summary.outcome,summary_partial:summary.partial,summary_attempts:summary.counts.attempts,summary_items:summary.learning_items.length});
        clearTimeout(readyTimer); clearTimeout(lifetime);
        clearInterval(heartbeat);
        if(code)metrics?.count(providerKind,'failures');
        for(const pending of pendingCancel.values())clearTimeout(pending.timer);
        pendingCancel.clear();
        if(pendingContext)clearTimeout(pendingContext.timer);
        try { provider?.close(); } catch {}
        if (ws.readyState === ws.OPEN) {
          const view=summary.focus==='unavailable'?{mode:ticket.mode,goal:'',start_tip:'',cards:[],attempts:[],attempt_count:0,attempts_truncated:false,notice:'本轮总结不可用。'}:teaching.view();
          ws.send(JSON.stringify({type:'teaching.summary',session_id:ticket.session_id,...view,summary}));
          ws.send(JSON.stringify({type:code ? 'session.failed':'session.closed',code:code ?? undefined,provider_connected:false}));
        }
        ws.close(code ? 1011:1000,'session ended');
        connections.delete(ws);
        sessions.delete(ws);
      };
      const endAndSave = () => {
        if(ended||ending)return;
        if(spokenClose?.timer)clearTimeout(spokenClose.timer);
        const canSave=planningPort&&teaching.planning&&!teaching.closed&&ticket.identity.authorization_until>Date.now()&&ticket.identity.scopes.includes('learning:write');
        let record=null;
        if(canSave){try{record=teaching.learningRecord();}catch{record=null;}}
        if(!record){finish();return;}
        ending=true;recordController=new AbortController();teaching.planning.close();send({type:'output.stop'});
        void planningPort.append(ticket.identity,record,ticket.session_id,{signal:recordController.signal}).then(receipt=>{send({type:'learning.record.receipt',status:receipt.status,mocked:true});metrics?.count(providerKind,receipt.status==='accepted'?'mock_records_saved':'mock_records_pending');}).catch(()=>{send({type:'learning.record.receipt',status:'failed',mocked:true});metrics?.count(providerKind,'mock_records_failed');}).finally(()=>finish());
      };
      const speakCloseSummary = () => {
        if(!spokenClose||spokenClose.phase==='wait_summary'||ended||ending)return;
        if(Date.now()>spokenClose.deadline){endAndSave();return;}
        if(runtime.active||pendingCancel.size){spokenClose.timer=setTimeout(speakCloseSummary,200);return;}
        spokenClose.phase='wait_summary';spokenClose.responseId=null;
        try{
          if(typeof provider.speakFixedText!=='function'){endAndSave();return;}
          provider.speakFixedText(spokenClose.script);
          send({type:'session.closing'});
        }catch{endAndSave();return;}
        spokenClose.timer=setTimeout(()=>endAndSave(),12000);
      };
      const armSpokenClose = turnId => {
        if(spokenClose||ended||ending)return;
        spokenClose={turnId,phase:'wait_reply',script:teaching.spokenCloseScript(),responseId:runtime.active?.id??null,deadline:Date.now()+12000,timer:null};
        if(!spokenClose.responseId)spokenClose.timer=setTimeout(speakCloseSummary,1500);
      };
      const noteSpokenClose = event => {
        if(!spokenClose||ended||ending)return;
        if(event.type==='response.started') {
          if(spokenClose.phase==='wait_reply'){clearTimeout(spokenClose.timer);spokenClose.responseId=event.response_id;}
          else if(spokenClose.phase==='wait_summary'&&!spokenClose.responseId)spokenClose.responseId=event.response_id;
        }
        if(event.type!=='response.done'&&event.type!=='response.cancelled')return;
        if(spokenClose.phase==='wait_reply'&&(!spokenClose.responseId||spokenClose.responseId===event.response_id)){clearTimeout(spokenClose.timer);spokenClose.responseId=null;speakCloseSummary();}
        else if(spokenClose.phase==='wait_summary'&&spokenClose.responseId===event.response_id){clearTimeout(spokenClose.timer);endAndSave();}
      };
      const readyTimer = setTimeout(()=>finish('PROVIDER_READY_TIMEOUT'),readyTimeoutMs);
      const lifetime = setTimeout(()=>finish('SESSION_DURATION_LIMIT'),Math.min(maxSessionMs,ticket.identity.authorization_until-Date.now()));
      let alive=true;
      const heartbeat=setInterval(()=>{if(!alive){finish('CLIENT_HEARTBEAT_TIMEOUT');ws.terminate();return;}alive=false;if(ws.readyState===ws.OPEN)ws.ping();},15000);
      ws.on('pong',()=>{alive=true;});
      const flushContext = () => {
        if(ended || !ready || runtime.active || pendingCancel.size || pendingContext || appliedVersion===teaching.version)return;
        const snapshot=teaching.contextSnapshot(),version=snapshot.version,decision=snapshot.decision;
        diagnose('context.requested',{context_version:version,turn_id:decision?.turn_id,context_hash:snapshot.hash,context_policy_version:snapshot.policy_version,context_scope:snapshot.scope});
        pendingContext={version,decision,language:snapshot.language,snapshot,timer:setTimeout(()=>finish('CONTEXT_ACK_TIMEOUT'),contextTimeoutMs)};
        try{provider.updateContext({version,instructions:snapshot.instructions});}catch{finish('PROVIDER_CONTEXT_FAILED');}
      };
      const cancelSent=id=> {
        const pending=pendingCancel.get(id);if(!pending || pending.timer!==undefined)return;
        pending.sentAt=performance.now();
        diagnose('cancel.sent',{response_id:id,turn_id:pending.turn,source:pending.source,elapsed_ms:pending.sentAt-pending.at});
        pending.timer=setTimeout(()=>finish('CANCEL_ACK_TIMEOUT'),cancelTimeoutMs);
      };
      const interrupt = (responseId,source='manual') => {
        const active = runtime.active;
        const id=responseId ?? active?.id ?? lastResponse?.id;
        if(responseId===undefined||responseId===active?.id||responseId===lastResponse?.id)teaching.planning?.invalidate('student_interruption');
        if (!id) return;
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
      sessions.set(ws,{identity:ticket.identity,teaching,finish,flushContext});
      const restrict = (risk,event) => {
        restricted=true;metrics?.count(providerKind,'restricted');
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
            if (Date.now()-windowAt >= 1000) {windowAt=Date.now();byteWindow=0;}
            byteWindow += bytes.length;
            if (byteWindow > provider.audio.input_rate*2*1.25) throw new Error('AUDIO_RATE_LIMIT');
            provider.sendAudio(bytes);
          } else {
            if(Date.now()-controlAt>=1000){controlAt=Date.now();controlCount=0;}
            if(++controlCount>20){metrics?.count(providerKind,'control_rate_limited');return finish('CONTROL_RATE_LIMIT');}
            if (bytes.length > 1024) throw new Error('CONTROL_TOO_LARGE');
            const value = JSON.parse(bytes.toString());
          if (value?.type === 'session.end' && Object.keys(value).every(k=>['type','save_learning'].includes(k)) && (value.save_learning===undefined||typeof value.save_learning==='boolean')) {
            // Student end always writes the sourced mock record. The checkbox
            // no longer gates it. Facts stay attempted-only, without transcript or mastery.
            endAndSave();
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
            else if(value?.type==='playback.report' && Object.keys(value).every(k=>['type','response_id','state','audio_ms'].includes(k)))teaching.planning?.consumption(value.response_id,value);
            else throw new Error('INVALID_CONTROL');
          }
        } catch { finish('INVALID_CLIENT_MESSAGE'); }
      });
      try {
        provider = providerFactory(ticket);
        if(provider.speechStartKind==='asr_candidate')outputGate=new TurnOutputGate({send,fail:finish,observe:diagnose,graceMs:replyGraceMs,maxWaitMs:turnWaitMs});
        provider.open({sessionId:ticket.session_id,instructions:appliedContext.instructions,onFailure:code=>finish(code),onEvent:packet=> {
          if (ended || ending || restricted) return;
          if(packet.control==='user.speech.candidate') {
            if(!ready || !/^[a-zA-Z0-9_-]{1,128}$/.test(packet.turn_id??'') || runtime.finalTurns.has(packet.turn_id))return;
            const candidate=captureSpeech(packet.turn_id);outputGate?.candidate(packet.turn_id);
            diagnose('speech.candidate',{turn_id:packet.turn_id,response_id:candidate?.target,source:'asr_start'});return;
          }
          if(packet.control==='cancel.sent') {if(pendingCancel.get(packet.response_id)?.turn===packet.turn_id)cancelSent(packet.response_id);return;}
          if(packet.control==='cancel.skipped') {
            const pending=pendingCancel.get(packet.response_id);if(!pending || pending.turn!==packet.turn_id)return;
            clearTimeout(pending.timer);pendingCancel.delete(packet.response_id);
            diagnose('cancel.skipped',{response_id:packet.response_id,turn_id:packet.turn_id,reason:packet.reason,source:pending.source});
            completeStats(packet.response_id,'cancelled');flushContext();return;
          }
          if (packet.control==='user.speech.started') {diagnose('user.speech.started',{turn_id:packet.turn_id,source:'provider_speech_start',active:!!runtime.active});if(ready)interrupt(undefined,'provider_speech_start');return;}
          if(packet.control==='context.updated') {
            if(pendingContext && packet.version===pendingContext.version){clearTimeout(pendingContext.timer);appliedContext=pendingContext.snapshot;appliedVersion=packet.version;appliedDecision=appliedContext.decision;appliedLanguage=appliedContext.language;pendingContext=null;diagnose('context.applied',{context_version:appliedVersion,turn_id:appliedDecision?.turn_id,context_hash:appliedContext.hash,context_policy_version:appliedContext.policy_version});send({type:'teaching.context.applied',version:appliedVersion,context_hash:appliedContext.hash});flushContext();}
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
          if (packet.event.type === 'session.ready') {ready=true;clearTimeout(readyTimer);metrics?.count(providerKind,'ready');metrics?.observe(providerKind,'ready_ms',performance.now()-started);}
          if(packet.event.type==='session.ready')diagnose('session.ready',{provider_ready:true,elapsed_ms:performance.now()-started});
          if(packet.event.type==='session.closed'){finish(undefined,'provider_closed');return;}
          if(packet.event.type==='session.failed'){finish('PROVIDER_SESSION_FAILED');return;}
          if (packet.event.type==='response.started'){lastResponse={id:packet.event.response_id,turn:packet.event.turn_id};policy.newResponse();replyAt=performance.now();firstAudio=false;}
          const event=packet.event,ids={response_id:event.response_id,turn_id:event.turn_id};
          if(event.type==='response.started') {
            const languageContextMatched=!pendingContext && sameLanguageSupport(appliedLanguage,teaching.languageSnapshot());
            replyStats.set(event.response_id,{at:performance.now(),turn:event.turn_id,chars:0,deltas:0,chunks:0,pcmMs:0,audit:diagnostics?new ReplyAudit({englishSupport:appliedLanguage.english_support,languageContextMatched}):null});
            diagnose('response.started',{...ids,pending_context:!!pendingContext,pending_cancel:pendingCancel.size>0});
            // Snapshot at the first accepted response-start notification, which
            // can arrive after generation began. This proves ACK/turn matching,
            // not model compliance or that already generated audio used it.
            diagnose('teaching.response',{...ids,applied_context_version:appliedVersion,applied_context_hash:appliedContext.hash,context_policy_version:appliedContext.policy_version,current_state_version:teaching.version,current_decision_context_version:teaching.view().decision?.context_version,decision_context_version:appliedDecision?.context_version,decision_context_matched:appliedDecision?.turn_id===event.turn_id,pending_context:!!pendingContext});
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
          if(packet.event.type==='response.audio.chunk' && !firstAudio && replyAt!==null){firstAudio=true;metrics?.observe(providerKind,'first_audio_ms',performance.now()-replyAt);}
          // Register accepted input/request provenance after safety, before a
          // final releases held teacher text. Plans alone remain no evidence.
          const acceptedTeaching=teaching.accept(packet.event);
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
          if(acceptedTeaching) {
            const view=teaching.view(),decision=view.decision;
            const language=teaching.languageSnapshot();
            diagnose('language.decision',{turn_id:event.turn_id,context_version:teaching.version,language_policy_version:language.policy_version,english_support:language.english_support,language_reason:language.reason,known_expression_count:language.known_expressions.length});
            diagnose('teaching.decision',{turn_id:decision.turn_id,context_version:decision.context_version,teaching_policy_version:decision.policy_version,mode:decision.mode,action:decision.action,decision_reason:decision.reason,interaction:decision.interaction,support_level:decision.support_level,new_points:decision.new_points,turn_count:decision.turn_count,goal_attempt_observed:decision.goal_attempt_observed,teaching_paused:decision.teaching_paused,clarification_pending:decision.clarification_pending,teaching_cooldown:decision.teaching_cooldown});
            send({type:'teaching.state',...view});
            diagnose('context.queued',{context_version:teaching.version,turn_id:decision.turn_id});
            // A final can arrive after this reply's observed terminal boundary.
            // Flush only that owned completed turn, never an arbitrary early final.
            if(teaching.completedReplyTurns.has(event.turn_id))flushContext();
            // Collection sessions enable diagnostics and must keep the scripted
            // reply as the only model reply. Ordinary web sessions speak the summary.
            if(decision.action==='CLOSE'&&decision.reason==='student_end'&&!diagnostics)armSpokenClose(event.turn_id);
            if(teaching.planning)void teaching.planTurn(event).then(plan=> {
              if(!plan||ended)return;
              send({type:'teaching.state',...teaching.view()});flushContext();
            }).catch(()=>diagnose('planning.rejected',{turn_id:event.turn_id,reason:'planning_failed'}));
          }
          noteSpokenClose(event);
          const projected={type:'event',event:packet.event,audio:packet.audio,sample_rate:packet.sample_rate,provider_connected:ready && providerKind==='doubao',synthetic:providerKind!=='doubao'};
          if(outputGate && ['response.started','response.text.delta','response.audio.chunk','response.done'].includes(event.type))outputGate.push(projected);else send(projected);
          if(teaching.completeReply(event)) {
            send({type:'teaching.state',...teaching.view()});
            diagnose('language.reply.completed',{turn_id:event.turn_id,context_version:teaching.version});
          }
          if(['response.done','response.cancelled'].includes(packet.event.type))flushContext();
        }});
        send({type:'session.config',session_id:ticket.session_id,audio:provider.audio,speech:{supported:provider.profile?.realtime?.protocol===SEEDUPLEX_PROTOCOL,pace:provider.speechPace??null,output_speed:provider.profile?.session_create?.session?.audio?.output?.speed??null},provider_connected:false,synthetic:providerKind!=='doubao'});
        send({type:'teaching.state',...teaching.view()});
      } catch { finish('PROVIDER_CONFIGURATION_ERROR'); }
    });
  });
  return {
    available:!!providerFactory,
    create({origin,mode,identity,speechPace,planning,bindPlanning}) {
      if (!providerFactory) return null;
      if (tickets.size+connections.size >= maxConnections) throw new Error('SESSION_CAPACITY');
      const token = randomUUID();
      const ticket = {session_id:randomUUID(),mode,speech_pace:speechPace,origin,identity,expires:Math.min(Date.now()+30000,identity.expires)};
      if(planning)ticket.planning=bindPlanning(planning,ticket.session_id);
      tickets.set(token,ticket);
      return {session_id:ticket.session_id,ticket:token,websocket_path:'/api/realtime',protocol:'ask-kai.v1',expires_in:30,provider_connected:false};
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
    close() {clearInterval(sweep);tickets.clear();for(const ws of connections)ws.terminate();wss.close();}
  };
}
