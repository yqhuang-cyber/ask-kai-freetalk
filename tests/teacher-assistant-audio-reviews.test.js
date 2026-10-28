import test from 'node:test';import assert from 'node:assert/strict';
import {deepFixture,syntheticReportEnv} from './helpers/deep-analysis.js';
import {ConversationReportAnalyzer} from '../packages/teacher-assistant/deep-analysis/semantic.js';
import {syntheticSemanticTransport} from './helpers/semantic-analysis.js';
import {runClaimedAnalysis} from '../apps/learning-analysis-worker/src/run-analysis.js';
import {normalizeAssessment} from '../packages/provider-tencent-soe/assessment.js';
import {NOTICE_VERSION} from '../packages/teacher-assistant/teaching-record/policy.js';
const env={...syntheticReportEnv,ASK_KAI_TA_AUDIO_ASSESSMENT_VALIDATED:'0',ASK_KAI_TA_AUDIO_REVIEW_ENABLED:'1'};
const clean={noise:'not_detected',clipping:'not_detected',missing_frames:'not_detected',overlap:'not_detected'};
const view=f=>f.service.call('submission',f.teacher,{submission_id:f.submission.id});
const manifest=f=>f.service.call('audio_review_manifest',f.teacher,{submission_id:f.submission.id});
const decision=(item,extra={})=>({segment_id:item.id,source_metadata_hash:item.source_metadata_hash,expected_revision:item.revision,speaker:'learner_verified',quality:clean,reference_text:'我',...extra});
const review=(f,list)=>f.service.call('audio_review',f.teacher,{submission_id:f.submission.id,manifest_hash:list.manifest_hash,decisions:list.segments.map(s=>decision(s))});
function runner(f,{audioPort,onText=()=>{}}={}){return runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:new ConversationReportAnalyzer({transport:syntheticSemanticTransport(v=>{onText();return v;})}),audioPort});}
const assessed=(source)=>normalizeAssessment({PronAccuracy:72,PronFluency:0.7,Words:[{Word:'我',MemBeginTime:0,MemEndTime:50,PronAccuracy:72,PronFluency:0.7,Tone:{Valid:true,RefTone:3,HypothesisTone:4},PhoneInfos:[{Phone:'w',PronAccuracy:70}]}]},{segment:source.segment,mode:source.mode,reference:source.reference});

