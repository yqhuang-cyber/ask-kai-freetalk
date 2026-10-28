import test from 'node:test';import assert from 'node:assert/strict';
import {deepFixture,syntheticReportEnv} from './helpers/deep-analysis.js';
import {syntheticSemanticTransport} from './helpers/semantic-analysis.js';
import {ConversationReportAnalyzer} from '../packages/teacher-assistant/deep-analysis/semantic.js';
import {runClaimedAnalysis} from '../apps/learning-analysis-worker/src/run-analysis.js';
import {normalizeAssessment} from '../packages/provider-tencent-soe/assessment.js';
import {NOTICE_VERSION} from '../packages/teacher-assistant/teaching-record/policy.js';
const analyzer=()=>new ConversationReportAnalyzer({transport:syntheticSemanticTransport()});
const fakeAudio=()=>({assess:async(source,{beforeSend})=>{await beforeSend();return normalizeAssessment({PronAccuracy:80,PronFluency:0.8,Words:[{Word:'我',PronAccuracy:80,PronFluency:0.8,MemBeginTime:0,MemEndTime:50}]},{segment:source.segment});}});
const view=f=>f.service.call('submission',f.teacher,{submission_id:f.submission.id});
const waitFor=async test=>{for(let i=0;i<100;i++){if(test())return;await new Promise(r=>setTimeout(r,5));}throw new Error('WAIT_TIMEOUT');};
test('submitted text yields referenced semantic candidates while unverified audio never reaches its provider',async t=>{
  const f=await deepFixture(t);let audioCalls=0;const job=f.service.analysisDelegation.claim();await runClaimedAnalysis({job,call:f.call,textAnalyzer:analyzer(),audioPort:{assess:async()=>audioCalls++}});
  const teacher=await view(f),student=await f.service.call('submission',f.learner,{submission_id:f.submission.id});assert.equal(teacher.report_state,'complete');assert.equal(teacher.deep_analysis.state,'partial');assert.equal(teacher.deep_analysis.stages.text.state,'complete');assert.equal(teacher.deep_analysis.stages.audio.reason,'no_eligible_audio');assert.equal(audioCalls,0);assert.ok(teacher.deep_analysis.stages.text.result.candidates.length);assert.equal(student.deep_analysis.stages.text.result.candidates[0].evidence_refs[0].source_id,undefined);assert.equal(student.deep_analysis.grade,null);assert.equal(student.deep_analysis.mastery,'unassessed');
});
test('neither basic feedback nor partial text results are published until the background report finishes',async t=>{
  const f=await deepFixture(t,{verifiedAudio:true});let release;const audioPort={assess:async(source,{beforeSend})=>{await beforeSend();await new Promise(resolve=>release=resolve);return fakeAudio().assess(source,{beforeSend:async()=>{}});}};
  const work=runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:analyzer(),audioPort});await waitFor(()=>!!release&&f.service.repo.get('jobs',f.submission.id).deep.stages.text.state==='complete');
  const during=await view(f);assert.equal(during.report_state,'running');assert.equal(during.report,null);assert.equal(during.deep_analysis.stages.text.result,undefined);const student=await f.service.call('submission',f.learner,{submission_id:f.submission.id});assert.equal(student.report,null);assert.equal(student.deep_analysis.stages.text.result,undefined);assert.equal(during.deep_analysis.processing,true);assert.equal(during.deep_analysis.stages.audio.state,'running');assert.equal((await f.service.call('me',f.learner)).actor.role,'learner');release();await work;assert.equal((await view(f)).deep_analysis.processing,false);assert.equal((await view(f)).report_state,'complete');assert.ok((await view(f)).deep_analysis.stages.text.result);
});
test('withdrawing audio during an uncooperative provider call blocks its late result and preserves text',async t=>{
  const f=await deepFixture(t,{verifiedAudio:true});let release;const work=runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:analyzer(),audioPort:{assess:async(source,{beforeSend})=>{await beforeSend();await new Promise(resolve=>release=resolve);return fakeAudio().assess(source,{beforeSend:async()=>{}});}}});await waitFor(()=>!!release);
  await f.service.call('recording_choice_update',f.learner,{attempt_id:f.attempt.id,notice_version:NOTICE_VERSION,expected_revision:1,text:true,audio:false});release();await work;
  const result=await view(f);assert.equal(result.deep_analysis.stages.text.state,'complete');assert.equal(result.deep_analysis.stages.audio.state,'not_authorized');assert.equal(result.deep_analysis.stages.audio.result,undefined);assert.equal(f.service.repo.get('jobs',f.submission.id).deep.stages.audio.result,null);
});
test('text withdrawal removes derived quotes immediately while leaving submitted facts intact',async t=>{
  const f=await deepFixture(t);await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:analyzer()});assert.ok((await view(f)).deep_analysis.stages.text.result);
  await f.service.call('recording_choice_update',f.learner,{attempt_id:f.attempt.id,notice_version:NOTICE_VERSION,expected_revision:1,text:false,audio:true});assert.equal((await view(f)).deep_analysis.stages.text.result,undefined);assert.equal(f.service.repo.get('jobs',f.submission.id).deep.stages.text.result,null);assert.equal((await view(f)).state,'submitted');
});
test('unreviewed configuration and local-only consent do not authorize an external call after reconfiguration',async t=>{
  const f=await deepFixture(t,{env:{...syntheticReportEnv,ASK_KAI_TA_REPORT_EXTERNAL_REVIEWED:'0'}});let calls=0;const transport=syntheticSemanticTransport(v=>{calls++;return v;});
  f.service.analysisConfig.text.reviewed=true;await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:new ConversationReportAnalyzer({transport})});assert.equal(calls,0);assert.equal((await view(f)).deep_analysis.stages.text.state,'not_authorized');
});
test('generation, lease and snapshot checks reject stale or invented stage commits',async t=>{
  const f=await deepFixture(t),job=f.service.analysisDelegation.claim(),ref={job_id:job.job_id,lease_id:job.lease_id};const snapshot=(await f.call('read_text',ref)).snapshot,permission=await f.call('stage_authorize',{...ref,branch:'text'}),result=await analyzer().analyze(f.plan,snapshot);
  for(const changes of [{lease_id:'foreign'},{call_id:'foreign'},{result:{...result,snapshot_hash:'0'.repeat(64)}}])await assert.rejects(f.call('stage_commit',{...ref,branch:'text',call_id:permission.call_id,result,...changes}),/LEASE|STAGE|SEMANTIC/);
  result.candidates[0].evidence_refs[0].quote='伪造原文';await assert.rejects(f.call('stage_commit',{...ref,branch:'text',call_id:permission.call_id,result}),/QUOTE/);
});
test('audio metadata cannot change speaker or quality after sealing even if the PCM hash is unchanged',async t=>{
  const f=await deepFixture(t),job=f.service.analysisDelegation.claim(),ref={job_id:job.job_id,lease_id:job.lease_id,segment_id:f.saved.segment_id};const row=f.service.repo.get('audio_segments',f.saved.segment_id);f.service.repo.put('audio_segments',{...row,speaker:'learner_verified'});await assert.rejects(f.call('read_audio',ref),/SOURCE_CHANGED/);
});
test('external outcome unknown is durable and requires explicit retry instead of automatic reissue',async t=>{
  let now=Date.now();const f=await deepFixture(t,{now:()=>now}),job=f.service.analysisDelegation.claim(),ref={job_id:job.job_id,lease_id:job.lease_id};await f.call('stage_authorize',{...ref,branch:'text'});now=job.lease_until;
  assert.equal((await f.call('claim',{})).state,'empty');const saved=f.service.repo.get('jobs',job.job_id);assert.equal(saved.state,'failed');assert.equal(saved.deep.stages.text.reason,'external_outcome_unknown');assert.equal(saved.deep.stages.text.state,'failed');
  await f.service.call('retry_report',f.teacher,{submission_id:f.submission.id});const next=await f.call('claim',{});assert.notEqual(next.lease_id,job.lease_id);assert.equal(next.deep.generation,2);assert.equal(f.service.repo.get('jobs',job.job_id).deep.stages.text.version,2);
});
test('deleting the learner while semantic work is running rejects all late writeback',async t=>{
  const f=await deepFixture(t);let release;const transport=syntheticSemanticTransport(async value=>{await new Promise(resolve=>release=resolve);return value;}),work=runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:new ConversationReportAnalyzer({transport})});await waitFor(()=>!!release);await f.service.call('delete_my_data',f.learner);release();await assert.rejects(work,/LEASE|NOT_FOUND|REVOKED/);assert.equal(f.service.repo.all('jobs').length,0);assert.equal(f.service.repo.all('deep_records').length,0);
});
test('explicit retry reuses successful text and audio segments instead of charging them again',async t=>{
  const f=await deepFixture(t,{verifiedAudio:true,audioSegments:2}),audioCalls=new Map();let textCalls=0,fail=true;
  const textAnalyzer=new ConversationReportAnalyzer({transport:syntheticSemanticTransport(v=>{textCalls++;return v;})}),audioPort={assess:async(source,{beforeSend})=>{await beforeSend();const id=source.segment.id;audioCalls.set(id,(audioCalls.get(id)??0)+1);if(id===f.savedSegments[1].segment_id&&fail)throw new Error('TENCENT_QUOTA');return fakeAudio().assess(source,{beforeSend:async()=>{}});}};
  await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer,audioPort});assert.equal((await view(f)).deep_analysis.stages.audio.state,'failed');assert.equal(f.service.repo.get('jobs',f.submission.id).deep.stages.audio.result.assessments.length,1);assert.equal(textCalls,1);
  await f.service.call('retry_report',f.teacher,{submission_id:f.submission.id});fail=false;await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer,audioPort});
  assert.equal(textCalls,1);assert.equal(audioCalls.get(f.savedSegments[0].segment_id),1);assert.equal(audioCalls.get(f.savedSegments[1].segment_id),2);const after=await view(f);assert.equal(after.deep_analysis.stages.audio.result.assessments.length,2);assert.equal(after.deep_analysis.stages.audio.state,'partial');assert.equal(after.deep_analysis.retryable,false);
});
test('retrying a failed text window preserves successful windows and never silently reruns their model calls',async t=>{
  const f=await deepFixture(t,{rounds:70,audio:false});let fail=true;const calls=new Map(),transport=syntheticSemanticTransport((value,messages)=>{const input=JSON.parse(messages.find(m=>m.role==='user').content),id=input.window[0].source_id;calls.set(id,(calls.get(id)??0)+1);if(input.window[0].sequence>0&&fail)return {invalid:true};return value;}),textAnalyzer=new ConversationReportAnalyzer({transport});
  await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer});const before=await view(f);assert.equal(before.deep_analysis.stages.text.state,'partial');assert.equal(before.deep_analysis.retryable,true);const first=[...calls.keys()][0];assert.equal(calls.get(first),1);
  fail=false;await f.service.call('retry_report',f.teacher,{submission_id:f.submission.id});await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer});assert.equal(calls.get(first),1);const after=await view(f);assert.equal(after.deep_analysis.stages.text.state,'complete');assert.equal(after.deep_analysis.retryable,false);assert.ok(after.deep_analysis.stages.text.result.candidates.length>=before.deep_analysis.stages.text.result.candidates.length);
});
test('retry cannot invalidate an active lease while another branch is still making an external call',async t=>{
  const f=await deepFixture(t,{verifiedAudio:true});let release;const work=runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:new ConversationReportAnalyzer({transport:syntheticSemanticTransport(()=>({invalid:true}))}),audioPort:{assess:async(source,{beforeSend})=>{await beforeSend();await new Promise(resolve=>release=resolve);return fakeAudio().assess(source,{beforeSend:async()=>{}});}}});
  await waitFor(()=>!!release&&f.service.repo.get('jobs',f.submission.id).deep.stages.text.state==='failed');const job=f.service.repo.get('jobs',f.submission.id);assert.equal((await view(f)).deep_analysis.retryable,false);await assert.rejects(f.service.call('retry_report',f.teacher,{submission_id:f.submission.id}),/NOT_FAILED/);assert.equal(f.service.repo.get('jobs',f.submission.id).lease_id,job.lease_id);release();await work;assert.equal((await view(f)).deep_analysis.retryable,true);
});
test('expiry purges semantic derivatives and legacy notice versions cannot authorize new processing',async t=>{
  let offset=0;const f=await deepFixture(t,{now:()=>Date.now()+offset});await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:analyzer()});offset=8*86400000;f.service.recordingPermissions.expire();f.service.transcriptStore.expire();f.service.audioStore.expire();assert.equal(f.service.repo.get('jobs',f.submission.id).deep.stages.text.result,null);
  const g=await deepFixture(t);const choice=g.service.repo.get('recording_choices',g.attempt.id);g.service.repo.put('recording_choices',{...choice,notice_version:'deep-report-notice-v3'});const job=g.service.analysisDelegation.claim();await assert.rejects(g.call('stage_authorize',{job_id:job.job_id,lease_id:job.lease_id,branch:'text'}),/NOTICE_CHANGED/);
});
test('only a sealed independently confirmed reference selects sentence assessment for valid tone candidates',async t=>{
  const reference={text:'我',verified:true,basis:'author_verified',version:'synthetic-reference-v1'},f=await deepFixture(t,{verifiedAudio:true,verifiedReference:reference});let mode;
  await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:analyzer(),audioPort:{assess:async(source,{beforeSend})=>{mode=source.mode;assert.deepEqual(source.reference,reference);await beforeSend();return normalizeAssessment({PronAccuracy:80,PronFluency:0.8,Words:[{Word:'我',PronAccuracy:80,MemBeginTime:0,MemEndTime:50,Tone:{Valid:true,RefTone:3,HypothesisTone:4}}]},{segment:source.segment,mode:source.mode,reference:source.reference});}}});
  assert.equal(mode,1);assert.deepEqual((await view(f)).deep_analysis.stages.audio.result.assessments[0].words[0].tone,{reference:3,hypothesis:4});
});

