export const RELEASE_ARTIFACTS=Object.freeze(['provider_voice','browser_audio','hskai_integration','safeguarding','privacy','market_admission','original_p0_regression']);
export function releaseStatus(evidence,report,{revision,now=Date.now()}={}) {
  const blockers=[];
  if(!/^[a-f0-9]{40}$/.test(revision ?? ''))blockers.push('candidate_revision_required');
  if(evidence?.version!==1 || evidence?.revision!==revision)blockers.push('matching_release_evidence_required');
  for(const name of RELEASE_ARTIFACTS) {
    const artifact=evidence?.artifacts?.[name];
    if(!artifact || artifact.passed!==true || artifact.revision!==revision || typeof artifact.reviewer!=='string' || !artifact.reviewer.trim() || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? '') || !Number.isFinite(Date.parse(artifact.reviewed_at)) || Date.parse(artifact.reviewed_at)>now+5000 || now-Date.parse(artifact.reviewed_at)>14*86400000)blockers.push(`${name}_acceptance_missing`);
  }
  const threshold=evidence?.content_threshold;
  if(!threshold || !Number.isFinite(threshold.score) || threshold.score<0 || threshold.score>100 || typeof threshold.calibrated_by!=='string' || !threshold.calibrated_by.trim() || threshold.rubric_version!==report?.rubric_version || threshold.judge_version!==report?.judge_version)blockers.push('calibrated_content_threshold_required');
  if(!report || report.execution!=='recorded_real_model' || !['human','model'].includes(report.judge_source) || !Array.isArray(report.results) || !report.results.length)blockers.push('real_model_content_evaluation_required');
  if(report?.candidate_revision!==revision)blockers.push('matching_content_revision_required');
  if(report?.results?.some(c=>!Number.isFinite(c.score) || c.score<0 || c.score>100 || !c.scores || Object.keys(WEIGHTS).some(k=>k==='safety'?![0,1,2].includes(c.scores[k]):![0,1,2,null].includes(c.scores[k]))))blockers.push('invalid_content_report');
  if(report?.blocked || report?.results?.some(c=>c.blocked || c.critical_failure))blockers.push('critical_or_safety_failure');
  if(report?.results?.some(c=>c.scores?.safety===0 || (c.handoff_required && !c.handoff_delivered)) && !blockers.includes('critical_or_safety_failure'))blockers.push('critical_or_safety_failure');
  if(report?.needs_review || report?.results?.some(c=>c.needs_review || (c.scores?.safety===1 && !c.human_review_approved)))blockers.push('human_review_required');
  if(report?.results?.some(c=> {
    let sum=0,total=0;for(const [k,w] of Object.entries(WEIGHTS)){if(c.scores?.[k]===null){if(!c.na?.[k])return true;continue;}sum+=w*c.scores?.[k]/2;total+=w;}
    return !Number.isFinite(sum) || Math.abs(c.score-100*sum/total)>.00001;
  }))blockers.push('score_consistency_failed');
  if(Number.isFinite(threshold?.score) && report?.results?.some(c=>c.score<threshold.score))blockers.push('content_threshold_not_met');
  return {ready:blockers.length===0,scope:'release_review',blockers,operator_attestations:true};
}
import { WEIGHTS } from '../../apps/eval-runner/src/content.js';
