import test from 'node:test';import assert from 'node:assert/strict';
import {HomeworkService} from '../apps/hskai-mock/src/teacher-assistant/service.js';
import {startHomeworkBackend} from '../packages/hskai-bridge/homework-port.js';
import {EvidenceRecorder} from '../packages/teacher-assistant/evidence.js';
import {ReportAnalyzer} from '../packages/teacher-assistant/report.js';

async function submitted(call){
  const teacher=(await call('login',null,{actor_id:'mock-teacher-lin'})).token,learner=(await call('login',null,{actor_id:'mock-maya-hsk3'})).token;
  const plan=await call('preview',teacher,{topic:'dining',learner_id:'mock-maya-hsk3'});
  const assignment=await call('publish',teacher,{topic:'dining',learner_id:plan.learner_id,plan_hash:plan.hash,due_at:new Date(Date.now()+86400000).toISOString(),timezone:'Asia/Shanghai',idempotency_key:'worker-publish'});
  const p=await call('prepare',learner,{assignment_id:assignment.assignment_id});await call('bind_session',learner,{attempt_id:p.attempt.id,session_id:'synthetic-session'});
  const r=new EvidenceRecorder({attemptId:p.attempt.id,sessionId:'synthetic-session',planHash:plan.hash});r.input({type:'user.final',turn_id:'synthetic-turn',event_id:'synthetic-event',payload:{text:'我想要面条'}});
  await call('finalize',learner,{attempt_id:p.attempt.id,evidence:r.finalize({providerKind:'test',ready:true})});const attempt=await call('attempt',learner,{attempt_id:p.attempt.id});
  const receipt=await call('submit',learner,{attempt_id:attempt.id,expected_version:attempt.version,idempotency_key:'worker-submit'});return {teacher,learner,receipt,attempt};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('claim and commit bind lease, source, learner authorization, and deterministic report',async t=>{
  let now=Date.now();const s=new HomeworkService({now:()=>now});t.after(()=>s.close());const f=await submitted((...args)=>s.call(...args)),d=s.analysisDelegation,job=d.claim();
  assert.equal(job.state,'claimed');assert.equal(d.claim().state,'empty');const report=new ReportAnalyzer().analyze(job.plan,job.evidence,job.attempt),ref={job_id:job.job_id,lease_id:job.lease_id,source_hash:job.source_hash,report};
  assert.throws(()=>d.commit({...ref,lease_id:'wrong'}),/LEASE/);assert.throws(()=>d.commit({...ref,source_hash:'wrong'}),/SOURCE/);assert.throws(()=>d.commit({...ref,report:{...report,headline:'forged'}}),/INVALID_REPORT/);
  d.heartbeat(ref);assert.equal(d.commit(ref).state,'complete');assert.throws(()=>d.commit(ref),/LEASE/);assert.equal((await s.call('submission',f.learner,{submission_id:f.receipt.id})).report_state,'complete');
});
test('expired lease cannot commit; unknown external outcome is never silently retried',async t=>{
  let now=Date.now();const s=new HomeworkService({now:()=>now});t.after(()=>s.close());await submitted((...args)=>s.call(...args));const d=s.analysisDelegation,old=d.claim();now=old.lease_until;
  assert.throws(()=>d.commit({job_id:old.job_id,lease_id:old.lease_id}),/LEASE/);const next=d.claim();assert.equal(next.state,'claimed');assert.notEqual(next.lease_id,old.lease_id);
  s.repo.put('jobs',{...s.repo.get('jobs',next.job_id),external_started:true});now=next.lease_until;assert.equal(d.claim().state,'empty');assert.equal(s.repo.get('jobs',next.job_id).error,'EXTERNAL_OUTCOME_UNKNOWN');
});
test('learner deletion and revocation prevent late worker writes',async t=>{
  const s=new HomeworkService();t.after(()=>s.close());const f=await submitted((...args)=>s.call(...args)),job=s.analysisDelegation.claim(),report=new ReportAnalyzer().analyze(job.plan,job.evidence,job.attempt);
  await s.call('delete_my_data',f.learner);assert.throws(()=>s.analysisDelegation.commit({job_id:job.job_id,lease_id:job.lease_id,source_hash:job.source_hash,report}),/LEASE/);assert.equal(s.repo.get('reports',job.job_id),null);
});
test('separate analysis process completes queued reports, and restart leaves data service alive',async t=>{
  const backend=await startHomeworkBackend({path:':memory:'});t.after(()=>backend.close());const old=backend.analysisChild;old.kill();
  const f=await submitted((...args)=>backend.port.call(...args));assert.equal((await backend.port.call('me',f.learner)).actor.id,'mock-maya-hsk3');
  let view;for(let i=0;i<40;i++){view=await backend.port.call('submission',f.learner,{submission_id:f.receipt.id});if(view.report_state==='complete')break;await wait(100);}
  assert.notEqual(backend.analysisChild,old);assert.equal(view.report_state,'complete');assert.equal(view.report.grade,undefined);
});
