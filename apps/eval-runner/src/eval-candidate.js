import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { sha256 } from './multiturn-plan.js';

const revision=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const runtimePath=p=>typeof p==='string'&&/^(?:packages|apps\/(?:realtime-gateway|hskai-mock))\/[A-Za-z0-9_.\/-]+$/.test(p)&&!p.split('/').some(s=>!s||s==='.'||s==='..');
const listFiles=()=>execFileSync('git',['ls-files','packages','apps/realtime-gateway','apps/hskai-mock'],{encoding:'utf8'}).trim().split('\n');
const readRevision=(rev,path)=>execFileSync('git',['show',`${rev}:${path}`],{maxBuffer:8*1024*1024});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=values=>[...values].sort();
const fail=(ok,code)=>{if(!ok)throw new Error(code);};
export const CANDIDATE_VERSION=1;

function validateInputs({baseline,dataBytes,profileBytes}) {
  fail(baseline?.kind==='ask-kai-evaluation-baseline'&&baseline.version===1&&revision(baseline.agent_revision),'INVALID_PARENT_BASELINE');
  fail(sha256(dataBytes)===baseline.dataset_sha256&&sha256(profileBytes)===baseline.profile_sha256,'EVALUATION_INPUT_DRIFT');
}
export async function createEvaluationCandidate({baseline,agentRevision,parentRevision,allowedRuntimeChanges=[],dataBytes,profileBytes,
  read=readFile,files=listFiles,readAtRevision=readRevision}={}) {
  validateInputs({baseline,dataBytes,profileBytes});
  fail(revision(agentRevision)&&revision(parentRevision)&&Array.isArray(allowedRuntimeChanges)&&new Set(allowedRuntimeChanges).size===allowedRuntimeChanges.length&&allowedRuntimeChanges.every(runtimePath),'INVALID_CANDIDATE_DECLARATION');
  const paths=sorted(files());fail(paths.length>0&&new Set(paths).size===paths.length&&paths.every(runtimePath),'INVALID_CANDIDATE_FILE_SET');
  const runtimeFiles={};
  for(const path of paths) {
    const bytes=await read(path),committed=await readAtRevision(agentRevision,path);
    fail(sha256(bytes)===sha256(committed),'CANDIDATE_COMMIT_MISMATCH');runtimeFiles[path]=sha256(bytes);
  }
  const changed=sorted(new Set([...Object.keys(baseline.runtime_files),...paths])).filter(p=>baseline.runtime_files[p]!==runtimeFiles[p]);
  fail(same(changed,sorted(allowedRuntimeChanges)),'UNDECLARED_CANDIDATE_CHANGE');
  const dependencies=JSON.parse(await read('package.json','utf8')).dependencies,lockHash=sha256(await read('package-lock.json'));
  fail(same(dependencies,baseline.dependencies)&&lockHash===baseline.lock_sha256,'AGENT_DEPENDENCY_DRIFT');
  fail(same(JSON.parse(await readAtRevision(agentRevision,'package.json')).dependencies,dependencies)&&sha256(await readAtRevision(agentRevision,'package-lock.json'))===lockHash,'CANDIDATE_COMMIT_MISMATCH');
  return {version:CANDIDATE_VERSION,kind:'ask-kai-evaluation-candidate',agent_revision:agentRevision,parent_agent_revision:parentRevision,
    baseline_agent_revision:baseline.agent_revision,baseline_manifest_sha256:sha256(Buffer.from(JSON.stringify(baseline))),
    dataset_version:baseline.dataset_version,dataset_sha256:baseline.dataset_sha256,profile_sha256:baseline.profile_sha256,
    model_version:baseline.model_version,rubric_version:baseline.rubric_version,
    runtime_files:runtimeFiles,runtime_digest:sha256(Buffer.from(JSON.stringify(runtimeFiles))),allowed_runtime_changes:changed,dependencies,lock_sha256:lockHash,
    historical_baseline_replaced:false};
}
export async function verifyEvaluationCandidate({candidate,...inputs}={}) {
  fail(candidate?.kind==='ask-kai-evaluation-candidate'&&candidate.version===CANDIDATE_VERSION&&candidate.historical_baseline_replaced===false,'INVALID_EVALUATION_CANDIDATE');
  const actual=await createEvaluationCandidate({...inputs,agentRevision:candidate.agent_revision,parentRevision:candidate.parent_agent_revision,allowedRuntimeChanges:candidate.allowed_runtime_changes});
  fail(same(candidate,actual),'CANDIDATE_MANIFEST_DRIFT');
  return {agent_revision:candidate.agent_revision,runtime_digest:candidate.runtime_digest,baseline_verified:false,candidate_verified:true,
    evaluation_contract_kind:'candidate',candidate_manifest_sha256:sha256(Buffer.from(JSON.stringify(candidate))),parent_agent_revision:candidate.parent_agent_revision,
    baseline_agent_revision:candidate.baseline_agent_revision};
}

