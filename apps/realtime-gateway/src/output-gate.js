// Local presentation policy, not supplier VAD or a claim about real silence.
// Only accepted, owner-bound packets enter this bounded, ephemeral buffer.
export class TurnOutputGate {
  constructor({send,fail,observe=()=>{},now=()=>performance.now(),schedule=setTimeout,unschedule=clearTimeout,graceMs=350,maxWaitMs=5000,maxBytes=262144,maxPackets=256}) {
    Object.assign(this,{send,fail,observe,now,schedule,unschedule,graceMs,maxWaitMs,maxBytes,maxPackets});
    this.observe=(name,fields)=>{try{observe(name,fields);}catch{/* Observation never controls presentation. */}};
    this.turns=new Map();this.held=null;this.closed=false;
  }
  candidate(id) {
    if(this.closed || this.turns.has(id))return;
    if(this.turns.size>=1000)return this.abort('TURN_LIMIT');
    this.turns.set(id,{final:false});
  }
  user(event) {
    if(this.closed)return;
    this.candidate(event.turn_id);
    const turn=this.turns.get(event.turn_id);if(!turn || turn.final)return;
    if(event.type==='user.final') {
      turn.final=true;turn.at=this.now();
      if(this.held?.turn===event.turn_id)this.armRelease();
    }
  }
  push(packet) {
    if(this.closed)return;
    const event=packet.event;
    if(event.type==='response.started') {
      if(this.held)this.stop(this.held.id,'replaced');
      const turn=this.turns.get(event.turn_id);
      if(turn && (!turn.final || this.now()-turn.at<this.graceMs)) {
        const held={id:event.response_id,turn:event.turn_id,at:this.now(),packets:[],bytes:0};
        this.held=held;
        this.observe('response.held',{response_id:held.id,turn_id:held.turn,grace_ms:this.graceMs,final_received:turn.final});
        held.deadline=this.schedule(()=>{if(this.held===held)this.abort('TURN_FINAL_TIMEOUT');},this.maxWaitMs);
        if(turn.final)this.armRelease();
      }
    }
    const held=this.held;
    if(!held || held.id!==event.response_id)return this.send(packet);
    const bytes=Buffer.byteLength(JSON.stringify(packet));
    if(held.packets.length>=this.maxPackets || held.bytes+bytes>this.maxBytes)return this.abort('OUTPUT_HOLD_LIMIT');
    held.bytes+=bytes;held.packets.push(packet);
  }
  armRelease() {
    const held=this.held;if(!held)return;
    const turn=this.turns.get(held.turn);if(!turn?.final)return;
    this.unschedule(held.deadline);held.deadline=undefined;
    if(held.release!==undefined)this.unschedule(held.release);
    held.release=this.schedule(()=> {
      if(this.closed || this.held!==held)return;
      this.held=null;this.unschedule(held.deadline);
      this.observe('response.released',{response_id:held.id,turn_id:held.turn,held_ms:this.now()-held.at});
      for(const packet of held.packets){if(this.closed)break;this.send(packet);}
      held.packets.length=0;
    },Math.max(0,this.graceMs-(this.now()-turn.at)));
  }
  stop(id,reason='stopped') {
    const held=this.held;if(!held || held.id!==id)return;
    this.held=null;this.unschedule(held.deadline);if(held.release!==undefined)this.unschedule(held.release);
    this.observe('response.hold.discarded',{response_id:id,turn_id:held.turn,held_ms:this.now()-held.at,reason});
    held.packets.length=0;
  }
  close() {if(this.held)this.stop(this.held.id);this.closed=true;this.turns.clear();}
  abort(code) {this.close();this.fail(code);}
}
