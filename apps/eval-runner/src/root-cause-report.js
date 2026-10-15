import { comparableText,sha256 } from './multiturn-plan.js';
import { ROOT_CAUSE_VERSION } from './root-cause-plan.js';

export function compiledContextMetadata(instructions,version,phase) {
  const prefix='本轮语言状态（JSON 数据）：',line=instructions.split('\n').find(line=>line.startsWith(prefix));
  let state=null;try{state=JSON.parse(line?.slice(prefix.length)??'null');}catch{}
  return {version,phase,instructions_sha256:sha256(Buffer.from(instructions)),
    english_support:['required','adaptive','off'].includes(state?.english_support)?state.english_support:null,
    preference:['zh','zh_en','auto'].includes(state?.preference)?state.preference:null,
    comprehension:['comfortable','beginner','unknown'].includes(state?.comprehension)?state.comprehension:null,
    raw_instructions_retained:false,provider_semantic_application_proven:false};
}

// The report describes observable mechanisms, not ten-dimensional scores or
// statistical causal attribution. All strings from actual dialogue stay private.
export function summarizeRootCauseTrial(trial,observations) {
  const c=observations.cases[0];
  const turns=(c?.turns??[]).map(t=>{
    const source=trial.steps.find(s=>s.step===t.turn),e=t.collection_evidence,
      diagnostics=t.diagnostics??[],find=name=>diagnostics.find(d=>d.name===name);
    const decision=find('language.decision'),owner=decision?.fields.turn_id;
    const start=diagnostics.find(d=>d.name==='response.started'&&d.fields.turn_id===owner);
    const sameDecision=d=>d.fields.turn_id===owner&&d.fields.context_version===decision?.fields.context_version;
    const requested=diagnostics.find(d=>d.name==='context.requested'&&sameDecision(d));
    const ack=diagnostics.find(d=>d.name==='context.applied'&&sameDecision(d));
    const response=diagnostics.find(d=>d.name==='teaching.response'&&d.fields.response_id===start?.fields.response_id);
    const providerFinals=e?.events.filter(x=>x.site==='provider_adapter'&&x.name==='user.final')??[];
    const candidate=e?.event_counts['provider_adapter:user.speech.candidate'];
    const latin=(t.actual_kai??'').match(/\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’\-]\p{Script=Latin}[\p{Script=Latin}\p{M}]*)*/gu)??[];
    const hasReply=t.reply_complete===true&&!t.failure&&t.state!=='partial';
    return {step:t.turn,source_case_id:source?.source_case_id,source_turn:source?.source_turn,diagnostic_probe:source?.diagnostic_probe??false,
      reply_complete:hasReply,model_reply_complete:t.model_reply_complete??t.reply_complete,failure:t.failure??null,
      input_audio_sha256:t.input_audio_sha256,input_duration_ms:t.input_audio_duration_ms,
      all_input_enqueued:e?.all_input_enqueued??null,all_input_transport_flushed:e?.all_input_transport_flushed??null,
      enqueue_hash_matches:e?.all_input_enqueued?e.enqueued_sha256===t.input_audio_sha256:null,
      enqueue_intervals:e?.enqueue_intervals??null,provider_receipt_proven:false,
      provider_asr_candidates:candidate?.count??0,provider_asr_finals:providerFinals.length,
      provider_final_before_input_end:e?.provider_final_before_input_end??null,
      provider_reply_before_input_end:e?.provider_reply_before_input_end??null,
      pending_bytes_at_finals:providerFinals.map(f=>f.remaining_input_bytes),
      asr_segments_retained:t.asr_segments?.length??(t.actual_student_transcript?1:0),
      reply_fragments_retained:t.reply_fragments?.length??(t.actual_kai?1:0),
      asr_surface_matches:typeof t.actual_student_transcript==='string'?comparableText(t.actual_student_transcript)===comparableText(t.script_input):null,
      language_decision:decision?.fields.english_support??null,language_reason:decision?.fields.language_reason??null,
      decision_context_version:decision?.fields.context_version??null,
      reply_applied_context_version:response?.fields.applied_context_version??null,
      previously_confirmed_compiled_support:observations.context_compilations?.find(c=>c.version===response?.fields.applied_context_version)?.english_support??null,
      decision_context_matched:response?.fields.decision_context_matched??null,
      gateway_decision_to_reply_start_ms:decision&&start?start.at_ms-decision.at_ms:null,
      gateway_reply_start_to_context_request_ms:start&&requested?requested.at_ms-start.at_ms:null,
      gateway_reply_start_to_ack_ms:start&&ack?ack.at_ms-start.at_ms:null,
      request_turn_matches_reply:decision&&start?decision.fields.turn_id===start.fields.turn_id:null,
      ack_turn_matches_decision:decision&&ack?ack.fields.turn_id===decision.fields.turn_id:null,
      next_turn_context_confirmed:t.context_update_confirmed??false,
      latin_word_count:hasReply?latin.length:null,contains_latin_surface:hasReply?latin.length>0:null,
      content_semantics_scored:false,diagnostic_evidence_truncated:e?.truncated??null};
  });
  return {trial_id:trial.trial_id,condition:trial.condition,family:trial.family,repetition:trial.repetition,
    source_case_id:trial.case_id,source_steps:trial.steps,initial_profile:trial.case.initial_profile,
    collection_status:c?.status??'not_run',failure:c?.failure??null,expected_steps:trial.steps.length,
    valid_steps:turns.filter(t=>t.reply_complete).length,session_terminal:c?.session_terminal??null,
    memory_scope:c?.memory_audit?.scope??null,internal_memory_observed:false,
    persistent_write_calls:c?.memory_audit?.write_calls??null,persistent_delete_calls:c?.memory_audit?.delete_calls??null,
    source_run_id:observations.run_id,turns};
}

