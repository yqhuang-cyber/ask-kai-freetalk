import {speechConfirmation} from '../../../packages/agent-core/speech.js';

// A control transaction, not a teaching turn. Both utterances retain the source
// learner turn and request ID. Playback confirmation never implies understanding.
export class SpeechPaceCoordinator {
  constructor({sessionId,teaching,send,speak,available,settled,apply,fail,waitMs=12000,playbackMs=35000}) {
    Object.assign(this,{sessionId,teaching,send,speak,available,settled,apply,fail,waitMs,playbackMs});
    this.turns=new Set();this.current=null;this.closed=false;
  }
  input(event,request) {
    this.cancel();
    if(!request||this.closed)return;
    if(this.turns.size>=1000)return this.expire('SPEECH_CONTROL_LIMIT');
    this.turns.add(event.turn_id);
    this.current={...request,phase:'waiting_reply',response_id:null,audio_ms:0,english:this.teaching.languageSnapshot().english_support==='required'};
    this.publish();this.arm(this.waitMs);this.advance();
  }
  publish(){const c=this.current;if(c)this.send({type:'speech.state',session_id:this.sessionId,request_id:c.id,turn_id:c.turn_id,phase:c.phase,intent:c.intent,requested_speed:c.target,output_speed:this.teaching.speech.applied,response_id:c.response_id,audio_ms:c.audio_ms});}
  arm(ms){clearTimeout(this.timer);this.timer=setTimeout(()=>this.expire('SPEECH_CONTROL_TIMEOUT'),ms);}
  expire(code){if(this.closed)return;if(this.current){this.current.phase='failed';this.publish();}this.fail(code);}
  blocksContext(){return !!this.current&&!['updating','complete'].includes(this.current.phase);}
  suppresses(turn){return this.turns.has(turn);}
  advance() {
    const c=this.current;if(this.closed||!c||!this.available())return;
    let phase;
    if(c.phase==='waiting_reply'&&(c.original_settled||this.settled(c.turn_id)))phase='before';
    if(c.phase==='ready_after')phase='after';
    if(!phase)return;
    c.phase=`speaking_${phase}`;c.response_id=null;c.audio_ms=0;this.publish();this.arm(30000);
    try{this.speak(speechConfirmation(c,phase,{english:c.english}),{turn_id:c.turn_id,request_id:c.id,phase});}
    catch{this.expire('SPEECH_CONTROL_FAILED');}
  }
  settle(turn){if(this.current?.turn_id===turn)this.current.original_settled=true;}
  owns(packet){const c=this.current,m=packet.speech_control;return !!c&&m?.request_id===c.id&&packet.event?.turn_id===c.turn_id&&c.phase===`speaking_${m.phase}`;}
  forward(packet) {
    if(!this.owns(packet))return false;
    const c=this.current,e=packet.event;
    if(e.type==='response.started'){if(c.response_id)return false;c.response_id=e.response_id;this.publish();}
    if(e.response_id!==c.response_id)return false;
    if(e.type==='response.audio.chunk')c.audio_ms+=e.payload.byte_length/(packet.sample_rate??24000)/2*1000;
    if(e.type==='response.done'){
      if(!c.audio_ms){this.expire('SPEECH_CONTROL_FAILED');return false;}
      c.phase=`awaiting_${packet.speech_control.phase}_playback`;this.publish();this.arm(this.playbackMs);
    }
    if(e.type==='response.cancelled')this.cancel();
    return true;
  }
  report(value) {
    const c=this.current;
    if(!c||!['before','after'].includes(value.phase)||c.phase!==`awaiting_${value.phase}_playback`||value.request_id!==c.id||value.response_id!==c.response_id||!['played','muted'].includes(value.state)||!Number.isFinite(value.audio_ms)||Math.abs(value.audio_ms-c.audio_ms)>2)return false;
    clearTimeout(this.timer);
    if(value.phase==='after'||!c.changed){c.phase='complete';this.publish();return true;}
    c.phase='updating';this.publish();this.arm(this.waitMs);
    if(!this.teaching.releaseSpeechRequest(c.id)){this.cancel();return false;}
    this.apply();return true;
  }
  confirmed(snapshot) {
    const c=this.current;
    if(c?.phase==='updating'&&snapshot?.speech?.request_id===c.id&&snapshot.speech.speed===c.target){c.phase='ready_after';this.publish();this.arm(this.waitMs);this.advance();}
  }
  cancel() {
    clearTimeout(this.timer);
    if(this.current){const id=this.current.id;this.current.phase='cancelled';this.publish();this.teaching.speech.abandon(id);}
    this.current=null;
  }
  close(){this.closed=true;clearTimeout(this.timer);this.current=null;this.turns.clear();}
}
