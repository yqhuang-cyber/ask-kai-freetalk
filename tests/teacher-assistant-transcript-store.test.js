import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {HomeworkService} from '../apps/hskai-mock/src/teacher-assistant/service.js';
import {TranscriptRecorder} from '../packages/teacher-assistant/teaching-record/transcript-recorder.js';
import {NOTICE_VERSION} from '../packages/teacher-assistant/teaching-record/policy.js';
import {validateRecord} from '../packages/teacher-assistant/teaching-record/contracts.js';
import {EvidenceRecorder} from '../packages/teacher-assistant/evidence.js';

async function fixture(t,options={}){
  const s=new HomeworkService(options);let closed=false;const close=()=>{if(!closed){closed=true;s.close();}};t.after(close);const teacher=(await s.call('login',null,{actor_id:'mock-teacher-lin'})).token,learner=(await s.call('login',null,{actor_id:'mock-maya-hsk3'})).token;
  const plan=await s.call('preview',teacher,{topic:'dining',learner_id:'mock-maya-hsk3'});const pub=await s.call('publish',teacher,{topic:'dining',learner_id:plan.learner_id,plan_hash:plan.hash,due_at:new Date(Date.now()+86400000).toISOString(),timezone:'Asia/Shanghai',idempotency_key:'transcript-publish'});
  const p=await s.call('prepare',learner,{assignment_id:pub.assignment_id});await s.call('recording_choice_update',learner,{attempt_id:p.attempt.id,notice_version:NOTICE_VERSION,expected_revision:0,text:true,audio:false});await s.call('bind_session',learner,{attempt_id:p.attempt.id,session_id:'test-session'});
  const port={call:(...args)=>s.call(...args)},recorder=new TranscriptRecorder({port,token:learner,attemptId:p.attempt.id,sessionId:'test-session'});await recorder.open();return {s,teacher,learner,p,recorder,close};
}
function turn(r,n,{interrupted=false}={}){
  const session_id='test-session',turn_id=`turn-${n}`,response_id=`reply-${n}`;
  r.input({type:'user.final',session_id,turn_id,event_id:`u-${n}`,payload:{text:`我觉得第 ${n} 个很有趣。`}});
  const forward=(type,suffix,payload={})=>r.forward({type:'event',event:{type,session_id,turn_id,response_id,event_id:`${suffix}-${n}`,payload}});
  forward('response.started','start');forward('response.text.delta','text',{text:`你为什么喜欢第 ${n} 个？`});forward(interrupted?'response.cancelled':'response.done','end');
}
test('authorized text persists over five turns and seals actual forwarded Kai and accepted student text',async t=>{
  const f=await fixture(t);for(let i=0;i<10;i++)turn(f.recorder,i);const receipt=await f.recorder.seal('student_end');assert.equal(receipt.coverage,'complete');
  const record=await f.s.call('record_read',f.learner,{attempt_id:f.p.attempt.id});assert.ok(validateRecord(record));assert.equal(record.transcript.length,20);assert.equal(record.transcript_manifest.accepted_learner_finals,10);assert.equal(record.audio_manifest.reason,'not_enabled');assert.match(record.transcript[19].text,/9/);
  const teacherRecord=await f.s.call('record_read',f.teacher,{attempt_id:f.p.attempt.id});assert.equal(teacherRecord.snapshot_hash,record.snapshot_hash);
  f.recorder.input({type:'user.final',session_id:'other',turn_id:'late',event_id:'late',payload:{text:'late'}});assert.equal(f.recorder.queue.length,0);
});
test('cancelled output, wrong ownership and lost events never claim complete coverage',async t=>{
  const f=await fixture(t);turn(f.recorder,1,{interrupted:true});f.recorder.dropped=true;const receipt=await f.recorder.seal('student_end');assert.equal(receipt.coverage,'partial');
  const record=await f.s.call('record_read',f.learner,{attempt_id:f.p.attempt.id});assert.equal(record.transcript[1].status,'cancelled');assert.equal(record.transcript_manifest.gaps[0].reason,'overflow');
});
test('late events and cross-session or stale-response traffic cannot be appended',async t=>{
  const f=await fixture(t);turn(f.recorder,1);f.recorder.forward({type:'event',event:{type:'response.text.delta',session_id:'test-session',turn_id:'turn-1',response_id:'reply-1',event_id:'late-delta',payload:{text:'late'}}});
  f.recorder.input({type:'user.final',session_id:'other-session',turn_id:'foreign',event_id:'foreign',payload:{text:'foreign'}});await f.recorder.seal('student_end');
  const r=await f.s.call('record_read',f.learner,{attempt_id:f.p.attempt.id});assert.equal(r.transcript.length,2);assert.ok(!JSON.stringify(r).includes('foreign'));assert.ok(!JSON.stringify(r).includes('late-delta'));
  await assert.rejects(f.s.call('record_append',f.learner,{attempt_id:f.p.attempt.id,session_id:'test-session',events:[]}),/NOT_ACTIVE/);
});
test('withdrawal erases text, blocks late writes and keeps attempt active',async t=>{
  const f=await fixture(t);turn(f.recorder,1);await f.recorder.running;
  await f.s.call('recording_choice_update',f.learner,{attempt_id:f.p.attempt.id,notice_version:NOTICE_VERSION,expected_revision:1,text:false,audio:false});
  assert.equal(f.s.repo.all('deep_records').length,0);assert.equal(f.s.repo.all('transcript_events').length,0);assert.equal(f.s.repo.get('attempts',f.p.attempt.id).state,'active');await assert.rejects(f.recorder.seal('student_end'),/NOT_AUTHORIZED/);
});
test('restricted ending discards buffered text and does not expose a record',async t=>{
  const f=await fixture(t);turn(f.recorder,1);await f.recorder.discard();if(f.recorder.running)await f.recorder.running;assert.equal(f.s.repo.all('transcript_events').length,0);await assert.rejects(f.s.call('record_read',f.learner,{attempt_id:f.p.attempt.id}),/NOT_FOUND/);
});
test('student and forwarded Kai controls remain in the transcript but are not analyzable achievement text',async t=>{
  const f=await fixture(t),session_id='test-session',turn_id='control-turn',response_id='control-reply';
  f.recorder.input({type:'user.final',session_id,turn_id,event_id:'user-control',payload:{text:'结束练习'}},{kind:'control'});
  for(const [type,event_id,text] of [['response.started','control-start',''],['response.text.delta','control-text','好的，再见。'],['response.done','control-done','']])f.recorder.forward({type:'event',speech_control:true,event:{type,event_id,session_id,turn_id,response_id,payload:{text}}});
  await f.recorder.seal('student_end');const record=await f.s.call('record_read',f.learner,{attempt_id:f.p.attempt.id});assert.equal(record.transcript.length,2);assert.ok(record.transcript.every(s=>s.kind==='control'));assert.equal(record.transcript_manifest.analyzable_segments,0);
});

