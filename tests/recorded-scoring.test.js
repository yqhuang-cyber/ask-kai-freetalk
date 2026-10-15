import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptRecordedObservations,reviewTemplate,evaluateRecorded } from '../apps/eval-runner/src/recorded-scoring.js';
import { runRecordedJudge } from '../apps/eval-runner/src/recorded-judge.js';
import { REVIEW_CALIBRATION_VERSION } from '../apps/eval-runner/src/review-calibration.js';
import { compareRecordedReviews } from '../apps/eval-runner/src/review-comparison.js';
import { sha256,selectCases } from '../apps/eval-runner/src/multiturn-plan.js';
import { WEIGHTS } from '../apps/eval-runner/src/content.js';
const bytes=await readFile(new URL('../docs/eval-datasets/freechat-v3.1/ask-kai-freechat-eval-v3.1.json',import.meta.url)),data=JSON.parse(bytes),hash=sha256(bytes);
function observation({caseIds=['ask-kai-v2-001'],real=false}={}) {
  const chosen=selectCases(data,{caseIds,includeLanguage:true,limit:100});
  return {version:1,kind:'ask-kai-multiturn-observations',run_id:'fixture-run',execution:real?'recorded_real_model':'synthetic_fixture',candidate_revision:'a'.repeat(40),
    dataset_version:data.dataset_version,dataset_sha256:hash,model_version:'fixture',profile_sha256:'b'.repeat(64),policy_versions:{rubric:'kai-content-v3'},
    history_source:'actual_provider_session_only',references_sent_to_model:false,soft_goals_sent_to_model:false,
    cases:chosen.map(c=>({case_id:c.id,entry:'free',kind:c.kind,initial_profile:c.initial_profile,expected_turns:c.turns.length,status:'collected',failure:null,
      turns:c.turns.map(t=>({turn:t.turn,script_input:t.text,input_source:real?'authored_tts':'synthetic_fixture',actual_student_transcript:t.text,
        actual_kai:'这是测试回答。 This is a test reply.',reply_complete:true,context_update_confirmed:true,next_turn_context_version:t.turn+1,diagnostics:[]})),
      summary:{focus:'conversation_only'},session_terminal:'session.closed'}))};
}
const adapt=o=>adaptRecordedObservations(data,[o],{datasetSha256:hash});
function judgement(bundle,{real=false}={}) {
  const j=reviewTemplate(bundle);j.source=real?'model':'synthetic_example';j.judge_version='fixture-v1';
  for(const r of j.units){const u=bundle.units.find(u=>u.id===r.unit_id),ev=[{turn:u.turn,role:'kai',start:0,end:u.actual.kai.length}];
    Object.assign(r,{status:'scored',scores:Object.fromEntries(Object.keys(WEIGHTS).map(d=>[d,2])),dimension_evidence:Object.fromEntries(Object.keys(WEIGHTS).map(d=>[d,ev])),
      criteria:u.requirements.criteria.map(c=>({id:c.id,score:2,evidence:ev,reason:'Synthetic grading fixture.'})),asr_semantics:'equivalent',context_verdict:u.context_dependency.type==='none'?'not_required':'valid'});}
  for(const s of j.summaries)Object.assign(s,{status:'scored',score:2,evidence_turns:[1],reason:'Synthetic summary fixture.'});return j;
}
test('adapter binds real history and independent labels; current unit contains no future turns or runtime preview as gold',()=>{
  const o=observation(),b=adapt(o),u=b.units[1];assert.equal(b.units.length,4);assert.equal(u.history.length,1);
  assert.equal(u.history[0].kai,o.cases[0].turns[0].actual_kai);assert.notEqual(u.history[0].kai,u.reference_for_review_only);
  assert.ok(!JSON.stringify(u.history).includes(data.cases[0].turns[0].reference_for_judge_only));
  assert.equal(u.language_expectation.derived_from_runtime,false);assert.equal(u.reference_is_actual_reply,false);assert.equal(u.case.turns.length,2);
  assert.equal(u.requirements.criteria.length,data.cases[0].turns[1].expected.criteria.length);
});
test('adapter rejects duplicate cases/runs, changed scripts, initial profiles, mixed versions and unsafe history provenance',()=>{
  for(const mutate of [o=>o.cases.push(o.cases[0]),o=>o.cases[0].turns[0].script_input='changed',o=>o.cases[0].initial_profile.support_language='zh',o=>o.references_sent_to_model=true,o=>o.dataset_sha256='c'.repeat(64)]){
    const o=observation();mutate(o);assert.throws(()=>adapt(o));}
  const a=observation(),b=observation({caseIds:['ask-kai-v2-002']});b.run_id='other';b.model_version='different';assert.throws(()=>adaptRecordedObservations(data,[a,b],{datasetSha256:hash}),/MIXED/);
});
test('real collection accepts authored TTS only and preserves execution identity instead of claiming human redaction',()=>{
  const o=observation({real:true}),b=adapt(o);assert.equal(b.units[0].case.source,'authored_tts_real_model');
  o.cases[0].turns[0].input_source='approved_recording';assert.throws(()=>adapt(o),/GENERATED_INPUT/);
  assert.throws(()=>evaluateRecorded(b,judgement(b)),/FIXTURE_SCORE_ON_REAL/);
  const report=evaluateRecorded(b,judgement(b,{real:true}));assert.equal(report.execution,'recorded_real_model');assert.equal(report.human_review_approved,false);
});
test('missing/partial turns remain unassessable; later history gaps are never silently filled',()=>{
  const o=observation();o.cases[0].turns[1].reply_complete=false;o.cases[0].status='failed';o.cases[0].failure='TURN_TIMEOUT';
  const b=adapt(o);assert.deepEqual(b.units.map(u=>u.eligible),[true,false,false,false]);
  const r=evaluateRecorded(b,reviewTemplate(b));assert.equal(r.coverage.unassessable_turns,3);assert.equal(r.coverage.pending_turns,1);assert.equal(r.mean_actual_input_score,null);assert.equal(r.complete_scoring,false);
  assert.equal(r.collection_failures[0].failure,'TURN_TIMEOUT');
});
test('a legacy partial or failed fragment marked reply complete never enters scoring or later comparable history',()=>{
  for(const marker of [{state:'partial'},{failure:'MULTIPLE_ASR_TURNS'}]) {
    const o=observation();Object.assign(o.cases[0].turns[1],marker);assert.equal(o.cases[0].turns[1].reply_complete,true);
    const b=adapt(o);assert.deepEqual(b.units.map(u=>u.eligible),[true,false,false,false]);
    assert.equal(b.units[1].unassessable_reason,'collection_incomplete');assert.equal(b.units[2].history.length,1);
    assert.equal(evaluateRecorded(b,reviewTemplate(b)).coverage.unassessable_turns,3);
  }
});

