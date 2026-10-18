// Metadata-only, opt-in diagnostics. Never copy packets, text, audio, URLs or credentials.
const names=new Set(['session.config','session.ready','session.end','user.speech.started','user.partial','user.final','response.started','response.first_text','response.first_audio','response.complete','event.dropped','cancel.requested','cancel.ack','context.requested','context.applied','caption.received','caption.revealed','caption.cleared','presentation.dropped','audio.capture.started','audio.capture.progress','audio.queued','audio.drained','audio.stopped','audio.muted','browser.failed','manual.interrupt']);
const numeric=new Set(['chars','text_chars','text_deltas','audio_chunks','pcm_duration_ms','elapsed_ms','ack_ms','visible_chars','pending_chars','revealed_chars','queue_ms','scheduled_ms','duration_ms','input_rate','output_rate','frame_ms','caption_interval_ms','cancel_timeout_ms','context_timeout_ms','ready_timeout_ms','frames','sources','context_version']);
const boolean=new Set(['synthetic','provider_ready','speed_explicit','speech_pace_supported','echo_cancellation','noise_suppression','auto_gain_control','muted','active','pending_cancel','pending_context']);
const enums={source:['manual','provider_speech_start','safety','session_end','new_response'],reason:['invalid_event','foreign_session','duplicate_event','event_limit','terminal_session','already_ready','session_not_ready','duplicate_final_turn','reused_response','overlapping_response','unexpected_cancel_ack','inactive_response','ownership','unknown'],state:['active','done','cancelled','cancel_pending','closed','failed'],protocol:['seeduplex-1.2.6.1','reviewed_mapping','synthetic'],code:['CANCEL_ACK_TIMEOUT','CONTEXT_ACK_TIMEOUT','PROVIDER_READY_TIMEOUT','PROVIDER_CANCEL_FAILED','PROVIDER_CONTEXT_FAILED','PROVIDER_PROTOCOL_ERROR','CLIENT_BACKPRESSURE','SESSION_DURATION_LIMIT','CLIENT_HEARTBEAT_TIMEOUT','CLIENT_TRANSPORT_ERROR','INVALID_CLIENT_MESSAGE','CONTROL_RATE_LIMIT','PROVIDER_CONFIGURATION_ERROR','AUTHORIZATION_REVOKED','SAFETY_RESTRICTED','other']};
for(const name of ['speech.candidate','speech.confirmed','response.held','response.released','response.hold.discarded','cancel.sent','cancel.skipped','cancel.ignored'])names.add(name);
for(const key of ['grace_ms','turn_wait_ms','held_ms'])numeric.add(key);
boolean.add('final_received');
enums.source.push('asr_start','asr_confirmed');enums.reason.push('duplicate','completed','replaced','stopped');
enums.code.push('TURN_LIMIT','TURN_FINAL_TIMEOUT','OUTPUT_HOLD_LIMIT');
enums.code.push('PLAYBACK_BACKLOG','PLAYBACK_LIMIT','INVALID_AUDIO','CAPTION_LIMIT','REPLY_LIMIT','PROVIDER_DISCONNECTED','PROVIDER_TRANSPORT_ERROR');
names.add('reply.audit');
names.add('backend.config');enums.business_source=['mock_hskai','external_hskai','unconfigured'];
for(const key of ['chinese_chars','english_words','numeric_units','spoken_units','chinese_sentences','english_sentences','pair_count','question_pairs'])numeric.add(key);
for(const key of ['audit_complete','audit_truncated','budget_exceeded','language_order_issue','english_support_issue','language_context_matched','question_budget_exceeded','translation_review_required','language_support_review_required','teaching_density_review_required'])boolean.add(key);
enums.reply_policy_version=['kai-reply-v1','kai-reply-v2','kai-reply-v3','kai-reply-v4','kai-reply-v5','kai-reply-v6','kai-reply-v7'];
names.add('language.decision');numeric.add('known_expression_count');
names.add('language.reply.completed');
Object.assign(enums,{language_policy_version:['kai-language-v1','kai-language-v2','kai-language-v3','kai-language-v4','kai-language-v5','kai-language-v6'],english_support:['required','adaptive','off'],language_reason:['beginner_or_unknown','explicit_chinese','student_help_or_new_expression','explicit_bilingual','reported_comprehension','known_expressions']});
for(const name of ['caption.mode','caption.playback'])names.add(name);
for(const key of ['played_pcm_ms','received_pcm_ms','queued_pcm_ms','cue_at_ms','phrase_units'])numeric.add(key);
Object.assign(enums,{caption_mode:['waiting_audio','playing','paused','text_only','complete'],caption_policy_version:['kai-captions-v1'],clock_source:['output_timestamp','context_time']});
names.add('summary.finalized');
for(const key of ['summary_attempts','summary_items'])numeric.add(key);
boolean.add('summary_partial');
Object.assign(enums,{summary_policy_version:['kai-summary-v1','kai-summary-v2','kai-summary-v3'],summary_focus:['practice_observed','target_text_observed','conversation_only','insufficient','unavailable'],summary_outcome:['ended','failed']});
names.add('teaching.decision');names.add('teaching.response');
for(const name of ['context.queued','context.confirmation.ignored'])names.add(name);
numeric.add('current_decision_context_version');
numeric.add('current_state_version');
Object.assign(enums,{context_policy_version:['kai-context-v1','kai-context-v2','kai-context-v3','kai-context-v4','kai-context-v5','kai-context-v7','kai-context-v8'],context_scope:['initial','subsequent_inputs']});
enums.reason.push('wrong_version','no_pending');
for(const key of ['applied_context_version','decision_context_version','new_points','turn_count','teaching_cooldown'])numeric.add(key);
for(const key of ['decision_context_matched','goal_attempt_observed','teaching_paused','clarification_pending'])boolean.add(key);
Object.assign(enums,{teaching_policy_version:['kai-teaching-v1','kai-teaching-v2','kai-teaching-v3','kai-teaching-v4','kai-teaching-v5','kai-teaching-v6','kai-teaching-v7','kai-teaching-v8','kai-teaching-v9','kai-teaching-v10','kai-teaching-v11'],action:['RESPOND','FOLLOW_UP','CLARIFY_INTENT','TEACH_TARGET','CLOSE'],decision_reason:['student_end','student_declined','student_changed_topic','student_requested_practice','student_requested_help','student_understanding_help','student_continuation_help','ambiguous_expression','unclear_input','prior_context_reference','clarification_limit','teaching_paused','teaching_cooldown','goal_attempt_observed','relevant_short_answer','ordinary_question','conversation_first'],mode:['sports','mission','free'],interaction:['chat','teach'],support_level:['none','choice','model']});
for(const name of ['planning.started','planning.accepted','planning.rejected','planning.cancelled','conversation_plan.revised'])names.add(name);
for(const key of ['planning_revision','plan_revision','input_revision','profile_level','verified_through_level'])numeric.add(key);
boolean.add('degraded');enums.path=['legacy','shadow','next_turn_advisory','controlled'];enums.planner_kind=['rule','llm'];
Object.assign(enums,{speaking_policy_version:['kai-speaking-v1'],lexical_style:['everyday','precise'],sentence_structure:['simple','linked','flexible'],new_word_policy:['avoid','one_explained','requested_only'],request_scope:['none','reply','session'],speaking_generation_basis:['unknown','confirmed_before_start']});
enums.reason.push('stale','new_input','input_corrected','preferences_changed','session_closed','student_interruption','planning_failed');
enums.summary_policy_version.push('kai-dynamic-summary-v1','kai-dynamic-summary-v2');
enums.goal_status=['active','paused','retired','unverified'];
names.add('planning.resource.unavailable');
enums.reason.push('student_cancelled_goal','student_selected_goal','student_resumed_goal','requested_goal_unverified','accepted_pause','accepted_resume','accepted_goal_replacement','accepted_goal_retirement','reduce_support_after_attempt','prerequisite_context_changed');
enums.rejection_code=['INVALID_CONVERSATION_PROPOSAL','INVALID_PLAN_RESOURCE_REFERENCE','FREE_INITIAL_GOAL_FORBIDDEN','RESOURCE_GOAL_REQUIRED','INITIAL_STRATEGY_CONFLICT','GOAL_KP_MISMATCH','DECLINED_INITIAL_GOAL','SESSION_DECLINED_GOAL_FORBIDDEN','PREREQUISITE_UNVERIFIED','INVALID_SELECTION_BASIS','INVALID_SELECTION_REASON','INVALID_SELECTION_REFERENCE','UNSUPPORTED_ATTEMPT_ASSESSMENT','INTERNAL_REFERENCE_IN_DIRECTIVE','MULTIPLE_QUESTIONS_IN_DIRECTIVE','INVALID_TURN_PROPOSAL','INVALID_TURN_DIRECTIVE','INVALID_SUPPORT_LEVEL','INVALID_NEW_POINT_COUNT','INVALID_REPLY_BUDGET_REF','INVALID_EXPECTED_OBSERVATION','PRIOR_OUTCOME_CONFLICT','INACTIVE_GOAL_ASSESSMENT','INVALID_PRIOR_OUTCOME','INVALID_GOAL_ASSESSMENT','INVALID_GOAL_PATCH','PLAN_EXPIRED','PLAN_POLICY_CONFLICT','CLOSE_TEACHING_FORBIDDEN','UNREQUESTED_CLOSING_FORBIDDEN','INACTIVE_GOAL_TEACHING_FORBIDDEN','LOCAL_HELP_SCOPE_CONFLICT','VALID_EXPRESSION_CORRECTION_FORBIDDEN','GOAL_RESUME_REQUIRES_CHOICE','GOAL_PATCH_REQUIRES_CURRENT_INPUT','GOAL_RETIRE_REQUIRES_CHOICE','GOAL_REPLACEMENT_REQUIRES_CHOICE','GOAL_REPLACEMENT_RESOURCE_OR_PREREQUISITE','PLANNER_UNAVAILABLE','PLANNER_CANCELLED','PLANNER_INVALID_JSON','PLANNER_INVALID_DRAFT','PLANNER_INVALID_RESPONSE','PLANNER_INCOMPLETE_OUTPUT','PLANNER_INPUT_TOO_LARGE','PLANNER_RESPONSE_TOO_LARGE','INVALID_SPEAKING_DIFFICULTY','SPEAKING_CONSTRAINT_CONFLICT','INVALID_SPEAKING_REFERENCE','SPEAKING_TERM_OUT_OF_SCOPE'];
export function metadata(fields={}) {
  const out={};
  if(!fields || typeof fields!=='object' || Array.isArray(fields))return out;
  for(const [key,value] of Object.entries(fields)) {
    if(numeric.has(key) && Number.isFinite(value) && value>=0 && value<=3600000)out[key]=Math.round(value*100)/100;
    else if(boolean.has(key) && typeof value==='boolean')out[key]=value;
    else if(Object.hasOwn(enums,key) && enums[key].includes(value))out[key]=value;
    else if(key==='speech_pace' && ['slow','normal'].includes(value))out[key]=value;
    else if(key==='output_speed' && Number.isFinite(value) && value>=-50 && value<=100)out[key]=value;
    else if(['context_hash','applied_context_hash'].includes(key)&&typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))out[key]=value;
    else if(['response_id','turn_id'].includes(key) && typeof value==='string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value))out[key]=value;
  }
  return out;
}
export function safeObserve(observer,name,fields) {try{observer?.(name,fields);}catch{/* Diagnostics must never change voice behavior. */}}
export class ExperienceTrace {
  constructor({now=()=>performance.now(),limit=2048}={}) {this.now=now;this.limit=Number.isSafeInteger(limit)?Math.max(1,Math.min(4096,limit)):2048;this.reset();}
  reset() {this.started=this.now();this.rows=[];this.aliases={response_id:new Map(),turn_id:new Map()};this.discarded=0;this.providerReady=false;this.kind='not_connected';this.businessSource='unconfigured';}
  record(name,fields={},clock='browser',atMs=this.now()-this.started) {
    if(!names.has(name) || !['browser','gateway'].includes(clock) || !Number.isFinite(atMs) || atMs<0 || atMs>3600000)return;
    const clean=metadata(fields);
    if(clock==='gateway' && name==='backend.config' && clean.business_source)this.businessSource=clean.business_source;
    for(const key of ['response_id','turn_id'])if(clean[key]) {
      const map=this.aliases[key],id=clean[key];delete clean[key];
      if(!map.has(id) && map.size<10000)map.set(id,`${key==='response_id'?'r':'t'}${map.size+1}`);
      if(map.has(id))clean[key==='response_id'?'response_ref':'turn_ref']=map.get(id);
    }
    if(clock==='gateway' && name==='session.config' && typeof clean.synthetic==='boolean')this.kind=clean.synthetic?'synthetic':'real_provider_pending';
    if(clock==='gateway' && name==='session.ready' && clean.provider_ready===true){this.providerReady=true;if(this.kind==='real_provider_pending')this.kind='real_provider';}
    if(this.rows.length===this.limit){this.rows.shift();this.discarded++;}
    this.rows.push({seq:(this.rows.at(-1)?.seq??this.discarded)+1,clock,at_ms:Math.round(atMs*100)/100,name,...clean});
  }
  gateway(row) {if(row && typeof row==='object' && Number.isFinite(row.at_ms))this.record(row.name,row.fields,'gateway',row.at_ms);}
  snapshot({caseId='unselected',outcome='not_run'}={}) {
    const interruptions={},responses=new Map();let maxQueue=0,maxPending=0;
    for(const row of this.rows) {
      if(row.name==='cancel.requested')interruptions[row.source]=(interruptions[row.source]??0)+1;
      maxQueue=Math.max(maxQueue,row.queue_ms??0);maxPending=Math.max(maxPending,row.pending_chars??0);
      if(row.response_ref) {
        const reply=responses.get(row.response_ref)??{response_ref:row.response_ref};responses.set(row.response_ref,reply);
        reply.presentation??={browser_audio_observed:false,caption_observed:false,queue_ms:null,played_pcm_ms:null,drained:false,caption_complete:false,text_only:false,late_events_dropped:0};
        const presentation=reply.presentation;
        if(row.clock==='browser') {
          if(row.name==='audio.queued'){presentation.browser_audio_observed=true;presentation.queue_ms=Math.max(presentation.queue_ms??0,row.queue_ms??0);}
          if(row.name==='audio.drained'){presentation.browser_audio_observed=true;presentation.drained=true;}
          if(row.name==='caption.revealed')presentation.caption_observed=true;
          if(row.name==='caption.playback'){presentation.browser_audio_observed=true;presentation.played_pcm_ms=row.played_pcm_ms??null;presentation.caption_complete=row.caption_mode==='complete';}
          if(row.name==='caption.mode'&&row.caption_mode==='text_only')presentation.text_only=true;
          if(row.name==='presentation.dropped')presentation.late_events_dropped++;
        }
        if(row.name==='response.complete')Object.assign(reply,{state:row.state,text_chars:row.text_chars,text_deltas:row.text_deltas,audio_chunks:row.audio_chunks,received_pcm_ms:row.pcm_duration_ms,gateway_span_ms:row.elapsed_ms});
        if(row.name==='cancel.ack')reply.cancel_ack_ms=row.ack_ms;
        if(row.name==='cancel.requested')reply.cancel_source=row.source;
        if(row.name==='cancel.sent')reply.cancel_dispatch_wait_ms=row.elapsed_ms;
        if(row.name==='cancel.skipped')reply.cancel_skipped_reason=row.reason;
        if(row.name==='response.released')reply.presentation_hold_ms=row.held_ms;
        if(row.name==='response.first_text')reply.first_text_ms=row.elapsed_ms;
        if(row.name==='response.first_audio')reply.first_audio_ms=row.elapsed_ms;
        if(row.name==='caption.revealed') {
          reply.caption_phrases=(reply.caption_phrases??0)+1;
          if(row.clock==='browser' && Number.isFinite(row.played_pcm_ms))reply.caption_played_pcm_ms=row.played_pcm_ms;
          if(row.caption_mode==='text_only')reply.caption_text_only=true;
        }
        if(row.name==='caption.playback' && row.clock==='browser') {
          reply.caption_played_pcm_ms=row.played_pcm_ms;
          reply.caption_clock_source=row.clock_source;
        }
        if(row.name==='teaching.response')reply.teaching_context=Object.fromEntries(Object.entries(row).filter(([key])=>['applied_context_version','applied_context_hash','context_policy_version','current_state_version','current_decision_context_version','decision_context_version','decision_context_matched','pending_context'].includes(key)));
        if(row.name==='reply.audit')reply.reply_audit=Object.fromEntries(Object.entries(row).filter(([key])=>['reply_policy_version','language_policy_version','english_support','language_context_matched','audit_complete','audit_truncated','chinese_chars','english_words','numeric_units','spoken_units','chinese_sentences','english_sentences','pair_count','question_pairs','budget_exceeded','language_order_issue','english_support_issue','question_budget_exceeded','translation_review_required','language_support_review_required','teaching_density_review_required'].includes(key)));
      }
    }
    return {version:1,business_source:this.businessSource,kind:this.kind,provider_ready_observed:this.providerReady,real_experience_accepted:false,case_id:/^E0[1-9]$/.test(caseId)?caseId:'unselected',operator_outcome:['not_run','pass','fail','uncertain'].includes(outcome)?outcome:'not_run',contains_text:false,contains_audio:false,clock_policy:'browser and gateway have independent monotonic origins; compare intervals within one clock only',truncated:this.discarded>0,discarded_rows:this.discarded,summary:{responses:[...responses.values()],interruptions_by_source:interruptions,max_audio_queue_ms:maxQueue,max_caption_pending_chars:maxPending,gateway_dropped_events:this.rows.filter(r=>r.name==='event.dropped').length},timeline:this.rows.map(r=>({...r}))};
  }
}
