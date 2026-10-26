import {VERSION,digest,validEvidence,validPlan} from './contracts.js';
export class ReportAnalyzer {
  analyze(plan,evidence,attempt){validPlan(plan);validEvidence(evidence,attempt);
    const eligible=evidence.ready&&!['authorization_revoked','safety_restricted'].includes(evidence.end_reason);
    const goals=plan.goals.map(goal=>{const refs=eligible?evidence.observations.filter(o=>o.goal_id===goal.id):[];return {id:goal.id,label:goal.label,status:refs.length?'attempt_observed':'unassessed',description:refs.length?'本次识别文本中观察到相关表达尝试。':'当前有限规则和可用记录不足以判断，不表示不会。',evidence:refs,support_basis:'unknown'};});
    return {schema_version:VERSION,analyzer:'authored-dining-rules-v1',source:'bounded_session_evidence',plan_hash:plan.hash,attempt_id:attempt.id,session_id:attempt.session_id,evidence_hash:digest(evidence),voice_source:evidence.voice_source,grade:null,goals,
      headline:!eligible||!evidence.final_turns?'本次可用记录不足，无法判断练习表现。':'本次记录了点餐交流；以下只描述可核验的表达尝试。',
      suggestion:goals.some(g=>g.id==='taste_preference'&&g.status==='attempt_observed')?'下次可以尝试把食物和口味要求连成一句话。':'下次可以练习在点单后补充一句口味要求，例如“不要辣”。',
      help_requests:evidence.help_requests,replies:evidence.replies,coverage:{final_turns:evidence.final_turns,truncated:evidence.truncated,complete_transcript:false},limitations:['规则只支持部分完整点餐表达；未知改述未评估。','无法判断独立完成、掌握程度、发音或真人实际听到的内容。'],mastery:'unassessed',pronunciation:'unassessed'};
  }
}
export function projectReport(report,role){
  const base={schema_version:report.schema_version,submission_id:report.submission_id,attempt_id:report.attempt_id,session_id:report.session_id,plan_hash:report.plan_hash,voice_source:report.voice_source,headline:report.headline,suggestion:report.suggestion,goals:report.goals.map(g=>({id:g.id,label:g.label,status:g.status,description:g.description})),limitations:report.limitations};
  return role==='teacher'?{...base,analyzer:report.analyzer,evidence_hash:report.evidence_hash,goals:report.goals,help_requests:report.help_requests,replies:report.replies,coverage:report.coverage,grade:null}:base;
}
