import { planningCapabilities } from './skill-catalog.js';
import { randomUUID } from 'node:crypto';
import { validateLearningRecord,immutable } from '../contracts/planning.js';
import { supportedExpression,observedPrompt,LEARNER_FEEDBACK_VERSION } from './learner-feedback.js';
import { goalChoice } from './goal-lifecycle.js';
export class PlanningObservations {
  constructor({sessionId,resource,plan}){Object.assign(this,{sessionId,resource,plan});this.observations=new Map();this.feedback=new Map();}
  accept(event,{plan=this.plan,resource=this.resource,goal_status=plan.goal_status,executions=[]}={}) {
    if(event.type!=='user.final'||event.session_id!==this.sessionId)return;
    // A corrected final replaces the old candidate, never adds another attempt.
    this.observations.delete(event.turn_id);
    const goal=plan.primary_goal;
    const kp=planningCapabilities(plan,resource)?.key_points.find(k=>goal?.kp_ids.includes(k.id));
    const attempted=goal_status==='active'?supportedExpression(event.payload.text,kp?.evidence_rule):null;
    const row=attempted?{observation_id:randomUUID(),turn_id:event.turn_id,source_event_id:event.event_id,kp_id:kp.id,goal_id:goal.id,plan_revision:plan.revision,attempt_rule_ref:kp.evidence_rule,state:'attempted',support:'unknown',execution_ref:null}:null;
    if(row)this.observations.set(event.turn_id,row);
    const signal=goalChoice(event.payload.text).kind==='difficulty'?'difficulty_report':row?'supported_attempt':goal_status!=='active'||!goal?'no_active_goal':kp?.evidence_rule==='unassessed'?'unsupported_rule':'unassessed_input';
    this.feedback.set(event.turn_id,immutable({policy_version:LEARNER_FEEDBACK_VERSION,source_event_id:event.event_id,goal_id:goal?.id??null,plan_revision:plan.revision,signal,observation_ref:row?.observation_id??null,semantic_review:'unverified',support:'unknown',prompt:observedPrompt(attempted,executions,event.turn_id)}));
    if(this.feedback.size>1000)this.feedback.delete(this.feedback.keys().next().value);
  }
  record(plan,outcome='ended'){return validateLearningRecord({schema_version:'learning-record-v2',session_id:this.sessionId,plan_id:plan.plan_id,plan_revision:plan.revision,resource_ref:plan.resource_refs[0]?{id:plan.resource_refs[0].id,version:plan.resource_refs[0].version}:null,observations:[...this.observations.values()].slice(-100),outcome,source:'ask_kai_observation'});}
}
