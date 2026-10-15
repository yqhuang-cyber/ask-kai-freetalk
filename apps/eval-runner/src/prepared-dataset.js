import { WEIGHTS,RUBRIC_VERSION } from './content.js';
import { REPLY_BUDGET,REPLY_POLICY_VERSION } from './evaluation-reply-v3.js';
import { LANGUAGE_POLICY_VERSION,LanguageSupport } from './evaluation-language-v3.js';

const text=v=>typeof v==='string'&&v.trim().length>0;
const list=v=>Array.isArray(v)&&v.length>0&&v.every(text);
const assert=(condition,code)=>{if(!condition)throw new Error(code);};
const sameObject=(a,b)=>a&&Object.keys(a).length===Object.keys(b).length&&Object.entries(b).every(([k,v])=>a[k]===v);
const modes=['required','adaptive','off'];

function checkAuthoredTurn(c,t){
  const e=t.expected,g=e.language_ground_truth;
  assert(g?.annotation_source==='authored_semantic_review'&&g.derived_from_runtime===false&&modes.includes(g.mode)&&g.mode===e.english_support&&g.chinese_first===true&&g.semantic_review_required===true&&text(g.basis),'INVALID_AUTHORED_LANGUAGE');
  assert(t.language_preview?.normative===false&&t.language_preview.must_not_define_gold===true&&t.language_preview.label==='implementation_diagnostic_only','RUNTIME_PREVIEW_AS_GOLD');
  assert(Array.isArray(g.known_expression_evidence)&&g.known_expression_evidence.every(k=>text(k.expression)&&k.mastery_proven===false&&Number.isInteger(k.source_turn)&&k.source_turn>=1&&k.source_turn<=t.turn&&k.available_from_turn===k.source_turn&&(
    k.kind==='student_explicit_self_report'&&text(k.quote)&&c.turns[k.source_turn-1].input.text.includes(k.quote)&&c.turns[k.source_turn-1].input.text.includes(k.expression)||
    k.kind==='declared_scenario_assumption'&&k.source_turn===1&&c.initial_state.profile.known_expressions.includes(k.expression)
  )),'INVALID_AUTHORED_KNOWN_EVIDENCE');
  const criteria=e.criteria,ids=new Set(criteria?.map(a=>a.id));
  assert(Array.isArray(criteria)&&criteria.length>=e.must.length&&ids.size===criteria.length&&criteria.every(a=>text(a.id)&&text(a.requirement)&&text(a.score_2)&&text(a.score_1)&&text(a.score_0)&&list(a.dimensions)&&a.dimensions.every(d=>Object.hasOwn(WEIGHTS,d))&&text(a.evidence))&&e.must.every(s=>criteria.some(a=>a.kind==='must'&&a.requirement===s)),'MISSING_AUTHORED_CRITERIA');
  assert(e.dimension_anchors&&Object.keys(e.dimension_anchors).length===10&&Object.keys(WEIGHTS).every(d=>{
    const a=e.dimension_anchors[d];return a&&text(a.score_2)&&text(a.score_1)&&text(a.score_0)&&Array.isArray(a.criteria)&&a.criteria.every(i=>ids.has(i));
  }),'INVALID_AUTHORED_ANCHORS');
  assert(list(e.acceptable_alternatives)&&Array.isArray(e.critical_failure_conditions)&&e.critical_failure_conditions.length===e.critical_failures.length&&e.critical_failures.every(s=>e.critical_failure_conditions.some(a=>a.condition===s&&text(a.decision)&&text(a.evidence_scope))),'MISSING_AUTHORED_CALIBRATION');
  const r=t.reference_candidate;
  assert(text(r?.text)&&r.source==='authored_policy_aligned_example'&&r.judge_only===true&&r.is_actual_model_reply===false&&(!r.exact_match_required||e.one_turn_output?.text===r.text),'INVALID_AUTHORED_REFERENCE');
  const dep=t.context_dependency;
  assert(dep&&['none','prior_reply_semantics'].includes(dep.type)&&dep.reference_history_allowed===false&&Array.isArray(dep.source_turns)&&dep.source_turns.every(n=>Number.isInteger(n)&&n>=1&&n<t.turn)&&text(dep.on_mismatch),'INVALID_AUTHORED_DEPENDENCY');
}

