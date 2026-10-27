import test from 'node:test';import assert from 'node:assert/strict';
import {sealRecord,validateRecord,recordHash,validateEvidenceRef,validateAnalysisCandidate,validateAnalysisResult} from '../packages/teacher-assistant/teaching-record/contracts.js';
import {recordingPolicy,configuredRecordingPolicy,recordingNotice,newRecordingChoice,updateRecordingChoice,expireRecordingChoice,authorizeRecording} from '../packages/teacher-assistant/teaching-record/policy.js';
import {tencentReadiness} from '../packages/teacher-assistant/teaching-record/tencent-readiness.js';
import {syntheticRecord,textRef,candidate,recordScope} from './helpers/teaching-record.js';
const body=record=>{const {snapshot_hash,...rest}=structuredClone(record);return rest;};

test('non-dining, 100-round, interrupted, missing and legacy records preserve honest coverage',()=>{
  for(const options of [{},{rounds:100},{interrupted:true},{missing:true},{legacy:true},{audio:true}])assert.equal(validateRecord(syntheticRecord(options)).schema_version,'teaching-record-v1');
  assert.equal(syntheticRecord({rounds:100}).transcript.length,200);
  assert.equal(syntheticRecord({legacy:true}).transcript_manifest.accepted_learner_finals,null);
});
test('canonical hash freezes text, audio, manifests, scope and versions',()=>{
  const r=syntheticRecord({audio:true});assert.equal(recordHash({a:1,b:2}),recordHash({b:2,a:1}));
  for(const mutate of [r=>r.transcript[0].text+='改',r=>r.audio[0].sha256='c'.repeat(64),r=>r.transcript_manifest.late_events++,r=>r.version++,r=>r.scope.plan_hash='d'.repeat(64)]){const changed=structuredClone(r);mutate(changed);assert.throws(()=>validateRecord(changed),/HASH/);}
  for(const k of ['learner_id','assignment_id','attempt_id','session_id','plan_hash','auth_epoch','deletion_epoch','consent_revision'])assert.throws(()=>validateRecord(r,{...r.scope,[k]:typeof r.scope[k]==='number'?2:k==='plan_hash'?'b'.repeat(64):'other'}),/SCOPE/);
});
test('receiving a final never fabricates speaking timestamps or a raw provider guarantee',()=>{
  const b=body(syntheticRecord());b.transcript[1].speaking_time={end:1001};assert.throws(()=>sealRecord(b),/SPEAKING_TIME/);
  b.transcript[1].speaking_time=null;b.transcript[1].source='provider_said_it';assert.throws(()=>sealRecord(b),/SOURCE/);
});
test('duplicate turns, events, responses, out-of-order and extra trace fields reject',()=>{
  for(const mutate of [b=>b.transcript.push({...b.transcript[1],id:'another',sequence:5}),b=>b.transcript[1].event_ids=b.transcript[0].event_ids,b=>b.transcript.reverse(),b=>b.raw_trace='secret',b=>b.transcript[0].raw_provider_event='trace']){const b=body(syntheticRecord());mutate(b);assert.throws(()=>sealRecord(b));}
});
test('accepted count, unknown denominator and interrupted outputs cannot masquerade as complete',()=>{
  for(const mutate of [b=>b.transcript_manifest.persisted_learner_finals++,b=>b.transcript_manifest.accepted_learner_finals=null,b=>b.transcript_manifest.accepted_learner_finals++,b=>b.transcript[0].status='interrupted']){const b=body(syntheticRecord());mutate(b);assert.throws(()=>sealRecord(b),/MANIFEST/);}
});
test('refs bind exact snapshot, source and UTF-16 range without splitting an emoji',()=>{
  const r=syntheticRecord(),ref=textRef(r,'learner-0');assert.equal(validateEvidenceRef(r,ref).role,'learner');
  for(const changes of [{quote:'模型编造'},{snapshot_hash:'0'.repeat(64)},{source_id:'other-session'},{end:999}])assert.throws(()=>validateEvidenceRef(r,{...ref,...changes}));
  const start=ref.quote.indexOf('🦋')+1;assert.throws(()=>validateEvidenceRef(r,{...ref,start,quote:ref.quote.slice(start)}),/TEXT_RANGE/);
});
test('audio ranges, speaker alignment, consent and expiry must agree with their record',()=>{
  for(const mutate of [b=>b.audio[0].sample_end=0,b=>b.audio[0].sample_rate=48000,b=>b.audio[0].expires_at++,b=>b.audio[0].consent_revision++,b=>b.audio.push({...b.audio[0],id:'a2'}),b=>b.audio[0].blob_id='/private/audio.wav',b=>b.audio_manifest.persisted_samples--]){const b=body(syntheticRecord({audio:true}));mutate(b);assert.throws(()=>sealRecord(b));}
  const b=body(syntheticRecord({audio:true}));b.audio[0].alignment={segment_id:'learner-0',text_start:0,text_end:2,version:'synthetic-alignment-v1',confidence:0.9,basis:'aligner_candidate'};assert.ok(sealRecord(b));
  b.audio[0].alignment.segment_id='kai-0';assert.throws(()=>sealRecord(b),/ALIGNMENT_OWNER/);
});
test('understanding needs the question, acoustic claims need learner audio, control is not achievement',()=>{
  const r=syntheticRecord();assert.ok(validateAnalysisCandidate(candidate(r),r));
  for(const dimension of ['pronunciation','tone','fluency','context_understanding'])assert.throws(()=>validateAnalysisCandidate(candidate(r,dimension),r),/EVIDENCE|CONTEXT/);
  const c=candidate(r,'context_understanding');c.evidence_refs.push(textRef(r,'kai-0'));assert.ok(validateAnalysisCandidate(c,r));
  const b=body(r);b.transcript[0].kind='control';b.transcript_manifest.analyzable_segments--;const control=sealRecord(b);const cc=candidate(control,'context_understanding');cc.evidence_refs.push(textRef(control,'kai-0'));assert.throws(()=>validateAnalysisCandidate(cc,control),/CONTEXT/);
});
test('unknown speaker audio and forged audio intervals cannot support pronunciation',()=>{
  const r=syntheticRecord({audio:true}),c=candidate(r,'pronunciation');c.evidence_refs=[{snapshot_hash:r.snapshot_hash,type:'audio',source_id:'audio-0',start:0,end:16000,quote:null}];assert.ok(validateAnalysisCandidate(c,r));
  assert.throws(()=>validateEvidenceRef(r,{...c.evidence_refs[0],end:16001}),/AUDIO_REFERENCE/);
  const b=body(r);b.audio[0].speaker='unknown';const unknown=sealRecord(b);c.snapshot_hash=unknown.snapshot_hash;c.evidence_refs[0].snapshot_hash=unknown.snapshot_hash;assert.throws(()=>validateAnalysisCandidate(c,unknown),/ACOUSTIC/);
});
test('partial report cannot claim both branches complete, no grades or mastery',()=>{
  const r=syntheticRecord(),result={schema_version:'analysis-result-v1',snapshot_hash:r.snapshot_hash,scope:r.scope,version:1,state:'partial',text_state:'complete',audio_state:'unavailable',candidates:[candidate(r)],grade:null,mastery:'unassessed',analyzer_version:'synthetic-v1'};assert.ok(validateAnalysisResult(result,r));
  for(const change of [{grade:'A'},{mastery:'mastered'},{state:'complete'},{state:'unavailable'},{text_state:'not_authorized'}])assert.throws(()=>validateAnalysisResult({...result,...change},r));
});

