import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectEvaluationAttempts,renderEvaluationReport } from '../apps/eval-runner/src/evaluation-report.js';
test('duplicate attempts are rejected; only an explicitly selected rerun replaces a failed original',()=>{
  const a={run_id:'a',cases:[{case_id:'case1',status:'failed'},{case_id:'case2',status:'collected'}]},b={run_id:'b',cases:[{case_id:'case1',status:'collected'}]};
  assert.throws(()=>selectEvaluationAttempts([a,b]),/AMBIGUOUS/);
  const selected=selectEvaluationAttempts([a,b],{replacementRunIds:['b']});assert.deepEqual(selected[0].cases.map(c=>c.case_id),['case2']);assert.equal(selected[1].cases[0].case_id,'case1');
  const overwrite={run_id:'c',cases:[{case_id:'case2',status:'collected'}]};assert.throws(()=>selectEvaluationAttempts([a,overwrite],{replacementRunIds:['c']}),/AMBIGUOUS/);
});
test('report distinguishes coverage, pending scoring and surface hints without invented means or root causes',()=>{
  const text=renderEvaluationReport({execution:'recorded_real_model',agent_revision:'a'.repeat(40),dataset_version:'fixture',judge_source:'model',judge_version:'fixture',
    coverage:{collected_cases:40,expected_cases:48,eligible_turns:200,expected_turns:255,scored_turns:0,comparable_turns:0,scored_summaries:0},mean_actual_input_score:null,mean_authored_case_score:null,
    issue_groups:[{type:'asr_surface_difference',case_count:12,occurrence_count:20}]});
  assert.ok(text.includes('40/48'));assert.ok(text.includes('未评分'));assert.ok(text.includes('不证明根因'));assert.ok(!text.includes('通过率100'));
});