test('a learner may retry only their own failed deep report without re-submitting the homework',async t=>{
  const f=await deepFixture(t);const failed=new ConversationReportAnalyzer({transport:syntheticSemanticTransport(()=>{throw new Error('SYNTHETIC_FAILURE');})});
  await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:failed});const before=await view(f);assert.equal(before.report_state,'failed');assert.equal(before.report,null);assert.equal(before.deep_analysis.retryable,true);
  f.service.repo.put('actors',{id:'mock-other-learner',role:'learner',name:'合成其他学生',active:true,auth_epoch:1,deletion_epoch:1});const other=(await f.service.call('login',null,{actor_id:'mock-other-learner'})).token;await assert.rejects(f.service.call('retry_report',other,{submission_id:f.submission.id}),/FORBIDDEN|UNAUTHORIZED/);
  await f.service.call('retry_report',f.learner,{submission_id:f.submission.id});assert.equal((await view(f)).report_state,'pending');
  await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:analyzer()});assert.equal((await view(f)).report_state,'complete');assert.equal(f.service.repo.all('submissions').length,1);
});
test('failed report views distinguish timeouts, provider failures and rejected outputs, including existing jobs',async t=>{
  for(const [failure,expected] of [['timeout','deadline'],['provider_unavailable','provider_failed'],['output_rejected','output_rejected']]){
    const f=await deepFixture(t,{audio:false}),transport=syntheticSemanticTransport(()=>{
      if(failure==='provider_unavailable')throw new Error('PLANNER_UNAVAILABLE');
      if(failure==='timeout')return new Promise(resolve=>setTimeout(()=>resolve({observations:[]}),80));
      return {invalid:true};
    });
    const hold=setTimeout(()=>{},200);
    try{await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:new ConversationReportAnalyzer({transport,windowBudgetMs:15})});}finally{clearTimeout(hold);}
    const saved=f.service.repo.get('jobs',f.submission.id);assert.equal(saved.deep.stages.text.reason,expected);
    // Older jobs stored every unsuccessful window as output_rejected. Derive the
    // public reason from their coverage without rewriting records or retrying.
    saved.deep.stages.text.reason='output_rejected';f.service.repo.put('jobs',saved);
    const student=await f.service.call('submission',f.learner,{submission_id:f.submission.id});
    assert.equal(student.report_state,'failed');assert.equal(student.deep_analysis.stages.text.reason,expected);assert.equal(student.deep_analysis.stages.text.result,undefined);assert.equal(student.deep_analysis.retryable,true);
  }
});
