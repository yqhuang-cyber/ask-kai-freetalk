import { PlanningTrace } from '../../../packages/agent-core/planning-trace.js';
import { randomUUID } from 'node:crypto';
import { immutable,requireIdentity } from '../../../packages/contracts/planning.js';
import { normalizeEntry,planProjection } from '../../../packages/agent-core/conversation-initializer.js';
import { planHash } from '../../../packages/agent-core/plan-validator.js';
import { TeachingSession } from '../../../packages/agent-core/teaching.js';
const owner=i=>JSON.stringify([i.owner_id,i.learner_id]);
export class Preparations {
  constructor({initializer,clock=()=>Date.now(),ttlMs=60000,capacity=32}){Object.assign(this,{initializer,clock,ttlMs,capacity});this.items=new Map();this.epochs=new Map();}
  prune(){for(const [id,item] of this.items)if(item.expires<=this.clock()){item.controller.abort();item.trace?.clear();this.items.delete(id);}}
  create(identity,input,{observe=false}={}) {
    this.prune();requireIdentity(identity,'session:create',this.clock());
    if(this.items.size>=this.capacity)throw new Error('PREPARATION_CAPACITY');
    const entry=normalizeEntry(input,identity),id=randomUUID(),controller=new AbortController(),epoch=this.epochs.get(owner(identity))??0;
    const trace=observe?new PlanningTrace():null;trace?.record('preparation.started',{preparation_id:id,entry});
    const item={trace,id,identity:{...identity},owner:owner(identity),entry,status:'preparing',epoch,expires:Math.min(this.clock()+this.ttlMs,identity.authorization_until),controller};this.items.set(id,item);
    item.done=this.initializer.prepare(entry,identity,{signal:controller.signal,trace}).then(result=>{if(item.status!=='preparing'||controller.signal.aborted||item.epoch!==(this.epochs.get(item.owner)??0)||item.expires<=this.clock())return;Object.assign(item,result,{status:'ready'});trace?.record('preparation.ready',{preparation_id:id,plan:result.plan});}).catch(error=>{if(item.status==='preparing'){item.status='failed';trace?.record('preparation.failed',{preparation_id:id,reason:'CONVERSATION_PREPARATION_FAILED'});item.error=['TOPIC_PRACTICE_DECLINED','TOPIC_REQUESTED_GOAL_UNAVAILABLE','TOPIC_NO_ELIGIBLE_GOAL'].includes(error.message)?error.message:'CONVERSATION_PREPARATION_FAILED';}});
    return {preparation_id:id,status:item.status,expires_at:item.expires};
  }
  get(identity,id) {
    this.prune();requireIdentity(identity,'session:create',this.clock());
    const item=this.items.get(id);if(!item||item.owner!==owner(identity)||item.epoch!==(this.epochs.get(item.owner)??0))throw new Error('PREPARATION_NOT_FOUND');return item;
  }
  view(identity,id){const item=this.get(identity,id);const view=item.status!=='ready'?null:item.plan.execution_mode==='shadow'?new TeachingSession({sessionId:'shadow-preview',mode:item.entry.mode==='topic'&&item.resource?.schema_version!=='topic-pack-v1'?'sports':item.entry.mode,mission:identity.mission,memory:identity.memory}).view():planProjection(item.plan,item.resource);return {preparation_id:id,status:item.status,error:item.error,expires_at:item.expires,...(view?{view}:{}),...(item.trace?{observation:item.trace.snapshot()}:{})};}
  cancel(identity,id){const item=this.get(identity,id);item.controller.abort();item.trace?.clear();item.status='cancelled';delete item.context;delete item.resource;delete item.plan;}
  async consume(identity,id,input) {
    const item=this.get(identity,id);if(item.status!=='ready')throw new Error('PREPARATION_NOT_READY');
    const entry=normalizeEntry(input,identity);if(JSON.stringify(entry)!==JSON.stringify(item.entry))throw new Error('PREPARATION_ENTRY_MISMATCH');
    const [context,resource]=await Promise.all([this.initializer.port.read(identity),entry.mode==='free'?null:this.initializer.port.getResource(identity,entry,{version:item.resource?.schema_version==='topic-pack-v1'?item.resource.version:undefined})]);
    // Another request may consume/cancel/revoke while revisions are in flight.
    if(this.get(identity,id)!==item||item.status!=='ready')throw new Error('PREPARATION_ALREADY_USED');
    if(context.revision!==item.context.revision||resource?.version!==item.resource?.version||resource?.hash!==item.resource?.hash){item.status='failed';item.error='PREPARATION_STALE';throw new Error('PREPARATION_STALE');}
    item.status='consumed';this.items.delete(id);return {plan:item.plan,context:item.context,resource:item.resource,...(item.trace?{trace:item.trace}:{})};
  }
  bind(result,sessionId){const {hash,...base}=result.plan;const plan={...base,session_id:sessionId};return {...result,plan:immutable({...plan,hash:planHash(plan)})};}
  revoke(identity){const k=owner(identity);this.epochs.set(k,(this.epochs.get(k)??0)+1);for(const [id,item] of this.items)if(item.owner===k){item.controller.abort();item.trace?.clear();this.items.delete(id);}}
  close(){for(const item of this.items.values()){item.controller.abort();item.trace?.clear();}this.items.clear();this.epochs.clear();}
}
