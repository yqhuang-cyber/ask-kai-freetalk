import { randomUUID } from 'node:crypto';
import { DoubaoJsonTransport, ReviewedDoubaoProvider, validateRealtimeProfile } from './realtime.js';
import { validateProfile } from './probe.js';
import { isSpeechPace, isSpeechSpeed } from '../agent-core/speech.js';
import { validateSlidesToolSet, validateSlidesIntent } from '../contracts/ui-actions.js';

export const SEEDUPLEX_PROTOCOL = 'seeduplex-1.2.6.1';
export const SEEDUPLEX_SOURCE = 'https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh';
// Supplied official PDF: session.audio.output.speed, default 0, range [-50,100].
// -20 is our initial slow preset, pending real listening calibration.
export const SEEDUPLEX_SPEEDS = Object.freeze({slow:-20,normal:0});
// Full-duplex session.create puts Dialog settings in extension.dialog.
// enable_user_query_exit is the documented switch; default false. When true,
// response.output_audio.done carries the exit signal and the client closes.
// Live 1.2.6.1 observation, 2026-10-16: an exit query adds top-level
// status_code "20000002" on that event. An ordinary completion omits the
// field. response.done stays usage-only and does not carry the signal.
export const SEEDUPLEX_EXIT_EXTENSION = Object.freeze({dialog:Object.freeze({extra:Object.freeze({enable_user_query_exit:true})})});
export function isSeeduplexExitExtension(extension) {
  if (extension === undefined) return true;
  if (!extension || typeof extension !== 'object' || Array.isArray(extension)) return false;
  const dialog = extension.dialog;
  if (Object.keys(extension).length !== 1 || !dialog || typeof dialog !== 'object' || Array.isArray(dialog)) return false;
  const extra = dialog.extra;
  if (Object.keys(dialog).length !== 1 || !extra || typeof extra !== 'object' || Array.isArray(extra)) return false;
  return Object.keys(extra).length === 1 && extra.enable_user_query_exit === true;
}
export function isSeeduplexExitSignal(raw) {
  return raw?.status_code === '20000002' || raw?.status_code === 20000002;
}
function visibleProviderEvent(value,depth=0) {
  if(value==null||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string')return value.length>400?`[省略 ${value.length} 字符]`:value;
  if(Array.isArray(value))return depth>3?`[数组 ${value.length}]`:value.slice(0,20).map(item=>visibleProviderEvent(item,depth+1));
  if(typeof value==='object') {
    if(depth>4)return {keys:Object.keys(value)};
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,visibleProviderEvent(item,depth+1)]));
  }
  return String(value);
}
export function validateSeeduplexProfile(profile,{protocolProbe=false}={}) {
  validateProfile(profile);
  const rt = profile.realtime, session = profile.session_create.session;
  if (!profile.reviewed || !rt?.reviewed || rt.protocol !== SEEDUPLEX_PROTOCOL || profile.evidence_source !== SEEDUPLEX_SOURCE || rt.evidence_source !== SEEDUPLEX_SOURCE) throw new Error('DOUBAO_PROTOCOL_NOT_VERIFIED');
  if(rt.review_scope==='protocol_smoke'&&!protocolProbe)throw new Error('SEEDUPLEX_PROBE_ONLY');
  if (profile.auth.header !== 'X-Api-Key' || profile.auth.prefix !== '' || profile.ready.type !== 'session.created' || profile.ready.session_id_path !== 'session.id') throw new Error('INVALID_SEEDUPLEX_MAPPING');
  if (session.model !== '1.2.6.1' || session.audio?.input?.format?.type !== 'pcm' || session.audio.input.format.rate !== 16000 || session.audio?.output?.format?.type !== 'pcm_s16le' || session.audio.output.format.rate !== 24000 || !/^[a-zA-Z0-9_-]{1,128}$/.test(session.audio.output.voice ?? '')) throw new Error('UNSUPPORTED_REVIEWED_AUDIO');
  const speed=session.audio.output.speed;
  if (speed !== undefined && (!Number.isFinite(speed) || speed < -50 || speed > 100)) throw new Error('INVALID_SEEDUPLEX_SPEED');
  if (rt.audio?.encoding !== 'pcm_s16le' || rt.audio.input_rate !== 16000 || rt.audio.output_rate !== 24000 || rt.audio.frame_ms !== 20 || rt.initial_instructions !== 'session.instructions') throw new Error('UNSUPPORTED_REVIEWED_AUDIO');
  // The PDF identifies ACK types, but does not prove their ordering/identity on an account.
  // Do not enable this policy solely because the static mapping has been reviewed.
  if (rt.ordered_acks_reviewed !== true) throw new Error('SEEDUPLEX_ACK_REVIEW_REQUIRED');
  if (session.id !== undefined || session.tools!==undefined&&(!Array.isArray(session.tools)||session.tools.length>0) || !isSeeduplexExitExtension(profile.session_create.extension)) throw new Error('UNREVIEWED_SEEDUPLEX_FEATURE');
  return profile;
}
export function validateDoubaoRealtimeProfile(profile) {
  return profile.realtime?.protocol === SEEDUPLEX_PROTOCOL ? validateSeeduplexProfile(profile) : validateRealtimeProfile(profile);
}
export function createDoubaoProvider(options) {
  if (options.profile.realtime?.protocol === SEEDUPLEX_PROTOCOL) return new SeeduplexProvider(options);
  if (options.speechPace !== undefined) throw new Error('SPEECH_PACE_UNSUPPORTED');
  return new ReviewedDoubaoProvider(options);
}