const context={learner_id:recordScope.learner_id,attempt_id:recordScope.attempt_id,auth_epoch:1,deletion_epoch:1};
const attempt={id:context.attempt_id,...context};
const enabled={text_collection:true,audio_collection:true,text_analysis:true,pronunciation_analysis:true,external_processing_reviewed:true};
const change=(choice,text,audio)=>updateRecordingChoice(choice,{notice_version:recordingNotice().version,expected_revision:choice.revision,text,audio},context,2000);
test('text and audio choices default off; phase A never enables recording or external analysis',()=>{
  const initial=newRecordingChoice(attempt,recordingPolicy(),1000);assert.equal(initial.text.allowed,false);assert.equal(initial.audio.allowed,false);
  const selected=change(initial,true,false);assert.equal(selected.audio.allowed,false);
  assert.throws(()=>authorizeRecording(selected,{context,revision:1,kind:'text',operation:'collect',now:3000}),/NOT_ENABLED/);
  assert.throws(()=>authorizeRecording(selected,{context,revision:1,kind:'audio',operation:'collect',now:3000,capabilities:enabled}),/NOT_AUTHORIZED/);
});
test('revoke, stale result, wrong learner, notice version and deletion epochs fence all operations',()=>{
  const selected=change(newRecordingChoice(attempt,recordingPolicy(),1000),true,true),revoked=change(selected,false,true);
  for(const operation of ['collect','read','provider_call','commit']){
    const request={context,revision:1,kind:'text',operation,now:3000,capabilities:enabled};assert.ok(authorizeRecording(selected,request));
    assert.throws(()=>authorizeRecording(revoked,request),/CHANGED/);
    for(const c of [{...context,learner_id:'other'},{...context,deletion_epoch:2},{...context,auth_epoch:2}])assert.throws(()=>authorizeRecording(selected,{...request,context:c}),/REVOKED/);
    assert.throws(()=>authorizeRecording(selected,{...request,noticeVersion:'old'}),/NOTICE_CHANGED/);
  }
  assert.throws(()=>change(selected,false,true)&&updateRecordingChoice(revoked,{notice_version:recordingNotice().version,expected_revision:1,text:true,audio:true},context,3000),/CONFLICT/);
});
test('retention is configurable, separate, fixed from attempt creation and expires at boundary',()=>{
  const policy=configuredRecordingPolicy({ASK_KAI_TA_TEXT_RETENTION_DAYS:'7',ASK_KAI_TA_AUDIO_RETENTION_DAYS:'1'});const selected=change(newRecordingChoice(attempt,policy,1000),true,true);
  const expired=expireRecordingChoice(selected,1000+86400000);assert.equal(expired.audio.state,'expired');assert.equal(expired.text.allowed,true);assert.equal(expireRecordingChoice(expired,1000+86400000).revision,expired.revision);
  assert.throws(()=>authorizeRecording(selected,{context,revision:1,kind:'audio',operation:'read',now:1000+86400000,capabilities:enabled}),/EXPIRED/);
  assert.equal(change(selected,true,true).audio.expires_at,selected.audio.expires_at);
  for(const v of ['0','31','NaN','1.5',' 7'])assert.throws(()=>configuredRecordingPolicy({ASK_KAI_TA_AUDIO_RETENTION_DAYS:v}),/RETENTION/);
});
test('external use requires separate activation and reviewed purposes, not merely a checkbox',()=>{
  const choice=change(newRecordingChoice(attempt,recordingPolicy(),1000),true,true);
  assert.throws(()=>authorizeRecording(choice,{context,revision:1,kind:'audio',operation:'provider_call',now:3000,capabilities:{...enabled,external_processing_reviewed:false}}),/ANALYSIS_NOT_ENABLED/);
});
test('Tencent preflight never leaks credentials or turns documentation into measured capability',()=>{
  const r=tencentReadiness({TENCENT_SOE_APP_ID:'fake-app-id',TENCENT_SOE_SECRET_ID:'fake-secret-id',TENCENT_SOE_SECRET_KEY:'fake-secret-key'});assert.deepEqual(r.missing_configuration,[]);assert.equal(r.live_call_performed,false);assert.equal(r.ready_for_learner_reports,false);assert.equal(JSON.stringify(r).includes('fake-secret'),false);assert.equal(r.modes.free_speech.tone,'unverified');
});
