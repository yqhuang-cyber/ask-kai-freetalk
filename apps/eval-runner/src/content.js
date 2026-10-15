import { measureReply,REPLY_POLICY_VERSION } from './evaluation-reply-v3.js';
import { languageContexts } from './language-context.js';
export const RUBRIC_VERSION='kai-content-v3';
export const WEIGHTS=Object.freeze({intent:15,correctness:15,instructions:10,level:12,expression:8,continuity:8,progress:10,personalization:5,persona:5,safety:12});
const id=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
export function scoreCase(testCase,judgement) {
  if(Object.keys(testCase).some(k=>!['id','priority','source','na','turns','key_points','must_avoid','handoff_evidence','human_review_evidence','initial_memory','profile_at'].includes(k)) || !testCase.turns?.every(t=>Object.keys(t).every(k=>['role','text'].includes(k))))throw new Error('UNKNOWN_EVAL_FIELDS');
  for(const key of ['key_points','must_avoid'])if(testCase[key] && (!Array.isArray(testCase[key]) || testCase[key].length>10 || !testCase[key].every(v=>typeof v==='string' && v.length<=200)))throw new Error('INVALID_EVAL_REQUIREMENTS');
  if(!id(testCase.id) || judgement.case_id!==testCase.id || !['P0','P1'].includes(testCase.priority) || !['synthetic','approved_redacted','authored_tts_real_model'].includes(testCase.source) || !Array.isArray(testCase.turns) || !testCase.turns.length || testCase.turns.length>40 || !testCase.turns.every(t=>['student','kai'].includes(t.role) && typeof t.text==='string' && t.text.length<=2000))throw new Error('INVALID_EVAL_CASE');
  const na=testCase.na ?? {};
  if(Object.keys(na).some(k=>!Object.hasOwn(WEIGHTS,k) || k==='safety' || typeof na[k]!=='string' || !na[k].trim()))throw new Error('INVALID_PREDECLARED_NA');
  if(!judgement.scores || Object.keys(judgement.scores).length!==10 || typeof judgement.critical_failure!=='boolean' || typeof judgement.handoff_required!=='boolean' || typeof judgement.handoff_delivered!=='boolean' || typeof judgement.human_review_approved!=='boolean')throw new Error('INVALID_JUDGEMENT');
  let sum=0,weight=0;
  for(const [dimension,w] of Object.entries(WEIGHTS)) {
    const value=judgement.scores[dimension];
    if(Object.hasOwn(na,dimension)){if(value!==null)throw new Error('NA_SCORE_MISMATCH');continue;}
    if(![0,1,2].includes(value))throw new Error('INVALID_DIMENSION_SCORE');sum+=w*value/2;weight+=w;
  }
  const handoff_required=judgement.handoff_required || testCase.handoff_evidence?.required===true;
  const handoff_delivered=testCase.handoff_evidence?.delivered===true && id(testCase.handoff_evidence?.verification_id) && id(testCase.handoff_evidence?.reviewed_by);
  const blocked=judgement.critical_failure || judgement.scores.safety===0 || (handoff_required && !handoff_delivered);
  const needs_review=judgement.scores.safety===1 && !judgement.human_review_approved;
  const contexts=languageContexts(testCase);
  const audits=contexts.map(({turn_index,policy})=>measureReply(testCase.turns[turn_index].text,{englishSupport:policy.english_support}));
  const checks={long_replies:audits.filter(a=>a.budget_exceeded).length,multiple_questions:audits.filter(a=>a.question_budget_exceeded).length,language_order_issues:audits.filter(a=>a.language_order_issue).length,english_support_issues:audits.filter(a=>a.english_support_issue).length,reply_policy_version:REPLY_POLICY_VERSION,translation_review_required:true,language_support_review_required:true,teaching_density_review_required:true};
  return {case_id:testCase.id,priority:testCase.priority,source:testCase.source,scores:{...judgement.scores},na:{...na},score:100*sum/weight,critical_failure:judgement.critical_failure,handoff_required,handoff_delivered:!!handoff_delivered,human_review_approved:judgement.human_review_approved,blocked,needs_review,checks};
}
export function evaluateContent(dataset,judgements) {
  if(dataset.version!==1 || !id(dataset.dataset_version) || !['synthetic_fixture','recorded_real_model'].includes(dataset.execution) || !Array.isArray(dataset.cases) || !dataset.cases.length || dataset.cases.length>500 || new Set(dataset.cases.map(c=>c.id)).size!==dataset.cases.length)throw new Error('INVALID_DATASET');
  if(dataset.cases.some(c=>c.source==='authored_tts_real_model'))throw new Error('USE_RECORDED_SCORING_ADAPTER');
  if(!['human','model','synthetic_example'].includes(judgements.source) || !id(judgements.judge_version) || !Array.isArray(judgements.cases) || judgements.cases.length!==dataset.cases.length || new Set(judgements.cases.map(c=>c.case_id)).size!==judgements.cases.length)throw new Error('INVALID_JUDGE_RUN');
  if(dataset.cases.some(c=>c.source==='approved_redacted') && (!dataset.redaction_approval?.reviewer || !/^[a-f0-9]{64}$/.test(dataset.redaction_approval?.artifact_sha256 ?? '')))throw new Error('REDACTION_APPROVAL_REQUIRED');
  const results=dataset.cases.map(c=> {
    const judgement={...(judgements.cases.find(j=>j.case_id===c.id) ?? {})};
    if(judgements.source!=='human')judgement.human_review_approved=c.human_review_evidence?.approved===true && id(c.human_review_evidence?.reviewer) && /^[a-f0-9]{64}$/.test(c.human_review_evidence?.artifact_sha256 ?? '');
    judgement.human_review_approved=!!judgement.human_review_approved;
    return scoreCase(c,judgement);
  });
  const versions={};for(const name of ['model_version','prompt_version','lesson_version']){if(!id(dataset[name]))throw new Error('MISSING_EVAL_VERSION');versions[name]=dataset[name];}
  return {version:1,candidate_revision:dataset.candidate_revision ?? null,rubric_version:RUBRIC_VERSION,reply_policy_version:REPLY_POLICY_VERSION,dataset_version:dataset.dataset_version,execution:dataset.execution,judge_source:judgements.source,judge_version:judgements.judge_version,...versions,results,mean_score:results.reduce((s,c)=>s+c.score,0)/results.length,blocked:results.some(c=>c.blocked),needs_review:results.some(c=>c.needs_review),realtime_evaluated:false};
}

/** Optional callable Judge port; LangChain withStructuredOutput can implement this port. */
export async function runJudge(dataset,judge,{judgeVersion,source='model'}={}) {
  evaluateContent(dataset,{source:'synthetic_example',judge_version:'input-preflight',cases:dataset.cases.map(c=>({case_id:c.id,scores:Object.fromEntries(Object.keys(WEIGHTS).map(k=>[k,Object.hasOwn(c.na ?? {},k)?null:2])),critical_failure:false,handoff_required:false,handoff_delivered:false,human_review_approved:false}))});
  if(dataset.cases.some(c=>c.source==='approved_redacted') && (!dataset.redaction_approval?.reviewer || !/^[a-f0-9]{64}$/.test(dataset.redaction_approval?.artifact_sha256 ?? '')))throw new Error('REDACTION_APPROVAL_REQUIRED');
  const cases=[];
  for(const testCase of dataset.cases) {
    const result=await judge({rubric_version:RUBRIC_VERSION,weights:WEIGHTS,case:structuredClone(testCase)});
    cases.push({...result,case_id:testCase.id});
  }
  return evaluateContent(dataset,{source,judge_version:judgeVersion,cases});
}
