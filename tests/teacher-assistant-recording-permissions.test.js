import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {HomeworkService} from '../apps/hskai-mock/src/teacher-assistant/service.js';
import {startHomeworkBackend} from '../packages/hskai-bridge/homework-port.js';
import {EvidenceRecorder} from '../packages/teacher-assistant/evidence.js';

async function fixture(options={}){
  const service=new HomeworkService(options),teacher=(await service.call('login',null,{actor_id:'mock-teacher-lin'})).token,learner=(await service.call('login',null,{actor_id:'mock-maya-hsk3'})).token;
  const plan=await service.call('preview',teacher,{learner_id:'mock-maya-hsk3',topic:'dining'});
  const published=await service.call('publish',teacher,{learner_id:plan.learner_id,topic:'dining',plan_hash:plan.hash,due_at:new Date(Date.now()+86400000).toISOString(),timezone:'Asia/Shanghai',idempotency_key:'record-choice-publish'});
  const prepared=await service.call('prepare',learner,{assignment_id:published.assignment_id});
  const input={attempt_id:prepared.attempt.id,notice_version:'deep-report-notice-v5',expected_revision:0,text:true,audio:false};
  return {service,teacher,learner,prepared,input};
}
test('M4 stores per-attempt choices separately from attempts and rejects teacher / other learner writes',async t=>{
  const f=await fixture();t.after(()=>f.service.close());
  const before=await f.service.call('recording_choice',f.learner,{attempt_id:f.input.attempt_id});assert.equal(before.revision,0);assert.equal(before.audio.allowed,false);
  const saved=await f.service.call('recording_choice_update',f.learner,f.input);assert.equal(saved.revision,1);assert.equal(saved.collection_enabled,true);assert.equal(saved.text.allowed,true);assert.equal(saved.audio.allowed,false);
  assert.equal(f.service.repo.get('attempts',f.input.attempt_id).state,'active');assert.equal(f.service.repo.get('attempts',f.input.attempt_id).version,1);
  await assert.rejects(f.service.call('recording_choice_update',f.teacher,f.input),/FORBIDDEN/);
  f.service.repo.put('actors',{id:'mock-alex-hsk1',role:'learner',active:true,auth_epoch:1,deletion_epoch:1});
  const other=(await f.service.call('login',null,{actor_id:'mock-alex-hsk1'})).token;
  await assert.rejects(f.service.call('recording_choice',other,{attempt_id:f.input.attempt_id}),/FORBIDDEN/);
  await assert.rejects(f.service.call('recording_choice_update',f.learner,f.input),/VERSION_CONFLICT/);
});
test('choice persists across restart; audio stays disabled and interrupted attempts stay interrupted',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'kai-recording-choice-'));t.after(()=>rmSync(dir,{force:true,recursive:true}));const path=join(dir,'test.sqlite');
  const f=await fixture({path});await f.service.call('recording_choice_update',f.learner,f.input);f.service.close();
  const restarted=new HomeworkService({path});t.after(()=>restarted.close());const saved=await restarted.call('recording_choice',f.learner,{attempt_id:f.input.attempt_id});assert.equal(saved.text.allowed,true);assert.equal(saved.collection_enabled,true);assert.equal(restarted.repo.get('attempts',f.input.attempt_id).state,'interrupted');
  assert.deepEqual(restarted.repo.db.prepare('SELECT version FROM migrations ORDER BY version').all().map(r=>r.version),[1,2,3,4,5,6,7]);
});
test('TTL sweep and request path revoke expired branches without reviving or extending them',async t=>{
  let now=Date.now();const f=await fixture({now:()=>now,recordingPolicy:{text_days:7,audio_days:1}});t.after(()=>f.service.close());
  const saved=await f.service.call('recording_choice_update',f.learner,{...f.input,audio:true});now=saved.audio.expires_at;f.service.recordingPermissions.expire();f.learner=(await f.service.call('login',null,{actor_id:'mock-maya-hsk3'})).token;
  const expired=await f.service.call('recording_choice',f.learner,{attempt_id:f.input.attempt_id});assert.equal(expired.audio.state,'expired');assert.equal(expired.text.allowed,true);
  await assert.rejects(f.service.call('recording_choice_update',f.learner,{...f.input,expected_revision:expired.revision,audio:true}),/EXPIRED/);
  const revoked=await f.service.call('recording_choice_update',f.learner,{...f.input,expected_revision:expired.revision,text:false});assert.equal(revoked.text.state,'revoked');assert.equal(revoked.text.expires_at,saved.text.expires_at);
});
test('account deletion clears choices and blocks late writes; stale actor access cannot restore them',async t=>{
  const f=await fixture();t.after(()=>f.service.close());await f.service.call('recording_choice_update',f.learner,f.input);
  await f.service.call('delete_my_data',f.learner);assert.deepEqual(f.service.repo.all('recording_choices'),[]);
  await assert.rejects(f.service.call('recording_choice_update',f.learner,{...f.input,expected_revision:1}),/UNAUTHORIZED/);
  assert.deepEqual(f.service.repo.all('recording_choices'),[]);
});
test('revoking future deep-record choices preserves an explicitly submitted legacy attempt',async t=>{
  const f=await fixture();t.after(()=>f.service.close());await f.service.call('recording_choice_update',f.learner,f.input);
  await f.service.call('bind_session',f.learner,{attempt_id:f.input.attempt_id,session_id:'synthetic-session'});
  const recorder=new EvidenceRecorder({attemptId:f.input.attempt_id,sessionId:'synthetic-session',planHash:f.prepared.plan.hash});recorder.input({type:'user.final',event_id:'synthetic-final',turn_id:'synthetic-turn',payload:{text:'我要一碗面条'}});
  await f.service.call('finalize',f.learner,{attempt_id:f.input.attempt_id,evidence:recorder.finalize({providerKind:'test',ready:true})});
  const attempt=await f.service.call('attempt',f.learner,{attempt_id:f.input.attempt_id}),submitted=await f.service.call('submit',f.learner,{attempt_id:attempt.id,expected_version:attempt.version,idempotency_key:'synthetic-submit-key'});
  await f.service.call('recording_choice_update',f.learner,{...f.input,expected_revision:1,text:false});
  assert.equal((await f.service.call('submission',f.learner,{submission_id:submitted.id})).state,'submitted');assert.equal(f.service.repo.get('attempts',attempt.id).state,'ended');
});
test('authenticated local M4 child exposes configured notice, no provider / recording activation',async t=>{
  const backend=await startHomeworkBackend({path:':memory:',recordingEnv:{ASK_KAI_TA_TEXT_RETENTION_DAYS:'3',ASK_KAI_TA_AUDIO_RETENTION_DAYS:'2'}});t.after(()=>backend.close());
  const login=await backend.port.call('login',null,{actor_id:'mock-maya-hsk3'}),notice=await backend.port.call('recording_notice',login.token);
  assert.equal(notice.text.retention_days,3);assert.equal(notice.audio.retention_days,2);assert.equal(notice.capabilities.external_processing_reviewed,false);assert.equal(notice.capabilities.audio_collection,false);
  await assert.rejects(backend.port.call('recording_notice','not-a-valid-token'),/UNAUTHORIZED/);
});
