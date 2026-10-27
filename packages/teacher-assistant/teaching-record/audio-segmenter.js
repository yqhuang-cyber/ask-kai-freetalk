import {createHash} from 'node:crypto';

// A candidate detector, not a speaker recognizer or a validated voice activity
// detector. Its output is never eligible for pronunciation feedback by itself.
export class AudioCandidateSegmenter {
  constructor({sampleRate=16000,frameSamples=320,threshold=600,startFrames=3,tailFrames=8,maxSegmentFrames=250,maxSegments=120}={}){
    if(sampleRate!==16000||frameSamples!==320||![threshold,startFrames,tailFrames,maxSegmentFrames,maxSegments].every(Number.isSafeInteger)||threshold<1||startFrames<1||tailFrames<1||maxSegmentFrames<startFrames+tailFrames||maxSegments<1)throw new Error('INVALID_AUDIO_SEGMENT_CONFIG');
    Object.assign(this,{sampleRate,frameSamples,threshold,startFrames,tailFrames,maxSegmentFrames,maxSegments});this.position=0;this.pending=[];this.active=null;this.quiet=0;this.count=0;this.droppedSamples=0;this.closed=false;
  }
  push(frame,{playback='unknown'}={}){
    if(this.closed)throw new Error('AUDIO_SEGMENTER_CLOSED');
    if(!Buffer.isBuffer(frame)||frame.length!==this.frameSamples*2||!['active','inactive','unknown'].includes(playback))throw new Error('INVALID_AUDIO_FRAME');
    const start=this.position;this.position+=this.frameSamples;let power=0,clipped=0;
    for(let i=0;i<frame.length;i+=2){const n=frame.readInt16LE(i);power+=n*n;if(Math.abs(n)>=32700)clipped++;}
    const entry={start,pcm:Buffer.from(frame),active:Math.sqrt(power/this.frameSamples)>=this.threshold,clipped,playback};const emitted=[];
    if(!this.active){if(entry.active){this.pending.push(entry);if(this.pending.length>=this.startFrames){this.active=this.pending;this.pending=[];this.quiet=0;}}else this.pending=[];}
    else {this.active.push(entry);this.quiet=entry.active?0:this.quiet+1;if(this.quiet>=this.tailFrames||this.active.length>=this.maxSegmentFrames){const value=this.finishSegment(this.quiet<this.tailFrames?'capacity':'silence');if(value)emitted.push(value);}}
    return emitted;
  }
  finishSegment(reason){if(!this.active)return null;const frames=this.active;this.active=null;this.pending=[];this.quiet=0;const samples=frames.length*this.frameSamples;if(this.count>=this.maxSegments){this.droppedSamples+=samples;return null;}this.count++;
    const pcm=Buffer.concat(frames.map(f=>f.pcm)),clipped=frames.reduce((n,f)=>n+f.clipped,0);return {sample_start:frames[0].start,sample_end:frames.at(-1).start+this.frameSamples,pcm,sha256:createHash('sha256').update(pcm).digest('hex'),speaker:'unknown',turn_id:null,alignment:null,quality:{noise:'unknown',clipping:clipped>0?'detected':'unknown',missing_frames:'unknown',overlap:'unknown'},boundary_reason:reason};
  }
  finish(){if(this.closed)return [];this.closed=true;const result=this.finishSegment('session_end');this.pending=[];return result?[result]:[];}
}
