import {randomUUID} from 'node:crypto';
// Session-only absolute settings with exact Web receipts. Voice acknowledgements
// use the existing fixed-speech lane and actual accepted input provenance.
export class CaptionSettings {
  constructor({sessionId,send,speak,available,settled,onApplied,voiceSupported=false,english=()=>false,confirmation,ackMs=3000}){
    Object.assign(this,{sessionId,send,speak,available,settled,onApplied,voiceSupported,english,confirmation,ackMs});
    this.enabled=true;this.revision=0;this.turns=new Set();this.current=null;this.closed=false;
  }
  snapshot(){return {session_id:this.sessionId,pinyin_enabled:this.enabled,revision:this.revision,voice_supported:this.voiceSupported};}
  blocksContext(){return !!this.current?.voice&&!['complete','failed','cancelled'].includes(this.current.phase);}
  suppresses(turn){return this.turns.has(turn);}
  input(event,request){this.cancelVoice();if(!request||!this.voiceSupported||this.closed)return;this.turns.add(event.turn_id);this.set(request.enabled,{id:event.event_id,turn_id:event.turn_id,voice:true});}
  set(enabled,{id=randomUUID(),turn_id=null,voice=false}={}){
    if(this.closed||typeof enabled!=='boolean'||this.revision>=1000)return false;
    this.cancelVoice();clearTimeout(this.timer);
    const c=this.current={id,turn_id,voice,target:enabled,revision:++this.revision,phase:'waiting_ack',response_id:null,audio_ms:0};
    this.send({type:'caption.settings',...this.snapshot(),revision:c.revision,request_id:c.id,pinyin_enabled:enabled});this.publish();this.arm(this.ackMs);return true;
  }
  publish(){const c=this.current;if(c)this.send({type:'caption.state',...this.snapshot(),request_id:c.id,turn_id:c.turn_id,requested_pinyin:c.target,phase:c.phase,response_id:c.response_id,audio_ms:c.audio_ms});}
  arm(ms){clearTimeout(this.timer);this.timer=setTimeout(()=>this.failed(),ms);}
  failed(){if(this.closed||!this.current)return;this.current.phase='failed';this.current.voice=false;this.publish();this.current=null;clearTimeout(this.timer);}
  acknowledge(value){
    const c=this.current;
    if(this.closed||!c||c.phase!=='waiting_ack'||value.session_id!==this.sessionId||value.request_id!==c.id||value.revision!==c.revision||value.pinyin_enabled!==c.target||!['applied','unavailable'].includes(value.status))return false;
    clearTimeout(this.timer);if(value.status!=='applied'){this.failed();return true;}
    this.enabled=c.target;this.onApplied(this.enabled);c.phase=c.voice?'ready_after':'complete';this.publish();
    if(c.voice){this.arm(12000);this.advance();}else this.current=null;return true;
  }
  advance(){
    const c=this.current;
    if(this.closed||!c||!c.voice||c.phase!=='ready_after'||!(c.original_settled||this.settled(c.turn_id))||!this.available())return;
    c.phase='speaking_after';this.publish();this.arm(30000);
    const zh=c.target?'好的，已打开字幕拼音。':'好的，已关闭字幕拼音，中文会继续显示。';
    const text=this.confirmation?.(c.target)??zh+(this.english()?(c.target?' Pinyin is now shown.':' Pinyin is hidden; Chinese captions stay on.'):'');
    try{this.speak(text,{turn_id:c.turn_id,request_id:c.id,phase:'after'});}catch{this.failed();}
  }
  settle(turn){if(this.current?.turn_id===turn)this.current.original_settled=true;}
  owns(packet){const c=this.current;return !!c&&c.voice&&c.phase==='speaking_after'&&packet.speech_control?.request_id===c.id&&packet.speech_control.phase==='after'&&packet.event?.turn_id===c.turn_id;}
  forward(packet){
    if(!this.owns(packet))return false;const c=this.current,e=packet.event;
    if(e.type==='response.started'){if(c.response_id)return false;c.response_id=e.response_id;this.publish();}
    if(e.response_id!==c.response_id)return false;
    if(e.type==='response.audio.chunk')c.audio_ms+=e.payload.byte_length/(packet.sample_rate??24000)/2*1000;
    if(e.type==='response.done'){if(!c.audio_ms){this.failed();return false;}c.phase='awaiting_after_playback';this.publish();this.arm(35000);}
    if(e.type==='response.cancelled')this.cancelVoice();return true;
  }
  report(value){const c=this.current;if(!c||c.phase!=='awaiting_after_playback'||value.request_id!==c.id||value.response_id!==c.response_id||value.phase!=='after'||!['played','muted'].includes(value.state)||!Number.isFinite(value.audio_ms)||Math.abs(value.audio_ms-c.audio_ms)>2)return false;clearTimeout(this.timer);c.phase='complete';this.publish();this.current=null;return true;}
  cancelVoice(){const c=this.current;if(!c?.voice)return;c.voice=false;if(c.phase==='waiting_ack')return;clearTimeout(this.timer);c.phase='cancelled';this.publish();this.current=null;}
  close(){this.closed=true;clearTimeout(this.timer);this.current=null;this.turns.clear();}
}
