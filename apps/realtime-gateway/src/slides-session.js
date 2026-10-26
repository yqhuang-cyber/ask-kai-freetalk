import {randomUUID,createHash} from 'node:crypto';
import {SlidesCoordinator} from './slides-coordinator.js';
import {SlidesCommandCapabilities} from './slides-command-gate.js';
import {slidesInstructions} from './slides-instructions.js';
import {validateSlidesIntent,validateSlidesCancellation} from '../../../packages/contracts/ui-actions.js';

// Authorized WebSocket owns this control session. It never emits teaching events.
export class SlidesSession {
  constructor({sessionId,send,changed=()=>{},observe=()=>{},isAuthorized=()=>true,demoHistory=false,handshakeMs=5000,coordinatorOptions={}}){
    Object.assign(this,{send,changed,isAuthorized,demoHistory});this.closed=false;this.initialized=false;this.viewerReady=false;this.revision=0;this.appliedRevision=-1;
    this.observe=(name,fields)=>{try{observe(name,fields);}catch{}};this.dispatchedAt=null;
    this.capabilities=new SlidesCommandCapabilities();this.results=new Map();
    this.coordinator=new SlidesCoordinator({...coordinatorOptions,sessionId,viewerId:randomUUID(),generation:randomUUID(),send:packet=>{
      if(packet.type==='slides.command'){this.dispatchedAt=performance.now();this.observe('slides.command',{slides_page:packet.page,slides_revision:packet.revision});}send(packet);
    },onState:state=>{
      this.revision++;send({type:'slides.state',...state});this.observe('slides.state',{slides_page:state.page,slides_revision:state.revision,confirmed:state.confirmed,available:state.available,pending:state.pending,queued:state.queued});if(this.initialized)changed();
    }});
    this.binding=this.coordinator.binding;
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    this.timer=setTimeout(()=>this.failReady('SLIDES_VIEWER_TIMEOUT'),handshakeMs);
  }
  offer(){this.send({type:'slides.bind',...this.binding,history_source:this.demoHistory?'synthetic_author_demo':'component_receipts',demo_history:this.demoHistory});}
  failReady(code){if(this.initialized||this.closed)return;this.rejectReady(new Error(code));this.close();}
  current(){return !this.closed&&this.isAuthorized()===true;}
  async initialize(){
    for(const page of this.demoHistory?[1,2,3]:[1]){
      const outcome=await this.coordinator.present(page,{requestId:randomUUID()});
      if(!this.current()||!['applied','unchanged'].includes(outcome.status)){this.failReady('SLIDES_VIEWER_UNAVAILABLE');return;}
    }
    clearTimeout(this.timer);this.initialized=true;this.resolveReady(this.configuration());
  }
  receive(packet){
    if(!this.current()||!this.coordinator.matches(packet))return false;
    if(packet.type==='slides.ready'){
      if(this.viewerReady||Object.keys(packet).some(key=>!['type',...Object.keys(this.binding)].includes(key)))return false;
      this.viewerReady=true;void this.initialize();return true;
    }
    if(['slides.ack','slides.snapshot'].includes(packet.type)){
      const at=this.dispatchedAt,accepted=this.coordinator.receive(packet);
      if(accepted&&at!==null)this.observe('slides.receipt',{slides_page:packet.page,slides_revision:packet.revision,elapsed_ms:performance.now()-at});return accepted;
    }
    if(packet.type==='slides.intent'){
      if(!this.initialized||Object.keys(packet).some(key=>!['type',...Object.keys(this.binding),'request_id','intent'].includes(key)))return false;
      // Manual requests share execution/revalidation, but cannot enter the host presentation port.
      void this.coordinator.execute(packet.intent,{requestId:packet.request_id,isCurrent:()=>this.current()}).then(outcome=>{
        if(this.current())this.send({type:'slides.result',...this.binding,request_id:packet.request_id,outcome});
      });return true;
    }
    return false;
  }
  configuration(){
    const state=this.coordinator.snapshot();
    // Unknown state offers no executable tools; a late exact receipt can reconcile it.
    const registration=state.confirmed&&state.available?this.capabilities.registration(state):null;
    return {revision:this.revision,registration,tools:registration?.tools??[],state};
  }
  instructions(base,config){
    if(!config.registration)return base+'\n课件展示结果尚未确认，暂时不能操作。不得声称已切换或自动重试。';
    return slidesInstructions(base,config.state,config.registration,{demoHistory:this.demoHistory});
  }
  contextSnapshot(base,config){
    const instructions=this.instructions(base.instructions,config);
    return {...base,instructions,hash:createHash('sha256').update(instructions).digest('hex'),slides_revision:config.revision};
  }
  confirm(config){this.appliedRevision=config.revision;if(config.registration)this.capabilities.acknowledge(config.registration.token);}
  get dirty(){return this.initialized&&this.revision!==this.appliedRevision;}
  observeStarted(id){this.capabilities.observeStarted(id);}
  observeFinal(id){this.capabilities.observeFinal(id);}
  calls(calls){
    if(calls.some(call=>{const kind=this.capabilities.kind(call.name);return kind==='navigate'?!validateSlidesIntent(call.args):kind==='cancel'?!validateSlidesCancellation(call.args):true;})){
      return calls.map(call=>Promise.resolve({callId:call.callId,outcome:{...this.coordinator.outcome('rejected','INVALID_UI_TOOL_BATCH'),scope:'session_call',learning_evidence:false}}));
    }
    // Admit and apply control mutations synchronously at wire ingress, before any awaits.
    return calls.map(call=>{
      const at=performance.now();
      const state=this.coordinator.snapshot();let decision;
      try{decision=this.current()&&this.initialized?this.capabilities.admit(call,state):{status:'rejected',reason:'SLIDES_STATE_UNCONFIRMED'};}
      catch{decision={status:'rejected',reason:'SLIDES_STATE_UNCONFIRMED'};}
      let result;
      if(decision.status!=='accepted')result=Promise.resolve(this.coordinator.outcome('rejected',decision.reason));
      else{
        result=this.results.get(decision.request_id);
        if(!result){
          const options={requestId:decision.request_id,isCurrent:()=>this.current()};
          result=decision.kind==='cancel'?this.coordinator.cancelPendingReviews(options):this.coordinator.execute(decision.intent,options);
          this.results.set(decision.request_id,result);
          if(decision.rotated){this.revision++;this.changed();}
        }
      }
      this.observe('slides.admission',{slides_status:decision.status,epoch_index:decision.epoch_index});
      return result.then(outcome=>{this.observe('slides.result',{slides_status:outcome.status,slides_page:outcome.page,confirmed:outcome.confirmed,elapsed_ms:performance.now()-at});return {callId:call.callId,outcome:{...outcome,scope:'session_call',learning_evidence:false}};});
    });
  }
  close(){
    if(this.closed)return;this.closed=true;clearTimeout(this.timer);
    if(!this.initialized)this.rejectReady(new Error('SLIDES_SESSION_CLOSED'));
    this.capabilities.close();this.coordinator.close();this.results.clear();
  }
}
