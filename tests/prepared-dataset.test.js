import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPreparedDataset } from '../apps/eval-runner/src/prepared-dataset.js';
import { WEIGHTS,RUBRIC_VERSION } from '../apps/eval-runner/src/content.js';
import { REPLY_BUDGET,REPLY_POLICY_VERSION } from '../apps/eval-runner/src/evaluation-reply-v3.js';
import { LANGUAGE_POLICY_VERSION } from '../apps/eval-runner/src/evaluation-language-v3.js';

// Small authored synthetic fixture; no uploaded learner dialogue is committed.
function fixture(){return {format:'ask-kai-prepared-eval',version:1,status:'prepared_not_executed',
 scope:{entry:'free',modality:'text',provider_executed:false,judge_executed:false},
 rules:{weights:{...WEIGHTS},rubric_version:RUBRIC_VERSION,language_policy_version:LANGUAGE_POLICY_VERSION,reply_policy_version:REPLY_POLICY_VERSION,budget:{...REPLY_BUDGET},safety_na_allowed:false},
 source:{sha256:'a'.repeat(64),case_count:1,turn_count:1,original_reference_preserved:true},
 cases:[{id:'ask-kai-v2-001',entry:'free',title:'synthetic close',initial_state:{prior_context:[],prior_context_status:'not_provided',profile:{support_language:'auto',chinese_comprehension:'unknown',known_expressions:[]},profile_evidence:[],unknown_fields:['profile'],audio_available:false,image_available:false,mission_contract:null},
 soft_goal:{text:'chat briefly',kind:'inferred_from_opening',source_turn:1,available_from_turn:1,binding:false,may_change:true},opening_context:{source_turn:1,available_from_turn:1},
 turns:[{turn:1,input:{role:'student',text:'Bye.'},history_rule:{prior_student_turns:[],include_reference_kai:false,include_future_turns:false,include_actual_prior_kai:true},reference_for_judge_only:'再见。Goodbye.',original:{'案例编号':'ask-kai-v2-001','轮次':'1','用户发言':'Bye.','参考Kai回复':'再见。Goodbye.'},expected:{behavior:'结束与小结',must:['respect close'],must_avoid:['invented learning'],critical_failures:['false mastery'],language_semantics:'Chinese first',english_support:'required',rubric_dimensions:Object.keys(WEIGHTS),predeclared_na:{},proactive:{signal:'未指定主动检查',requirement:'respect intent',event:'none',idle_event:false},summary:{oral:'short_close',visual:'existing_web_summary',evidence:'actual_observed_only'}},language_preview:{policy:{english_support:'required'},semantic_review_required:true,provider_context_ack_verified:false},reference_surface_audit:{target:'authored_reference_only',actual_model_score:null}}]}],
 preparation_check:{case_count:1,turn_count:1,proactive_utterance_count:0,actual_scores_present:false,provider_run_count:0,judge_run_count:0},review_issues:[]};}
test('prepared evaluation data is checked without inventing executed results',()=>{
 assert.deepEqual(checkPreparedDataset(fixture()),{status:'preparation_checks_passed',case_count:1,turn_count:1,proactive_utterance_count:0,rubric_version:RUBRIC_VERSION,provider_runs:0,judge_runs:0});
});
test('reference or future history, future initial goal and unsupported known expressions are rejected',()=>{
 for(const [mutate,code] of [
  [d=>d.cases[0].turns[0].history_rule.include_reference_kai=true,'PREPARED_HISTORY_LEAK'],
  [d=>d.cases[0].turns[0].history_rule.prior_student_turns=[1],'PREPARED_HISTORY_LEAK'],
  [d=>d.cases[0].soft_goal.source_turn=2,'INVALID_PREPARED_GOAL'],
  [d=>d.cases[0].initial_state.profile.known_expressions=['茶'],'MISSING_PREPARED_PROFILE_EVIDENCE'],
  [d=>d.cases[0].turns[0].original['参考Kai回复']='changed','PREPARED_SOURCE_CHANGED'],
  [d=>d.cases[0].turns[0].expected.proactive.idle_event=true,'PREPARED_IDLE_INVENTED'],
  [d=>d.cases[0].turns[0].reference_surface_audit.actual_model_score=100,'PREPARED_FAKE_RESULTS'],
  [d=>d.cases[0].turns[0].language_preview.policy.known_expressions=['茶'],'PREPARED_LANGUAGE_CONTEXT_LEAK'],
  [d=>d.cases[0].turns[0].expected.predeclared_na.progress='social','INVALID_PREPARED_RUBRIC'],
  [d=>d.rules.weights.intent=14,'PREPARED_RULES_DRIFT'],
  [d=>d.source.turn_count=2,'PREPARED_COUNT_MISMATCH'],
 ]){const d=fixture();mutate(d);assert.throws(()=>checkPreparedDataset(d),{message:code});}
});

