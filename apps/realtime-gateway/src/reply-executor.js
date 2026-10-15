// Host-side port for a future verified gated realtime provider. No speculative
// response.create or turn-detection wire field is sent by this module.
export const SEEDUPLEX_PLANNING_CAPABILITIES=Object.freeze({path:'autonomous_full_duplex',generation_gate_verified:false,explicit_generation_verified:false,current_turn_control:false,context_application:'reply_boundary',generation_start:'unknown'});
export class ReplyExecutor {
  constructor({provider,state,clock=()=>Date.now()}){Object.assign(this,{provider,state,clock});this.requests=new Map();}
  async execute(plan,context,{signal}={}) {
    const c=this.provider.planningCapabilities;
    if(c?.generation_gate_verified!==true||c?.explicit_generation_verified!==true||typeof this.provider.generateFromPlan!=='function')throw new Error('CONTROLLED_REALTIME_NOT_VERIFIED');
    if(!this.state.isCurrent(plan)||plan.expires_at<=this.clock()||signal?.aborted)throw new Error('STALE_EXECUTION_PLAN');
    const key=`${plan.turn_id}-${plan.input_revision}-${plan.proposal_id}`;
    if(this.requests.has(key))throw new Error('EXECUTION_ALREADY_REQUESTED');
    const execution={execution_id:plan.proposal_id,turn_id:plan.turn_id,turn_plan_ref:plan.proposal_id,plan_hash:plan.hash,context_hash:context.hash,accepted_at:plan.accepted_at,generation_requested_at:this.clock(),generation_basis:'host_request_after_plan',status:'generation_requested',consumption:'unknown'};
    this.requests.set(key,execution);this.state.executions.set(execution.execution_id,execution);
    try{const result=await this.provider.generateFromPlan({plan,context,execution_id:execution.execution_id,signal});if(!this.state.isCurrent(plan)||signal?.aborted){execution.status='cancelled';throw new Error('STALE_EXECUTION_PLAN');}return result;}
    catch(error){if(execution.status!=='cancelled')execution.status='failed';throw error;}
  }
}
