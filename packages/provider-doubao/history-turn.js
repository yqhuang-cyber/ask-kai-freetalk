import {randomUUID} from 'node:crypto';
import {SeeduplexProvider} from './seeduplex.js';

// Explicit Thai-entry opt-in to the initial history route verified in real probes.
// Base profiles remain unchanged; ordinary Chinese/English callers do not use it.
export class HistoryTurnProvider extends SeeduplexProvider {
  constructor({history=[],...options}){
    if(!Array.isArray(history)||history.length%2||history.length>40||history.some((entry,i)=>entry?.role!==(i%2?'assistant':'user')||typeof entry.text!=='string'||!entry.text.length||entry.text.length>2000)||JSON.stringify(history).length>28000)throw Error('INVALID_TURN_HISTORY');
    super(options);this.initialHistory=structuredClone(history);
    if(history.length)this.profile.session_create.extension.dialog.dialog_context=structuredClone(history);
  }
  unmute(){if(!this.ready||this.closed)throw Error('PROVIDER_NOT_OPEN');this.send({type:'input_audio_unmute.commit',event_id:randomUUID()});}
  verifyHistory(){
    if(!this.initialHistory.length)return Promise.resolve(true);
    if(this.historyPending||!this.ready||this.closed)return Promise.reject(Error('HISTORY_NOT_READY'));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.historyPending=null;reject(Error('HISTORY_ACK_TIMEOUT'));},4000);
      this.historyPending={resolve:()=>{clearTimeout(timer);this.historyPending=null;resolve(true);},reject:()=>{clearTimeout(timer);this.historyPending=null;reject(Error('HISTORY_READBACK_MISMATCH'));}};
      this.send({type:'conversation.item.retrieve',event_id:randomUUID(),items:[]});
    });
  }
  receive(raw){
    if(raw?.type==='conversation.item.retrieved'){
      const pending=this.historyPending;if(!pending)return;
      const items=raw.items;
      const matched=Array.isArray(items)&&items.length===this.initialHistory.length&&this.initialHistory.every((entry,i)=>items[i]?.role===entry.role&&Array.isArray(items[i]?.content)&&items[i].content.some(part=>part?.text===entry.text));
      if(matched)pending.resolve();else pending.reject();return;
    }
    return super.receive(raw);
  }
  close(){this.historyPending?.reject();return super.close();}
}
