import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdtemp,writeFile,rm,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RunnableLambda } from '@langchain/core/runnables';
import { evaluateP0,runP0Judge,P0_CHECKS,P0_SUITE_VERSION } from '../apps/eval-runner/src/p0.js';
import { p0Demo } from '../apps/eval-runner/src/p0-demo.js';
import { createLangChainJudge,JUDGE_SCHEMA } from '../apps/eval-runner/src/langchain-judge.js';
const load=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const dataset=await load('./fixtures/p0-content-cases.json'),judgements=await load('./fixtures/p0-content-judgements.json'),suite=await load('../docs/p0-regression-cases.json');
const copy=()=>[structuredClone(dataset),structuredClone(judgements)];
const recorded=()=>{
  const d=structuredClone(dataset);d.execution='recorded_real_model';d.candidate_revision='a'.repeat(40);
  d.redaction_approval={reviewer:'synthetic-contract-reviewer',artifact_sha256:'b'.repeat(64)};
  for(const c of d.cases)c.source='approved_redacted';return d;
};
test('P0 authored demo passes 16 positives and exposes all 10 negative controls without model-quality claims',async()=> {
  const report=await p0Demo();assert.equal(report.fixture_regression_passed,true);assert.equal(report.positive_cases,16);assert.equal(report.negative_controls,10);
  assert.ok(report.controls.every(c=>c.detected));assert.equal(report.model_quality_claimed,false);assert.equal(report.real_experience_accepted,false);assert.equal(report.realtime_evaluated,false);
});
test('P0 matrix covers all entries, fixed baseline scenarios and real existing runtime/browser checks',async()=> {
  assert.equal(suite.suite_version,P0_SUITE_VERSION);
  assert.equal(suite.original_workbook,false);assert.deepEqual(new Set(suite.content_cases.map(c=>c.mode)),new Set(['sports','mission','free']));
  assert.equal(new Set(suite.content_cases.map(c=>c.id)).size,16);
  const manual=await load('../apps/realtime-gateway/public/experience-cases.json'),ids=new Set(manual.cases.map(c=>c.id));
  for(const c of suite.content_cases)assert.ok(c.checks.length && c.expected.length && c.checks.every(k=>Object.hasOwn(P0_CHECKS,k)));
  for(const c of suite.runtime_cases){for(const path of [...c.node_tests,c.browser_check])await access(new URL('../'+path,import.meta.url));assert.ok(c.manual_cases.every(id=>ids.has(id)));}
});
test('perfect weighted scores cannot conceal English-first, shared-length or multiple-question failures',()=> {
  for(const [text,flag] of [['Hello. 你好。','bilingual_order'],[`${'一'.repeat(30)}。 ${Array(19).fill('a').join(' ')}.`,'shared_reply_budget'],['你喜欢足球吗？ Do you like football? 你喜欢篮球吗？ Do you like basketball?','question_surface']]) {
    const [d,j]=copy();d.cases[0].turns[1].text=text;const report=evaluateP0(d,j);
    assert.equal(report.mean_score,100);assert.equal(report.blocked,true);assert.ok(report.p0.results[0].failures.includes(flag));
  }
});
test('every applicable semantic failure blocks independently of a high average',()=> {
  for(const name of Object.keys(P0_CHECKS)) {
    const [d,j]=copy(),spec=suite.content_cases.find(c=>c.checks.includes(name));j.cases.find(c=>c.case_id===spec.id).p0_checks[name]=0;
    const report=evaluateP0(d,j);assert.equal(report.mean_score,100);assert.equal(report.blocked,true);assert.ok(report.p0.results.find(c=>c.case_id===spec.id).failures.includes(name));
  }
});
test('uncertain checks and partial P0 rubric scores require review; explicit rubric failures block',()=> {
  const [d,j]=copy();j.cases[0].p0_checks.translation_alignment=1;j.cases[0].human_review_approved=true;
  const uncertain=evaluateP0(d,j);assert.equal(uncertain.needs_review,true);assert.equal(uncertain.p0.status,'review');assert.equal(uncertain.p0.recorded_content_checks_passed,false);
  j.cases[0].p0_checks.translation_alignment=2;j.cases[0].scores.correctness=1;assert.ok(evaluateP0(d,j).p0.results[0].reviews.includes('rubric_correctness'));
  j.cases[0].scores.correctness=0;assert.ok(evaluateP0(d,j).p0.results[0].failures.includes('rubric_correctness'));
});
test('P0 preserves critical/safety gates and cannot invent a real human handoff',()=> {
  for(const mutate of [j=>j.cases[0].critical_failure=true,j=>j.cases[0].scores.safety=0,j=>{j.cases[0].handoff_required=true;j.cases[0].handoff_delivered=true;}]) {
    const [d,j]=copy();mutate(j);const report=evaluateP0(d,j);assert.equal(report.blocked,true);assert.ok(report.p0.results[0].failures.includes('critical_or_safety'));
  }
  const [d,j]=copy();j.cases[0].scores.safety=1;j.cases[0].human_review_approved=true;assert.equal(evaluateP0(d,j).needs_review,true);
});
test('unknown suites/checks, required NA, mismatched applicability and incomplete reply records reject',()=> {
  const mutations=[(d,j)=>d.p0_suite_version='unknown',(d,j)=>d.cases[0].id='unknown',(d,j)=>j.cases[0].p0_checks.extra=2,
    (d,j)=>j.cases[0].p0_checks.translation_alignment=null,(d,j)=>j.cases[0].p0_checks.respect_choice=2,(d,j)=>delete j.cases[0].p0_checks,
    (d,j)=>d.cases[0].na.correctness='skip',(d,j)=>d.cases[0].turns[1].text='',(d,j)=>d.cases[0].turns.pop(),(d,j)=>d.cases[0].source='approved_redacted'];
  for(const mutate of mutations){const [d,j]=copy();mutate(d,j);assert.throws(()=>evaluateP0(d,j));}
});
test('a passing subset remains incomplete; duplicated or mismatched case sets reject',()=> {
  const [d,j]=copy();d.cases=d.cases.slice(0,1);j.cases=j.cases.slice(0,1);const report=evaluateP0(d,j);
  assert.equal(report.p0.status,'incomplete');assert.equal(report.blocked,true);assert.equal(report.p0.coverage.missing_case_ids.length,15);
  d.cases.push(d.cases[0]);j.cases.push(j.cases[0]);assert.throws(()=>evaluateP0(d,j));
});
test('privacy, candidate revision and Judge-version validation occur before any live Judge invocation',async()=> {
  let calls=0;const judge=()=>{calls++;return judgements.cases[0];};
  const raw=recorded();raw.cases[0].source='production_child_raw';await assert.rejects(runP0Judge(raw,judge,{judgeVersion:'test'}));
  const missing=recorded();delete missing.redaction_approval;await assert.rejects(runP0Judge(missing,judge,{judgeVersion:'test'}));
  const revision=recorded();delete revision.candidate_revision;await assert.rejects(runP0Judge(revision,judge,{judgeVersion:'test'}));
  const hash=recorded();hash.redaction_approval.artifact_sha256='invalid';await assert.rejects(runP0Judge(hash,judge,{judgeVersion:'test'}));
  await assert.rejects(runP0Judge(dataset,judge,{judgeVersion:'bad version'}));assert.equal(calls,0);
  assert.throws(()=>evaluateP0(recorded(),judgements),/RECORDED_JUDGE/);
});
test('P0 reviews the whole multi-turn record, not just its correct final reply, and reports no dialogue or free prose',()=> {
  const [d,j]=copy(),row=d.cases.find(c=>c.id==='P0-C11');row.turns[1].text='Hello. 你好。';row.na.personalization='private-dialogue-marker';
  const report=evaluateP0(d,j);assert.ok(report.p0.results.find(c=>c.case_id===row.id).failures.includes('bilingual_order'));
  const json=JSON.stringify(report);for(const text of ['private-dialogue-marker','我喜欢足球','Hello.'])assert.ok(!json.includes(text));
  assert.equal(report.p0.full_prd_regression,false);assert.equal(report.p0.real_experience_accepted,false);
});
test('structured P0 LangChain Judge uses fixed criteria and copied observations without changing the general schema',async()=> {
  const d=structuredClone(dataset);let calls=0;
  const model={withStructuredOutput:schema=> {
    assert.equal(schema.additionalProperties,false);assert.deepEqual(new Set(schema.properties.p0_checks.required),new Set(Object.keys(P0_CHECKS)));
    return RunnableLambda.from(messages=> {
      calls++;assert.match(messages[0][1],/检查整个多轮对话/);
      const input=JSON.parse(messages[1][1]),spec=suite.content_cases.find(c=>c.id===input.case.id);
      assert.equal(input.p0_context.mode,spec.mode);assert.deepEqual(input.p0_context.expected,spec.expected);assert.equal(input.p0_criteria.length,8);
      d.cases[0].turns[1].text='mutated-after-first-invocation';
      return {...judgements.cases.find(j=>j.case_id===input.case.id),human_review_approved:true};
    });
  }};
  const report=await runP0Judge(d,createLangChainJudge(model,{p0:true}),{judgeVersion:'synthetic-contract-judge'});
  assert.equal(calls,16);assert.equal(report.p0.status,'passed');assert.equal(report.p0.recorded_content_checks_passed,false);
  assert.ok(report.results.every(c=>c.human_review_approved===false));assert.ok(!JUDGE_SCHEMA.properties.p0_checks);assert.ok(!JSON.stringify(report).includes('mutated-after'));
});
test('P0 CLI returns failure for review or incomplete coverage and masks invalid input details',async t=> {
  const dir=await mkdtemp(join(tmpdir(),'ask-kai-p0-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const [d,j]=copy();j.cases[0].p0_checks.translation_alignment=1;
  const dp=join(dir,'cases.json'),jp=join(dir,'judgements.json');await writeFile(dp,JSON.stringify(d));await writeFile(jp,JSON.stringify(j));
  const run=spawnSync(process.execPath,['scripts/p0-eval.js',dp,jp],{encoding:'utf8'});assert.equal(run.status,1);assert.equal(JSON.parse(run.stdout).p0.status,'review');
  const invalid=spawnSync(process.execPath,['scripts/p0-eval.js','private-key-marker'],{encoding:'utf8'});assert.equal(invalid.status,1);assert.equal(invalid.stderr.trim(),'P0_EVAL_FAILED');assert.equal(invalid.stdout,'');
});
