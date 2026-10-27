import {CAPABILITIES} from './capabilities.js';
import {createHash} from 'node:crypto';
import {ANALYSIS_VERSION,diningQuestion,diningAnswer,observeDining,observeOrganization} from './report-observations.js';
export const SCENARIO='teacher_homework';
export const VERSION='homework-v1';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function requireThat(condition,code='INVALID_REQUEST'){if(!condition)throw new Error(code);}
export function id(value){requireThat(typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(value));return value;}
export function key(value){requireThat(typeof value==='string'&&/^[a-zA-Z0-9_.:-]{8,128}$/.test(value),'IDEMPOTENCY_KEY_REQUIRED');return value;}
export function validPlan(plan){
  requireThat(plan?.scenario===SCENARIO,'INVALID_PLAN');id(plan.id);id(plan.learner_id);
  if(plan.schema_version===VERSION){
    requireThat(plan.source==='authored_fixture'&&plan.version===1&&plan.pack?.source==='authored_fixture'&&plan.pack.version===1&&plan.pack.topic==='点餐','INVALID_PLAN');
    requireThat(Array.isArray(plan.goals)&&plan.goals.length===2&&plan.goals.every(g=>typeof g.label==='string'&&g.label.length<=80)&&new Set(plan.goals.map(g=>g.id)).size===2&&plan.goals.some(g=>g.id==='order_food')&&plan.goals.some(g=>g.id==='taste_preference'),'INVALID_PLAN');
  }else{
    requireThat(plan.schema_version==='homework-v2'&&['llm_generated','synthetic','teacher_edited'].includes(plan.source)&&plan.version===1&&plan.grade===null&&plan.assessment==='attempts_only','INVALID_PLAN');
    requireThat(plan.pack&&['llm_generated','synthetic'].includes(plan.pack.source)&&typeof plan.pack.topic==='string'&&plan.pack.topic===plan.brief?.topic&&typeof plan.pack.role==='string'&&typeof plan.pack.opening==='string'&&typeof plan.pack.context==='string'&&Array.isArray(plan.pack.opportunities)&&plan.pack.opportunities.length>0&&Array.isArray(plan.pack.materials),'INVALID_PLAN');
    requireThat(Array.isArray(plan.goals)&&plan.goals.length>=1&&plan.goals.length<=3&&new Set(plan.goals.map(g=>g.id)).size===plan.goals.length&&plan.goals.every(g=>CAPABILITIES.some(c=>c.id===g.id&&c.rule===g.observation_rule&&c.kinds.includes(plan.brief.kind))&&typeof g.label==='string'&&g.label.length>0&&g.label.length<=80&&typeof g.task==='string'&&g.task.length<=160&&typeof g.criterion==='string'&&g.criterion.length<=160&&Array.isArray(g.opportunity_ids)&&g.opportunity_ids.length>0&&g.opportunity_ids.every(id=>plan.pack.opportunities.some(o=>o.id===id))),'INVALID_PLAN');
    requireThat(plan.support&&Array.isArray(plan.support.allowed)&&plan.support.allowed.every(s=>['澄清','短句示范','按需简短英文'].includes(s))&&plan.support.independent_use_assessment==='unassessed','INVALID_PLAN');
  }
  requireThat(plan.hash===digest({...plan,hash:undefined}),'PLAN_HASH_MISMATCH');return plan;
}
export function validEvidence(e,attempt,plan){
  requireThat(e?.schema_version===VERSION&&e.attempt_id===attempt.id&&e.session_id===attempt.session_id&&e.plan_hash===attempt.plan_hash,'EVIDENCE_BINDING_MISMATCH');
  requireThat(['doubao','synthetic'].includes(e.voice_source)&&typeof e.ready==='boolean'&&Number.isSafeInteger(e.final_turns)&&e.final_turns>=0&&e.final_turns<=1000,'INVALID_EVIDENCE');
  requireThat(Array.isArray(e.observations)&&e.observations.length<=24&&e.observations.every(o=>['order_food','taste_preference'].includes(o.goal_id)&&(!plan||plan.goals.some(g=>g.id===o.goal_id&&g.observation_rule!=='unassessed'))&&typeof o.excerpt==='string'&&o.excerpt.length<=160&&typeof o.event_id==='string'&&typeof o.turn_id==='string'&&o.support_basis==='unknown'),'INVALID_EVIDENCE');
  requireThat(Array.isArray(e.help_requests)&&e.help_requests.length<=12&&e.help_requests.every(r=>typeof r.event_id==='string'&&typeof r.turn_id==='string'),'INVALID_EVIDENCE');
  requireThat(Array.isArray(e.replies)&&e.replies.length<=24&&e.replies.every(r=>typeof r.response_id==='string'&&typeof r.turn_id==='string'&&['done','cancelled','interrupted'].includes(r.status)&&r.playback_confirmed===false),'INVALID_EVIDENCE');
  requireThat(['student_end','transport_closed','provider_closed','service_failure','session_limit','authorization_revoked','safety_restricted'].includes(e.end_reason),'INVALID_EVIDENCE');
  requireThat(typeof e.truncated==='boolean','INVALID_EVIDENCE');
  for(const o of e.observations)requireThat(observeDining(o.excerpt).some(f=>f.goal_id===o.goal_id),'INVALID_OBSERVATION');
  if(e.analysis_version!==undefined){
    requireThat(e.analysis_version===ANALYSIS_VERSION&&Array.isArray(e.interactions)&&e.interactions.length<=24&&Number.isSafeInteger(e.recognized_questions)&&e.recognized_questions>=e.interactions.length&&e.recognized_questions<=1000,'INVALID_ANALYSIS_EVIDENCE');
    const turns=new Set();
    for(const pair of e.interactions){
      const p=pair?.prompt,a=pair?.answer;
      requireThat(p&&a&&typeof p.event_id==='string'&&typeof a.event_id==='string'&&typeof a.turn_id==='string'&&a.turn_id!==p.turn_id&&!turns.has(a.turn_id)&&typeof p.excerpt==='string'&&p.excerpt.length<=120&&typeof a.excerpt==='string'&&a.excerpt.length<=160,'INVALID_INTERACTION');
      requireThat(diningQuestion(p.excerpt)?.kind===p.kind&&pair.relation==='delivery_order_only'&&pair.support_basis==='unknown'&&e.replies.some(r=>r.response_id===p.response_id&&r.turn_id===p.turn_id&&r.status==='done'),'INVALID_INTERACTION_SOURCE');
      requireThat(diningAnswer(p.kind,a.excerpt,observeDining(a.excerpt))===pair.interpretation&&typeof pair.interpretation==='string','INVALID_INTERACTION_MEANING');
      turns.add(a.turn_id);
    }
    requireThat(turns.size<=e.final_turns,'INVALID_ANALYSIS_EVIDENCE');
    requireThat(Array.isArray(e.organization_observations)&&e.organization_observations.length<=24&&e.organization_observations.every(o=>typeof o.event_id==='string'&&typeof o.turn_id==='string'&&observeOrganization(o.excerpt).some(f=>f.feature_id===o.feature_id)),'INVALID_ORGANIZATION_EVIDENCE');
    requireThat(!plan||plan.pack.topic==='点餐'||e.interactions.length===0,'INVALID_INTERACTION_SCOPE');
  }else requireThat(e.interactions===undefined&&e.recognized_questions===undefined&&e.organization_observations===undefined,'INVALID_ANALYSIS_EVIDENCE');
  return e;
}
