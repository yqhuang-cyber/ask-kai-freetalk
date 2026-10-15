import { sha256,selectCases } from './multiturn-plan.js';
import { COLLECTION_EVIDENCE_VERSION } from './collection-evidence.js';

export const DIAGNOSTIC_CASE_IDS=['ask-kai-v2-007','ask-kai-v2-011','ask-kai-v2-036','ask-kai-v2-040','ask-kai-language-08'];
export function validateDiagnosticRequest(request,{baseline,data,dataSha,profileBytes,env}) {
  const keys=['version','kind','request_id','agent_revision','dataset_sha256','profile_sha256','case_ids','duration_ms','baseline_artifact_sha256'];
  if(request?.version!==1||request.kind!=='ask_kai_collection_diagnostic'||
    !/^collection-diagnostic-\d{4}-\d{2}-\d{2}-\d{2}$/.test(request.request_id??'')||
    request.agent_revision!==baseline.agent_revision||request.dataset_sha256!==dataSha||request.profile_sha256!==sha256(profileBytes)||
    request.baseline_artifact_sha256!=='cb4e93765511348cfdc232779058be8d1e4feb2c436b784cedf68295895c2f73'||
    JSON.stringify(request.case_ids)!==JSON.stringify(DIAGNOSTIC_CASE_IDS)||request.duration_ms!==1200000||
    Object.keys(request).some(k=>!keys.includes(k))||env.GITHUB_REF!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??''))throw new Error('INVALID_COLLECTION_DIAGNOSTIC_REQUEST');
  return selectCases(data,{caseIds:request.case_ids,includeLanguage:true,limit:100});
}

// Metadata-only publication. Findings describe this attempt; no automatic ASR
// semantic judgment, internal memory verdict, score or historical replacement.
export function summarizeCollectionEvidence(observations) {
  const valid=t=>t.reply_complete===true&&!t.failure&&t.state!=='partial';
  const cases=observations.cases.map(c=>({case_id:c.case_id,status:c.status,failure:c.failure,expected_turns:c.expected_turns,
    collected_turns:c.turns.filter(valid).length,
    memory_audit:c.memory_audit??null,session_evidence_truncated:c.collection_evidence?.truncated??null,
    turns:c.turns.map(t=>({case_id:c.case_id,turn:t.turn,reply_complete:valid(t),model_reply_complete:t.model_reply_complete??t.reply_complete,failure:t.failure??null,
      input_audio_sha256:t.input_audio_sha256,asr_surface_match:t.asr_surface_match,
      collection_evidence:t.collection_evidence??null,
      gateway_event_names:[...new Set(t.diagnostics?.map(d=>d.name)??[])],
      context_update_confirmed:t.context_update_confirmed??false}))}));
  const turns=cases.flatMap(c=>c.turns),measured=turns.filter(t=>t.collection_evidence);
  return {kind:'ask-kai-collection-diagnostic-report',version:1,collection_evidence_version:COLLECTION_EVIDENCE_VERSION,
    run_id:observations.run_id,runner_revision:observations.candidate_revision,agent_revision:observations.agent_revision,
    runtime_digest:observations.runtime_digest,dataset_sha256:observations.dataset_sha256,profile_sha256:observations.profile_sha256,
    execution:observations.execution,observation_scope:'task02_independent_diagnostic',historical_baseline_replaced:false,
    input_pcm_scope:'authored_tts_fixtures_only',pacing_changed:false,turn_timeout_ms:45000,judge_calls:0,content_scored:false,
    selected_cases:cases.length,expected_turns:cases.reduce((n,c)=>n+c.expected_turns,0),collected_turns:turns.filter(t=>t.reply_complete).length,
    raw_reported_reply_complete:observations.cases.reduce((n,c)=>n+c.turns.filter(t=>t.reply_complete).length,0),
    measured_input_turns:measured.length,early_provider_finals:measured.filter(t=>t.collection_evidence.provider_final_before_input_end===true).map(t=>`${t.case_id}-t${String(t.turn).padStart(2,'0')}`),
    partial_turns:turns.filter(t=>!t.reply_complete).length,internal_memory_audit_covered:false,playback_measured:false,cases};
}
