import {createHash} from 'node:crypto';

// A candidate detector, not a speaker recognizer or a validated voice activity
// detector. Its output is never eligible for pronunciation feedback by itself.
export class AudioCandidateSegmenter {
  constructor({sampleRate=16000,frameSamples=320,threshold=600,startFrames=3,tailFrames=8,maxSegmentFrames=250,maxSegments=120,preRollFrames=0}={}){
    if(sampleRate!==16000||frameSamples!==320||![threshold,startFrames,tailFrames,maxSegmentFrames,maxSegments].every(Number.isSafeInteger)||threshold<1||startFrames<1||tailFrames<1||maxSegmentFrames<startFrames+tailFrames||maxSegments<1)throw new Error('INVALID_AUDIO_SEGMENT_CONFIG');
    if(!Number.isInteger(preRollFrames)||preRollFrames<0||preRollFrames>20)throw new Error('INVALID_AUDIO_SEGMENT_CONFIG');
    Object.assign(this,{sampleRate,frameSamples,threshold,startFrames,tailFrames,maxSegmentFrames,maxSegments,preRollFrames});this.position=0;this.pending=[];this.preRoll=[];this.lastEnd=0;this.active=null;this.quiet=0;this.count=0;this.droppedSamples=0;this.closed=false;
  }
  push(frame,{playback='unknown',capture=null}={}){
    if(this.closed)throw new Error('AUDIO_SEGMENTER_CLOSED');
    if(!Buffer.isBuffer(frame)||frame.length!==this.frameSamples*2||!['active','inactive','unknown'].includes(playback))throw new Error('INVALID_AUDIO_FRAME');
    const emitted=[];let captureGap=false;
    if(capture){if(!Number.isSafeInteger(capture.sample_start)||capture.sample_start<this.position||capture.sample_start>16000*600)throw new Error('INVALID_AUDIO_CLOCK');if(capture.sample_start!==this.position){captureGap=true;const old=this.finishSegment('capture_gap');if(old)emitted.push(old);this.preRoll=[];}this.position=capture.sample_start;}
    const start=this.position;this.position+=this.frameSamples;let power=0,clipped=0;
    for(let i=0;i<frame.length;i+=2){const n=frame.readInt16LE(i);power+=n*n;if(Math.abs(n)>=32700)clipped++;}
    if(this.preRollFrames&&this.active&&playback==='active'&&this.quiet>=3){const done=this.finishSegment('silence');if(done)emitted.push(done);this.preRoll=[];}
    const entry={start,pcm:Buffer.from(frame),active:Math.sqrt(power/this.frameSamples)>=this.threshold,clipped,playback,capture:capture?{...capture,gap:captureGap}:null};
    if(!this.active){if(entry.active){this.pending.push(entry);if(this.pending.length>=this.startFrames){const lastPlayback=this.preRoll.findLastIndex(f=>f.playback==='active');this.active=[...this.preRoll.slice(lastPlayback+1).filter(f=>f.start>=this.lastEnd),...this.pending];this.preRoll=[];this.pending=[];this.quiet=0;}}else{this.preRoll.push(...this.pending,entry);this.pending=[];this.preRoll=this.preRollFrames?this.preRoll.slice(-this.preRollFrames):[];}}
    else {this.active.push(entry);this.quiet=entry.active?0:this.quiet+1;if(this.quiet>=this.tailFrames||this.active.length>=this.maxSegmentFrames){const value=this.finishSegment(this.quiet<this.tailFrames?'capacity':'silence');if(value)emitted.push(value);}}
    return emitted;
  }
  finishSegment(reason){if(!this.active)return null;const frames=this.active;this.active=null;this.pending=[];this.quiet=0;const samples=frames.length*this.frameSamples;if(this.count>=this.maxSegments){this.droppedSamples+=samples;return null;}this.count++;
    const pcm=Buffer.concat(frames.map(f=>f.pcm)),clipped=frames.reduce((n,f)=>n+f.clipped,0),sample_end=frames.at(-1).start+this.frameSamples;this.lastEnd=sample_end;
    const capture=frames.every(f=>f.capture)?{protocol:'homework-mic-v1',frames:frames.length,aec:frames.every(f=>f.capture.aec===true),playback_overlap:frames.some(f=>f.playback==='active'),playback_known:frames.every(f=>f.playback!=='unknown'),continuous:reason!=='capture_gap'&&frames.every((f,i)=>!i||f.start===frames[i-1].start+this.frameSamples)&&frames.every(f=>!f.capture.gap)}:null;
    return {sample_start:frames[0].start,sample_end,pcm,sha256:createHash('sha256').update(pcm).digest('hex'),speaker:'unknown',turn_id:null,alignment:null,quality:{noise:'unknown',clipping:clipped>0?'detected':'unknown',missing_frames:'unknown',overlap:'unknown'},boundary_reason:reason,...(capture?{capture}:{})};
  }
  finish(){if(this.closed)return [];this.closed=true;const result=this.finishSegment('session_end');this.pending=[];return result?[result]:[];}
}
