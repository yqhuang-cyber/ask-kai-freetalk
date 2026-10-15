import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PlanningSemanticReviewer } from '../apps/eval-runner/src/planning-semantic-review.js';
import { validatedBundleInputs,REVIEW_BUNDLE_VERSION } from '../apps/eval-runner/src/planning-review-bundle.js';
import { MiniMaxJsonTransport } from '../packages/provider-minimax/planner.js';
// Explicitly reviews only the most recent synthetic goal-eval accepted plans.
// Verify authorship against the frozen dataset before transmitting any row.
export const authoredReviewInputs=validatedBundleInputs;
if(import.meta.url===new URL(process.argv[1],'file:').href) {
  try {
    const preflight=process.argv.length===3&&process.argv[2]==='--preflight';
    if(process.argv.length!==2&&!preflight)throw new Error('INVALID_REVIEW_ARGUMENT');
    const datasetBytes=await readFile('docs/eval-datasets/dynamic-goals-v1/cases.json'),reviewBytes=await readFile('.local/goal-eval/review.json');
    const inputs=validatedBundleInputs(JSON.parse(reviewBytes),JSON.parse(datasetBytes),createHash('sha256').update(datasetBytes).digest('hex')),transport=[];
    const reviewer=!preflight&&inputs.length?new PlanningSemanticReviewer({transport:new MiniMaxJsonTransport({apiKey:process.env.MINIMAX_API_KEY,baseURL:process.env.MINIMAX_BASE_URL,model:process.env.MINIMAX_PLANNER_MODEL??'MiniMax-M3',observe:r=>transport.push(r)})}):null;
    const cases=[];for(const row of inputs){const result=reviewer?await reviewer.review(row.input):{status:'not_reviewed',semantic_quality_accepted:false,human_calibrated:false};cases.push({id:row.id,index:row.index,snapshot_hash:row.snapshot_hash,proposal_hash:row.proposal_hash,planner:'llm',...result});console.error(row.id+': '+result.status);}
    console.log(JSON.stringify({version:'accepted-planner-semantic-review-v1',source:'authored_synthetic_goal_eval',dataset_sha256:createHash('sha256').update(datasetBytes).digest('hex'),private_review_sha256:createHash('sha256').update(reviewBytes).digest('hex'),context_rows_validated:JSON.parse(reviewBytes).rows.length,input_bundle_version:REVIEW_BUNDLE_VERSION,limited_context:false,missing_context:[],denominators:{accepted_llm_proposals:inputs.length,reviewed:cases.filter(c=>c.status==='reviewed').length,all_criteria_pass:cases.filter(c=>c.all_criteria_pass).length},cases,transport,model_calls_enabled:!!reviewer,review_mode:reviewer?'auxiliary_model_review':'preflight_only',human_calibrated:false,semantic_quality_accepted:false,real_voice_connected:false,contains_transcripts:false},null,2));
  }catch{console.error('PLANNING_REVIEW_FAILED');process.exitCode=1;}
}