function authoredFixture(){
 const d=fixture();d.version=2;
 d.rules.language_policy_version='kai-language-v1';d.rules.reply_policy_version='kai-reply-v2';
 d.optimization={annotation_source:'authored_semantic_review',derived_from_runtime:false};
 d.rules.gold_source='authored_semantic_review_independent_of_runtime';
 const c=d.cases[0],t=c.turns[0],e=t.expected;
 t.input.text='I already know 再见. Bye.';t.original['用户发言']=t.input.text;
 e.english_support='adaptive';
 e.language_ground_truth={annotation_source:'authored_semantic_review',derived_from_runtime:false,mode:'adaptive',chinese_first:true,semantic_review_required:true,basis:'Explicit self-report about a bounded word; not a mastery observation',known_expression_evidence:[{expression:'再见',kind:'student_explicit_self_report',quote:'I already know 再见',source_turn:1,available_from_turn:1,mastery_proven:false}]};
 t.language_preview={...t.language_preview,normative:false,must_not_define_gold:true,label:'implementation_diagnostic_only'};
 e.criteria=e.must.map((s,i)=>({id:`criterion-${i}`,kind:'must',requirement:s,score_2:s,score_1:'partial without contradiction',score_0:'explicitly violated',dimensions:['intent'],evidence:'actual reply'}));
 e.dimension_anchors=Object.fromEntries(Object.keys(WEIGHTS).map(dim=>[dim,{score_2:'fully meets this turn',score_1:'minor omission',score_0:'contradicts this turn',criteria:[]} ]));
 e.acceptable_alternatives=['short natural equivalent'];
 e.critical_failure_conditions=e.critical_failures.map(s=>({condition:s,decision:'explicit evidence only',evidence_scope:'actual reply and prior actual history'}));
 e.summary.case_contract_ref=c.id;
 t.reference_candidate={text:'再见。',source:'authored_policy_aligned_example',judge_only:true,is_actual_model_reply:false,exact_match_required:false};
 t.context_dependency={type:'none',reference_history_allowed:false,source_turns:[],on_mismatch:'mark context_mismatch'};
 c.summary_contract={acceptance_mode:'conditional_on_actual_history_and_supported_ui',case_topics:['再见'],forbidden:['invented mastery'],include_if_observed:[{expression:'再见',condition:'only if actually present',required_card:false}],student_facts:[]};
 d.language_scenarios=[{id:'ask-kai-language-01',entry:'free',title:'synthetic Chinese preference',kind:'authored_profile_variant',base_case_id:c.id,base_turn:1,initial_profile:{support_language:'zh',chinese_comprehension:'comfortable',known_expressions:['再见']},profile_evidence:{kind:'declared_synthetic_fixture',not_actual_learner_profile:true},turns:[{turn:1,input:{role:'student',text:'Bye.'},expected_mode:'off',basis:'Explicit declared preference',reference_candidate:'再见。',reference_is_judge_only:true,history_rule:{include_reference_kai:false,include_future_turns:false,include_actual_prior_kai:true},must:['Chinese only'],must_avoid:['English addition'],score_2:'only Chinese',score_1:'minor phrasing issue',score_0:'adds English'}]}];
 Object.assign(d.preparation_check,{independent_language_turns:1,score_anchor_turns:1,candidate_reference_turns:1,case_specific_summary_contracts:1,diagnostic_is_gold:false,language_scenario_count:1,language_scenario_turn_count:1});
 return d;
}
test('authored expectations stay independent of production language predictions',()=>{
 const d=authoredFixture();
 assert.equal(d.cases[0].turns[0].language_preview.policy.english_support,'required');
 const r=checkPreparedDataset(d);
 assert.equal(r.annotation_source,'authored_semantic_review');
 assert.equal(r.language_scenarios,1);
 assert.equal(r.provider_runs,0);
 assert.equal(r.semantic_quality_not_scored,true);
});
test('archived authored previews may disagree with candidate behavior but cannot carry future evidence',()=>{
 const d=authoredFixture();d.cases[0].turns[0].language_preview.policy.english_support='off';
 assert.equal(checkPreparedDataset(d).annotation_source,'authored_semantic_review');
 d.cases[0].turns[0].language_preview.policy.known_expressions=['future-only-expression'];assert.throws(()=>checkPreparedDataset(d),/CONTEXT_LEAK/);
});
test('authored preparation rejects future evidence, reference leakage and fake executed output',()=>{
 for(const [mutate,code] of [
  [d=>d.cases[0].turns[0].expected.language_ground_truth.derived_from_runtime=true,'INVALID_AUTHORED_LANGUAGE'],
  [d=>d.cases[0].turns[0].expected.language_ground_truth.known_expression_evidence[0].source_turn=2,'INVALID_AUTHORED_KNOWN_EVIDENCE'],
  [d=>d.cases[0].turns[0].expected.language_ground_truth.known_expression_evidence[0].quote='unprovided learner declaration','INVALID_AUTHORED_KNOWN_EVIDENCE'],
  [d=>d.cases[0].turns[0].language_preview.normative=true,'RUNTIME_PREVIEW_AS_GOLD'],
  [d=>d.cases[0].turns[0].expected.dimension_anchors.intent.criteria=['missing'],'INVALID_AUTHORED_ANCHORS'],
  [d=>d.cases[0].turns[0].reference_candidate.judge_only=false,'INVALID_AUTHORED_REFERENCE'],
  [d=>d.cases[0].turns[0].context_dependency.source_turns=[1],'INVALID_AUTHORED_DEPENDENCY'],
  [d=>d.cases[0].summary_contract.include_if_observed[0].required_card=true,'INVALID_AUTHORED_SUMMARY'],
  [d=>d.language_scenarios[0].initial_profile.support_language='invalid','INVALID_LANGUAGE_SCENARIO_PROFILE'],
  [d=>d.language_scenarios[0].turns[0].history_rule.include_reference_kai=true,'INVALID_LANGUAGE_SCENARIO_TURN'],
  [d=>d.language_scenarios[0].turns[0].actual_kai='fake reply','INVALID_LANGUAGE_SCENARIO_TURN'],
  [d=>d.preparation_check.language_scenario_turn_count=2,'LANGUAGE_SCENARIO_COUNT_MISMATCH'],
 ]){const d=authoredFixture();mutate(d);assert.throws(()=>checkPreparedDataset(d),{message:code});}
});
