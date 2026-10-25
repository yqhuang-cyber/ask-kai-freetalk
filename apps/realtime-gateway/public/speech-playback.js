// Reports only matching rendered captions and drained browser PCM.
export function speechStateMessage(packet){
  const label=({'-40':'更慢','-20':'慢速',0:'正常',20:'较快',40:'更快'})[packet.output_speed]??'当前';
  if(packet.phase==='failed')return `语速调整未完成；上次确认的语速：${label}。`;
  if(['complete','cancelled'].includes(packet.phase))return `本次语速：${label}；可以说“慢一点”“快一点”或“恢复正常”。`;
  return `正在${packet.intent==='slower'?'放慢':packet.intent==='faster'?'加快':'恢复正常'}语速；上次确认：${label}。`;
}
export class SpeechPlayback {
  constructor({presentation,getPlayback,isMuted,send}){Object.assign(this,{presentation,getPlayback,isMuted,send});this.reset();}
  reset(){this.current=null;this.reported=null;}
  update(packet){if(['cancelled','failed','complete'].includes(packet.phase)){this.reset();return;}this.current=packet;this.check();}
  check(){
    const c=this.current,p=this.presentation;
    const phase=c?.phase==='awaiting_before_playback'?'before':c?.phase==='awaiting_after_playback'?'after':null;
    const key=c?`${c.request_id}:${phase}`:null;
    if(!phase||this.reported===key||p.current!==c.response_id||p.mode!=='complete')return false;
    const playback=this.getPlayback(c.response_id);
    if(!playback?.running||playback.queued_ms>0||Math.abs(playback.received_ms-c.audio_ms)>2)return false;
    if(this.send({type:'speech.playback',request_id:c.request_id,response_id:c.response_id,phase,state:this.isMuted()?'muted':'played',audio_ms:playback.received_ms})===false)return false;
    this.reported=key;return true;
  }
}