test('unreviewed microphone audio stays local; a teacher review queues audio and reuses completed text',async t=>{
  const f=await deepFixture(t,{env});let textCalls=0,audioCalls=0;
  const port={assess:async(source,{beforeSend})=>{await beforeSend();audioCalls++;assert.equal(source.mode,1);assert.equal(source.reference.basis,'teacher_reviewed');return assessed(source);}};
  await runner(f,{audioPort:port,onText:()=>textCalls++});assert.equal(audioCalls,0);const waiting=await f.service.call('submission',f.learner,{submission_id:f.submission.id});assert.equal(waiting.report_state,'awaiting_audio_review');assert.equal(waiting.report,null);assert.equal(waiting.deep_analysis.stages.text.result,undefined);
  const original=f.service.repo.get('audio_segments',f.saved.segment_id),sealed=f.service.repo.get('audio_manifests',f.attempt.id),list=await manifest(f);
  const bytes=await f.service.call('audio_preview',f.teacher,{submission_id:f.submission.id,segment_id:list.segments[0].id});assert.equal(bytes.pcm_base64,f.pcm.toString('base64'));
  await review(f,list);assert.deepEqual(f.service.repo.get('audio_segments',original.id),original);assert.deepEqual(f.service.repo.get('audio_manifests',f.attempt.id),sealed);assert.equal((await view(f)).report_state,'pending');
  await runner(f,{audioPort:port,onText:()=>textCalls++});assert.equal(textCalls,1);assert.equal(audioCalls,1);
  const student=await f.service.call('submission',f.learner,{submission_id:f.submission.id});assert.equal(student.report_state,'complete');assert.equal(student.deep_analysis.stages.audio.result.clips[0].words[0].tone.hypothesis,4);assert.equal(student.deep_analysis.stages.audio.result.clips[0].words[0].range_ms.start,0);assert.equal(student.deep_analysis.stages.audio.result.clips[0].source_basis,'teacher_listening_declaration');
});
test('rejected or uncertain source quality is retained as unassessed, never a provider diagnosis',async t=>{
  const f=await deepFixture(t,{env});await runner(f);const list=await manifest(f);await f.service.call('audio_review',f.teacher,{submission_id:f.submission.id,manifest_hash:list.manifest_hash,decisions:[decision(list.segments[0],{quality:{...clean,noise:'unknown'},reference_text:null})]});let called=0;
  await runner(f,{audioPort:{assess:async()=>called++}});assert.equal(called,0);assert.equal((await view(f)).deep_analysis.stages.audio.reason,'review_inconclusive');
});
test('review authorization, immutable source hashes and revisions reject forged and concurrent decisions',async t=>{
  const f=await deepFixture(t,{env}),active=f.service.analysisDelegation.claim();const list=await manifest(f);
  await assert.rejects(review(f,list),/ANALYSIS_ACTIVE/);await f.call('fail',{job_id:active.job_id,lease_id:active.lease_id});
  await assert.rejects(f.service.call('audio_review_manifest',f.learner,{submission_id:f.submission.id}),/FORBIDDEN/);
  for(const changes of [{manifest_hash:'0'.repeat(64)},{decisions:[decision(list.segments[0],{source_metadata_hash:'0'.repeat(64)})]},{decisions:[decision(list.segments[0],{expected_revision:9})]}])await assert.rejects(f.service.call('audio_review',f.teacher,{submission_id:f.submission.id,manifest_hash:list.manifest_hash,decisions:list.segments.map(s=>decision(s)),...changes}),/SOURCE_CHANGED|VERSION_CONFLICT/);
  await review(f,list);await runner(f);await assert.rejects(review(f,list),/VERSION_CONFLICT/);
});
test('teacher relationship revocation invalidates audio evidence and blocks late provider writeback',async t=>{
  const f=await deepFixture(t,{env});await runner(f);await review(f,await manifest(f));let release;
  const work=runner(f,{audioPort:{assess:async(source,{beforeSend})=>{await beforeSend();await new Promise(resolve=>release=resolve);return assessed(source);}}});while(!release)await new Promise(r=>setTimeout(r,2));
  const actor=f.service.repo.get('actors','mock-teacher-lin');f.service.repo.put('actors',{...actor,learners:[]});release();await work;
  const result=await f.service.call('submission',f.learner,{submission_id:f.submission.id});assert.equal(result.deep_analysis.stages.audio.result,undefined);assert.equal(result.deep_analysis.stages.audio.state,'not_authorized');
});
test('reviewing a local-only recording never authorizes external use; deleting audio removes reviews',async t=>{
  const f=await deepFixture(t,{env:{...env,ASK_KAI_TA_REPORT_EXTERNAL_REVIEWED:'0'}});await runner(f);f.service.analysisConfig.audio.reviewed=true;const response=await review(f,await manifest(f));assert.equal(response.state,'reviewed_local_only');assert.notEqual(f.service.repo.get('jobs',f.submission.id).state,'pending');
  await f.service.call('recording_choice_update',f.learner,{attempt_id:f.attempt.id,notice_version:NOTICE_VERSION,expected_revision:1,text:true,audio:false});assert.equal(f.service.repo.all('audio_reviews').length,0);await assert.rejects(manifest(f),/NOT_AUTHORIZED/);
});
test('manual-review configuration cannot bypass source confirmation by changing stored speaker fields',async t=>{
  const f=await deepFixture(t,{env,verifiedAudio:true});let calls=0;await runner(f,{audioPort:{assess:async(source,{beforeSend})=>{await beforeSend();calls++;return assessed(source);}}});assert.equal(calls,0);assert.equal((await view(f)).deep_analysis.stages.audio.result,undefined);
});
