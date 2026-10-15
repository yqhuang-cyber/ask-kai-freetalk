import { scoreCase,WEIGHTS,RUBRIC_VERSION } from './content.js';
import { checkPreparedDataset } from './prepared-dataset.js';
import { selectCases,profileMemory,sha256,comparableText } from './multiturn-plan.js';
import { measureReply } from './evaluation-reply-v3.js';
import { REVIEW_CALIBRATION_VERSION,validateCalibratedTurn } from './review-calibration.js';

const assert=(ok,code)=>{if(!ok)throw new Error(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const dimensions=Object.keys(WEIGHTS),modes=['required','adaptive','off'];
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
const evidenceKey=(id,n,role)=>`${id}/turn-${n}/${role}`;

function languageExpectation(t,kind) {
  if(kind==='original_case')return structuredClone(t.expected.language_ground_truth);
  return {annotation_source:'authored_semantic_review',derived_from_runtime:false,mode:t.expected_mode,basis:t.basis,
    chinese_first:true,semantic_review_required:true,score_2:t.score_2,score_1:t.score_1,score_0:t.score_0};
}
function requirements(t,kind) {
  if(kind==='original_case')return structuredClone(t.expected);
  const criteria=[...t.must.map((requirement,i)=>({id:`language-must-${i+1}`,kind:'must',requirement,dimensions:['instructions'],score_2:t.score_2,score_1:t.score_1,score_0:t.score_0})),
    ...t.must_avoid.map((requirement,i)=>({id:`language-avoid-${i+1}`,kind:'avoid',requirement,dimensions:['instructions'],score_2:'没有禁止行为',score_1:'不确定',score_0:'发生禁止行为'}))];
  return {must:t.must,must_avoid:t.must_avoid,criteria,predeclared_na:{},acceptable_alternatives:['含义准确且满足语言条件的自然说法'],critical_failures:[]};
}

// Only reviewer input: no references or requirements are sent to the Agent.
export function adaptRecordedObservations(data,observations,{datasetSha256,caseIds=[],agentRevision,runtimeDigest,verificationKind='baseline'}={}) {
  checkPreparedDataset(data);
  assert(/^[a-f0-9]{64}$/.test(datasetSha256??''),'SCORING_DATASET_HASH_REQUIRED');
  assert(Array.isArray(observations)&&observations.length>0,'OBSERVATIONS_REQUIRED');
  const all=selectCases(data,{includeLanguage:true,limit:100}),specs=new Map([...data.cases,...data.language_scenarios].map(c=>[c.id,c]));
  const selected=caseIds.length?all.filter(c=>caseIds.includes(c.id)):all.filter(c=>observations.some(o=>o.cases?.some(r=>r.case_id===c.id)));
  assert(selected.length>0&&new Set(caseIds).size===caseIds.length&&(!caseIds.length||selected.length===caseIds.length),'INVALID_SCORING_SELECTION');
  const rows=new Map(),sourceRuns=new Map(),sourceObservations=new Map(),runs=[];let execution,modelVersion,profileHash,policyVersions,identity;
  for(const o of observations) {
    assert(o?.version===1&&o.kind==='ask-kai-multiturn-observations'&&['recorded_real_model','synthetic_fixture'].includes(o.execution)&&o.dataset_sha256===datasetSha256&&o.dataset_version===data.dataset_version&&o.history_source==='actual_provider_session_only'&&o.references_sent_to_model===false&&o.soft_goals_sent_to_model===false&&/^[a-f0-9]{40}$/.test(o.candidate_revision??'')&&Array.isArray(o.cases),'INVALID_RECORDED_OBSERVATIONS');
    if(agentRevision)assert(o.agent_revision===agentRevision&&o.runtime_digest===runtimeDigest&&(verificationKind==='candidate'?o.candidate_verified===true&&o.evaluation_contract_kind==='candidate'&&o.baseline_verified===false:o.baseline_verified===true),'OBSERVED_AGENT_BASELINE_MISMATCH');
    const observedIdentity=[o.agent_revision??null,o.runtime_digest??null,o.evaluation_contract_kind??'baseline',o.candidate_verified===true];
    if(identity)assert(equal(identity,observedIdentity),'MIXED_AGENT_IDENTITIES');else identity=observedIdentity;
    if(execution)assert(execution===o.execution&&modelVersion===o.model_version&&profileHash===o.profile_sha256&&equal(policyVersions,o.policy_versions),'MIXED_EVALUATION_VERSIONS');
    execution=o.execution;modelVersion=o.model_version;profileHash=o.profile_sha256;policyVersions=o.policy_versions;
    assert(!runs.some(r=>r.run_id===o.run_id),'DUPLICATE_OBSERVATION_RUN');runs.push({run_id:o.run_id,runner_revision:o.candidate_revision,input_tts_transport_version:o.input_tts_transport_version??'production-decoder-64k'});
    for(const c of o.cases){assert(specs.has(c.case_id)&&!rows.has(c.case_id),'DUPLICATE_OR_UNKNOWN_OBSERVED_CASE');rows.set(c.case_id,c);sourceRuns.set(c.case_id,o.run_id);sourceObservations.set(c.case_id,o);}
  }
  const bundle={version:1,kind:'ask-kai-recorded-scoring-input',dataset_version:data.dataset_version,dataset_sha256:datasetSha256,
    execution,agent_revision:agentRevision??identity[0],runtime_digest:runtimeDigest??identity[1],model_version:modelVersion,profile_sha256:profileHash,
    evaluation_contract_kind:identity[2],candidate_verified:identity[3],
    policy_versions:policyVersions,rubric_version:RUBRIC_VERSION,weights:{...WEIGHTS},runs,units:[],cases:[],browser_audio_tested:false,real_experience_accepted:false};
  for(const c of selected) {
    const spec=specs.get(c.id),row=rows.get(c.id),history=[];
    if(row)assert(equal(row.initial_profile,c.initial_profile)&&row.entry==='free'&&row.expected_turns===c.turns.length&&Array.isArray(row.turns)&&new Set(row.turns.map(t=>t.turn)).size===row.turns.length&&row.turns.every(t=>Number.isInteger(t.turn)&&t.turn>=1&&t.turn<=c.turns.length),'OBSERVED_CASE_CONTRACT_MISMATCH');
    const cr={case_id:c.id,kind:c.kind,source_run_id:sourceRuns.get(c.id)??null,expected_turns:c.turns.length,collection_status:row?.status??'not_run',collection_failure:row?.failure??null,
      summary:row?.summary??null,summary_contract:structuredClone(spec.summary_contract??{visual:'现有总结，不虚构掌握或发音结论',forbidden:['没有证据的掌握与发音结论']}),
      session_terminal:row?.session_terminal??null,units:[]};bundle.cases.push(cr);
    let prefixComplete=true;
    for(const t of c.turns) {
      const obs=row?.turns.find(x=>x.turn===t.turn),authored=spec.turns[t.turn-1],key=`${c.id}-t${String(t.turn).padStart(2,'0')}`;
      if(obs)assert(obs.script_input===t.text&&['authored_tts','approved_recording','synthetic_fixture'].includes(obs.input_source),'OBSERVED_SCRIPT_MISMATCH');
      if(execution==='recorded_real_model'&&obs)assert(obs.input_source==='authored_tts','GENERATED_INPUT_REQUIRED');
      const association=obs?.author_provider_association;
      if(association)assert(association.version===1&&association.case_id===c.id&&association.author_turn===t.turn&&association.input_audio_sha256===obs.input_audio_sha256&&association.provider_ids_merged===false&&['single','fragmented','unresolved'].includes(association.status)&&typeof association.eligible_as_complete_turn==='boolean'&&Array.isArray(association.provider_turn_ids)&&Array.isArray(association.response_links)&&association.provider_turn_ids.length<=4&&association.response_links.length<=4&&(!association.eligible_as_complete_turn||association.status==='single'&&!association.truncated&&association.provider_turn_ids.length===1&&association.response_links.length===1&&association.response_links[0].model_reply_complete&&association.response_links[0].turn_id===association.provider_turn_ids[0]),'INVALID_AUTHOR_PROVIDER_ASSOCIATION');
      const complete=!!obs?.reply_complete&&!obs.failure&&obs.state!=='partial'&&(!association||association.eligible_as_complete_turn)&&nonempty(obs.actual_student_transcript)&&nonempty(obs.actual_kai);
      const eligible=complete&&prefixComplete&&obs.actual_kai.length<=2000&&obs.actual_student_transcript.length<=2000;
      const reason=association&&!association.eligible_as_complete_turn?'author_provider_association_incomplete':!complete?'collection_incomplete':!prefixComplete?'history_incomplete':!eligible?'evaluator_text_limit':null;
      const req=requirements(authored,c.kind),lang=languageExpectation(authored,c.kind);
      assert(modes.includes(lang.mode),'INVALID_SCORING_LANGUAGE');
      const current=obs?{student:obs.actual_student_transcript??'',kai:obs.actual_kai??''}:null;
      const unit={id:key,case_id:c.id,turn:t.turn,kind:c.kind,eligible,unassessable_reason:reason,
        source_run_id:sourceRuns.get(c.id)??null,input_audio_sha256:obs?.input_audio_sha256??null,input_audio_duration_ms:obs?.input_audio_duration_ms??null,
        author_provider_association:association?structuredClone(association):null,
        input_script:t.text,actual:current,history:structuredClone(history),requirements:req,language_expectation:lang,
        session_summary:t.turn===c.turns.length&&row?.summary?Object.fromEntries(Object.entries(row.summary).filter(([k])=>!['session_id','voice'].includes(k))):null,
        execution_evidence:row?{source_run_id:sourceRuns.get(c.id),history_source:sourceObservations.get(c.id).history_source,references_sent_to_model:sourceObservations.get(c.id).references_sent_to_model,
          soft_goals_sent_to_model:sourceObservations.get(c.id).soft_goals_sent_to_model,baseline_verified:sourceObservations.get(c.id).baseline_verified??false}:null,
        reference_for_review_only:c.kind==='original_case'?authored.reference_candidate.text:authored.reference_candidate,
        reference_is_actual_reply:false,context_dependency:structuredClone(t.dependency),
        asr_surface_match:obs?comparableText(obs.actual_student_transcript??'')===comparableText(t.text):null,
        surface_audit:complete?measureReply(obs.actual_kai,{englishSupport:lang.mode}):null,
        timing:{next_turn_context_version:obs?.next_turn_context_version??null,context_update_confirmed:obs?.context_update_confirmed??false,
          response_context:obs?.diagnostics?.filter(d=>d.name==='teaching.response').map(d=>d.fields)??[],context_acks:obs?.diagnostics?.filter(d=>d.name==='context.applied').map(d=>d.fields)??[]},
        evidence:complete?{[evidenceKey(c.id,t.turn,'student')]:obs.actual_student_transcript,[evidenceKey(c.id,t.turn,'kai')]:obs.actual_kai}:{},
        case:{id:key,priority:'P0',source:execution==='recorded_real_model'?'authored_tts_real_model':'synthetic',na:{},
          turns:complete?[{role:'student',text:obs.actual_student_transcript},{role:'kai',text:obs.actual_kai}]:[],
          initial_memory:profileMemory(c.initial_profile,Date.parse('2026-10-11T00:00:00Z')),profile_at:'2026-10-11T00:00:00Z'}};
      bundle.units.push(unit);cr.units.push(key);
      if(complete)history.push({turn:t.turn,student:obs.actual_student_transcript,kai:obs.actual_kai});
      else prefixComplete=false;
    }
  }
  bundle.artifact_sha256=sha256(Buffer.from(JSON.stringify(bundle)));return bundle;
}

export function reviewTemplate(bundle) {
  return {version:1,kind:'ask-kai-recorded-judgements',artifact_sha256:bundle.artifact_sha256,source:'human',judge_version:'replace-with-review-version',
    units:bundle.units.filter(u=>u.eligible).map(u=>({unit_id:u.id,status:'pending',scores:null,dimension_evidence:null,
      criteria:u.requirements.criteria.map(c=>({id:c.id,score:null,evidence:[],reason:null})),critical_failure:false,handoff_required:false,handoff_delivered:false,human_review_approved:false,
      asr_semantics:u.asr_surface_match?'equivalent':'uncertain',context_verdict:u.context_dependency.type==='none'?'not_required':'uncertain',reason:null})),
    summaries:bundle.cases.map(c=>({case_id:c.case_id,status:'pending',score:null,evidence_turns:[],reason:null}))};
}
function validateEvidence(e,unit) {
  assert(Array.isArray(e)&&e.length>0&&e.length<=12,'SCORING_EVIDENCE_REQUIRED');
  for(const r of e){assert(r&&Number.isInteger(r.turn)&&r.turn>=1&&r.turn<=unit.turn&&['student','kai','summary','metadata'].includes(r.role),'INVALID_SCORE_EVIDENCE');
    const row=r.turn===unit.turn?unit.actual:unit.history.find(h=>h.turn===r.turn),s=r.role==='summary'&&r.turn===unit.turn&&unit.session_summary?JSON.stringify(unit.session_summary):r.role==='metadata'&&r.turn===unit.turn&&unit.execution_evidence?JSON.stringify(unit.execution_evidence):row?.[r.role];
    assert(typeof s==='string'&&Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=s.length,'INVALID_SCORE_EVIDENCE_RANGE');}
}
export function evaluateRecorded(bundle,judgements) {
  const original={...bundle};delete original.artifact_sha256;
  assert(bundle.kind==='ask-kai-recorded-scoring-input'&&sha256(Buffer.from(JSON.stringify(original)))===bundle.artifact_sha256,'SCORING_ARTIFACT_CHANGED');
  assert(judgements?.kind==='ask-kai-recorded-judgements'&&judgements.version===1&&judgements.artifact_sha256===bundle.artifact_sha256&&['human','model','synthetic_example'].includes(judgements.source)&&/^[A-Za-z0-9_.-]{1,100}$/.test(judgements.judge_version??''),'INVALID_RECORDED_JUDGEMENTS');
  assert(bundle.execution!=='recorded_real_model'||judgements.source!=='synthetic_example','FIXTURE_SCORE_ON_REAL_RUN');
  assert(judgements.review_calibration_version===undefined||judgements.review_calibration_version===REVIEW_CALIBRATION_VERSION,'UNKNOWN_REVIEW_CALIBRATION');
  const eligible=bundle.units.filter(u=>u.eligible),byId=new Map((judgements.units??[]).map(j=>[j.unit_id,j]));
  assert(byId.size===judgements.units?.length&&[...byId.keys()].every(id=>eligible.some(u=>u.id===id)),'UNKNOWN_OR_DUPLICATE_JUDGEMENT');
  const results=bundle.units.map(u=>{
    const j=byId.get(u.id),base={unit_id:u.id,case_id:u.case_id,turn:u.turn,kind:u.kind,
      collection:u.eligible?'complete':u.unassessable_reason,asr_surface_match:u.asr_surface_match,timing:u.timing,
      surface_hints:u.surface_audit?{budget_exceeded:u.surface_audit.budget_exceeded,language_order_issue:u.surface_audit.language_order_issue,english_support_issue:u.surface_audit.english_support_issue}:null};
    if(!u.eligible||!j||j.status==='pending')return {...base,status:!u.eligible?'unassessable':'pending',scores:null};
    assert(['scored','unassessable'].includes(j.status)&&['equivalent','meaning_changed','uncertain'].includes(j.asr_semantics)&&['valid','mismatch','uncertain','not_required'].includes(j.context_verdict),'INVALID_REVIEW_VERDICT');
    assert(u.context_dependency.type==='none'?j.context_verdict==='not_required':j.context_verdict!=='not_required','DEPENDENCY_REVIEW_REQUIRED');
    if(j.status==='unassessable'){assert(nonempty(j.reason),'UNASSESSABLE_REASON_REQUIRED');return {...base,status:'unassessable',scores:null,reason:j.reason};}
    assert(j.dimension_evidence&&equal(Object.keys(j.dimension_evidence).sort(),dimensions.slice().sort()),'DIMENSION_EVIDENCE_REQUIRED');
    for(const d of dimensions)validateEvidence(j.dimension_evidence[d],u);
    assert(Array.isArray(j.criteria)&&j.criteria.length===u.requirements.criteria.length&&new Set(j.criteria.map(c=>c.id)).size===j.criteria.length,'CRITERIA_JUDGEMENTS_REQUIRED');
    for(const c of j.criteria){assert(u.requirements.criteria.some(r=>r.id===c.id)&&[0,1,2,null].includes(c.score)&&nonempty(c.reason)&&c.reason.length<=500,'INVALID_CRITERION_SCORE');if(c.score!==null)validateEvidence(c.evidence,u);}
    if(judgements.review_calibration_version)validateCalibratedTurn(u,j,validateEvidence);
    const critical=j.critical_failure||j.criteria.some(c=>c.score===0&&u.requirements.criteria.find(r=>r.id===c.id).kind==='critical');
    const scored=scoreCase(u.case,{...j,case_id:u.id,critical_failure:critical,human_review_approved:judgements.source==='human'&&j.human_review_approved===true});
    const comparable=j.asr_semantics==='equivalent'&&['valid','not_required'].includes(j.context_verdict);
    const criteriaFailed=j.criteria.some(c=>c.score===0),criteriaReview=j.criteria.some(c=>c.score===1||c.score===null);
    return {...base,status:scored.blocked||criteriaFailed||dimensions.some(d=>scored.scores[d]===0)?'failed':scored.needs_review||criteriaReview||!comparable||dimensions.some(d=>scored.scores[d]===1)?'review':'passed',
      scores:scored.scores,score:scored.score,critical_failure:critical,blocked:scored.blocked,handoff_required:scored.handoff_required,handoff_delivered:scored.handoff_delivered,
      dimension_evidence:j.dimension_evidence,criteria:j.criteria,asr_semantics:j.asr_semantics,context_verdict:j.context_verdict,
      ...(judgements.review_calibration_version?{asr_review:j.asr_review,finding_attribution:j.finding_attribution,calibration_notes:j.calibration_notes??{}}:{}),
      authored_case_comparable:comparable,needs_review:!comparable||scored.needs_review||criteriaReview,reason:j.reason??null};
  });
  const sumRows=judgements.summaries??[],summaryIds=new Set(sumRows.map(s=>s.case_id));
  assert(summaryIds.size===sumRows.length&&sumRows.every(s=>bundle.cases.some(c=>c.case_id===s.case_id)),'INVALID_SUMMARY_REVIEWS');
  for(const s of sumRows)if(s.status==='scored'){
    const c=bundle.cases.find(c=>c.case_id===s.case_id),observed=bundle.units.filter(u=>u.case_id===s.case_id&&u.eligible).map(u=>u.turn);
    assert(c.summary&&[0,1,2].includes(s.score)&&nonempty(s.reason)&&Array.isArray(s.evidence_turns)&&new Set(s.evidence_turns).size===s.evidence_turns.length&&(!observed.length||s.evidence_turns.length>0)&&s.evidence_turns.every(n=>observed.includes(n)),'INVALID_SUMMARY_EVIDENCE');
  }
  const scored=results.filter(r=>r.scores),comparable=scored.filter(r=>r.authored_case_comparable);
  const mean=rows=>rows.length?rows.reduce((s,r)=>s+r.score,0)/rows.length:null;
  const report={version:1,kind:'ask-kai-recorded-score-report',artifact_sha256:bundle.artifact_sha256,execution:bundle.execution,agent_revision:bundle.agent_revision,
    runtime_digest:bundle.runtime_digest,dataset_version:bundle.dataset_version,dataset_sha256:bundle.dataset_sha256,model_version:bundle.model_version,profile_sha256:bundle.profile_sha256,
    evaluation_contract_kind:bundle.evaluation_contract_kind??'baseline',candidate_verified:bundle.candidate_verified===true,
    rubric_version:RUBRIC_VERSION,weights:{...WEIGHTS},judge_source:judgements.source,judge_version:judgements.judge_version,
    review_calibration_version:judgements.review_calibration_version??null,
    review_mode:judgements.review_mode??null,external_judge_calls:judgements.external_judge_calls??null,
    coverage:{expected_cases:bundle.cases.length,expected_turns:results.length,eligible_turns:eligible.length,scored_turns:scored.length,comparable_turns:comparable.length,
      expected_criteria:bundle.units.filter(u=>u.eligible).reduce((n,u)=>n+u.requirements.criteria.length,0),scored_criteria:scored.reduce((n,r)=>n+r.criteria.filter(c=>c.score!==null).length,0),
      pending_turns:results.filter(r=>r.status==='pending').length,unassessable_turns:results.filter(r=>r.status==='unassessable').length,
      collected_cases:bundle.cases.filter(c=>c.collection_status==='collected').length,scored_summaries:sumRows.filter(s=>s.status==='scored').length},
    mean_actual_input_score:mean(scored),mean_authored_case_score:mean(comparable),results,summaries:sumRows,
    collection_failures:bundle.cases.filter(c=>c.collection_status!=='collected').map(c=>({case_id:c.case_id,status:c.collection_status,failure:c.collection_failure})),
    content_scored:scored.length>0,complete_scoring:scored.length===results.length&&sumRows.filter(s=>s.status==='scored').length===bundle.cases.length&&scored.every(r=>r.criteria.every(c=>c.score!==null)),
    human_review_approved:false,real_experience_accepted:false,browser_audio_tested:false};
  report.summary_coverage={observed_snapshots:bundle.cases.filter(c=>c.summary).length,empty_learning_snapshots:bundle.cases.filter(c=>c.summary&&!(c.summary.learning_items?.length)).length,
    partial_collection_snapshots:bundle.cases.filter(c=>c.summary&&c.collection_status!=='collected').length,learning_items:bundle.cases.reduce((n,c)=>n+(c.summary?.learning_items?.length??0),0),
    score_scope:'source_fidelity_contract_not_pedagogical_coverage'};
  report.summary_coverage.conversation_recap_snapshots=bundle.cases.filter(c=>c.summary?.conversation_recap?.topics?.length||c.summary?.conversation_recap?.expressions?.length).length;
  report.summary_coverage.recap_topics=bundle.cases.reduce((n,c)=>n+(c.summary?.conversation_recap?.topics?.length??0),0);
  report.summary_coverage.recap_student_expressions=bundle.cases.reduce((n,c)=>n+(c.summary?.conversation_recap?.expressions?.length??0),0);
  report.attribution_counts={};for(const r of results)for(const value of Object.values(r.finding_attribution??{}))report.attribution_counts[value]=(report.attribution_counts[value]??0)+1;
  report.issue_groups=aggregateIssues(bundle,report);return report;
}
export function aggregateIssues(bundle,report) {
  const groups=new Map(),add=(type,row,evidence)=>{if(!groups.has(type))groups.set(type,{type,case_ids:new Set(),occurrences:[],root_cause_status:'hypothesis_requires_validation'});const g=groups.get(type);g.case_ids.add(row.case_id);g.occurrences.push({case_id:row.case_id,turn:row.turn??null,evidence});};
  for(const r of report.results){
    if(r.collection!=='complete')add('collection_failure',r,r.collection);
    if(r.asr_surface_match===false)add('asr_surface_difference',r,'actual_student_transcript');
    if(r.asr_semantics==='meaning_changed')add('asr_meaning_changed',r,'review.asr_semantics');
    if(r.context_verdict==='mismatch')add('context_mismatch',r,'review.context_verdict');
    if(r.timing.response_context.some(c=>c.decision_context_matched===false))add('current_turn_policy_timing',r,'diagnostics.teaching.response');
    if(r.surface_hints?.budget_exceeded)add('reply_budget_surface',r,'surface_audit');
    if(r.scores)for(const d of dimensions)if(r.scores[d]<2)add(`content_${d}`,r,r.dimension_evidence[d]);
    for(const [key,value]of Object.entries(r.finding_attribution??{}))add(`finding_${value}`,r,key);
  }
  for(const s of report.summaries)if(s.status==='scored'&&s.score<2)add('summary_content',s,s.evidence_turns);
  return [...groups.values()].map(g=>({...g,case_ids:[...g.case_ids],case_count:g.case_ids.size,occurrence_count:g.occurrences.length,
    earliest_per_case:[...g.case_ids].map(id=>({case_id:id,turn:g.occurrences.filter(r=>r.case_id===id&&r.turn!==null).length?Math.min(...g.occurrences.filter(r=>r.case_id===id&&r.turn!==null).map(r=>r.turn)):null})),
    notes:'Surface hints and correlated symptoms are not confirmed root causes; dependent consequences must be reviewed together.'}));
}
