import {createHash} from 'node:crypto';
export const SCENARIO='teacher_homework';
export const VERSION='homework-v1';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function requireThat(condition,code='INVALID_REQUEST'){if(!condition)throw new Error(code);}
export function id(value){requireThat(typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(value));return value;}
export function key(value){requireThat(typeof value==='string'&&/^[a-zA-Z0-9_.:-]{8,128}$/.test(value),'IDEMPOTENCY_KEY_REQUIRED');return value;}
export function validPlan(plan){
  requireThat(plan?.schema_version===VERSION&&plan.scenario===SCENARIO&&plan.source==='authored_fixture','INVALID_PLAN');
  id(plan.id);id(plan.learner_id);requireThat(plan.version===1&&plan.pack?.source==='authored_fixture'&&plan.pack.version===1&&plan.pack.topic==='点餐','INVALID_PLAN');
  requireThat(Array.isArray(plan.goals)&&plan.goals.length===2&&plan.goals.every(g=>typeof g.label==='string'&&g.label.length<=80)&&new Set(plan.goals.map(g=>g.id)).size===2&&plan.goals.some(g=>g.id==='order_food')&&plan.goals.some(g=>g.id==='taste_preference'),'INVALID_PLAN');
  requireThat(plan.hash===digest({...plan,hash:undefined}),'PLAN_HASH_MISMATCH');return plan;
}
export function validEvidence(e,attempt){
  requireThat(e?.schema_version===VERSION&&e.attempt_id===attempt.id&&e.session_id===attempt.session_id&&e.plan_hash===attempt.plan_hash,'EVIDENCE_BINDING_MISMATCH');
  requireThat(['doubao','synthetic'].includes(e.voice_source)&&typeof e.ready==='boolean'&&Number.isSafeInteger(e.final_turns)&&e.final_turns>=0&&e.final_turns<=1000,'INVALID_EVIDENCE');
  requireThat(Array.isArray(e.observations)&&e.observations.length<=24&&e.observations.every(o=>['order_food','taste_preference'].includes(o.goal_id)&&typeof o.excerpt==='string'&&o.excerpt.length<=160&&typeof o.event_id==='string'&&typeof o.turn_id==='string'&&o.support_basis==='unknown'),'INVALID_EVIDENCE');
  requireThat(Array.isArray(e.help_requests)&&e.help_requests.length<=12&&e.help_requests.every(r=>typeof r.event_id==='string'&&typeof r.turn_id==='string'),'INVALID_EVIDENCE');
  requireThat(Array.isArray(e.replies)&&e.replies.length<=24&&e.replies.every(r=>typeof r.response_id==='string'&&typeof r.turn_id==='string'&&['done','cancelled','interrupted'].includes(r.status)&&r.playback_confirmed===false),'INVALID_EVIDENCE');
  requireThat(['student_end','transport_closed','provider_closed','service_failure','session_limit','authorization_revoked','safety_restricted'].includes(e.end_reason),'INVALID_EVIDENCE');
  requireThat(typeof e.truncated==='boolean','INVALID_EVIDENCE');return e;
}