function checkLanguageScenarios(data){
  const scenarios=data.language_scenarios;
  assert(Array.isArray(scenarios)&&scenarios.length>0&&new Set(scenarios.map(s=>s.id)).size===scenarios.length,'INVALID_LANGUAGE_SCENARIOS');
  let count=0;
  for(const s of scenarios){
    const p=s.initial_profile;
    assert(/^ask-kai-language-\d{2}$/.test(s.id)&&s.entry==='free'&&text(s.title)&&['authored_profile_variant','authored_language_transition'].includes(s.kind)&&['auto','zh','zh_en'].includes(p?.support_language)&&['unknown','beginner','comfortable'].includes(p.chinese_comprehension)&&Array.isArray(p.known_expressions)&&p.known_expressions.length<=12&&p.known_expressions.every(text)&&s.profile_evidence?.kind==='declared_synthetic_fixture'&&s.profile_evidence.not_actual_learner_profile===true,'INVALID_LANGUAGE_SCENARIO_PROFILE');
    assert(s.base_case_id===null||data.cases.some(c=>c.id===s.base_case_id&&s.base_turn===1),'INVALID_LANGUAGE_SCENARIO_SOURCE');
    assert(Array.isArray(s.turns)&&s.turns.length>0,'MISSING_LANGUAGE_SCENARIO_TURNS');
    s.turns.forEach((t,i)=>{
      assert(t.turn===i+1&&t.input?.role==='student'&&text(t.input.text)&&modes.includes(t.expected_mode)&&text(t.basis)&&text(t.reference_candidate)&&t.reference_is_judge_only===true&&t.history_rule?.include_reference_kai===false&&t.history_rule.include_future_turns===false&&t.history_rule.include_actual_prior_kai===true&&list(t.must)&&list(t.must_avoid)&&text(t.score_2)&&text(t.score_1)&&text(t.score_0)&&!Object.hasOwn(t,'actual_kai')&&!Object.hasOwn(t,'scores'),'INVALID_LANGUAGE_SCENARIO_TURN');
    });
    count+=s.turns.length;
  }
  assert(data.preparation_check.language_scenario_count===scenarios.length&&data.preparation_check.language_scenario_turn_count===count,'LANGUAGE_SCENARIO_COUNT_MISMATCH');
  return {scenarios:scenarios.length,turns:count};
}

