import test from 'node:test';import assert from 'node:assert/strict';
import {deepFixture,syntheticReportEnv} from './helpers/deep-analysis.js';
import {syntheticSemanticTransport} from './helpers/semantic-analysis.js';
import {ConversationReportAnalyzer} from '../packages/teacher-assistant/deep-analysis/semantic.js';
import {runClaimedAnalysis} from '../apps/learning-analysis-worker/src/run-analysis.js';
import {reportProgress} from '../apps/teacher-assistant/public/report-progress.js';
import {NOTICE_VERSION} from '../packages/teacher-assistant/teaching-record/policy.js';
const waitFor=async test=>{for(let i=0;i<100;i++){if(test())return;await new Promise(r=>setTimeout(r,5));}throw new Error('WAIT_TIMEOUT');};
const read=f=>f.service.call('submission',f.learner,{submission_id:f.submission.id});
test('worker publishes actual analysis, repair and validation phases without exposing intermediate candidates',async t=>{
  const f=await deepFixture(t,{audio:false});let release,calls=0;const observed=[];
  const textAnalyzer=new ConversationReportAnalyzer({transport:syntheticSemanticTransport(async value=>{calls++;await new Promise(resolve=>release=resolve);return calls===1?{invalid:true}:value;})});
  const work=runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:async(op,input)=>{
    const result=await f.call(op,input);
    if(op==='stage_progress'||op==='stage_authorize'){
      const s=await read(f);observed.push(s.deep_analysis.stages.text.progress.phase);
      assert.equal(s.deep_analysis.stages.text.result,undefined);assert.equal(s.report,null);
    }return result;
  },textAnalyzer});
  await waitFor(()=>!!release);let s=await read(f);assert.equal(s.deep_analysis.stages.text.progress.phase,'analyzing');assert.match(reportProgress(s).steps[1].detail,/第 1 \/ 1 组/);
  const first=release;release=null;first();await waitFor(()=>!!release);s=await read(f);assert.equal(s.deep_analysis.stages.text.progress.phase,'repairing');assert.match(reportProgress(s).steps[1].detail,/修复/);release();await work;
  assert.deepEqual(observed,['analyzing','checking','repairing','checking','processed']);
  s=await read(f);assert.equal(s.report_state,'complete');assert.equal(s.deep_analysis.stages.text.progress.processed,1);assert.ok(s.deep_analysis.stages.text.finished_at>=s.deep_analysis.stages.text.started_at);assert.equal(reportProgress(s).steps.at(-1).state,'complete');
});
test('progress is source-bound, bounded, lease-bound and never accepts a previous provider call after repair',async t=>{
  const f=await deepFixture(t,{audio:false}),job=f.service.analysisDelegation.claim(),ref={job_id:job.job_id,lease_id:job.lease_id,branch:'text'},progress={phase:'analyzing',current:1,total:1,processed:0,attempt:1};
  const first=await f.call('stage_authorize',{...ref,progress});
  for(const change of [{total:999},{processed:2},{phase:'provider says done'},{raw_response:'not allowed'}])await assert.rejects(f.call('stage_progress',{...ref,call_id:first.call_id,progress:{...progress,...change}}),/INVALID_ANALYSIS_PROGRESS/);
  const second=await f.call('stage_authorize',{...ref,progress:{...progress,phase:'repairing',attempt:2}});
  await assert.rejects(f.call('stage_progress',{...ref,call_id:first.call_id,progress}),/STAGE_NOT_ACTIVE/);
  await assert.rejects(f.call('stage_progress',{...ref,lease_id:'stale-lease',call_id:second.call_id,progress}),/LEASE/);
  await f.service.call('recording_choice_update',f.learner,{attempt_id:f.attempt.id,notice_version:NOTICE_VERSION,expected_revision:1,text:false,audio:false});
  await assert.rejects(f.call('stage_progress',{...ref,call_id:second.call_id,progress}),/STAGE|AUTHORIZ/);
  assert.equal((await read(f)).deep_analysis.stages.text.progress,undefined);
});
test('teacher review is a distinct wait and does not hide completed text progress or imply Tencent was called',async t=>{
  const f=await deepFixture(t,{env:{...syntheticReportEnv,ASK_KAI_TA_AUDIO_ASSESSMENT_VALIDATED:'0',ASK_KAI_TA_AUDIO_REVIEW_ENABLED:'1'}});let audioCalls=0;
  await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:new ConversationReportAnalyzer({transport:syntheticSemanticTransport()}),audioPort:{assess:async()=>audioCalls++}});
  const teacherView=await f.service.call('submission',f.teacher,{submission_id:f.submission.id}),teacherProgress=reportProgress(teacherView);assert.equal(teacherView.report_state,'complete');assert.equal(teacherView.deep_analysis.stages.audio.review_required,true);assert.equal(teacherProgress.steps[3].state,'action');assert.equal(teacherProgress.steps.at(-1).state,'waiting');assert.match(teacherProgress.summary,/等待老师核对/);
  const s=await read(f),p=reportProgress(s);assert.equal(s.report_state,'awaiting_audio_review');assert.equal(s.deep_analysis.stages.text.result,undefined);assert.equal(p.steps[1].state,'complete');assert.equal(p.steps[2].state,'complete');assert.equal(p.steps[3].state,'action');assert.equal(p.steps[4].state,'waiting');assert.equal(p.steps[5].state,'waiting');assert.equal(audioCalls,0);
});
test('retry clears stale attempt progress while successful branches remain completed',async t=>{
  const f=await deepFixture(t,{audio:false});await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:new ConversationReportAnalyzer({transport:syntheticSemanticTransport(()=>({invalid:true}))})});
  const failed=await read(f);assert.equal(reportProgress(failed).steps[1].state,'failed');assert.equal(reportProgress(failed).steps.at(-1).state,'blocked');
  await f.service.call('retry_report',f.learner,{submission_id:f.submission.id});const pending=await read(f);assert.equal(pending.deep_analysis.stages.text.progress,null);assert.equal(pending.deep_analysis.stages.text.started_at,null);assert.match(reportProgress(pending).summary,/排队/);
});
test('progress never treats failed or unavailable analysis as a completed report and elapsed time freezes on completion',()=>{
  const stage={state:'failed',reason:'deadline',provider:'minimax',started_at:1000,finished_at:31000,progress:{total:2,processed:1}};
  const s={report_state:'failed',deep_analysis:{processing:false,stages:{text:stage,audio:{state:'unavailable',reason:'source_unavailable',provider:'tencent_soe_v2'}}}};
  const p=reportProgress(s,{now:999999});assert.equal(p.elapsed,30);assert.equal(p.steps[1].state,'failed');assert.equal(p.steps[2].state,'blocked');assert.equal(p.steps[3].state,'unavailable');assert.equal(p.steps.at(-1).state,'blocked');assert.match(p.summary,/停止/);
});

test('automatic verification has no teacher action gate and keeps audio evaluation waiting until recognition finishes',()=>{
 const s={report_state:'pending',deep_analysis:{processing:true,stages:{text:{state:'complete',provider:'minimax'},audio:{state:'running',provider:'tencent_soe_v2',verification_mode:'automatic',verification_summary:{state:'running',checked:1,total:3,eligible:1,excluded:0,failed:0}}}}};const p=reportProgress(s);assert.equal(p.steps[3].label,'自动核验录音');assert.equal(p.steps[3].state,'running');assert.equal(p.steps[4].state,'waiting');assert.equal(p.steps.some(step=>step.state==='action'),false);
 s.report_state='complete';s.deep_analysis.processing=false;s.deep_analysis.stages.audio={...s.deep_analysis.stages.audio,state:'unavailable',reason:'no_eligible_audio',verification_summary:{state:'complete',checked:3,total:3,eligible:0,excluded:3,failed:0}};const done=reportProgress(s);assert.equal(done.steps[3].state,'complete');assert.equal(done.steps[4].state,'unavailable');assert.equal(done.steps[5].state,'complete');
});
