import {randomUUID} from 'node:crypto';
import {resolveSlidesTarget,validateSlidesIntent,SLIDES_POLICY} from '../../../packages/contracts/ui-actions.js';
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const page=value=>Number.isSafeInteger(value)&&value>=1&&value<=3;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

// Session-local host state machine. No provider, identity lookup or teaching evidence.
// The caller must bind this instance to its authorized WebSocket and Viewer instance.
export class SlidesCoordinator {
  constructor({sessionId,viewerId,generation,deckId='kai-demo',deckVersion='1',send,onState=()=>{},ackMs=2000,totalMs=5000,queueTtlMs=5000,makeId=randomUUID}={}) {
    if(![sessionId,viewerId,generation,deckId,deckVersion].every(id)||typeof send!=='function'||typeof onState!=='function'||typeof makeId!=='function'||
      ![ackMs,totalMs,queueTtlMs].every(v=>Number.isSafeInteger(v)&&v>0&&v<=30000)||ackMs>=totalMs)throw new Error('INVALID_SLIDES_COORDINATOR');
    this.binding={session_id:sessionId,viewer_instance_id:viewerId,generation,deck_id:deckId,deck_version:deckVersion};
    Object.assign(this,{send,onState,ackMs,totalMs,queueTtlMs,makeId});
    this.page=1;this.revision=0;this.confirmed=false;this.visits=[];this.shown=[];this.historyRevision=0;this.lastCommand=null;
    this.queue=[];this.requests=new Map();this.pending=null;this.closed=false;
  }
  snapshot(){return {...this.binding,navigation_policy:SLIDES_POLICY,page:this.confirmed?this.page:null,last_confirmed_page:this.revision?this.page:null,total:3,revision:this.revision,
    confirmed:this.confirmed,available:!this.closed&&this.confirmed&&!this.pending?.unknown,
    shown:[...this.shown],visits:[...this.visits],history_revision:this.historyRevision,
    allowed_review_pages:this.confirmed?this.shown.filter(value=>value<=this.page):[],pending:Boolean(this.pending),queued:this.queue.length};}
  publish(){try{this.onState(this.snapshot());}catch{}}
  outcome(status,reason,actionId){return {status,reason,...(actionId?{action_id:actionId}:{}),page:this.confirmed?this.page:null,total:3,revision:this.confirmed?this.revision:null,confirmed:this.confirmed};}
  emit(packet){try{this.send({...packet,...this.binding});return true;}catch{return false;}}
  execute(intent,{requestId,isCurrent=()=>true}={}){
    if(!id(requestId)||typeof isCurrent!=='function')return Promise.resolve(this.outcome('rejected','INVALID_REQUEST_ID'));
    // Normalize to a closed, deterministic form before deduplication.
    if(!validateSlidesIntent(intent))return Promise.resolve(this.outcome('rejected',intent?.action==='next'?'FORWARD_NAVIGATION_DISABLED':'INVALID_SLIDES_ARGUMENTS'));
    const normalized={action:intent.action,...(intent.action==='goto'?{page:intent.page}:{}),...(intent.replace_pending===true?{replace_pending:true}:{})};
    return this.enqueue({kind:'review',intent:normalized,requestId,isCurrent});
  }
  // Trusted host/test port only. Never route a model tool or browser intent here.
  // Used to initialize page 1 and, in isolated authored fixtures, establish display history.
  present(target,{requestId}={}){
    if(!page(target)||!id(requestId))return Promise.resolve(this.outcome('rejected','INVALID_HOST_PRESENTATION'));
    return this.enqueue({kind:'host',target,requestId,isCurrent:()=>true});
  }
  cancelPendingReviews({requestId,isCurrent=()=>true}={}){
    if(!id(requestId)||typeof isCurrent!=='function')return Promise.resolve(this.outcome('rejected','INVALID_REQUEST_ID'));
    if(this.closed)return Promise.resolve(this.outcome('cancelled','SESSION_CLOSED'));
    const signature='cancel_pending_reviews',cached=this.requests.get(requestId);
    if(cached)return cached.signature===signature?cached.promise:Promise.resolve(this.outcome('rejected','REQUEST_ID_CONFLICT'));
    if(this.requests.size>=64)return Promise.resolve(this.outcome('rejected','ACTION_LIMIT'));
    if(!this.valid({isCurrent}))return Promise.resolve(this.outcome('cancelled','REQUEST_SUPERSEDED'));
    let cancelled=0;
    for(const job of [...this.queue])if(job.kind==='review'&&this.cancelQueued(job.requestId))cancelled++;
    const inFlight=Boolean(this.pending),status=cancelled?'cancelled':'unchanged';
    const value={...this.outcome(status,cancelled?'QUEUED_REVIEWS_CANCELLED':inFlight?'ACTION_ALREADY_DISPATCHED':'NO_PENDING_REVIEWS',this.makeId()),
      cancelled_count:cancelled,in_flight:inFlight,...(inFlight?{page:null,revision:null,confirmed:false}:{})};
    const promise=Promise.resolve(Object.freeze(value));this.requests.set(requestId,{signature,promise});this.publish();return promise;
  }
  enqueue(input){
    if(this.closed)return Promise.resolve(this.outcome('cancelled','SESSION_CLOSED'));
    const signature=JSON.stringify(input.kind==='review'?input.intent:{host_page:input.target});
    const cached=this.requests.get(input.requestId);
    if(cached)return cached.signature===signature?cached.promise:Promise.resolve(this.outcome('rejected','REQUEST_ID_CONFLICT'));
    if(this.requests.size>=64)return Promise.resolve(this.outcome('rejected','ACTION_LIMIT'));
    if(this.pending?.unknown||!this.confirmed&&input.kind==='review')return Promise.resolve(this.outcome('rejected','SLIDES_STATE_UNCONFIRMED'));
    if(input.kind==='review'&&input.intent.replace_pending===true){
      if(!this.valid(input))return Promise.resolve(this.outcome('cancelled','REQUEST_SUPERSEDED'));
      const resolved=resolveSlidesTarget(input.intent,{page:this.page,shown:this.shown,visits:this.visits});
      if(resolved.status==='rejected')return Promise.resolve(this.outcome('rejected',resolved.reason));
      for(const job of [...this.queue])if(job.kind==='review'){
        this.queue.splice(this.queue.indexOf(job),1);this.settle(job,this.outcome('cancelled','REQUEST_REPLACED',job.actionId));
      }
    }
    if(this.pending&&this.queue.length>=2)return Promise.resolve(this.outcome('rejected','SLIDES_BUSY'));
    let settle;
    const promise=new Promise(resolve=>{settle=resolve;});
    const job={...input,signature,promise,settle,settled:false,acceptedAt:Date.now(),actionId:this.makeId()};
    if(!id(job.actionId))throw new Error('INVALID_ACTION_ID');
    if(input.kind==='review'&&input.intent.action==='recent'){
      job.recentTarget=[...this.visits].reverse().find(value=>value!==this.page)??null;
      job.historyRevision=this.historyRevision;
    }
    this.requests.set(input.requestId,job);this.queue.push(job);
    if(this.pending)this.publish();else this.drain();return promise;
  }
  settle(job,result){if(job.settled)return;job.settled=true;job.settle(result);}
  valid(job){try{return job.isCurrent()===true;}catch{return false;}}
  drain(){
    if(this.closed||this.pending)return;
    while(this.queue.length){
      const job=this.queue.shift();
      if(!this.valid(job)){this.settle(job,this.outcome('cancelled','REQUEST_SUPERSEDED',job.actionId));continue;}
      if(Date.now()-job.acceptedAt>=this.queueTtlMs){this.settle(job,this.outcome('cancelled','QUEUE_EXPIRED',job.actionId));continue;}
      let target=job.target;
      if(job.kind==='review'){
        if(!this.confirmed){this.settle(job,this.outcome('rejected','SLIDES_STATE_UNCONFIRMED',job.actionId));continue;}
        const state={page:this.page,shown:this.shown,visits:this.visits};
        const resolution=job.intent.action==='recent'&&job.recentTarget===null?{status:'unchanged',reason:'NO_REVIEW_HISTORY'}:
          resolveSlidesTarget(job.intent,state,{recentPage:job.recentTarget??undefined});
        if(resolution.status!=='ready'){this.settle(job,this.outcome(resolution.status,resolution.reason,job.actionId));continue;}
        target=resolution.target_page;
      }else if(this.confirmed&&target===this.page){this.settle(job,this.outcome('unchanged','ALREADY_ON_PAGE',job.actionId));continue;}
      const commandId=this.makeId();if(!id(commandId))throw new Error('INVALID_COMMAND_ID');
      this.pending={job,commandId,target,basePage:this.page,baseRevision:this.revision,baseConfirmed:this.confirmed,baseCommand:this.lastCommand,revision:this.revision+1,unknown:false};
      const pending=this.pending;
      pending.ackTimer=setTimeout(()=>this.query(pending),this.ackMs);
      pending.totalTimer=setTimeout(()=>this.unknown(pending),this.totalMs);
      if(!this.emit({type:'slides.command',command_id:commandId,page:target,base_revision:pending.baseRevision,revision:pending.revision})){
        // send() may have partially delivered before throwing. Reconcile rather than claim no effect.
        this.query(pending);
      }
      this.publish();return;
    }
    this.publish();
  }
  query(pending){
    if(this.closed||this.pending!==pending||pending.syncId)return;
    pending.syncId=this.makeId();
    if(!id(pending.syncId))throw new Error('INVALID_SYNC_ID');
    this.emit({type:'slides.sync',command_id:pending.commandId,sync_id:pending.syncId});
  }
  unknown(pending){
    if(this.closed||this.pending!==pending)return;
    pending.unknown=true;this.confirmed=false;
    this.settle(pending.job,this.outcome('unknown','VIEWER_ACK_TIMEOUT',pending.job.actionId));
    while(this.queue.length){const job=this.queue.shift();this.settle(job,this.outcome('rejected','SLIDES_STATE_UNCONFIRMED',job.actionId));}
    this.publish();
  }
  matches(packet){return object(packet)&&Object.entries(this.binding).every(([key,value])=>packet[key]===value);}
  receive(packet){
    const pending=this.pending;
    if(this.closed||!pending||!this.matches(packet)||packet.command_id!==pending.commandId)return false;
    const baseKeys=[...Object.keys(this.binding),'type','command_id','page','revision'];
    if(packet.type==='slides.ack'){
      if(Object.keys(packet).some(key=>![...baseKeys,'status'].includes(key)))return false;
      if(packet.status==='applied'&&packet.page===pending.target&&packet.revision===pending.revision)return this.complete(pending,true);
      if(packet.status==='not_applied'&&packet.page===pending.basePage&&packet.revision===pending.baseRevision)return this.complete(pending,false);
      return false;
    }
    if(packet.type==='slides.snapshot'){
      if(!pending.syncId||packet.sync_id!==pending.syncId||Object.keys(packet).some(key=>![...baseKeys,'sync_id','applied_command_id'].includes(key)))return false;
      if(packet.applied_command_id===pending.commandId&&packet.page===pending.target&&packet.revision===pending.revision)return this.complete(pending,true);
      if(packet.applied_command_id===pending.baseCommand&&packet.page===pending.basePage&&packet.revision===pending.baseRevision)return this.complete(pending,false);
    }
    return false;
  }
  complete(pending,applied){
    if(this.pending!==pending||this.closed)return false;
    clearTimeout(pending.ackTimer);clearTimeout(pending.totalTimer);
    if(applied){
      this.page=pending.target;this.revision=pending.revision;this.confirmed=true;this.lastCommand=pending.commandId;
      this.visits.push(this.page);this.visits=this.visits.slice(-20);
      if(!this.shown.includes(this.page))this.shown.push(this.page);this.shown.sort((a,b)=>a-b);this.historyRevision++;
    }else this.confirmed=pending.baseConfirmed;
    this.pending=null;
    this.settle(pending.job,this.outcome(applied?'applied':'failed',applied?'PAGE_CHANGED':'VIEWER_NOT_APPLIED',pending.job.actionId));
    this.publish();this.drain();return true;
  }
  cancelQueued(requestId){
    const index=this.queue.findIndex(job=>job.requestId===requestId);if(index<0)return false;
    const [job]=this.queue.splice(index,1);this.settle(job,this.outcome('cancelled','REQUEST_CANCELLED',job.actionId));this.publish();return true;
  }
  close(){
    if(this.closed)return;this.closed=true;
    if(this.pending){const pending=this.pending;clearTimeout(pending.ackTimer);clearTimeout(pending.totalTimer);this.confirmed=false;
      this.settle(pending.job,this.outcome('unknown','SESSION_CLOSED_DURING_ACTION',pending.job.actionId));this.pending=null;}
    while(this.queue.length){const job=this.queue.shift();this.settle(job,this.outcome('cancelled','SESSION_CLOSED',job.actionId));}
    this.requests.clear();this.publish();
  }
}
