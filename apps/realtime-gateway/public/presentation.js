/** Reply-owned phrase captions paced by played PCM, never by network arrival. */
import { safeObserve } from './diagnostics.js';
import { CAPTION_POLICY,captionUnits,takeCaptionPhrase } from './caption-phrases.js';
export class Presentation {
  constructor({render,play,stopAudio,getPlayback=()=>null,onMode,schedule=(callback,ms)=>setTimeout(callback,ms),unschedule=id=>clearTimeout(id),onObserve,now=()=>performance.now()}) {
    Object.assign(this,{render,play,stopAudio,getPlayback,onMode,schedule,unschedule,onObserve,now});
    this.used=new Set();this.current=null;this.visible='';this.pending='';this.timer=null;this.epoch=0;
  }
  begin(id) {
    if(this.used.has(id))return false;
    if(this.used.size>=10000)throw new Error('REPLY_LIMIT');
    this.clear();this.used.add(id);this.current=id;this.accepting=true;
    this.chunks=[];this.raw='';this.revealedUnits=0;this.audioReceived=false;
    this.lastReveal=null;this.pendingAt=null;this.lastPlayback=null;
    this.setMode('waiting_audio');return true;
  }
  setMode(mode) {
    if(mode===this.mode)return;
    this.mode=mode;this.onMode?.(mode,{text_only:!this.audioReceived && !this.accepting,has_text:!!this.visible});
    if(this.current)safeObserve(this.onObserve,'caption.mode',{response_id:this.current,caption_mode:mode,caption_policy_version:CAPTION_POLICY.version});
  }
  owns(id) {
    if(id===this.current && this.accepting)return true;
    safeObserve(this.onObserve,'presentation.dropped',{response_id:id,reason:'ownership'});return false;
  }
  append(id,text) {
    if(!this.owns(id))return false;
    if(typeof text!=='string' || this.visible.length+this.pending.length+text.length>CAPTION_POLICY.max_reply_chars)throw new Error('CAPTION_LIMIT');
    if(!this.raw)this.pendingAt=this.now();
    this.raw+=text;this.pending+=text;this.segment();
    safeObserve(this.onObserve,'caption.received',{response_id:id,chars:[...text].length,pending_chars:[...this.pending].length,caption_interval_ms:CAPTION_POLICY.poll_ms,caption_policy_version:CAPTION_POLICY.version});
    this.tick();return true;
  }
  segment(soft=false) {
    for(;;) {
      const part=takeCaptionPhrase(this.raw,{flush:!this.accepting,soft});if(part===null || !part)return;
      this.chunks.push({text:part,units:captionUnits(part)});this.raw=this.raw.slice(part.length);this.pendingAt=this.raw?this.now():null;
      if(!this.raw)return;
    }
  }
  tick() {
    if(this.timer!==null || !this.current || (!this.pending && this.accepting))return;
    const id=this.current,epoch=this.epoch;
    this.timer=this.schedule(()=> {
      if(epoch!==this.epoch || id!==this.current)return;
      this.timer=null;this.advance();
      if(this.current===id && this.mode!=='complete')this.tick();
    },CAPTION_POLICY.poll_ms);
  }
  advance() {
    const now=this.now();
    if(this.raw && this.pendingAt!==null && now-this.pendingAt>=CAPTION_POLICY.soft_wait_ms)this.segment(true);
    const playback=this.audioReceived?this.getPlayback(this.current):null;
    const running=playback?.running===true;
    const played=Number.isFinite(playback?.played_ms)?Math.max(0,playback.played_ms):0;
    const received=Number.isFinite(playback?.received_ms)?Math.max(0,playback.received_ms):0;
    if(this.audioReceived && !running){this.setMode('paused');return;}
    if(this.audioReceived && played<=0){this.setMode('waiting_audio');return;}
    if(!this.audioReceived && this.accepting){this.setMode('waiting_audio');return;}
    const textOnly=!this.audioReceived && !this.accepting;
    this.setMode(textOnly?'text_only':'playing');
    const phrase=this.chunks[0];
    if(phrase && (this.lastReveal===null || now-this.lastReveal>=CAPTION_POLICY.min_reveal_ms)) {
      const totalUnits=this.chunks.reduce((sum,c)=>sum+c.units,0)+this.revealedUnits;
      const at=!this.accepting && received>0?received*this.revealedUnits/Math.max(1,totalUnits):this.revealedUnits*CAPTION_POLICY.stream_unit_ms;
      if(textOnly || played>=at) {
        this.chunks.shift();this.visible+=phrase.text;this.pending=this.pending.slice(phrase.text.length);this.revealedUnits+=phrase.units;
        this.render(this.visible,{previous:this.visible.slice(0,-phrase.text.length),current:phrase.text,complete:false});this.lastReveal=now;
        const clock=this.audioReceived?{played_pcm_ms:played,received_pcm_ms:received,cue_at_ms:at}:{};
        safeObserve(this.onObserve,'caption.revealed',{response_id:this.current,visible_chars:[...this.visible].length,pending_chars:[...this.pending].length,revealed_chars:[...phrase.text].length,phrase_units:phrase.units,caption_mode:textOnly?'text_only':'playing',caption_policy_version:CAPTION_POLICY.version,...clock});
      }
    }
    const complete=!this.accepting && !this.pending && (textOnly || played>=received) && (this.lastReveal===null || now-this.lastReveal>=CAPTION_POLICY.min_reveal_ms);
    if(this.audioReceived && (complete || this.lastPlayback===null || now-this.lastPlayback>=250)) {
      this.lastPlayback=now;safeObserve(this.onObserve,'caption.playback',{response_id:this.current,played_pcm_ms:played,received_pcm_ms:received,queued_pcm_ms:Math.max(0,received-played),caption_mode:complete?'complete':this.mode,clock_source:playback.clock_source});
    }
    if(complete) {
      this.render(this.visible,{previous:this.visible,current:'',complete:true});this.setMode('complete');
    }
  }
  audio(id,base64,rate) {
    if(!this.owns(id))return false;
    this.play(base64,rate,id);this.audioReceived=true;this.tick();return true;
  }
  done(id) {if(id!==this.current || !this.accepting)return false;this.accepting=false;this.segment();this.tick();return true;}
  stop(id) {if(id===this.current || id===undefined){this.clear();return true;}return false;}
  clear() {
    if(this.current)safeObserve(this.onObserve,'caption.cleared',{response_id:this.current,visible_chars:[...this.visible].length,pending_chars:[...this.pending].length});
    this.epoch++;if(this.timer!==null)this.unschedule(this.timer);this.timer=null;
    this.current=null;this.accepting=false;this.visible='';this.pending='';this.raw='';this.chunks=[];
    this.stopAudio();this.render('',{previous:'',current:'',complete:false});this.setMode('idle');
  }
  reset() {this.clear();this.used.clear();}
}
