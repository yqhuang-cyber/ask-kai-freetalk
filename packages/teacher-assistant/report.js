import {isDeepStrictEqual} from 'node:util';
import {VERSION,digest,requireThat,validEvidence,validPlan} from './contracts.js';
import {ANALYSIS_VERSION} from './report-observations.js';
import {analyzeLearning,projectAnalysis} from './learning-analysis.js';
export class ReportAnalyzer {
  analyze(plan,evidence,attempt){validPlan(plan);validEvidence(evidence,attempt,plan);
    const eligible=evidence.ready&&!['authorization_revoked','safety_restricted'].includes(evidence.end_reason);
    const analysis=analyzeLearning(evidence,eligible,plan);
    const goals=plan.goals.map(goal=>{const refs=eligible?evidence.observations.filter(o=>o.goal_id===goal.id):[];return {id:goal.id,label:goal.label,status:refs.length?'attempt_observed':'unassessed',description:refs.length?'本次识别文本中观察到相关表达尝试。':'当前有限规则和可用记录不足以判断，不表示不会。',evidence:refs,support_basis:'unknown'};});
    return {schema_version:VERSION,analyzer:ANALYSIS_VERSION,source:'bounded_session_evidence',plan_hash:plan.hash,attempt_id:attempt.id,session_id:attempt.session_id,evidence_hash:digest(evidence),voice_source:evidence.voice_source,grade:null,goals,analysis,
      headline:!eligible||!evidence.final_turns?'本次可用记录不足，无法判断练习表现。':`本次从情境理解、表达组织和求助策略回看${plan.pack.topic}练习；结论仅限可核实证据。`,
      suggestion:analysis.next_steps[0].activity,
      help_requests:eligible?evidence.help_requests:[],replies:eligible?evidence.replies:[],coverage:{final_turns:evidence.final_turns,truncated:evidence.truncated,complete_transcript:false},limitations:['分析规则限于部分点餐表达和问答；未覆盖的表达不判错误。','无法判断独立完成、掌握程度、发音或真人实际听到的内容。',...(evidence.truncated?['部分证据超过保留上限；本报告仅分析已保留片段，不能代表整场。']:[]),...(evidence.analysis_version===undefined?['旧版证据未收集问答关系，理解情况保持未评估。']:[])],mastery:'unassessed',pronunciation:'unassessed'};
  }
}
// This release admits one deterministic analyzer. A future model analyzer needs
// its own semantic admission and source validation, not just matching hashes.
export function validateReport(report,plan,evidence,attempt){
  requireThat(isDeepStrictEqual(report,new ReportAnalyzer().analyze(plan,evidence,attempt)),'INVALID_REPORT_ANALYSIS');return report;
}
export function projectReport(report,role){
  const base={schema_version:report.schema_version,submission_id:report.submission_id,attempt_id:report.attempt_id,session_id:report.session_id,plan_hash:report.plan_hash,voice_source:report.voice_source,headline:report.headline,suggestion:report.suggestion,goals:report.goals.map(g=>({id:g.id,label:g.label,status:g.status,description:g.description})),limitations:report.limitations,...(report.analysis?{analysis:projectAnalysis(report.analysis,role==='teacher')}:{})};
  return role==='teacher'?{...base,analyzer:report.analyzer,evidence_hash:report.evidence_hash,goals:report.goals,help_requests:report.help_requests,replies:report.replies,coverage:report.coverage,grade:null}:base;
}