test('restart retains already-written events but marks the unsealed attempt incomplete',async t=>{const dir=mkdtempSync(join(tmpdir(),'kai-text-restart-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'db.sqlite'),f=await fixture(t,{path});turn(f.recorder,1);while(f.recorder.running)await f.recorder.running;f.close();const restarted=new HomeworkService({path});t.after(()=>restarted.close());assert.equal(restarted.repo.get('deep_records',f.p.attempt.id).state,'interrupted');assert.equal(restarted.repo.transcriptEvents(f.p.attempt.id).length,4);await assert.rejects(restarted.call('record_read',f.learner,{attempt_id:f.p.attempt.id}),/INCOMPLETE/);});
test('expiry of unselected audio does not invalidate an authorized, unexpired text snapshot',async t=>{let now=Date.now();const f=await fixture(t,{now:()=>now,recordingPolicy:{text_days:7,audio_days:1}});turn(f.recorder,1);now=Date.now()+100;await f.recorder.seal('student_end');now+=86400000;f.s.recordingPermissions.expire();f.learner=(await f.s.call('login',null,{actor_id:'mock-maya-hsk3'})).token;const choice=await f.s.call('recording_choice',f.learner,{attempt_id:f.p.attempt.id});assert.equal(choice.audio.state,'expired');assert.equal(choice.revision,1);assert.equal((await f.s.call('record_read',f.learner,{attempt_id:f.p.attempt.id})).transcript.length,2);});
test('delegated worker can read only the sealed submitted snapshot under a valid lease and consent',async t=>{
  const f=await fixture(t);turn(f.recorder,1);const sealed=await f.recorder.seal('student_end');const evidence=new EvidenceRecorder({attemptId:f.p.attempt.id,sessionId:'test-session',planHash:f.p.plan.hash});evidence.input({type:'user.final',event_id:'evidence-1',turn_id:'turn-e',payload:{text:'我要面条'}});
  await f.s.call('finalize',f.learner,{attempt_id:f.p.attempt.id,evidence:evidence.finalize({providerKind:'test',ready:true})});const attempt=await f.s.call('attempt',f.learner,{attempt_id:f.p.attempt.id});await f.s.call('submit',f.learner,{attempt_id:attempt.id,expected_version:attempt.version,idempotency_key:'snapshot-submit'});
  const job=f.s.analysisDelegation.claim(),ref={job_id:job.job_id,lease_id:job.lease_id};assert.equal(f.s.analysisDelegation.readText(ref).snapshot.snapshot_hash,sealed.snapshot_hash);assert.throws(()=>f.s.analysisDelegation.readText({...ref,lease_id:'wrong'}),/LEASE/);
  await f.s.call('recording_choice_update',f.learner,{attempt_id:f.p.attempt.id,notice_version:NOTICE_VERSION,expected_revision:1,text:false,audio:false});assert.throws(()=>f.s.analysisDelegation.readText(ref),/NOT_FOUND|NOT_AUTHORIZED/);
});
test('a failed event batch leaves an explicit sequence gap rather than false complete coverage',async t=>{
  const f=await fixture(t),call=f.recorder.port.call;let fail=true;f.recorder.port.call=(op,...args)=>{if(op==='record_append'&&fail){fail=false;return Promise.reject(new Error('injected'));}return call(op,...args);};
  for(let i=0;i<2;i++)f.recorder.input({type:'user.final',session_id:'test-session',turn_id:`lost-${i}`,event_id:`lost-event-${i}`,payload:{text:`测试 ${i}`}});const receipt=await f.recorder.seal('student_end');assert.equal(receipt.coverage,'partial');const record=await f.s.call('record_read',f.learner,{attempt_id:f.p.attempt.id});assert.equal(record.transcript_manifest.persisted_learner_finals,1);assert.deepEqual(record.transcript_manifest.gaps[0],{after_sequence:null,before_sequence:1,reason:'write_failed'});
});
