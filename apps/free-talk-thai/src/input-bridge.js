import {randomUUID} from 'node:crypto';
import {HistoryTurnProvider} from '../../../packages/provider-doubao/history-turn.js';
import {DoubaoThaiAsr} from '../../../packages/provider-doubao/asr.js';
import {SEEDUPLEX_SPEEDS} from '../../../packages/provider-doubao/seeduplex.js';
import {UtteranceBuffer} from './utterance-buffer.js';
import {BRIDGE_TRIGGER,BRIDGE_FAREWELL,BRIDGE_WAKE,inputInstructions,inputIntent} from './input-policy.js';

const normalized=text=>text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'');
// M2 owns the business conversation and cancellation epochs. Native wire
// normalization remains in M5. Program activation ASR is never learner evidence.
export class ThaiInputBridge {
  kind='doubao';speechStartKind='asr_candidate';speechControlSupported=true;
  constructor({profile,speechPace='slow',inputMode='zh',triggerPcm,asr=new DoubaoThaiAsr(),nativeFactory=options=>new HistoryTurnProvider(options)}){
    if(!['zh','th'].includes(inputMode)||!Buffer.isBuffer(triggerPcm)||!triggerPcm.length||triggerPcm.length%2)throw Error('INVALID_INPUT_BRIDGE');
    Object.assign(this,{profile:structuredClone(profile),speechPace,mode:inputMode,triggerPcm:Buffer.from(triggerPcm),asr,nativeFactory});
    this.profile.session_create.session.audio.output.speed=SEEDUPLEX_SPEEDS[speechPace];
    this.audio=structuredClone(profile.realtime.audio);this.history=[];this.inputs=new Map();this.replies=new Map();this.intents=new Map();this.epoch=0;this.nativeEpoch=0;this.seq=0;
    this.segmenter=new UtteranceBuffer({onStart:frames=>this.speechStarted(frames),onFrame:frame=>this.asrStream?.write(frame),onSegment:pcm=>void this.transcribe(pcm),onTooLong:()=>{this.cancelPendingInput();this.state('listening','请分成较短的泰语句子再说。');}});
  }
  get contextMode(){return this.mode==='th'?'deferred':'agent';}
  get managesClosing(){return this.mode==='th';}
  isEndTurn(turnId){return this.intents.get(turnId)==='end';}
  get pendingFixed(){return this.fixedControl??this.native?.pendingFixed;}
  get uiBusy(){return false;}
  event(type,payload={},ids={}){return {version:1,event_id:randomUUID(),session_id:this.sessionId,seq:++this.seq,at_ms:Math.max(0,Math.round(performance.now()-this.started)),type,...ids,payload};}
  emit(type,payload,ids,extra={}){if(!this.closed)this.onEvent({event:this.event(type,payload,ids),...extra});}
  state(phase,message){this.phase=phase;if(!this.closed)this.onEvent?.({control:'input.state',state:{mode:this.mode,phase,agent_context_deferred:this.mode==='th',...(message?{message}:{})}});}
  open({sessionId,instructions,onEvent,onFailure}){
    Object.assign(this,{sessionId,agentInstructions:instructions,onEvent,onFailure,started:performance.now()});
    void this.spawn({purpose:'listen'}).catch(()=>this.fail('INPUT_VOICE_UNAVAILABLE'));
  }
  fail(code){if(this.closed)return;this.onFailure(code);}
  trimHistory(){while(this.history.length>12||JSON.stringify(this.history).length>18000)this.history.splice(0,2);}
  async spawn({purpose,owner,fixedText,control}){
    this.pendingReady?.();this.pendingReady=null;const old=this.native;this.native=null;const epoch=++this.nativeEpoch;clearInterval(this.pump);clearTimeout(this.replyTimer);void old?.close();
    const history=structuredClone(this.history);
    if(purpose==='reply')history.push({role:'user',text:owner.text},{role:'assistant',text:'我先记下这个问题。'});
    const native=this.nativeFactory({profile:this.profile,speechPace:this.speechPace,history});
    this.native=native;this.owner=owner;this.nativePurpose=purpose;this.nativeMuted=true;
    if(owner&&purpose==='fixed')owner.fixedText=fixedText;
    const valid=()=>!this.closed&&this.native===native&&this.nativeEpoch===epoch;
    const instructions=purpose==='listen'&&this.mode==='zh'?this.agentInstructions:inputInstructions(this.mode);
    try{await new Promise((resolve,reject)=>{
      let ready=false;const timer=setTimeout(()=>reject(Error('NATIVE_READY_TIMEOUT')),8000);this.pendingReady=()=>{clearTimeout(timer);reject(Error('STALE_NATIVE'));};
      native.open({sessionId:this.sessionId,instructions,onFailure:()=>{if(!valid())return;clearTimeout(timer);if(!ready)reject(Error('NATIVE_FAILED'));else this.fail('INPUT_VOICE_UNAVAILABLE');},onEvent:packet=>{
        if(!valid())return;
        if(packet.event?.type==='session.ready'){
          native.mute();
          void native.verifyHistory().then(()=>{
            if(!valid()){clearTimeout(timer);return reject(Error('STALE_NATIVE'));}
            ready=true;clearTimeout(timer);this.pendingReady=null;
            if(!this.businessReady){this.businessReady=true;this.emit('session.ready',{});}
            if(purpose==='reply'){
              this.replyTimer=setTimeout(()=>{if(valid())this.fail('INPUT_REPLY_TIMEOUT');},40000);
              native.unmute();this.nativeMuted=false;let position=0;
              this.pump=setInterval(()=>{if(!valid())return;try{const frame=Buffer.alloc(640);this.triggerPcm.copy(frame,0,position,Math.min(position+640,this.triggerPcm.length));position=Math.min(position+640,this.triggerPcm.length);native.sendAudio(frame);}catch{this.fail('INPUT_TRIGGER_FAILED');}},20);
            }else if(purpose==='fixed'){this.replyTimer=setTimeout(()=>{if(valid())this.fail('INPUT_REPLY_TIMEOUT');},30000);native.speakFixedText(fixedText);}
            else this.state('listening');
            resolve();
          },()=>{clearTimeout(timer);reject(Error('HISTORY_UNVERIFIED'));});return;
        }
        try{this.nativePacket(packet,{native,purpose,owner,control,valid});}catch{this.fail('INPUT_OWNERSHIP_FAILED');}
      }});
    });}catch(error){
      if(valid()){this.pendingReady=null;this.native=null;++this.nativeEpoch;clearInterval(this.pump);clearTimeout(this.replyTimer);void native.close();}
      throw error;
    }
  }
  nativePacket(packet,{native,purpose,owner,control,valid}){
    if(purpose==='listen'){
      if(packet.control==='context.updated'){
        if(Number.isFinite(native.profile?.session_create?.session?.audio?.output?.speed)){this.profile.session_create.session.audio.output.speed=native.profile.session_create.session.audio.output.speed;this.speechPace=native.speechPace??this.speechPace;}
        this.onEvent(packet);if(this.native===native&&!this.currentReply&&native.ready)this.state('listening');return;
      }
      const e=packet.event;
      if(e?.type==='user.final'){this.intents.set(e.turn_id,inputIntent(e.payload.text));this.boundInputs();}
      if(e?.type==='response.started')this.currentReply={id:e.response_id,turn:e.turn_id,native:true};
      if(['response.done','response.cancelled'].includes(e?.type)){this.currentReply=null;this.state('listening');}
      this.onEvent(packet);return;
    }
    if(!owner)return;
    const event=packet.event;
    if(!event)return; // Trigger speech controls/exit signals are not learner controls.
    if(purpose==='reply'&&event.type==='user.final'){
      if(normalized(event.payload.text)!==normalized(BRIDGE_TRIGGER))throw Error('WRONG_TRIGGER');
      owner.triggerTurn=event.turn_id;owner.triggerVerified=true;
      for(const held of owner.held??[])this.project(held,owner,control);owner.held=[];return;
    }
    if(!event.type.startsWith('response.'))return;
    if(purpose==='reply'&&!owner.triggerVerified){owner.held??=[];owner.heldBytes=(owner.heldBytes??0)+(packet.audio?.length??0)+JSON.stringify(event).length;if(owner.held.length>=160||owner.heldBytes>2000000)throw Error('TRIGGER_HOLD_LIMIT');owner.held.push(packet);return;}
    this.project(packet,owner,control);
  }
  project(packet,owner,control){
    const e=packet.event;
    if(owner.fixedText&&e.type==='response.text.delta')return;
    if(owner.triggerVerified&&e.turn_id!==owner.triggerTurn)throw Error('FOREIGN_TRIGGER_REPLY');
    if(!owner.nativeReply){if(e.type!=='response.started')throw Error('UNBOUND_BRIDGE_REPLY');owner.nativeReply=e.response_id;owner.responseId=randomUUID();}
    if(e.response_id!==owner.nativeReply)throw Error('MULTIPLE_BRIDGE_REPLIES');
    const event={...e,session_id:this.sessionId,seq:++this.seq,turn_id:owner.turnId,response_id:owner.responseId};
    if(e.type==='response.started'){this.currentReply={id:owner.responseId,turn:owner.turnId,native:false,owner};this.state('responding');}
    const activeNative=this.native;
    if(e.type==='response.done'){owner.done=true;clearInterval(this.pump);clearTimeout(this.replyTimer);activeNative?.mute();this.nativeMuted=true;this.currentReply=null;this.fixedControl=null;}
    this.onEvent({...packet,event,...(control?{speech_control:control}:{}),input_source:'doubao_asr_bridge'});
    if(e.type==='response.started'&&owner.fixedText&&!this.closed)this.emit('response.text.delta',{text:owner.fixedText},{turn_id:owner.turnId,response_id:owner.responseId},{...(control?{speech_control:control}:{}),input_source:'m2_fixed_speech'});
    if(e.type==='response.done'&&!this.closed&&this.native===activeNative&&this.owner===owner)this.state('listening');
  }
  sendAudio(bytes){
    if(this.closed||!this.businessReady)return;
    if(!Buffer.isBuffer(bytes)||bytes.length!==640)throw Error('INVALID_INPUT_AUDIO');
    if(this.mode==='th'){this.segmenter.push(bytes);return;}
    if(this.phase==='switching'||!this.native?.ready)return;
    if(this.nativeMuted){this.native.unmute();this.nativeMuted=false;}
    this.native.sendAudio(bytes);
  }
  speechStarted(frames=[]){
    if(this.closed||this.mode!=='th')return;
    this.cancelPendingInput(false);
    this.capturedTurn=randomUUID();this.asrAbort=new AbortController();
    if(this.asr.start){this.asrStream=this.asr.start({signal:this.asrAbort.signal});this.asrStream.result.catch(()=>{});for(const frame of frames)this.asrStream.write(frame);}
    this.onEvent({control:'user.speech.started',source:'local_thai_vad'});this.state('capturing');
  }
  async transcribe(pcm){
    const token=++this.epoch,turnId=this.capturedTurn??randomUUID();this.capturedTurn=null;const controller=this.asrAbort??new AbortController(),stream=this.asrStream;this.asrAbort=controller;this.asrStream=null;stream?.finish();this.state('recognizing');
    try{
      const result=await(stream?stream.result:this.asr.recognize(pcm,{signal:controller.signal}));if(this.closed||token!==this.epoch||controller.signal.aborted||this.mode!=='th')return;
      if(typeof result.text!=='string'||!result.text.trim()||result.text.length>2000)throw Error('ASR_NO_TEXT');
      const intent=inputIntent(result.text);this.intents.set(turnId,intent);this.boundInputs();this.emit('user.final',{text:result.text},{turn_id:turnId},{input_source:'doubao_asr_final'});
      if(this.closed||token!==this.epoch)return;
      const owner={turnId,text:result.text};this.state('connecting_reply');
      if(intent==='end'||intent==='wake')await this.spawn({purpose:'fixed',owner,fixedText:intent==='end'?BRIDGE_FAREWELL:BRIDGE_WAKE});
      else await this.spawn({purpose:'reply',owner});
    }catch(error){if(this.closed||token!==this.epoch||controller.signal.aborted)return;this.state('listening',error.message==='ASR_PERMISSION_DENIED'?'泰语识别服务未获授权，请检查配置。':'这句泰语未能完成识别或回复，请重说，或切换到中文。');}
    finally{if(this.asrAbort===controller)this.asrAbort=null;}
  }
  boundInputs(){if(this.intents.size>256)this.intents.delete(this.intents.keys().next().value);}
  inputDecision(event,decision){if(this.mode!=='th')return decision;const intent=this.intents.get(event.turn_id);if(intent==='end')return {...decision,action:'CLOSE',reason:'m2_student_end'};if(intent==='continue'||intent==='wake')return {...decision,action:'CHAT',reason:'m2_student_continue'};return decision;}
  observeForwarded(packet){
    if(packet.speech_control)return;const e=packet.type==='event'?packet.event:null;if(!e)return;
    if(e.type==='user.final'){this.inputs.set(e.turn_id,e.payload.text);if(this.inputs.size>256)this.inputs.delete(this.inputs.keys().next().value);}
    if(e.type==='response.started')this.replies.set(e.response_id,{turn:e.turn_id,text:''});
    const reply=this.replies.get(e.response_id);
    if(reply&&e.type==='response.text.delta')reply.text=(reply.text+e.payload.text).slice(0,2000);
    if(reply&&e.type==='response.done'){const text=this.inputs.get(reply.turn);if(text&&reply.text){this.history.push({role:'user',text},{role:'assistant',text:reply.text});this.trimHistory();}this.replies.delete(e.response_id);}
    if(e.type==='response.cancelled')this.replies.delete(e.response_id);
  }
  cancelPendingInput(reset=true){
    ++this.epoch;this.asrAbort?.abort();this.asrAbort=null;this.asrStream=null;if(reset)this.segmenter.reset();
    if(!this.currentReply&&['reply','fixed'].includes(this.nativePurpose)&&!this.owner?.done){++this.nativeEpoch;this.pendingReady?.();this.pendingReady=null;clearInterval(this.pump);clearTimeout(this.replyTimer);void this.native?.close();this.native=null;this.fixedControl=null;}
    if(reset&&!this.currentReply)this.state('listening');
  }
  cancel(id){
    if(this.currentReply?.id!==id)throw Error('UNKNOWN_RESPONSE');
    if(this.currentReply.native)return this.native.cancel(id);
    const reply=this.currentReply;this.currentReply=null;this.owner=null;this.fixedControl=null;++this.nativeEpoch;clearInterval(this.pump);clearTimeout(this.replyTimer);void this.native?.close();this.native=null;
    queueMicrotask(()=>{if(!this.closed){this.emit('response.cancelled',{},{turn_id:reply.turn,response_id:id},{cancellation_scope:'m2_connection_fence'});this.state('listening');}});
    return 'local'; // A local connection fence, never a fabricated wire ACK.
  }
  updateContext(update){if(this.contextMode==='deferred')throw Error('AGENT_CONTEXT_DEFERRED');this.agentInstructions=update.instructions;return this.native.updateContext(update);}
  speakFixedText(text,control){
    if(this.mode==='zh')return this.native.speakFixedText(text,control);
    if(!control||!this.inputs.has(control.turn_id)||this.currentReply||this.fixedControl)throw Error('INVALID_FIXED_CONTROL');
    this.fixedControl=control;void this.spawn({purpose:'fixed',owner:{turnId:control.turn_id,text:''},fixedText:text,control}).catch(()=>this.fail('INPUT_FIXED_FAILED'));
  }
  async setInputMode(mode){
    if(!['zh','th'].includes(mode))throw Error('INVALID_INPUT_MODE');if(mode===this.mode){this.state('listening');return;}
    if(this.currentReply||this.fixedControl)throw Error('INPUT_BUSY');
    this.cancelPendingInput();this.mode=mode;this.state('switching');await this.spawn({purpose:'listen'});
  }
  close(){if(this.closed)return;this.closed=true;++this.epoch;++this.nativeEpoch;this.pendingReady?.();this.pendingReady=null;this.asrAbort?.abort();this.segmenter.close();clearInterval(this.pump);clearTimeout(this.replyTimer);this.history=[];this.inputs.clear();this.replies.clear();this.intents.clear();return this.native?.close();}
}
