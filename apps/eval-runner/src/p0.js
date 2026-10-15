import { readFile } from 'node:fs/promises';
import { evaluateContent,WEIGHTS,RUBRIC_VERSION } from './content.js';
import { P0_CHECKS,P0_SUITE_VERSION } from './p0-rubric.js';
export { P0_CHECKS,P0_SUITE_VERSION } from './p0-rubric.js';
const suite=JSON.parse(await readFile(new URL('../../../docs/p0-regression-cases.json',import.meta.url),'utf8'));
if(suite.version!==1 || suite.suite_version!==P0_SUITE_VERSION)throw new Error('P0_SUITE_VERSION_MISMATCH');
const specs=new Map(suite.content_cases.map(c=>[c.id,c]));
const id=v=>typeof v==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const checkNames=Object.keys(P0_CHECKS);
function preflight(dataset) {
  if(dataset?.p0_suite_version!==P0_SUITE_VERSION || !Array.isArray(dataset.cases) || !dataset.cases.length)throw new Error('P0_DATASET_REQUIRED');
  if(dataset.candidate_revision!==undefined && dataset.candidate_revision!==null && !/^[a-f0-9]{40}$/.test(dataset.candidate_revision))throw new Error('P0_REVISION_REQUIRED');
  if(dataset.execution==='recorded_real_model' && (!/^[a-f0-9]{40}$/.test(dataset.candidate_revision??'') || !id(dataset.redaction_approval?.reviewer)))throw new Error('P0_RECORDED_APPROVAL_REQUIRED');
  for(const c of dataset.cases) {
    if(!specs.has(c?.id) || c.priority!=='P0' || !Array.isArray(c.turns) || c.turns.length<2 || c.turns.length%2 || c.turns.some((t,i)=>t?.role!==(i%2?'kai':'student') || typeof t.text!=='string' || !t.text.trim()))throw new Error('P0_COMPLETED_DIALOGUE_REQUIRED');
    if(Object.keys(c.na??{}).some(k=>k!=='personalization'))throw new Error('P0_REQUIRED_DIMENSION_NA');
    if(c.source!==(dataset.execution==='recorded_real_model'?'approved_redacted':'synthetic'))throw new Error('P0_SOURCE_MISMATCH');
  }
  // Validate the base contract and privacy approval before invoking any Judge.
  // These neutral validation values are never reported as a quality assessment.
  evaluateContent(dataset,{source:'synthetic_example',judge_version:'p0-input-validation',cases:dataset.cases.map(c=>({case_id:c.id,scores:Object.fromEntries(Object.keys(WEIGHTS).map(k=>[k,Object.hasOwn(c.na??{},k)?null:2])),critical_failure:false,handoff_required:false,handoff_delivered:false,human_review_approved:false}))});
}
export function evaluateP0(dataset,judgements) {
  preflight(dataset);
  if(dataset.execution==='recorded_real_model' && !['human','model'].includes(judgements?.source))throw new Error('P0_RECORDED_JUDGE_REQUIRED');
  const base=evaluateContent(dataset,judgements);
  const results=base.results.map(row=> {
    const spec=specs.get(row.case_id),j=judgements.cases.find(c=>c.case_id===row.case_id),values=j.p0_checks;
    if(!values || Object.keys(values).length!==checkNames.length || Object.keys(values).some(k=>!Object.hasOwn(P0_CHECKS,k)))throw new Error('P0_CHECKS_REQUIRED');
    const semantic={},failures=[],reviews=[];
    for(const name of checkNames) {
      const applicable=spec.checks.includes(name),v=values[name];
      if(applicable?![0,1,2].includes(v):v!==null)throw new Error('P0_CHECK_APPLICABILITY_MISMATCH');
      semantic[name]=applicable?['fail','review','pass'][v]:'na';
      if(v===0)failures.push(name);if(v===1)reviews.push(name);
    }
    const deterministic={bilingual_order:row.checks.language_order_issues?'fail':'pass',english_support:row.checks.english_support_issues?'fail':'pass',shared_reply_budget:row.checks.long_replies?'fail':'pass',question_surface:row.checks.multiple_questions?'fail':'pass'};
    for(const [name,status] of Object.entries(deterministic))if(status==='fail')failures.push(name);
    for(const name of ['intent','correctness','instructions','level','expression','continuity','progress']) {
      if(row.scores[name]===0)failures.push(`rubric_${name}`);
      if(row.scores[name]===1)reviews.push(`rubric_${name}`);
    }
    if(row.blocked)failures.push('critical_or_safety');if(row.needs_review)reviews.push('safety_review');
    return {case_id:row.case_id,mode:spec.mode,deterministic,semantic,failures,reviews,status:failures.length?'failed':reviews.length?'review':'passed'};
  });
  const missing=suite.content_cases.filter(c=>!dataset.cases.some(d=>d.id===c.id)).map(c=>c.id);
  const status=results.some(c=>c.status==='failed')?'failed':missing.length?'incomplete':results.some(c=>c.status==='review')?'review':'passed';
  // Do not copy operator-provided N/A prose into a metadata-only report.
  for(const row of base.results)row.na=Object.fromEntries(Object.keys(row.na).map(k=>[k,'Predeclared not applicable.']));
  return {...base,blocked:base.blocked || status==='failed' || missing.length>0,needs_review:base.needs_review || results.some(c=>c.status==='review'),
    p0:{scope:'poc_p0_content',suite_version:P0_SUITE_VERSION,status,coverage:{expected:specs.size,observed:results.length,missing_case_ids:missing,complete:missing.length===0},results,
      recorded_content_checks_passed:status==='passed' && dataset.execution==='recorded_real_model' && ['human','model'].includes(judgements.source),
      full_prd_regression:false,real_experience_accepted:false}};
}
export async function runP0Judge(dataset,judge,{judgeVersion,source='model'}={}) {
  preflight(dataset);
  if(!id(judgeVersion) || !['human','model'].includes(source) || typeof judge!=='function')throw new Error('P0_JUDGE_REQUIRED');
  const snapshot=structuredClone(dataset),cases=[];
  for(const c of snapshot.cases) {
    const spec=specs.get(c.id);
    const result=await judge({rubric_version:RUBRIC_VERSION,weights:WEIGHTS,case:structuredClone(c),
      p0_context:{mode:spec.mode,scenario:spec.scenario,expected:structuredClone(spec.expected)},
      p0_criteria:checkNames.map(name=>({id:name,description:P0_CHECKS[name],applicable:spec.checks.includes(name)}))});
    cases.push({...structuredClone(result),case_id:c.id});
  }
  return evaluateP0(snapshot,{source,judge_version:judgeVersion,cases});
}
