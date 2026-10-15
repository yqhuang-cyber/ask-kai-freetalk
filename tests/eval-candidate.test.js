import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEvaluationCandidate,verifyEvaluationCandidate,compareAgentReports } from '../apps/eval-runner/src/eval-candidate.js';
import { verifyEvaluationBaseline,BASELINE_PATH } from '../apps/eval-runner/src/eval-baseline.js';
import { sha256,selectCases } from '../apps/eval-runner/src/multiturn-plan.js';
import { adaptRecordedObservations } from '../apps/eval-runner/src/recorded-scoring.js';
const dataBytes=await readFile('docs/eval-datasets/freechat-v3.1/ask-kai-freechat-eval-v3.1.json'),data=JSON.parse(dataBytes),profileBytes=await readFile('docs/protocol/seeduplex-connect.profile.json'),baseline=JSON.parse(await readFile(BASELINE_PATH));
function fixture() {
  const path='packages/agent-core/fixture.js',original=Buffer.from('export const mode="original";'),changed=Buffer.from('export const mode="candidate";');
  const files=new Map([[path,changed],['package.json',Buffer.from(JSON.stringify({dependencies:baseline.dependencies}))],['package-lock.json',Buffer.from('fixture-lock')]]);
  const parent={...baseline,runtime_files:{[path]:sha256(original)},lock_sha256:sha256(files.get('package-lock.json'))};
  return {baseline:parent,agentRevision:'a'.repeat(40),parentRevision:parent.agent_revision,dataBytes,profileBytes,allowedRuntimeChanges:[path],files:()=>[path],read:p=>files.get(p),readAtRevision:(_rev,p)=>files.get(p),path};
}
test('candidate pins changed runtime and committed bytes while original baseline still rejects drift',async()=>{
  const f=fixture(),candidate=await createEvaluationCandidate(f),info=await verifyEvaluationCandidate({...f,candidate});
  assert.equal(info.candidate_verified,true);assert.equal(info.baseline_verified,false);assert.deepEqual(candidate.allowed_runtime_changes,[f.path]);
  await assert.rejects(verifyEvaluationBaseline({...f,baseline:f.baseline}),/RUNTIME_DRIFT/);
});
test('candidate rejects undeclared changes, commit mismatch, input drift, altered manifest and unsafe paths',async()=>{
  const f=fixture(),candidate=await createEvaluationCandidate(f);
  await assert.rejects(createEvaluationCandidate({...f,allowedRuntimeChanges:[]}),/UNDECLARED/);
  await assert.rejects(createEvaluationCandidate({...f,readAtRevision:()=>Buffer.from('uncommitted')}),/COMMIT_MISMATCH/);
  await assert.rejects(createEvaluationCandidate({...f,dataBytes:Buffer.from('other')}),/INPUT_DRIFT/);
  await assert.rejects(createEvaluationCandidate({...f,allowedRuntimeChanges:['packages/../secret']}),/DECLARATION/);
  const altered=structuredClone(candidate);altered.model_version='other';await assert.rejects(verifyEvaluationCandidate({...f,candidate:altered}),/MANIFEST_DRIFT/);
  await assert.rejects(verifyEvaluationCandidate({...f,candidate,read:p=>p==='package-lock.json'?Buffer.from('different'):f.read(p)}),/DEPENDENCY_DRIFT/);
});
test('recorded adapter rejects mixed Agent identity even if model/data/profile agree',()=>{
  const make=(id,agent)=>({version:1,kind:'ask-kai-multiturn-observations',execution:'synthetic_fixture',run_id:id,candidate_revision:'a'.repeat(40),agent_revision:agent,runtime_digest:'c'.repeat(64),baseline_verified:true,
    dataset_version:data.dataset_version,dataset_sha256:sha256(dataBytes),model_version:'fixture',profile_sha256:'b'.repeat(64),policy_versions:{},history_source:'actual_provider_session_only',references_sent_to_model:false,soft_goals_sent_to_model:false,cases:[]});
  const a=make('a','a'.repeat(40)),b=make('b','b'.repeat(40));const cases=selectCases(data,{limit:2});
  for(const [o,c]of [[a,cases[0]],[b,cases[1]]])o.cases=[{case_id:c.id,entry:'free',initial_profile:c.initial_profile,expected_turns:c.turns.length,status:'failed',turns:[]}];
  assert.throws(()=>adaptRecordedObservations(data,[a,b],{datasetSha256:sha256(dataBytes)}),/MIXED_AGENT/);
});
function report({candidate=false}={}) {
  return {version:1,kind:'ask-kai-recorded-score-report',execution:'synthetic_fixture',judge_source:'synthetic_example',judge_version:'fixture-v1',agent_revision:(candidate?'b':'a').repeat(40),runtime_digest:(candidate?'d':'c').repeat(64),evaluation_contract_kind:candidate?'candidate':'baseline',candidate_verified:candidate,
    dataset_version:'fixture',dataset_sha256:'e'.repeat(64),profile_sha256:'f'.repeat(64),model_version:'fixture',rubric_version:'kai-content-v3',review_calibration_version:'kai-recorded-review-v2',weights:{intent:1},artifact_sha256:'f'.repeat(64),coverage:{expected_turns:2},results:[
      {unit_id:'one',case_id:'case',kind:'original_case',status:'review',critical_failure:false,scores:{intent:1},score:50,authored_case_comparable:true,criteria:[{id:'criterion',score:1}]},
      {unit_id:'two',case_id:'case',kind:'original_case',status:'review',critical_failure:false,scores:{intent:1},score:50,authored_case_comparable:false,criteria:[{id:'criterion',score:1}]}]};
}
test('version comparison keeps input-shifted gains out of improvement and exposes critical failures',()=>{
  const a=report(),b=report({candidate:true});for(const r of b.results){r.score=100;r.criteria[0].score=2;}b.results[1].critical_failure=true;
  const c=compareAgentReports(a,b);assert.equal(c.counts.comparable,1);assert.equal(c.counts.improved,1);assert.equal(c.counts.not_comparable,1);assert.equal(c.counts.new_critical_failures,1);assert.equal(c.units[1].score_delta,null);
});
test('version comparison rejects changed rubric/profile/criteria and an unverified candidate',()=>{
  const a=report();for(const change of [b=>b.profile_sha256='0'.repeat(64),b=>delete b.profile_sha256,b=>b.weights.intent=2,b=>b.judge_version='different',b=>b.review_calibration_version='other',b=>b.results[0].criteria[0].id='other',b=>b.candidate_verified=false]){const b=report({candidate:true});change(b);assert.throws(()=>compareAgentReports(a,b));}
  const b=report({candidate:true});b.results[0].scores=null;assert.equal(compareAgentReports(a,b).counts.comparable,0);
});