test('explicit fragmented author/provider association is unassessable even with a completed model fragment',()=>{
  const o=observation(),row=o.cases[0].turns[1];row.input_audio_sha256='c'.repeat(64);
  row.author_provider_association={version:1,case_id:o.cases[0].case_id,author_turn:2,input_audio_sha256:row.input_audio_sha256,status:'fragmented',provider_turn_ids:['first','tail'],response_links:[{response_id:'r1',turn_id:'first',model_reply_complete:true}],eligible_as_complete_turn:false,provider_ids_merged:false,truncated:false};
  const b=adapt(o);assert.deepEqual(b.units.map(u=>u.eligible),[true,false,false,false]);assert.equal(b.units[1].unassessable_reason,'author_provider_association_incomplete');
  row.author_provider_association.eligible_as_complete_turn=true;assert.throws(()=>adapt(o),/INVALID_AUTHOR_PROVIDER_ASSOCIATION/);
});
test('ten dimensions reuse existing weights; criterion failure cannot disappear under perfect dimension averages',()=>{
  const b=adapt(observation()),j=judgement(b);j.units[0].criteria[0].score=0;
  const r=evaluateRecorded(b,j);assert.equal(r.results[0].score,100);assert.equal(r.results[0].status,'failed');assert.equal(r.coverage.scored_turns,4);assert.equal(r.complete_scoring,true);
});
test('ASR meaning changes and context mismatches retain actual-input scores but leave authored-case denominator',()=>{
  const b=adapt(observation({caseIds:['ask-kai-v2-006']})),j=judgement(b);j.units[0].asr_semantics='meaning_changed';
  const dep=j.units.find(r=>b.units.find(u=>u.id===r.unit_id).context_dependency.type!=='none');assert.ok(dep);dep.context_verdict='mismatch';
  const r=evaluateRecorded(b,j);assert.equal(r.coverage.scored_turns,12);assert.ok(r.coverage.comparable_turns<12);assert.ok(r.issue_groups.some(g=>g.type==='context_mismatch'));
});
test('every score needs bounded actual evidence; altered artifacts, fake future evidence and omitted criteria are rejected',()=>{
  const b=adapt(observation());for(const mutate of [j=>j.units[0].dimension_evidence.intent[0].turn=9,j=>j.units[0].dimension_evidence.intent[0].end=9999,j=>j.units[0].criteria.pop(),j=>j.units.push(j.units[0])]){
    const j=judgement(b);mutate(j);assert.throws(()=>evaluateRecorded(b,j));}
  const changed=structuredClone(b);changed.units[0].actual.kai='changed';assert.throws(()=>evaluateRecorded(changed,judgement(b)),/ARTIFACT_CHANGED/);
});
test('language control requirements and declared profiles are adapted separately from original cases',()=>{
  const b=adapt(observation({caseIds:['ask-kai-language-03','ask-kai-language-06']}));assert.ok(b.units.every(u=>u.kind==='language_scenario'));
  assert.equal(b.units[0].language_expectation.mode,data.language_scenarios[2].turns[0].expected_mode);assert.equal(b.units[0].case.initial_memory.length,3);
});
test('structured summary evidence exists only at case end; run metadata can prove evaluation isolation independently of answer text',()=>{
  const b=adapt(observation()),j=judgement(b),last=b.units.at(-1);assert.equal(b.units[0].session_summary,null);assert.ok(last.session_summary);
  const summary=[{turn:last.turn,role:'summary',start:0,end:JSON.stringify(last.session_summary).length}];j.units.at(-1).criteria[1].evidence=summary;
  const metadata=[{turn:1,role:'metadata',start:0,end:JSON.stringify(b.units[0].execution_evidence).length}];j.units[0].criteria[0].evidence=metadata;
  assert.equal(evaluateRecorded(b,j).coverage.scored_turns,4);
  j.units[0].criteria[0].evidence=[{turn:1,role:'summary',start:0,end:1}];assert.throws(()=>evaluateRecorded(b,j),/EVIDENCE_RANGE/);
});
test('Judge failure retains pending checkpoint and continues subsequent units; model cannot approve human review',async()=>{
  const b=adapt(observation({real:true})),fixture=judgement(b,{real:true});let calls=0,saves=0;
  const judge=async u=>{calls++;if(calls===2)throw new Error('private upstream error');return {...fixture.units.find(j=>j.unit_id===u.id),human_review_approved:true};};
  const r=await runRecordedJudge(b,judge,{judgeVersion:'fixture-v1',checkpoint:async()=>saves++});assert.equal(calls,4);assert.equal(saves,5);assert.equal(r.report.coverage.scored_turns,3);
  assert.equal(r.judgements.units[1].judge_failure,'JUDGE_CALL_OR_SCHEMA_FAILED');assert.equal(r.report.human_review_approved,false);
});