export function compareAgentReports(before,after) {
  for(const r of [before,after]) {
    fail(r?.kind==='ask-kai-recorded-score-report'&&r.version===1&&revision(r.agent_revision)&&['recorded_real_model','synthetic_fixture'].includes(r.execution)&&
      ['runtime_digest','dataset_sha256','profile_sha256','artifact_sha256'].every(k=>/^[a-f0-9]{64}$/.test(r[k]??''))&&Array.isArray(r.results),'INVALID_AGENT_SCORE_REPORT');
    for(const row of r.results)if(row.scores)fail(Number.isFinite(row.score)&&row.score>=0&&row.score<=100&&Array.isArray(row.criteria)&&new Set(row.criteria.map(c=>c.id)).size===row.criteria.length&&row.criteria.every(c=>typeof c.id==='string'&&[0,1,2,null].includes(c.score)),'INVALID_COMPARISON_SCORE');
  }
  for(const key of ['execution','dataset_version','dataset_sha256','model_version','profile_sha256','rubric_version','review_calibration_version','judge_source','judge_version','weights'])fail(same(before[key],after[key]),'INCOMPARABLE_EVALUATION_CONDITIONS');
  fail(after.evaluation_contract_kind==='candidate'&&after.candidate_verified===true,'VERIFIED_CANDIDATE_REPORT_REQUIRED');
  const rows=new Map(before.results.map(r=>[r.unit_id,r]));fail(rows.size===before.results.length&&new Set(after.results.map(r=>r.unit_id)).size===after.results.length,'DUPLICATE_COMPARISON_UNIT');
  const units=after.results.map(b=>{
    const a=rows.get(b.unit_id);rows.delete(b.unit_id);
    const comparable=!!a&&a.scores&&b.scores&&a.authored_case_comparable===true&&b.authored_case_comparable===true;
    const criterionMap=r=>new Map((r.criteria??[]).map(c=>[c.id,c.score]));
    const ac=criterionMap(a??{}),bc=criterionMap(b);
    if(a&&a.scores&&b.scores)fail(same(sorted(ac.keys()),sorted(bc.keys())),'COMPARISON_CRITERIA_DRIFT');
    const criteria=[...bc].map(([id,score])=>({id,before:ac.get(id)??null,after:score,
      delta:comparable&&ac.get(id)!==null&&ac.has(id)&&score!==null?score-ac.get(id):null}));
    return {unit_id:b.unit_id,case_id:b.case_id,kind:b.kind,before_status:a?.status??'not_in_run',after_status:b.status,
      comparable:!!comparable,score_delta:comparable?b.score-a.score:null,criteria,
      new_critical_failure:b.critical_failure===true&&!!a?.scores&&a.critical_failure===false,
      critical_failure_after:b.critical_failure===true,
      reason:!a?'missing_before':!a.scores||!b.scores?'missing_score':!comparable?'input_or_context_not_comparable':null};
  });
  for(const a of rows.values())units.push({unit_id:a.unit_id,case_id:a.case_id,kind:a.kind,before_status:a.status,after_status:'not_in_run',comparable:false,score_delta:null,criteria:[],new_critical_failure:false,critical_failure_after:false,reason:'missing_after'});
  const comparable=units.filter(u=>u.comparable);
  return {version:1,kind:'ask-kai-agent-version-comparison',before_agent_revision:before.agent_revision,after_agent_revision:after.agent_revision,
    before_runtime_digest:before.runtime_digest,after_runtime_digest:after.runtime_digest,runtime_changed:before.runtime_digest!==after.runtime_digest,
    dataset_sha256:before.dataset_sha256,rubric_version:before.rubric_version,review_calibration_version:before.review_calibration_version,
    before_artifact_sha256:before.artifact_sha256,after_artifact_sha256:after.artifact_sha256,
    coverage:{before:before.coverage,after:after.coverage},summary_coverage:{before:before.summary_coverage,after:after.summary_coverage},
    counts:{comparable:comparable.length,improved:comparable.filter(u=>u.score_delta>0||u.criteria.some(c=>c.delta>0)).length,
      regressed:comparable.filter(u=>u.score_delta<0||u.criteria.some(c=>c.delta<0)).length,not_comparable:units.length-comparable.length,
      new_critical_failures:units.filter(u=>u.new_critical_failure).length,critical_failures_after:units.filter(u=>u.critical_failure_after).length},
    units,human_review_approved:false,real_experience_accepted:false,
    note:'Improvement and regression can overlap within a turn. Missing/input-shifted records never count as improvement. Summary coverage is not learning quality; timing correlation is not a confirmed cause.'};
}