// Preparation checks only: no model call, transcript replay or content score.
export function checkPreparedDataset(data) {
  assert(data?.format==='ask-kai-prepared-eval'&&[1,2].includes(data.version)&&data.status==='prepared_not_executed','INVALID_PREPARED_FORMAT');
  const authored=data.version===2;
  if(authored)assert(data.optimization?.annotation_source==='authored_semantic_review'&&data.optimization.derived_from_runtime===false&&data.rules?.gold_source==='authored_semantic_review_independent_of_runtime','INVALID_AUTHORED_PROVENANCE');
  assert(data.scope?.entry==='free'&&data.scope.modality==='text'&&data.scope.provider_executed===false&&data.scope.judge_executed===false,'INVALID_PREPARED_SCOPE');
  // Authored v2 annotations are pinned to the original preparation contract.
  // Candidate runtime versions must not rewrite their gold or archived preview.
  assert(data.rules?.rubric_version===RUBRIC_VERSION&&data.rules.language_policy_version===(authored?'kai-language-v1':LANGUAGE_POLICY_VERSION)&&data.rules.reply_policy_version===(authored?'kai-reply-v2':REPLY_POLICY_VERSION)&&sameObject(data.rules.weights,WEIGHTS)&&sameObject(data.rules.budget,REPLY_BUDGET),'PREPARED_RULES_DRIFT');
  assert(data.rules.safety_na_allowed===false&&data.source?.original_reference_preserved===true&&/^[a-f0-9]{64}$/.test(data.source.sha256),'INVALID_PREPARED_PROVENANCE');
  assert(Array.isArray(data.cases)&&data.cases.length>0&&new Set(data.cases.map(c=>c.id)).size===data.cases.length,'INVALID_PREPARED_CASES');
  let turns=0,proactive=0;
  for(const c of data.cases){
    assert(/^ask-kai-v2-\d{3}$/.test(c.id)&&c.entry==='free'&&text(c.title),'INVALID_PREPARED_CASE');
    const initial=c.initial_state,profile=initial?.profile;
    assert(initial?.audio_available===false&&initial.image_available===false&&initial.mission_contract===null&&initial.prior_context_status==='not_provided'&&Array.isArray(initial.prior_context)&&initial.prior_context.length===0,'INVALID_PREPARED_INITIAL_CONTEXT');
    assert(profile?.support_language==='auto'&&profile.chinese_comprehension==='unknown'&&Array.isArray(profile.known_expressions)&&profile.known_expressions.length<=12&&new Set(profile.known_expressions).size===profile.known_expressions.length&&profile.known_expressions.every(v=>text(v)&&[...v].length<=16),'INVALID_PREPARED_PROFILE');
    assert(list(initial.unknown_fields)&&Array.isArray(initial.profile_evidence)&&(!profile.known_expressions.length||initial.profile_evidence.some(e=>e.field==='known_expressions'&&e.kind==='scenario_assumption'&&e.source_turn===1&&text(e.basis))),'MISSING_PREPARED_PROFILE_EVIDENCE');
    assert(initial.profile_evidence.every(e=>e.source_turn===1),'FUTURE_INITIAL_PROFILE');
    assert(c.soft_goal?.kind==='inferred_from_opening'&&c.soft_goal.source_turn===1&&c.soft_goal.available_from_turn===1&&c.soft_goal.binding===false&&c.soft_goal.may_change===true&&text(c.soft_goal.text)&&c.opening_context?.available_from_turn===1&&c.opening_context.source_turn===1,'INVALID_PREPARED_GOAL');
    assert(Array.isArray(c.turns)&&c.turns.length>0,'MISSING_PREPARED_TURNS');
    const at=Date.parse('2026-10-10T00:00:00Z');
    const memory=profile.known_expressions.length?[{field:'known_expressions',value:profile.known_expressions,source:'authorized_hskai_profile',updated_at:new Date(at).toISOString(),expires_at:new Date(at+86400000).toISOString()}]:[];
    const language=new LanguageSupport({memory,clock:()=>at});
    c.turns.forEach((t,i)=>{
      assert(t.turn===i+1&&t.input?.role==='student'&&text(t.input.text),'NONCONTIGUOUS_PREPARED_TURNS');
      const h=t.history_rule;
      assert(h?.include_reference_kai===false&&h.include_future_turns===false&&h.include_actual_prior_kai===true&&JSON.stringify(h.prior_student_turns)===JSON.stringify(Array.from({length:i},(_,n)=>n+1)),'PREPARED_HISTORY_LEAK');
      assert(text(t.reference_for_judge_only)&&t.original?.['用户发言']===t.input.text&&t.original?.['参考Kai回复']===t.reference_for_judge_only&&t.original?.['案例编号']===c.id&&Number(t.original?.['轮次'])===t.turn,'PREPARED_SOURCE_CHANGED');
      const e=t.expected;
      assert(list(e?.must)&&list(e.must_avoid)&&list(e.critical_failures)&&text(e.behavior)&&text(e.language_semantics),'MISSING_PREPARED_EXPECTATIONS');
      assert(Array.isArray(e.rubric_dimensions)&&new Set(e.rubric_dimensions).size===10&&Object.keys(WEIGHTS).every(d=>e.rubric_dimensions.includes(d))&&e.predeclared_na&&Object.keys(e.predeclared_na).length===0,'INVALID_PREPARED_RUBRIC');
      assert(modes.includes(e.english_support)&&(authored||t.language_preview?.policy?.english_support===e.english_support)&&t.language_preview.semantic_review_required===true&&t.language_preview.provider_context_ack_verified===false,'INVALID_PREPARED_LANGUAGE');
      if(authored)checkAuthoredTurn(c,t);
      language.observe(t.input.text,{turn_id:`turn-${t.turn}`,source_event_id:`prepared-${t.turn}`,context_version:t.turn+1});
      const computed=language.snapshot(),preview=t.language_preview.policy;
      if(!authored)assert(computed.english_support===preview.english_support&&JSON.stringify(computed.known_expressions)===JSON.stringify(preview.known_expressions??[])&&computed.preference===(preview.preference??'auto')&&computed.comprehension===(preview.comprehension??'unknown'),'PREPARED_LANGUAGE_CONTEXT_LEAK');
      else {
        const known=preview?.known_expressions??[];
        assert(modes.includes(preview?.english_support)&&Array.isArray(known)&&known.length<=12&&new Set(known).size===known.length&&known.every(k=>text(k)&&(profile.known_expressions.includes(k)||c.turns.slice(0,i+1).some(prior=>prior.input.text.includes(k))))&&['auto','zh','zh_en'].includes(preview.preference??'auto')&&['unknown','beginner','comfortable'].includes(preview.comprehension??'unknown'),'PREPARED_LANGUAGE_CONTEXT_LEAK');
        for(const ref of preview.known_expression_evidence??[])if(ref.source==='student_current_session'){
          const n=Number(/^prepared-(\d+)$/.exec(ref.source_event_id??'')?.[1]);
          assert(Number.isInteger(n)&&n>=1&&n<=t.turn&&c.turns[n-1].input.text.includes(ref.value),'PREPARED_LANGUAGE_CONTEXT_LEAK');
        }
      }
      const p=e.proactive;
      assert(p&&p.idle_event===false&&text(p.signal)&&text(p.requirement)&&['student_utterance','none'].includes(p.event)&&((p.signal==='未指定主动检查')===(p.event==='none')),'PREPARED_IDLE_INVENTED');
      if(p.event==='student_utterance')proactive++;
      assert(t.reference_surface_audit?.target==='authored_reference_only'&&t.reference_surface_audit.actual_model_score===null&&!Object.hasOwn(t,'scores')&&!Object.hasOwn(t,'actual_kai'),'PREPARED_FAKE_RESULTS');
      if(i===c.turns.length-1){
        assert(e.behavior==='结束与小结'&&e.summary?.oral==='short_close'&&e.summary.visual==='existing_web_summary'&&e.summary.evidence==='actual_observed_only','INVALID_PREPARED_CLOSE');
        if(authored){
          const s=c.summary_contract;
          assert(e.summary.case_contract_ref===c.id&&s?.acceptance_mode==='conditional_on_actual_history_and_supported_ui'&&list(s.case_topics)&&list(s.forbidden)&&Array.isArray(s.include_if_observed)&&s.include_if_observed.length===s.case_topics.length&&s.include_if_observed.every(a=>s.case_topics.includes(a.expression)&&text(a.condition)&&a.required_card===false)&&Array.isArray(s.student_facts)&&s.student_facts.every(f=>Number.isInteger(f.source_turn)&&f.source_turn>=1&&f.source_turn<=t.turn&&text(f.text)),'INVALID_AUTHORED_SUMMARY');
        }
      }
    });
    turns+=c.turns.length;
  }
  assert(data.source.case_count===data.cases.length&&data.source.turn_count===turns,'PREPARED_COUNT_MISMATCH');
  const report=data.preparation_check;
  assert(report?.case_count===data.cases.length&&report.turn_count===turns&&report.proactive_utterance_count===proactive&&report.actual_scores_present===false&&report.provider_run_count===0&&report.judge_run_count===0,'INVALID_PREPARED_REPORT');
  assert(Array.isArray(data.review_issues)&&data.review_issues.every(r=>data.cases.some(c=>c.id===r.case_id&&Number.isInteger(r.turn)&&r.turn>=0&&r.turn<=c.turns.length)&&text(r.type)&&text(r.observation)&&text(r.resolution)&&text(r.status)),'INVALID_PREPARED_REVIEW');
  const result={status:'preparation_checks_passed',case_count:data.cases.length,turn_count:turns,proactive_utterance_count:proactive,rubric_version:RUBRIC_VERSION,provider_runs:0,judge_runs:0};
  if(authored){
    const scenarios=checkLanguageScenarios(data);
    assert(report.independent_language_turns===turns&&report.score_anchor_turns===turns&&report.candidate_reference_turns===turns&&report.case_specific_summary_contracts===data.cases.length&&report.diagnostic_is_gold===false,'INVALID_AUTHORED_COUNTS');
    return {...result,annotation_source:'authored_semantic_review',language_scenarios:scenarios.scenarios,language_scenario_turns:scenarios.turns,semantic_quality_not_scored:true};
  }
  return result;
}
