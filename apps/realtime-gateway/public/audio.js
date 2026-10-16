// Internal Web audio contract: mono PCM s16le, 20ms frames. Provider rates are reviewed server-side.
import { safeObserve } from './diagnostics.js';
// A streamed reply can arrive faster than playback, especially at slow speed.
// Bound queued PCM to 30 seconds (~1.44 MB at 24 kHz), independently of
// per-packet/node limits. This is a local resource bound, not provider pacing.
export const MAX_PLAYBACK_QUEUE_SECONDS=30;
// Prefer the estimated output-device position; fallback is the rendering clock,
// not a measurement of what the learner heard. Never advance it with wall time
// while the context is suspended/interrupted.
export function outputClock(context,nowMs=performance.now()) {
  const current=Number.isFinite(context?.currentTime)?context.currentTime:0;
  if(context?.state==='running' && typeof context.getOutputTimestamp==='function') {
    try {
      const stamp=context.getOutputTimestamp(),age=nowMs-stamp.performanceTime;
      if(Number.isFinite(stamp.contextTime) && stamp.contextTime>0 && Number.isFinite(age) && age>=0 && age<1000) {
        return {seconds:Math.min(current,stamp.contextTime+age/1000),source:'output_timestamp'};
      }
    }catch{/* Some devices do not expose a usable output timestamp. */}
  }
  return {seconds:current,source:'context_time'};
}
export class PCMResampler {
  constructor(sourceRate,targetRate) {this.ratio=sourceRate/targetRate;this.position=0;this.pending=[];}
  push(input) {
    this.pending.push(...input);
    const output=[];
    while (this.position+1 < this.pending.length) {
      const index=Math.floor(this.position),fraction=this.position-index;
      const value=this.pending[index]*(1-fraction)+this.pending[index+1]*fraction;
      output.push(Math.round(Math.max(-1,Math.min(1,value))*(value<0 ? 32768:32767)));
      this.position+=this.ratio;
    }
    const consumed=Math.floor(this.position);
    this.pending.splice(0,consumed);this.position-=consumed;
    const bytes=new Uint8Array(output.length*2),view=new DataView(bytes.buffer);
    output.forEach((value,index)=>view.setInt16(index*2,value,true));
    return bytes;
  }
}
export class AudioIO {
  constructor({onFrame,onFailure,onObserve}) {this.onFrame=onFrame;this.onFailure=onFailure;this.onObserve=onObserve;this.sources=new Set();this.generation=0;this.playbackEpoch=0;this.pending=new Uint8Array(0);this.queuedStats=new Map();}
  async prepare() {
    if (!window.isSecureContext) throw new Error('MICROPHONE_REQUIRES_SECURE_CONTEXT');
    this.context=new AudioContext();this.gain=this.context.createGain();this.gain.connect(this.context.destination);
    await this.context.resume();
  }
  async start(audio) {
    const generation=this.generation;
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    if (generation!==this.generation) {stream.getTracks().forEach(t=>t.stop());return;}
    this.stream=stream;
    const settings=stream.getAudioTracks()[0].getSettings();
    safeObserve(this.onObserve,'audio.capture.started',{input_rate:audio.input_rate,echo_cancellation:settings.echoCancellation,noise_suppression:settings.noiseSuppression,auto_gain_control:settings.autoGainControl});
    this.captureFrames=0;this.captureObservedAt=performance.now();
    stream.getAudioTracks()[0].addEventListener('ended',()=>this.onFailure('麦克风已断开，请重新开始。'));
    this.resampler=new PCMResampler(this.context.sampleRate,audio.input_rate);this.frameSize=audio.input_rate*2/50;
    await this.context.audioWorklet.addModule('/capture-worklet.js');
    if (generation!==this.generation) return;
    this.input=this.context.createMediaStreamSource(stream);
    this.capture=new AudioWorkletNode(this.context,'kai-capture');
    this.silent=this.context.createGain();this.silent.gain.value=0;
    this.capture.connect(this.silent).connect(this.context.destination);this.input.connect(this.capture);
    this.capture.port.onmessage=event => {
      if (generation!==this.generation) return;
      const bytes=this.resampler.push(event.data);
      const combined=new Uint8Array(this.pending.length+bytes.length);combined.set(this.pending);combined.set(bytes,this.pending.length);
      let offset=0;
      while(offset+this.frameSize<=combined.length) {this.onFrame(combined.slice(offset,offset+this.frameSize));this.captureFrames++;offset+=this.frameSize;}
      this.pending=combined.slice(offset);
      if(performance.now()-this.captureObservedAt>=1000){safeObserve(this.onObserve,'audio.capture.progress',{frames:this.captureFrames,input_rate:audio.input_rate});this.captureObservedAt=performance.now();}
    };
    await this.context.resume();
  }
  play(base64,rate,responseId) {
    const raw=atob(base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    if (!bytes.length || bytes.length%2 || bytes.length>65536) throw new Error('INVALID_AUDIO');
    const buffer=this.context.createBuffer(1,bytes.length/2,rate),channel=buffer.getChannelData(0),view=new DataView(bytes.buffer);
    for(let i=0;i<channel.length;i++)channel[i]=view.getInt16(i*2,true)/32768;
    const at=Math.max(this.context.currentTime+0.03,this.nextAt ?? 0);
    if(at+buffer.duration-this.context.currentTime>MAX_PLAYBACK_QUEUE_SECONDS)throw new Error('PLAYBACK_BACKLOG');
    const stats=this.queuedStats.get(responseId)??{duration:0,finished:0,played:0,spans:[],observedAt:null};
    // Bound live nodes and metadata even for unexpectedly tiny audio chunks.
    this.playback(responseId);
    if(this.sources.size>=1024 || stats.spans.length>=1024 || this.queuedStats.size>=32 && !this.queuedStats.has(responseId))throw new Error('PLAYBACK_LIMIT');
    const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.gain);this.sources.add(source);
    const epoch=this.playbackEpoch;
    source.onended=()=>{if(epoch===this.playbackEpoch && this.sources.delete(source) && !this.sources.size)safeObserve(this.onObserve,'audio.drained',{response_id:responseId,scheduled_ms:this.context?.currentTime*1000});};source.start(at);this.nextAt=at+buffer.duration;
    stats.duration+=buffer.duration*1000;stats.spans.push({start:at,end:this.nextAt,duration:buffer.duration*1000});this.queuedStats.set(responseId,stats);
    if(stats.observedAt===null || performance.now()-stats.observedAt>=250) {
      stats.observedAt=performance.now();safeObserve(this.onObserve,'audio.queued',{response_id:responseId,queue_ms:(this.nextAt-this.context.currentTime)*1000,scheduled_ms:at*1000,duration_ms:stats.duration,output_rate:rate,sources:this.sources.size});
    }
  }
  playback(responseId) {
    const stats=this.queuedStats.get(responseId);if(!stats || !this.context)return null;
    const clock=outputClock(this.context),seconds=clock.seconds;
    while(stats.spans.length && stats.spans[0].end<=seconds)stats.finished+=stats.spans.shift().duration;
    const partial=stats.spans.reduce((sum,span)=>sum+Math.min(span.duration,Math.max(0,(seconds-span.start)*1000)),0);
    stats.played=Math.min(stats.duration,Math.max(stats.played,stats.finished+partial));
    return {played_ms:stats.played,received_ms:stats.duration,queued_ms:Math.max(0,stats.duration-stats.played),running:this.context.state==='running',clock_source:clock.source};
  }
  mute(value) {if(this.gain)this.gain.gain.value=value?0:1;safeObserve(this.onObserve,'audio.muted',{muted:value});}
  drain(maxMs=8000) {const started=performance.now();return new Promise(resolve=>{const tick=()=>{if(!this.sources.size||performance.now()-started>=maxMs)resolve();else setTimeout(tick,40);};tick();});}
  stopPlayback() {this.playbackEpoch++;if(this.sources.size)safeObserve(this.onObserve,'audio.stopped',{sources:this.sources.size,queue_ms:Math.max(0,(this.nextAt-(this.context?.currentTime??0))*1000)});for(const source of this.sources){try{source.stop();}catch{}}this.sources.clear();this.queuedStats.clear();this.nextAt=0;}
  stopCapture(){this.generation++;this.capture?.disconnect();this.input?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.pending=new Uint8Array(0);}
  async close() {
    this.stopCapture();this.stopPlayback();
    this.pending=new Uint8Array(0);const context=this.context;this.context=null;if(context && context.state!=='closed')await context.close();
  }
}
