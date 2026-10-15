import { evaluateRecorded } from './recorded-scoring.js';
import { REVIEW_CALIBRATION_VERSION } from './review-calibration.js';
import { sha256 } from './multiturn-plan.js';

// One immutable observation bundle; no Agent invocation or reference rewriting.
export function compareRecordedReviews(bundle,before,after) {
  if(after.review_calibration_version!==REVIEW_CALIBRATION_VERSION)throw new Error('CALIBRATED_REVIEW_REQUIRED');
  const a=evaluateRecorded(bundle,before),b=evaluateRecorded(bundle,after),units=new Map(bundle.units.map(u=>[u.id,u]));
  const changes=[];
  for(let i=0;i<a.results.length;i++) {
    const old=a.results[i],next=b.results[i],criteria=[];
    for(const c of next.criteria??[]) {
      const previous=old.criteria?.find(p=>p.id===c.id);
      if(previous?.score!==c.score)criteria.push({id:c.id,before:previous?.score??null,after:c.score,reason:c.reason,attribution:next.finding_attribution?.[`criterion:${c.id}`]??null});
    }
    const dimensions=Object.keys(b.weights).filter(d=>old.scores?.[d]!==next.scores?.[d]).map(d=>({dimension:d,before:old.scores?.[d]??null,after:next.scores?.[d]??null}));
    const asrChanged=old.asr_semantics!==next.asr_semantics,contextChanged=old.context_verdict!==next.context_verdict;
    if(criteria.length||dimensions.length||asrChanged||contextChanged||old.status!==next.status)changes.push({unit_id:next.unit_id,case_id:next.case_id,turn:next.turn,
      before_status:old.status,after_status:next.status,before_score:old.score??null,after_score:next.score??null,dimensions,criteria,
      asr:asrChanged?{before:old.asr_semantics,after:next.asr_semantics,reason:next.asr_review?.reason??null}:null,
      context:contextChanged?{before:old.context_verdict,after:next.context_verdict}:null,reason:next.reason??null,
      evidence_location:{artifact_sha256:bundle.artifact_sha256,unit_id:next.unit_id,source_run_id:units.get(next.unit_id).source_run_id}});
  }
  const distribution=rows=>rows.reduce((counts,r)=>(counts[r.status]=(counts[r.status]??0)+1,counts),{});
  const asr=rows=>rows.filter(r=>r.scores).reduce((counts,r)=>(counts[r.asr_semantics]=(counts[r.asr_semantics]??0)+1,counts),{});
  const summaryChanges=b.summaries.flatMap(s=>{
    const old=a.summaries.find(r=>r.case_id===s.case_id);
    return old?.score===s.score&&old?.status===s.status&&JSON.stringify(old?.evidence_turns)===JSON.stringify(s.evidence_turns)?[]:
      [{case_id:s.case_id,before_score:old?.score??null,after_score:s.score??null,before_status:old?.status??null,after_status:s.status,reason:s.reason,evidence_turns:s.evidence_turns}];
  });
  const comparison={version:1,kind:'ask-kai-recorded-review-comparison',review_calibration_version:REVIEW_CALIBRATION_VERSION,
    artifact_sha256:bundle.artifact_sha256,agent_revision:bundle.agent_revision,runtime_digest:bundle.runtime_digest,dataset_sha256:bundle.dataset_sha256,
    rubric_version:bundle.rubric_version,weights:bundle.weights,observations_changed:false,agent_changed:false,
    before:{judge_version:before.judge_version,judgements_sha256:sha256(Buffer.from(JSON.stringify(before))),coverage:a.coverage,statuses:distribution(a.results),asr:asr(a.results),mean_actual_input_score:a.mean_actual_input_score},
    after:{judge_version:after.judge_version,judgements_sha256:sha256(Buffer.from(JSON.stringify(after))),coverage:b.coverage,statuses:distribution(b.results),asr:asr(b.results),mean_actual_input_score:b.mean_actual_input_score,attribution_counts:b.attribution_counts},
    changed_units:changes.length,changes,summary_changes:summaryChanges,summary_coverage:b.summary_coverage,human_review_approved:false,independent_judge_validation:false,
    note:'Score changes describe review calibration on identical observations, not an Agent quality improvement. Finding attributions are review classifications, not established causes.'};
  return {comparison,before_report:a,after_report:b};
}
