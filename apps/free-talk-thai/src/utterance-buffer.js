// Acoustic segmentation only: it never claims to recognize language or words.
export class UtteranceBuffer {
  constructor({onStart,onFrame,onSegment,onTooLong,minVoicedFrames=9,silenceFrames=35,maxFrames=650}={}){
    Object.assign(this,{onStart,onFrame,onSegment,onTooLong,minVoicedFrames,silenceFrames,maxFrames});this.reset();
  }
  reset(){clearTimeout(this.timer);this.frames=[];this.pre=[];this.voiced=0;this.silent=0;this.active=false;}
  push(bytes){
    if(!Buffer.isBuffer(bytes)||bytes.length!==640)throw Error('INVALID_INPUT_AUDIO');
    let sum=0,peak=0;for(let i=0;i<bytes.length;i+=2){const n=bytes.readInt16LE(i);sum+=n*n;peak=Math.max(peak,Math.abs(n));}
    const voiced=Math.sqrt(sum/320)>550&&peak>1100;
    if(!this.active){
      this.pre.push(Buffer.from(bytes));if(this.pre.length>15)this.pre.shift();
      this.voiced=voiced?this.voiced+1:0;
      if(this.voiced<this.minVoicedFrames)return;
      this.active=true;this.frames=this.pre;this.pre=[];this.silent=0;this.onStart?.(this.frames);
    }else{this.frames.push(Buffer.from(bytes));this.onFrame?.(bytes);}
    this.silent=voiced?0:this.silent+1;
    if(this.frames.length>=this.maxFrames){this.reset();this.onTooLong?.();return;}
    clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),900);
    if(this.silent>=this.silenceFrames)this.flush();
  }
  flush(){if(!this.active)return;const frames=this.frames.slice(0,Math.max(1,this.frames.length-Math.max(0,this.silent-5)));this.reset();this.onSegment?.(Buffer.concat(frames));}
  close(){this.reset();}
}