/** Wire names/fields come from the official evidence and bounded account probes.
 * Regressions use authored structural fixtures; ambiguous ownership fails closed.
 */
export class SeeduplexProvider extends DoubaoJsonTransport {
  speechStartKind='asr_candidate';
  speechControlSupported=true;
  constructor(options) {
    validateSeeduplexProfile(options.profile,{protocolProbe:options.protocolProbe===true});
    if (options.speechPace !== undefined && !isSpeechPace(options.speechPace)) throw new Error('INVALID_SPEECH_PACE');
    const profile=structuredClone(options.profile); // Isolate concurrent sessions and preserve the reviewed source profile.
    if (options.speechPace !== undefined) profile.session_create.session.audio.output.speed=SEEDUPLEX_SPEEDS[options.speechPace];
    profile.session_create.extension=structuredClone(SEEDUPLEX_EXIT_EXTENSION);
    super({...options,profile});
    this.speechPace=options.speechPace;
    this.wireSeen = new Set(); this.turns = new Map(); this.replies = new Map();
    this.activeReply = null; this.pendingControl = null; this.ready = false;
    this.queuedCancels=[];this.latestReply=null;
    // A PCM lane is opened only by an identified audio.started boundary, never
    // by latestReply. It survives a cancel request as a discard-only old lane.
    this.audioLane=null;this.audioFence=false;
    this.uiToolsEnabled=false;this.uiCalls=new Set();this.uiCallSignatures=new Map();this.uiAwaitingReply=false;
  }
  // Explicit, session-local opt-in. Reviewed source profiles still reject embedded tools.
  enableSlidesTools(tools){
    if(this.socket||this.closed||!validateSlidesToolSet(tools))throw new Error('INVALID_SLIDES_TOOLS');
    this.uiToolsEnabled=true;this.profile.session_create.session.tools=structuredClone(tools);
  }
  get uiBusy(){return this.uiCalls.size>0||this.uiAwaitingReply;}
  sendUiResults(results){
    if(!this.uiToolsEnabled||!this.ready||this.closed||!Array.isArray(results)||!results.length||results.length>4||
      new Set(results.map(result=>result.callId)).size!==results.length||results.some(result=>!this.uiCalls.has(result.callId)||!result.outcome||typeof result.outcome!=='object'))throw new Error('INVALID_UI_TOOL_RESULT');
    const items=results.map(({callId,outcome})=>({call_id:callId,role:'tool',content:[{type:'input_text',text:JSON.stringify(outcome)}]}));
    if(JSON.stringify(items).length>16000)throw new Error('UI_TOOL_RESULT_LIMIT');
    // Results may pass a pending context/cancel ACK: blocking them creates a native tool deadlock.
    this.send({type:'conversation.item.create',event_id:randomUUID(),items});
    for(const result of results)this.uiCalls.delete(result.callId);
  }
  text(value) {
    if (typeof value !== 'string' || !value.length || value.length > 2000) throw new Error('INVALID_PROVIDER_TEXT');
    return value;
  }
  turn(rawId) {
    const id = this.id(`turn:${this.checkId(rawId)}`);
    if (!this.turns.has(id)) this.turns.set(id,{id,text:'',final:false,started:false});
    return this.turns.get(id);
  }
  checkId(value) {
    if (typeof value !== 'string' || !value.length || value.length > 120) throw new Error('INVALID_PROVIDER_ID');
    return value;
  }
  reply(raw,create=false,fixed=null) {
    const rawId = this.checkId(raw.response_id);
    const id = this.id(`reply:${rawId}`);
    let reply = this.replies.get(id);
    if (!reply) {
      if (!create) throw new Error('UNBOUND_PROVIDER_RESPONSE');
      if (this.activeReply) throw new Error('OVERLAPPING_PROVIDER_RESPONSE');
      const turnId=fixed?fixed.turn_id:this.turn(raw.question_id).id;
      reply = {id,rawId,turn:turnId,status:'active',text:'',textStarted:false,textDone:false,audioDone:false,fixed};
      this.replies.set(id,reply); this.activeReply = reply;this.latestReply=reply;
      try{this.observeIdentity?.({response_id:reply.id,provider_response_id:reply.rawId,turn_id:reply.turn});}catch{}
      this.emitReply('response.started',reply);
      if(fixed)this.emitReply('response.text.delta',reply,{text:fixed.text});
    } else if (raw.question_id !== undefined && (reply.fixed?raw.question_id!==reply.fixed.rawQuestion:this.turn(raw.question_id).id!==reply.turn)) throw new Error('FOREIGN_PROVIDER_TURN');
    return reply;
  }
  replyIds(reply) { return {turn_id:reply.turn,response_id:reply.id}; }
  emitReply(type,reply,payload={},extra={}) {
    this.onEvent({event:this.event(type,payload,this.replyIds(reply)),...(reply.fixed?{speech_control:{request_id:reply.fixed.request_id,phase:reply.fixed.phase}}:{}),...extra});
  }
  completeReply(reply) {
    if(reply.status!=='active'){
      if(reply.status==='cancelled'&&this.uiAwaitingReply&&!this.uiCalls.size){this.uiAwaitingReply=false;this.onEvent({control:'ui.reply.settled'});}
      return;
    }
    reply.status='done';reply.wireDone=true;reply.text='';
    if(this.activeReply===reply)this.activeReply=null;
    if(this.audioLane===reply){this.audioLane=null;this.audioFence=true;}
    if(!this.uiCalls.size)this.uiAwaitingReply=false;
    this.emitReply('response.done',reply);
  }
  completeOutput(reply) {
    // Identified output boundaries close our reply output. ID-less usage is
    // separate telemetry and can never close a reply or create learning evidence.
    if(reply.audioDone&&(reply.status==='cancelled'||!reply.textStarted||reply.textDone))this.completeReply(reply);
  }
  audioReply(raw) {
    if(raw.response_id!==undefined)return this.reply(raw,true);
    const reply=this.audioLane;
    if(!reply){if(this.audioFence)return null;throw new Error('UNBOUND_AUDIO_STREAM');}
    if(raw.question_id!==undefined&&(reply.fixed?raw.question_id!==reply.fixed.rawQuestion:this.turn(raw.question_id).id!==reply.turn))throw new Error('FOREIGN_PROVIDER_TURN');
    return reply;
  }
  receive(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_PROVIDER_EVENT');
    if (raw.event_id !== undefined) {
      this.checkId(raw.event_id);
      if (this.wireSeen.has(raw.event_id)) return;
      if (this.wireSeen.size >= 10000) throw new Error('PROVIDER_EVENT_LIMIT');
      this.wireSeen.add(raw.event_id);
    }
    if (raw.type === 'error') throw new Error('PROVIDER_REPORTED_ERROR');
    if (raw.type === 'session.created') {
      if (this.ready) throw new Error('DUPLICATE_PROVIDER_READY');
      this.rawSessionId = this.checkId(raw.session?.id); this.ready = true;
      try{this.observeIdentity?.({provider_session_id:this.rawSessionId});}catch{}
      return this.onEvent({event:this.event('session.ready')});
    }
    if (!this.ready) throw new Error('PROVIDER_EVENT_BEFORE_READY');
    if (raw.type === 'session.closed') throw new Error('PROVIDER_SESSION_CLOSED');
    if (raw.type === 'session.updated') {
      const pending = this.pendingControl;
      if (!pending || pending.kind !== 'context' || raw.session?.id !== this.rawSessionId || raw.event_id === undefined) throw new Error('UNBOUND_CONTEXT_ACK');
      this.pendingControl = null;
      if(pending.uiTools!==undefined)this.profile.session_create.session.tools=pending.uiTools;
      if(pending.speed!==undefined){this.profile.session_create.session.audio.output.speed=pending.speed;this.speechPace=pending.speed===-20?'slow':pending.speed===0?'normal':undefined;}
      this.onEvent({control:'context.updated',version:pending.version});
      return this.drainCancels();
    }
    if (raw.type === 'response.canceled') {
      const pending = this.pendingControl;
      if (!pending || pending.kind !== 'cancel' || raw.event_id === undefined || (raw.response_id !== undefined && raw.response_id !== pending.reply.rawId)) throw new Error('UNBOUND_CANCEL_ACK');
      this.pendingControl = null; pending.reply.status = 'cancelled';
      pending.reply.text='';
      if(this.audioLane===pending.reply){this.audioLane=null;this.audioFence=true;}
      this.emitReply('response.cancelled',pending.reply);
      return this.drainCancels();
    }
    if (raw.type.startsWith('conversation.item.input_audio_transcription.')) {
      if (!['started','delta','completed','failed'].some(s=>raw.type.endsWith(`.${s}`))) return;
      const turn = this.turn(raw.item_id);
      if (turn.final) return;
      if (raw.type.endsWith('.started')) {
        if (turn.started) return;
        turn.started = true;
        // Official started means the first recognized character, not verified VAD onset.
        return this.onEvent({control:'user.speech.candidate',turn_id:turn.id});
      }
      if (raw.type.endsWith('.failed')) throw new Error('PROVIDER_ASR_FAILED');
      if (raw.type.endsWith('.delta')) {
        // Actual 1.2.6.1 ASR streams cumulative hypotheses, including rewrites
        // and shorter corrections. The event's name does not imply fragments.
        turn.text = this.text(raw.delta);
        return this.onEvent({event:this.event('user.partial',{text:turn.text},{turn_id:turn.id})});
      }
      // 2026-10-11 actual Seeduplex ASR completion uses `text`; the typed demo
      // and older authored fixtures use `transcript`. Never silently prefer
      // one conflicting final transcript over another.
      const hasText=Object.hasOwn(raw,'text'),hasTranscript=Object.hasOwn(raw,'transcript');
      const text=this.text(hasText?raw.text:raw.transcript);
      if(hasText&&hasTranscript&&this.text(raw.transcript)!==text)throw new Error('PROVIDER_ASR_TEXT_CONFLICT');
      turn.final = true; turn.text = '';
      return this.onEvent({event:this.event('user.final',{text},{turn_id:turn.id})});
    }
    if (['response.output_text.delta','response.output_text.done','response.output_audio.started','response.output_audio.delta','response.output_audio.done','response.done'].includes(raw.type)) {
      if(raw.type==='response.done'&&raw.response_id===undefined){
        // Observed real shape is {type,event_id,response:{usage:{...}}}. Neither
        // top-level nor nested reply identity exists. Do not infer an owner.
        if(!raw.response||typeof raw.response!=='object'||Array.isArray(raw.response)||
          !raw.response.usage||typeof raw.response.usage!=='object'||Array.isArray(raw.response.usage))throw new Error('UNBOUND_PROVIDER_RESPONSE');
        return;
      }
      if(raw.type==='response.output_audio.started'){
        const rawId=this.checkId(raw.response_id);
        const known=this.replies.get(this.ids.get(`reply:${rawId}`));
        if(known&&known.status!=='active'){
          // A locally discarded text-first reply may announce audio later. Bind
          // its unfinished lane for discard only, never to the newer reply.
          if(known.status==='cancelled'&&!known.wireDone){
            if(this.audioLane&&this.audioLane!==known)throw new Error('AMBIGUOUS_AUDIO_STREAM');
            this.audioLane=known;this.audioFence=false;
          }
          return; // a completed ID cannot reopen a lane
        }
        if((this.audioLane&&this.audioLane.rawId!==rawId)||this.pendingControl?.kind==='cancel'||this.queuedCancels.length)throw new Error('AMBIGUOUS_AUDIO_STREAM');
        let fixed=null;
        if(this.pendingFixed){
          // Account probe: fixed synthesis has its own question_id; it does not
          // echo our event_id. Bind only the explicitly reserved command after
          // its automatic reply settled. A known ASR turn cannot take this lane.
          this.checkId(raw.question_id);
          if(this.ids.has(`turn:${raw.question_id}`))throw new Error('UNEXPECTED_PROVIDER_REPLY_DURING_FIXED');
          fixed={...this.pendingFixed,rawQuestion:raw.question_id};this.pendingFixed=null;
        }
        const reply=this.reply(raw,true,fixed);
        this.audioLane=reply;this.audioFence=false;
        return;
      }
      const reply=raw.type==='response.output_audio.delta'?this.audioReply(raw):this.reply(raw,raw.type!=='response.done'&&raw.type!=='response.output_audio.done');
      if(!reply)return;
      if(reply.fixed&&['response.output_text.delta','response.output_text.done'].includes(raw.type))return;
      if(raw.type==='response.done'){
        reply.wireDone=true;
        this.completeReply(reply);return;
      }
      if(raw.type==='response.output_audio.done'){
        reply.audioDone=true;reply.wireDone=true;
        if(this.audioLane===reply){this.audioLane=null;this.audioFence=true;}
        // Signal the client before completing output, so a local closing script
        // cannot start after Doubao has already marked this reply as an exit.
        this.onEvent({control:'audio.done.observed',body:visibleProviderEvent(raw)});
        if(isSeeduplexExitSignal(raw))this.onEvent({control:'user.exit.intent',turn_id:reply.turn,response_id:reply.id});
        this.completeOutput(reply);return;
      }
      if (reply.status !== 'active') return; // cancelled/completed IDs cannot reopen
      if (raw.type === 'response.output_text.delta') {
        reply.textStarted=true;
        const text = this.text(raw.delta);
        if (reply.text.length + text.length > 4000) throw new Error('PROVIDER_TEXT_LIMIT');
        reply.text += text;
        return this.emitReply('response.text.delta',reply,{text});
      }
      if (raw.type === 'response.output_text.done') {
        // Never repeat a complete transcript as a new delta. Emit only an exact suffix.
        const text = this.text(raw.text);
        if (!text.startsWith(reply.text)) throw new Error('PROVIDER_TEXT_REWRITE');
        const suffix = text.slice(reply.text.length); reply.text = text;reply.textDone=true;
        if (suffix) this.emitReply('response.text.delta',reply,{text:suffix});
        this.completeOutput(reply);
        return;
      }
      if (raw.type === 'response.output_audio.delta') {
        if (typeof raw.delta !== 'string' || raw.delta.length > 122880 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.delta)) throw new Error('INVALID_PROVIDER_AUDIO');
        const bytes = Buffer.from(raw.delta,'base64');
        if (!bytes.length || bytes.length > 92160 || bytes.length % 2 || bytes.toString('base64') !== raw.delta) throw new Error('INVALID_PROVIDER_AUDIO');
        // Bounded provider packet compatibility; internal/Web chunks remain <=64 KiB.
        // 90 KiB decoded leaves room for ownership/header fields in the 128 KiB socket frame.
        for(let offset=0;offset<bytes.length;offset+=65536) {
          const chunk=bytes.subarray(offset,offset+65536);
          this.emitReply('response.audio.chunk',reply,{byte_length:chunk.length,format:'pcm_s16le'},{audio:chunk.toString('base64'),sample_rate:24000});
        }
        return;
      }
      return;
    }
    if (raw.type === 'response.function_call_arguments.done') {
      if(!this.uiToolsEnabled)throw new Error('UNEXPECTED_PROVIDER_TOOL');
      if(!Array.isArray(raw.items)||!raw.items.length||raw.items.length>4)throw new Error('INVALID_UI_TOOL_BATCH');
      const calls=raw.items.map(item=>{
        if(!item||Object.keys(item).some(key=>!['name','arguments','call_id'].includes(key))||!/^(navigate_slides|cancel_pending_slides)_[a-z0-9]{8,32}$/.test(item.name??'')||typeof item.arguments!=='string'||item.arguments.length>1024)throw new Error('INVALID_UI_TOOL_CALL');
        const callId=this.checkId(item.call_id);let args=null;try{args=JSON.parse(item.arguments);}catch{}
        return {name:item.name,callId,args};
      });
      if(new Set(calls.map(call=>call.callId)).size!==calls.length||this.uiCalls.size+calls.filter(call=>!this.uiCalls.has(call.callId)).length>16)throw new Error('UI_TOOL_CALL_LIMIT');
      const signatures=calls.map(call=>{
        const args=validateSlidesIntent(call.args)?{action:call.args.action,...(call.args.action==='goto'?{page:call.args.page}:{}),...(call.args.replace_pending===true?{replace_pending:true}:{})}:call.args;
        return JSON.stringify({name:call.name,args});
      });
      // A retransmission attaches to the existing transaction. It must not create
      // two result waiters that race to consume the same native call identity.
      calls.forEach((call,index)=>{const previous=this.uiCallSignatures.get(call.callId);if(previous!==undefined&&previous!==signatures[index])throw new Error('UI_CALL_ID_CONFLICT');});
      const fresh=calls.filter(call=>!this.uiCallSignatures.has(call.callId));
      if(this.uiCallSignatures.size+fresh.length>64)throw new Error('UI_TOOL_CALL_LIMIT');
      if(!fresh.length)return;
      calls.forEach((call,index)=>{this.uiCallSignatures.set(call.callId,signatures[index]);});
      this.uiAwaitingReply=true;for(const call of fresh)this.uiCalls.add(call.callId);
      // A separate session control port. No fabricated learner turn/response event.
      return this.onEvent({control:'ui.calls',calls:fresh});
    }
  }
  mute() {
    if (!this.ready || this.closed) throw new Error('PROVIDER_NOT_OPEN');
    this.send({type:'input_audio_mute.commit',event_id:randomUUID()});
  }
  speakFixedText(text,control) {
    if (!this.ready || this.closed || this.pendingControl || this.activeReply || this.pendingFixed || this.queuedCancels.length) throw new Error('PROVIDER_CONTROL_PENDING');
    if (typeof text!=='string' || !text.length || text.length>400) throw new Error('INVALID_SPOKEN_RECAP');
    if(control){
      if(!/^[a-zA-Z0-9_-]{1,128}$/.test(control.turn_id??'')||!this.turns.has(control.turn_id)||!/^[a-zA-Z0-9_-]{1,128}$/.test(control.request_id??'')||!['before','after'].includes(control.phase))throw new Error('INVALID_SPEECH_CONTROL');
      this.pendingFixed={...control,text};
    }
    this.send({type:'speech_text_buffer.commit',event_id:randomUUID(),text});
  }
  sendAudio(bytes) {
    if (!this.ready || !bytes.length || bytes.length % 2 || bytes.length > 640) throw new Error('INVALID_INPUT_AUDIO');
    this.send({type:'input_audio_buffer.append',audio:Buffer.from(bytes).toString('base64')});
  }
  cancel(responseId) {
    const reply = this.replies.get(responseId);
    if(reply?.status==='cancel_pending')return 'queued';
    if (!reply || reply.status !== 'active' || this.activeReply !== reply) throw new Error('UNKNOWN_RESPONSE');
    if(this.uiBusy){
      // Native waiting tools must receive their results. Stop this voice lane locally;
      // ordinary barge-in never cancels the accepted page transaction or waits for a wire ACK.
      return this.discardReply(responseId);
    }
    if(this.queuedCancels.length>=32)throw new Error('PROVIDER_CONTROL_LIMIT');
    reply.status = 'cancel_pending'; this.activeReply = null;
    this.queuedCancels.push(reply);this.drainCancels();
    return this.pendingControl?.kind==='cancel' && this.pendingControl.reply===reply?'sent':'queued';
  }
  discardReply(responseId){
    const reply=this.replies.get(responseId);
    if(!reply||reply.status!=='active'||this.activeReply!==reply)throw new Error('UNKNOWN_RESPONSE');
    reply.status='cancelled';reply.text='';this.activeReply=null;
    this.emitReply('response.cancelled',reply);return 'local';
  }
  drainCancels() {
    if(this.closed || this.pendingControl)return;
    while(this.queuedCancels.length) {
      const reply=this.queuedCancels.shift();
      // Simple response.cancel has no target ID. Never let a queued stop cancel a newer reply.
      if(reply.wireDone || this.latestReply!==reply) {
        reply.status='cancelled';reply.text='';
        this.onEvent({control:'cancel.skipped',response_id:reply.id,turn_id:reply.turn,reason:reply.wireDone?'completed':'replaced'});
        if(this.closed || this.pendingControl)return;
        continue;
      }
      this.pendingControl={kind:'cancel',reply};
      this.send({type:'response.cancel',event_id:randomUUID()});
      this.onEvent({control:'cancel.sent',response_id:reply.id,turn_id:reply.turn});
      return;
    }
  }
  updateContext({instructions,version,duringSilentReply=false,speechSpeed,uiTools}) {
    const silent=duringSilentReply && this.activeReply && !this.activeReply.textStarted && this.audioLane!==this.activeReply;
    if (!this.ready || this.pendingControl || this.pendingFixed || this.queuedCancels.length || this.uiBusy || (this.activeReply && !silent) || typeof instructions !== 'string' || instructions.length > 16000 || !Number.isSafeInteger(version) || version < 1) throw new Error('PROVIDER_CONTROL_PENDING');
    if(uiTools!==undefined&&(!this.uiToolsEnabled||!validateSlidesToolSet(uiTools)))throw new Error('INVALID_SLIDES_TOOLS');
    if(speechSpeed!==undefined&&!isSpeechSpeed(speechSpeed))throw new Error('INVALID_SPEECH_SPEED');
    this.pendingControl = {kind:'context',version,speed:speechSpeed,uiTools:uiTools===undefined?undefined:structuredClone(uiTools)};
    // Dynamic pace uses the full session shape verified by the live spike.
    const session=speechSpeed===undefined&&!this.uiToolsEnabled?{id:this.rawSessionId,instructions}:{...structuredClone(this.profile.session_create.session),id:this.rawSessionId,instructions};
    if(uiTools!==undefined)session.tools=structuredClone(uiTools);
    if(speechSpeed!==undefined)session.audio.output.speed=speechSpeed;
    this.send({type:'session.update',event_id:randomUUID(),session});
  }
  close() {
    if(this.closed)return this.closeResult;
    const socket=this.socket;
    this.uiCalls.clear();this.uiCallSignatures.clear();this.uiAwaitingReply=false;
    let sent=false;
    try{if(this.ready){this.send({type:'session.close',event_id:randomUUID()});sent=true;}}catch{}
    // Fence business events immediately, while waiting briefly for the actual
    // session.closed ACK on this connection. No model event can reopen output.
    this.closed=true;this.turns.clear();this.replies.clear();this.wireSeen.clear();this.pendingControl=null;
    this.queuedCancels.length=0;this.latestReply=null;this.activeReply=null;this.audioLane=null;this.audioFence=true;this.pendingFixed=null;
    if(!sent){super.close();return this.closeResult=Promise.resolve({acknowledged:false});}
    this.closeResult=new Promise(resolve=>{
      let finished=false;
      const finish=acknowledged=>{
        if(finished)return;finished=true;clearTimeout(timer);
        socket.removeListener('message',onMessage);socket.removeListener('close',onClose);socket.removeListener('error',onClose);
        super.close();resolve({acknowledged});
      };
      const onClose=()=>finish(false);
      const onMessage=(bytes,binary)=>{
        if(binary||bytes.length>131072)return;
        try{if(JSON.parse(bytes.toString()).type==='session.closed')finish(true);}catch{}
      };
      const timer=setTimeout(()=>finish(false),2000);timer.unref?.();
      socket.on('message',onMessage);socket.once('close',onClose);socket.once('error',onClose);
    });
    return this.closeResult;
  }
}
