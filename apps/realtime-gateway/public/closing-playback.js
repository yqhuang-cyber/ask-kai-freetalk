// Browser reports its own output-clock state, never inferred human consumption.
export class ClosingPlayback {
  constructor({presentation,getPlayback,isMuted,send}){Object.assign(this,{presentation,getPlayback,isMuted,send});this.reset();}
  reset(){this.current=null;this.reported=null;}
  update(packet,sessionId){
    if(packet.session_id!==sessionId)return false;
    if(packet.phase==='cancelled'){this.reset();return true;}
    this.current=packet;this.check();return true;
  }
  check(){
    const c=this.current,p=this.presentation;
    if(!c||c.phase!=='awaiting_playback'||this.reported===c.closing_id||p.current!==c.response_id||p.mode!=='complete')return false;
    const playback=this.getPlayback(c.response_id);
    if(playback&&(!playback.running||playback.queued_ms>0))return false;
    const report={type:'closing.playback',closing_id:c.closing_id,response_id:c.response_id,summary_revision:c.summary_revision,state:playback?(this.isMuted()?'muted':'played'):'text_only',audio_ms:playback?.received_ms??0};
    if(this.send(report)===false)return false;this.reported=c.closing_id;return true;
  }
}
