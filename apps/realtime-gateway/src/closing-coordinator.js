import { randomUUID } from 'node:crypto';
// Only forwarded owned output and a matching browser report can finish a close.
export class ClosingCoordinator {
  constructor({sessionId,send,finish,waitMs=12000,playbackMs=35000}){Object.assign(this,{sessionId,send,finish,waitMs,playbackMs});this.replies=new Map();this.current=null;this.delivery='skipped';}
  input(event,decision,summary) {
    if(decision.action!=='CLOSE'){this.cancel();return;}
    this.cancel();this.delivery='incomplete';
    this.current={closing_id:randomUUID(),turn_id:event.turn_id,summary_revision:summary.revision,summary,response_id:null,done:false,audio_ms:0};
    this.publish('preparing_close');
    this.send({type:'teaching.summary.preview',session_id:this.sessionId,closing_id:this.current.closing_id,summary});
    this.timer=setTimeout(()=>this.expire(),this.waitMs);
    const reply=[...this.replies.values()].find(r=>r.turn_id===event.turn_id&&!r.cancelled);if(reply)this.bind(reply);
  }
  publish(phase){if(this.current){this.current.phase=phase;this.send({type:'session.closing',session_id:this.sessionId,closing_id:this.current.closing_id,turn_id:this.current.turn_id,response_id:this.current.response_id,summary_revision:this.current.summary_revision,phase});}}
  bind(reply){const c=this.current;if(!c||c.suspended||reply.turn_id!==c.turn_id||reply.cancelled)return;c.response_id=reply.id;c.audio_ms=reply.audio_ms;c.done=reply.done;if(c.done&&c.phase!=='awaiting_playback'){clearTimeout(this.timer);this.timer=setTimeout(()=>this.expire(),this.playbackMs);this.publish('awaiting_playback');}else if(!c.done&&c.phase!=='presenting_close'){clearTimeout(this.timer);this.timer=setTimeout(()=>this.expire(),45000);this.publish('presenting_close');}}
  forward(packet) {
    const e=packet.type==='event'?packet.event:null;if(!e||e.session_id!==this.sessionId)return;
    if(e.type==='response.started'){if(this.replies.size>=64)this.replies.delete(this.replies.keys().next().value);this.replies.set(e.response_id,{id:e.response_id,turn_id:e.turn_id,audio_ms:0,done:false,cancelled:false});}
    const r=this.replies.get(e.response_id);if(!r||r.turn_id!==e.turn_id)return;
    if(e.type==='response.audio.chunk')r.audio_ms+=e.payload.byte_length/(packet.sample_rate??24000)/2*1000;
    if(e.type==='response.done')r.done=true;
    if(e.type==='response.cancelled')r.cancelled=true;
    if(this.current?.turn_id===r.turn_id){if(r.cancelled){this.cancel();return;}this.bind(r);}
  }
  report(v) {
    const c=this.current;
    if(!c||c.phase!=='awaiting_playback'||c.suspended||!c.done||v.closing_id!==c.closing_id||v.response_id!==c.response_id||v.summary_revision!==c.summary_revision||!['played','text_only','muted'].includes(v.state)||!Number.isFinite(v.audio_ms)||v.audio_ms<0||Math.abs(v.audio_ms-c.audio_ms)>2||v.state==='text_only'&&c.audio_ms>0||v.state==='played'&&c.audio_ms===0)return false;
    this.delivery=v.state==='played'?'advisory_played':v.state==='text_only'?'text_only':'skipped';clearTimeout(this.timer);this.publish('finalizing_record');this.finish();return true;
  }
  expire(){if(!this.current)return;this.delivery='incomplete';this.publish('finalizing_record');this.finish();}
  suspend(){if(!this.current||this.current.suspended)return;this.current.suspended=true;clearTimeout(this.timer);this.timer=setTimeout(()=>this.expire(),this.waitMs);this.publish('interrupted');}
  cancel(){clearTimeout(this.timer);if(this.current)this.publish('cancelled');this.current=null;this.delivery='skipped';}
  close(){clearTimeout(this.timer);this.current=null;this.replies.clear();}
}