export function summarizeRootCauseRun(plan,results,{baselineInfo,runnerRevision,datasetSha256,sourceFixtureRun=38196302477}={}) {
  const trials=results.map(({trial,observations})=>summarizeRootCauseTrial(trial,observations));
  const all=trials.flatMap(t=>t.turns),scope=all.filter(t=>t.source_case_id==='ask-kai-language-08'&&t.source_turn===4);
  return {version:ROOT_CAUSE_VERSION,kind:'ask-kai-root-cause-observable-report',...baselineInfo,runner_revision:runnerRevision,
    dataset_sha256:datasetSha256,source_fixture_run:sourceFixtureRun,observation_scope:'task03_root_cause_diagnostic',
    original_baseline_replaced:false,agent_changed:false,judge_calls:0,content_scored:false,browser_audio_tested:false,playback_measured:false,
    expected_trials:plan.trial_count,attempted_trials:trials.length,expected_steps:plan.max_input_steps,observed_steps:all.length,
    valid_steps:all.filter(t=>t.reply_complete).length,completed_trials:trials.filter(t=>t.collection_status==='collected').length,
    status:trials.length===plan.trial_count&&trials.every(t=>t.collection_status==='collected')?'diagnostics_collected':'diagnostics_with_gaps',
    signals:{language_only_request_steps:scope.length,
      recognized_off:scope.filter(t=>t.language_decision==='off').length,
      late_acks_on_complete_only_requests:scope.filter(t=>t.reply_complete&&t.gateway_reply_start_to_ack_ms>0).length,
      no_latin_surface_despite_late_ack:scope.filter(t=>t.reply_complete&&t.gateway_reply_start_to_ack_ms>0&&t.contains_latin_surface===false).length,
      provider_early_final_steps:all.filter(t=>t.provider_final_before_input_end===true).map(t=>({source_case_id:t.source_case_id,source_turn:t.source_turn,step:t.step})),
      multiple_provider_final_steps:all.filter(t=>t.provider_asr_finals>1).length},
    automatic_causal_verdict:false,limitations:plan.limitations,trials};
}
