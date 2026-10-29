import {randomUUID} from 'node:crypto';
export class FakeHistoryNative {
  constructor(options){this.options=options;this.profile=structuredClone(options.profile);this.frames=[];this.updates=[];this.seq=0;}
  open({sessionId,instructions,onEvent,onFailure}){Object.assign(this,{sessionId,instructions,onEvent,onFailure});queueMicrotask(()=>{if(this.closed)return;this.ready=true;this.emit('session.ready');});}
  emit(type,payload={},ids={},extra={}){this.onEvent({event:{version:1,event_id:randomUUID(),session_id:this.sessionId,seq:++this.seq,at_ms:0,type,...ids,payload},...extra});}
  verifyHistory(){return this.historyFailure&&this.options.history?.length?Promise.reject(Error('WRONG_HISTORY')):Promise.resolve(true);}
  mute(){this.muted=true;}
  unmute(){this.muted=false;}
  sendAudio(pcm){this.frames.push(Buffer.from(pcm));this.onAudio?.(pcm);}
  updateContext(update){this.updates.push(update);queueMicrotask(()=>this.onEvent({control:'context.updated',version:update.version}));}
  cancel(responseId){queueMicrotask(()=>this.emit('response.cancelled',{}, {turn_id:this.replyTurn,response_id:responseId}));return 'sent';}
  speakFixedText(text){this.spoken=text;this.onSpeak?.(text);}
  close(){this.closed=true;this.ready=false;return Promise.resolve({acknowledged:true});}
  response(text,{turn='native-trigger',response=randomUUID(),complete=true}={}){
    this.replyTurn=turn;this.replyId=response;
    this.emit('response.started',{}, {turn_id:turn,response_id:response});
    this.emit('response.text.delta',{text},{turn_id:turn,response_id:response});
    const pcm=Buffer.alloc(9600);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(Math.round(Math.sin(i/2*0.1)*1400),i);
    this.emit('response.audio.chunk',{byte_length:pcm.length,format:'pcm_s16le'},{turn_id:turn,response_id:response},{audio:pcm.toString('base64'),sample_rate:24000});
    if(complete)this.emit('response.done',{}, {turn_id:turn,response_id:response});
    return {turn,response};
  }
}
export const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
export const voiceFrame=()=>{const b=Buffer.alloc(640);for(let i=0;i<640;i+=2)b.writeInt16LE(Math.round(Math.sin(i*0.08)*2200),i);return b;};
