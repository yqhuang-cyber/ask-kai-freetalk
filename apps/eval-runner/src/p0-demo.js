import { readFile } from 'node:fs/promises';
import { evaluateP0,P0_SUITE_VERSION } from './p0.js';
export async function p0Demo() {
  const load=async name=>JSON.parse(await readFile(new URL(`../../../tests/fixtures/${name}`,import.meta.url),'utf8'));
  const dataset=await load('p0-content-cases.json'),judgements=await load('p0-content-judgements.json'),challenges=await load('p0-challenges.json');
  const positive=evaluateP0(dataset,judgements),negativeData=structuredClone(dataset),negativeJudgements=structuredClone(judgements);
  negativeData.dataset_version='p0-authored-negative-v1';
  for(const challenge of challenges.cases) {
    const row=negativeData.cases.find(c=>c.id===challenge.case_id);
    row.turns.filter(t=>t.role==='kai')[challenge.kai_turn_index].text=challenge.text;
    const judgement=negativeJudgements.cases.find(j=>j.case_id===challenge.case_id);
    for(const name of challenge.semantic_failures)judgement.p0_checks[name]=0;
  }
  const negative=evaluateP0(negativeData,negativeJudgements);
  const controls=challenges.cases.map(c=> {
    const result=negative.p0.results.find(r=>r.case_id===c.case_id);
    return {case_id:c.case_id,expected:c.expected_failures,observed:result.failures,detected:c.expected_failures.every(name=>result.failures.includes(name))};
  });
  return {version:1,suite_version:P0_SUITE_VERSION,execution:'synthetic_fixture',judge_source:'synthetic_example',
    fixture_regression_passed:positive.p0.status==='passed' && positive.p0.coverage.complete && negative.blocked && controls.every(c=>c.detected),
    positive_cases:positive.p0.results.length,negative_controls:controls.length,controls,
    semantic_labels:'authored_expected_results_not_a_live_judge',model_quality_claimed:false,real_experience_accepted:false,realtime_evaluated:false};
}