function calibrated(bundle,review=judgement(bundle)) {
  review.review_calibration_version=REVIEW_CALIBRATION_VERSION;
  for(const j of review.units) {
    const u=bundle.units.find(u=>u.id===j.unit_id);
    j.asr_review={reason:'Fixture student meaning reviewed independently of the reply.',evidence:[{turn:u.turn,role:'student',start:0,end:u.actual.student.length}]};
    j.finding_attribution={};j.calibration_notes={};
    for(const [d,s]of Object.entries(j.scores))if(s<2)j.finding_attribution[`dimension:${d}`]='content_observation';
    for(const c of j.criteria)if(c.score!==2)j.finding_attribution[`criterion:${c.id}`]=c.score===null?'missing_evidence':'content_observation';
  }
  return review;
}
test('calibrated review requires independently scoped ASR evidence and complete low-score attribution',()=>{
  const b=adapt(observation()),j=judgement(b);j.units[0].scores.intent=1;
  const c=calibrated(b,j);assert.equal(evaluateRecorded(b,c).attribution_counts.content_observation,1);
  const missing=structuredClone(c);missing.units[0].finding_attribution={};assert.throws(()=>evaluateRecorded(b,missing),/ATTRIBUTION/);
  const circular=structuredClone(c);circular.units[0].asr_review.evidence[0].role='kai';assert.throws(()=>evaluateRecorded(b,circular),/ASR_REVIEW/);
});
test('capability and missing-input findings stay null, never numeric passes or content failures',()=>{
  const b=adapt(observation()),j=judgement(b);j.units[0].criteria[0].score=null;j.units[0].criteria[0].evidence=[];
  const c=calibrated(b,j),id=`criterion:${c.units[0].criteria[0].id}`;c.units[0].finding_attribution[id]='capability_scope';
  assert.equal(evaluateRecorded(b,c).coverage.scored_criteria,evaluateRecorded(b,judgement(b)).coverage.scored_criteria-1);
  c.units[0].criteria[0].score=1;c.units[0].criteria[0].evidence=[{turn:1,role:'kai',start:0,end:b.units[0].actual.kai.length}];assert.throws(()=>evaluateRecorded(b,c),/REQUIRES_NULL/);
});
test('summary review cannot cite uncollected turns or invent a scored missing summary',()=>{
  const o=observation();o.cases[0].turns[2].reply_complete=false;o.cases[0].status='failed';
  const b=adapt(o),j=judgement(b);j.units=j.units.filter(x=>b.units.find(u=>u.id===x.unit_id).eligible);
  j.summaries[0].evidence_turns=[3];assert.throws(()=>evaluateRecorded(b,j),/SUMMARY_EVIDENCE/);
  j.summaries[0].evidence_turns=[];assert.throws(()=>evaluateRecorded(b,j),/SUMMARY_EVIDENCE/);
  j.summaries[0].evidence_turns=[1,2];assert.equal(evaluateRecorded(b,j).summary_coverage.partial_collection_snapshots,1);
  const empty=observation();empty.cases[0].summary=null;const missing=adapt(empty);assert.throws(()=>evaluateRecorded(missing,judgement(missing)),/SUMMARY_EVIDENCE/);
});
test('review comparison binds both versions to identical observations and reports score/ASR changes',()=>{
  const b=adapt(observation()),before=judgement(b),after=calibrated(b);
  before.units[0].asr_semantics='meaning_changed';after.units[0].scores.progress=1;after.units[0].finding_attribution['dimension:progress']='rubric_constraint';
  const {comparison}=compareRecordedReviews(b,before,after);assert.equal(comparison.changed_units,1);assert.equal(comparison.observations_changed,false);
  assert.equal(comparison.changes[0].asr.after,'equivalent');assert.equal(comparison.changes[0].dimensions[0].dimension,'progress');
  assert.equal(JSON.stringify(comparison).includes(b.units[0].actual.kai),false);
  after.summaries[0].score=1;assert.equal(compareRecordedReviews(b,before,after).comparison.summary_changes[0].after_score,1);
  const altered=structuredClone(after);altered.artifact_sha256='c'.repeat(64);assert.throws(()=>compareRecordedReviews(b,before,altered),/JUDGEMENTS/);
});
test('review attribution cannot excuse a criterion-triggered critical failure',()=>{
  const b=adapt(observation()),j=judgement(b),c=j.units[0].criteria.find(c=>b.units[0].requirements.criteria.find(r=>r.id===c.id).kind==='critical');
  c.score=0;const after=calibrated(b,j);after.units[0].finding_attribution[`criterion:${c.id}`]='unresolved';
  const r=evaluateRecorded(b,after);assert.equal(r.results[0].critical_failure,true);assert.equal(r.results[0].blocked,true);
});
