import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RunnableLambda } from '@langchain/core/runnables';
import { evaluateContent,scoreCase,runJudge,WEIGHTS } from '../apps/eval-runner/src/content.js';
import { createLangChainJudge } from '../apps/eval-runner/src/langchain-judge.js';
import { exportLangfuseScores } from '../apps/eval-runner/src/langfuse.js';
import { releaseStatus,RELEASE_ARTIFACTS } from '../packages/policy/release.js';
const dataset=JSON.parse(await readFile(new URL('./fixtures/content-cases.json',import.meta.url)));
const judged=JSON.parse(await readFile(new URL('./fixtures/content-judgements.json',import.meta.url)));
test('rubric weights total 100 and predeclared NA is renormalized',()=> {
  assert.equal(Object.values(WEIGHTS).reduce((s,w)=>s+w,0),100);
  const judgement=structuredClone(judged.cases[0]);judgement.scores.intent=0;
  const row=scoreCase(dataset.cases[0],judgement);assert.ok(Math.abs(row.score-(100*80/95))<.00001);
  const invalid=structuredClone(judgement);invalid.scores.correctness=null;assert.throws(()=>scoreCase(dataset.cases[0],invalid),/DIMENSION/);
  assert.throws(()=>scoreCase({...dataset.cases[0],na:{safety:'skip'}},judgement),/NA/);
});
test('critical/safety failures and unsupported human handoff cannot be hidden by high average',()=> {
  const candidate=structuredClone(judged);candidate.cases[0].critical_failure=true;
  assert.equal(evaluateContent(dataset,candidate).blocked,true);
  candidate.cases[0].critical_failure=false;candidate.cases[0].scores.safety=0;assert.equal(evaluateContent(dataset,candidate).blocked,true);
  candidate.cases[0].scores.safety=1;assert.equal(evaluateContent(dataset,candidate).needs_review,true);
  const noEvidence=structuredClone(dataset);delete noEvidence.cases.find(c=>c.id==='seed-safety').handoff_evidence;
  assert.equal(evaluateContent(noEvidence,judged).blocked,true);
});
test('evaluation report contains scores/versions only, not source dialogue',()=> {
  const report=evaluateContent(dataset,judged);assert.equal(report.execution,'synthetic_fixture');assert.equal(report.realtime_evaluated,false);
  assert.ok(!JSON.stringify(report).includes('我喜欢足球'));assert.equal(report.results.length,8);
});
test('LangChain structured Judge runs through the callable port; unapproved data never reaches it',async()=> {
  let invocations=0;
  const fakeModel={withStructuredOutput:schema=>{assert.equal(schema.additionalProperties,false);return RunnableLambda.from(()=>{invocations++;return {...judged.cases[0],human_review_approved:false};});}};
  const single={...dataset,cases:[dataset.cases[0]]};
  const report=await runJudge(single,createLangChainJudge(fakeModel),{judgeVersion:'test-judge'});assert.equal(invocations,1);assert.equal(report.judge_source,'model');
  const invalid={...single,cases:[{...single.cases[0],source:'production_child_raw'}]};await assert.rejects(runJudge(invalid,()=>{assert.fail('must not send');},{judgeVersion:'test'}));
});
test('Langfuse exports numeric scores with idempotent IDs and no transcript',async()=> {
  const report=evaluateContent({...dataset,cases:[dataset.cases[0]]},{...judged,cases:[judged.cases[0]]});const sent=[];
  const result=await exportLangfuseScores({report,baseUrl:'https://langfuse.example',publicKey:'test-public',secretKey:'test-secret',runId:'test-run',traceIds:{'seed-likes':'existing-test-trace'},fetcher:async(url,options)=>{assert.equal(url,'https://langfuse.example/api/public/scores');assert.equal(options.redirect,'error');sent.push(JSON.parse(options.body));return new Response('{}');}});
  assert.equal(result.submitted,11);assert.equal(result.persistence_verified,false);assert.ok(!JSON.stringify(sent).includes('我喜欢足球'));
  await assert.rejects(exportLangfuseScores({report,baseUrl:'http://unsafe',publicKey:'x',secretKey:'x',runId:'test',traceIds:{}}),/CONFIG/);
});
test('release is blocked by missing real acceptance and by synthetic score demos',()=> {
  const report=evaluateContent(dataset,judged),revision='a'.repeat(40);
  const status=releaseStatus(null,report,{revision});assert.equal(status.ready,false);assert.ok(status.blockers.includes('provider_voice_acceptance_missing'));assert.ok(status.blockers.includes('real_model_content_evaluation_required'));
});
test('release requires matching reviewed artifacts, calibrated threshold and no critical failure',()=> {
  const revision='a'.repeat(40),report={...evaluateContent(dataset,{...judged,source:'human'}),execution:'recorded_real_model',candidate_revision:revision};
  const evidence={version:1,revision,artifacts:Object.fromEntries(RELEASE_ARTIFACTS.map(name=>[name,{passed:true,revision,reviewer:'test-reviewer',reviewed_at:new Date().toISOString(),sha256:'b'.repeat(64)}])),content_threshold:{score:80,calibrated_by:'test-calibrator',rubric_version:report.rubric_version,judge_version:report.judge_version}};
  assert.equal(releaseStatus(evidence,report,{revision}).ready,true);
  report.results[0].critical_failure=true;assert.equal(releaseStatus(evidence,report,{revision}).ready,false);
});
