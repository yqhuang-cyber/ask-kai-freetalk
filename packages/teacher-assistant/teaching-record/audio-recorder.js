import {randomUUID} from 'node:crypto';
import {AudioCandidateSegmenter} from './audio-segmenter.js';

// Experimental only: candidates are explicitly unverified and must not feed
// pronunciation feedback until speaker/quality/aligner validation exists.
export class AudioRecorder {
  constructor({port,token,attemptId,sessionId}){Object.assign(this,{port,token,attemptId,sessionId});this.streamId=randomUUID();this.segmenter=new AudioCandidateSegmenter();this.queue=[];this.running=null;this.failed=false;this.closed=false;}
  input(frame,audio){if(this.closed)return;if(audio?.encoding!=='pcm_s16le'||audio.input_rate!==16000){this.failed=true;return;}try{for(const candidate of this.segmenter.push(Buffer.from(frame)))this.enqueue(candidate);}catch{this.failed=true;}}
  enqueue(candidate){if(this.queue.length>=10){this.failed=true;return;}this.queue.push(candidate);this.pump();}
  pump(){if(this.running||!this.queue.length)return;const a=this.queue.shift();this.running=this.port.call('audio_append',this.token,{attempt_id:this.attemptId,session_id:this.sessionId,stream_id:this.streamId,sample_start:a.sample_start,sample_end:a.sample_end,pcm_base64:a.pcm.toString('base64')}).catch(()=>{this.failed=true;}).finally(()=>{this.running=null;this.pump();});}
  async seal(){if(this.revoked)return {state:'revoked'};this.closed=true;for(const a of this.segmenter.finish())this.enqueue(a);this.pump();let timedOut=false,timer;const drain=async()=>{while(this.running)await this.running;};await Promise.race([drain(),new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve();},1500);})]);clearTimeout(timer);return this.port.call('audio_seal',this.token,{attempt_id:this.attemptId,session_id:this.sessionId,queue_incomplete:this.failed||timedOut||this.segmenter.droppedSamples>0});}
  stopLocal(){this.closed=true;this.revoked=true;this.queue=[];this.segmenter.finish();}
  discard(){this.closed=true;this.queue=[];this.segmenter.finish();return this.port.call('audio_discard',this.token,{attempt_id:this.attemptId,session_id:this.sessionId});}
}
