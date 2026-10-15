import { adaptRecordedObservations,reviewTemplate,evaluateRecorded } from './recorded-scoring.js';
import { selectCases } from './multiturn-plan.js';

// Explicit replacement of failed attempts only. Keep all source attempts on disk.
export function selectEvaluationAttempts(observations,{replacementRunIds=[]}={}) {
  const selected=new Map();
  for(const o of observations)for(const c of o.cases??[]) {
    const old=selected.get(c.case_id);
    if(old) {
      if(!replacementRunIds.includes(o.run_id)||old.c.status==='collected')throw new Error('AMBIGUOUS_EVALUATION_ATTEMPTS');
    }
    selected.set(c.case_id,{o,c});
  }
  return observations.map(o=>({...o,cases:o.cases.filter(c=>selected.get(c.case_id).o===o)}));
}
export function fullEvaluationReport(data,observations,{datasetSha256,judgements,agentRevision,runtimeDigest,verificationKind='baseline',replacementRunIds=[]}={}) {
  const all=selectCases(data,{includeLanguage:true,limit:100});
  const attempts=selectEvaluationAttempts(observations,{replacementRunIds});
  const bundle=adaptRecordedObservations(data,attempts,{datasetSha256,caseIds:all.map(c=>c.id),agentRevision,runtimeDigest,verificationKind});
  const reviews=judgements??reviewTemplate(bundle),report=evaluateRecorded(bundle,reviews);
  report.attempts=observations.flatMap(o=>o.cases.map(c=>({run_id:o.run_id,runner_revision:o.candidate_revision,case_id:c.case_id,status:c.status,failure:c.failure,
    selected:attempts.find(a=>a.run_id===o.run_id).cases.some(r=>r.case_id===c.case_id)})));
  report.groups={};
  for(const kind of ['original_case','language_scenario']) {
    const units=report.results.filter(r=>r.kind===kind),scored=units.filter(r=>r.scores);
    report.groups[kind]={expected_cases:bundle.cases.filter(c=>c.kind===kind).length,expected_turns:units.length,scored_turns:scored.length,
      failed_turns:units.filter(r=>r.status==='failed').length,review_turns:units.filter(r=>r.status==='review').length,
      mean_actual_input_score:scored.length?scored.reduce((s,r)=>s+r.score,0)/scored.length:null};
  }
  return {bundle,judgements:reviews,report,markdown:renderEvaluationReport(report)};
}
export function renderEvaluationReport(r) {
  const c=r.coverage,lines=[`# Ask Kai ${r.evaluation_contract_kind==='candidate'?'候选版本':'固定基线'}评测报告`,'',`Agent 版本：\`${r.agent_revision??'未核验'}\`；数据集：\`${r.dataset_version}\`。`,
    `执行：${r.execution}；评分来源：${r.judge_source}／${r.judge_version}。`,'',
    `收集完成 ${c.collected_cases}/${c.expected_cases} 案；有效回复 ${c.eligible_turns}/${c.expected_turns} 轮；已评分 ${c.scored_turns}/${c.expected_turns} 轮；原案例可比 ${c.comparable_turns}/${c.expected_turns} 轮；总结已评分 ${c.scored_summaries}/${c.expected_cases}。`,
    `实际输入平均分：${r.mean_actual_input_score===null?'未评分':r.mean_actual_input_score.toFixed(2)}；原案例可比平均分：${r.mean_authored_case_score===null?'未评分':r.mean_authored_case_score.toFixed(2)}。`,
    '', '完整收集或高均分不等于内容合格。ASR 表面差异须语义复核；时序相关性不证明根因；本报告不完成 Web／设备验收。','',
    '| 问题类别 | 涉及案例 | 记录次数 | 判定边界 |','| --- | ---: | ---: | --- |'];
  for(const g of r.issue_groups)lines.push(`| ${g.type} | ${g.case_count} | ${g.occurrence_count} | 待跨案例复核／对照验证 |`);
  if(!r.issue_groups.length)lines.push('| 尚无已确认或表面提示 | 0 | 0 | 不表示全部合格 |');
  lines.push('','后续修改候选：按输入识别、策略上下文时序、提示词／语言与教学策略、总结证据边界分别分析。保留具体案例与轮次，合并同一偏离的连锁后果，先验证假设，再设计 Agent harness 改动。');
  return lines.join('\n')+'\n';
}
