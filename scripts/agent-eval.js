import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { configuredPlanner,plannerDescriptor } from '../packages/agent-core/planner-port.js';
import { MiniMaxJsonTransport } from '../packages/provider-minimax/planner.js';
import { evaluateAgentFeedbackCase } from '../apps/eval-runner/src/agent-feedback.js';
import { PlanningSemanticReviewer,SEMANTIC_REVIEW_VERSION } from '../apps/eval-runner/src/planning-semantic-review.js';
import { LEARNER_FEEDBACK_VERSION } from '../packages/agent-core/learner-feedback.js';
import { AGENT_REASONING_VERSION } from '../packages/agent-core/agent-reasoning.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
export async function runAgentEval({live=false,semanticReview=false,selected=null,planner=live?configuredPlanner():null,reviewer=null,onCase=()=>{}}={}) {
  const bytes=await readFile('docs/eval-datasets/agent-feedback-v1/cases.json'),dataset=JSON.parse(bytes);
  if(live&&!planner)throw new Error('PLANNER_CONFIG_REQUIRED');
  if(semanticReview&&!live&&!reviewer)throw new Error('REVIEW_REQUIRES_LIVE');
  const ids=selected?.split(',');if(ids?.some(id=>!dataset.cases.some(c=>c.id===id)))throw new Error('UNKNOWN_AGENT_EVAL_CASE');
  const transport=[];if(planner)planner.observe=r=>transport.push(r);
  if(semanticReview&&!reviewer)reviewer=new PlanningSemanticReviewer({transport:new MiniMaxJsonTransport({apiKey:process.env.MINIMAX_API_KEY,baseURL:process.env.MINIMAX_BASE_URL,model:process.env.MINIMAX_PLANNER_MODEL??'MiniMax-M3',observe:r=>transport.push(r)})});
  const cases=[];
  for(const c of dataset.cases.filter(c=>!ids||ids.includes(c.id))) {
    let result;try{result=await evaluateAgentFeedbackCase(c,{planner,reviewer});}catch{result={id:c.id,initial_failed:true,passed:false,semantic_review:{status:'not_reviewed'}};}
    cases.push(result);onCase(result);
  }
  const files=['packages/agent-core/learner-feedback.js','packages/agent-core/agent-reasoning.js','packages/agent-core/planning-observations.js','packages/agent-core/planning-state.js','packages/agent-core/plan-validator.js','packages/agent-core/teaching.js','packages/agent-core/natural-teaching.js','packages/agent-core/planner-full-contract.js','packages/agent-core/planner-draft.js','packages/provider-minimax/planner.js','apps/eval-runner/src/agent-feedback.js','apps/eval-runner/src/planning-semantic-review.js','scripts/agent-eval.js'];
  const source_hashes=Object.fromEntries(await Promise.all(files.map(async p=>[p,hash(await readFile(p))])));
  return {version:'agent-feedback-eval-v1',dataset_sha256:hash(bytes),source_hashes,candidate:plannerDescriptor(planner),policies:{feedback:LEARNER_FEEDBACK_VERSION,reasoning:AGENT_REASONING_VERSION,review:SEMANTIC_REVIEW_VERSION},synthetic_inputs:true,synthetic_output_events:true,model_calls_enabled:live,real_voice_connected:false,browser_audio_tested:false,contains_transcripts:false,transport,cases,denominators:{cases:cases.length,behavior_pass:cases.filter(c=>c.passed).length,initial_failed:cases.filter(c=>c.initial_failed).length,llm_turns:cases.filter(c=>c.planner==='llm').length,rule_turns:cases.filter(c=>c.planner==='rule').length,reviewed:cases.filter(c=>c.semantic_review.status==='reviewed').length,review_all_criteria_pass:cases.filter(c=>c.semantic_review.all_criteria_pass).length},review_mode:reviewer?'auxiliary_model_review':'not_reviewed',independent_calibrated_judge:false,human_calibrated:false,semantic_quality_accepted:false,current_turn_control_verified:false};
}
if(import.meta.url===new URL(process.argv[1],'file:').href) {
  const args=process.argv.slice(2);
  try{if(args.some(a=>!['--live','--semantic-review'].includes(a)&&!a.startsWith('--case=')))throw new Error('INVALID_AGENT_EVAL_ARGUMENT');const r=await runAgentEval({live:args.includes('--live'),semanticReview:args.includes('--semantic-review'),selected:args.find(a=>a.startsWith('--case='))?.slice(7),onCase:c=>console.error(c.id+': '+(c.initial_failed?'initialization_failed':c.planner)+' / '+c.semantic_review.status)});console.log(JSON.stringify(r,null,2));if(r.denominators.behavior_pass!==r.denominators.cases)process.exitCode=1;}
  catch(error){console.error(['PLANNER_CONFIG_REQUIRED','REVIEW_REQUIRES_LIVE','UNKNOWN_AGENT_EVAL_CASE','INVALID_AGENT_EVAL_ARGUMENT'].includes(error.message)?error.message:'AGENT_EVAL_FAILED');process.exitCode=1;}
}
