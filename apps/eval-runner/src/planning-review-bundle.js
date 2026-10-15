import { exact,immutable } from '../../../packages/contracts/planning.js';
import { planHash } from '../../../packages/agent-core/plan-validator.js';
export const REVIEW_BUNDLE_VERSION='synthetic-planning-review-v2';
const SNAPSHOT_FIELDS=['plan','turn','policy','language','learner_feedback','actual_context','prior_execution','student_profile','learning_profile','learning_history','coverage','resource','goal_review'];
export function planningReviewRow(caseId,index,{input_snapshot,plan}) {
  return immutable({case_id:caseId,index,input:input_snapshot.turn.text,input_snapshot,snapshot_hash:planHash(input_snapshot),plan,proposal_hash:plan.hash});
}
export function validateReviewRow(row,dataset) {
  const c=dataset.cases.find(c=>c.id===row?.case_id),snapshot=row?.input_snapshot,p=row?.plan;
  if(!c||!Number.isSafeInteger(row.index)||row.index<0||c.turns[row.index]?.text!==row.input||p?.session_id!=='eval-'+row.case_id||!exact(snapshot,SNAPSHOT_FIELDS)||SNAPSHOT_FIELDS.some(k=>!Object.hasOwn(snapshot,k))||snapshot.turn?.text!==row.input||snapshot.plan?.session_id!==p.session_id||snapshot.turn.source_event_id!==p.input_ref||snapshot.turn.turn_id!==p.turn_id||snapshot.turn.input_revision!==p.input_revision||snapshot.turn.revision!==p.base_planning_revision||snapshot.turn.authorization_epoch!==p.authorization_epoch||snapshot.plan.revision!==p.based_on_plan_revision||planHash(snapshot)!==row.snapshot_hash||row.proposal_hash!==p.hash)throw new Error('INVALID_REVIEW_BINDING');
  const {hash,...body}=p;if(planHash(body)!==hash)throw new Error('INVALID_REVIEW_BINDING');
  return row;
}
export function reviewInput(snapshot,plan) {
  return immutable({student_input:snapshot.turn,plan_proposal:plan,conversation_plan:snapshot.plan,actual_context:snapshot.actual_context,learner_feedback:snapshot.learner_feedback,student_profile:snapshot.student_profile,learning_profile:snapshot.learning_profile,learning_history:snapshot.learning_history,coverage:snapshot.coverage,resource:snapshot.resource,goal_review:snapshot.goal_review,policy:snapshot.policy,language:snapshot.language,prior_execution:snapshot.prior_execution});
}
export function validatedBundleInputs(bundle,dataset,datasetHash) {
  if(!exact(bundle,['schema_version','source','dataset_sha256','candidate','rows'])||bundle.schema_version!==REVIEW_BUNDLE_VERSION||bundle.source!=='authored_synthetic_goal_eval'||bundle.dataset_sha256!==datasetHash||!Array.isArray(bundle.rows)||bundle.rows.length>100)throw new Error('SYNTHETIC_REVIEW_SOURCE_REQUIRED');
  const seen=new Set();
  for(const row of bundle.rows){validateReviewRow(row,dataset);const key=row.case_id+':'+row.index;if(seen.has(key))throw new Error('DUPLICATE_REVIEW_ROW');seen.add(key);}
  return bundle.rows.filter(r=>r.plan.planner_kind==='llm').map(r=>({id:r.case_id,index:r.index,snapshot_hash:r.snapshot_hash,proposal_hash:r.proposal_hash,input:reviewInput(r.input_snapshot,r.plan)}));
}
