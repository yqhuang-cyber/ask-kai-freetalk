import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObservationSummary,observationMarkdown } from '../packages/agent-core/observation-summary.js';
import { PlanningTrace } from '../packages/agent-core/planning-trace.js';
import { ObservationReports } from '../apps/realtime-gateway/src/observation-reports.js';

const identity={owner_id:'report-owner',learner_id:'report-learner',authorization_until:Date.now()+600000,scopes:['session:create']};
function builder(){
  const summary=new ObservationSummary({traceId:'fixture-trace',createdAt:'2026-10-19T00:00:00Z'});let seq=0;
  const event=(stage,data)=>summary.consume({seq:++seq,at_ms:seq,stage,data});
  event('preparation.ready',{plan:{conversation_purpose:'聊熟悉的生活',strategy:{speaking_difficulty:{lexical_style:'everyday'}},speaking_constraints:{profile_level:1}}});
  event('voice.context.prepared',{session_id:'fixture-session',provider_kind:'test',synthetic:true,context_version:1,context_hash:'a'.repeat(64),instructions:'第一版完整指令'});
  event('voice.request.sent',{context_version:1,context_hash:'a'.repeat(64),body:{session:{model:'fixture-model',instructions:'第一版完整指令'}}});
  event('voice.connection',{log_id:'fixture-provider-log'});event('voice.ready',{context_version:1,context_hash:'a'.repeat(64),provider_session_id:'fixture-provider-session'});
  return {summary,event};
}
test('summary pins the first five accepted turns, keeps partial output, and never applies a late plan retrospectively',()=>{
  const {summary,event}=builder();
  for(let n=1;n<=7;n++){
    event('student.input.accepted',{turn_id:`t${n}`,source_event_id:`e${n}`,text:`作者输入${n}`});
    event('voice.reply.started',{turn_id:`t${n}`,response_id:`r${n}`,provider_response_id:`provider-r${n}`,applied_context_version:1,applied_context_hash:'a'.repeat(64),pending_context:false});
    event('planning.committed',{turn_id:`t${n}`,proposal:{proposal_id:`p${n}`,turn_id:`t${n}`,reply_directive:{task:'晚到的下一步建议'}}});
    event('voice.reply.forwarded',{turn_id:`t${n}`,response_id:`r${n}`,text:`作者回复${n}`,status:n===5?'interrupted':'response.done'});
  }
  event('session.ended',{state:'failed',code:'CANCEL_ACK_TIMEOUT'});
  const report=summary.snapshot();assert.equal(report.turns.length,5);assert.equal(report.coverage.omitted_turns,2);
  assert.equal(report.turns[0].responses[0].expected.source,'planner_initial');assert.equal(report.turns[0].planner_proposal.task,'晚到的下一步建议');
  assert.equal(report.turns[4].responses[0].actual_response.text,'作者回复5');assert.equal(report.turns[4].responses[0].actual_response.complete,false);
  assert.equal(report.provider.log_id,'fixture-provider-log');assert.equal(report.instruction_versions[0].instructions,'第一版完整指令');
  assert.ok(!JSON.stringify(report).includes('作者回复6'));assert.ok(!JSON.stringify(report).includes('作者输入7'));
  const markdown=observationMarkdown(report);for(const value of ['fixture-provider-log','第一版完整指令','作者回复5','晚到的下一步建议','未完整结束'])assert.ok(markdown.includes(value));
});
test('a context update retains the language ceiling and distinguishes sent instructions from compiled instructions',()=>{
  const {summary,event}=builder();
  event('planning.committed',{turn_id:'t1',proposal:{proposal_id:'p1',turn_id:'t1',reply_directive:{task:'用简单中文回应',speaking_difficulty:{lexical_style:'everyday',sentence_structure:'simple',new_word_policy:'avoid'}}}});
  event('voice.context.requested',{context_version:2,context_hash:'b'.repeat(64),instructions:'尚未发送的配置',advisory_turn_id:'t1',advisory_proposal_id:'p1',speaking_constraints:{profile_level:1,verified_through_level:1}});
  event('student.input.accepted',{turn_id:'t2',text:'我今天不去。'});
  event('voice.reply.started',{turn_id:'t2',response_id:'r2',applied_context_version:2,applied_context_hash:'b'.repeat(64)});
  const report=summary.snapshot();assert.equal(report.turns[0].responses[0].expected.speaking_constraints.verified_through_level,1);assert.equal(report.instruction_versions[0].sent,false);assert.equal(report.turns[0].responses[0].instruction_ref.confirmation_at_start,false);
  assert.match(observationMarkdown(report),/已发送：false/);
});
test('summary is independent of the rolling raw trace and keeps expectation at the response-start snapshot',()=>{
  const trace=new PlanningTrace({limit:2});
  trace.record('preparation.ready',{plan:{conversation_purpose:'初始预期'}});
  trace.record('voice.context.prepared',{session_id:'trace-session',context_version:1,context_hash:'a'.repeat(64),instructions:'旧指令'});
  trace.record('student.input.accepted',{turn_id:'turn',source_event_id:'input',text:'固定作者输入'});
  trace.record('voice.reply.started',{turn_id:'turn',response_id:'reply',applied_context_version:1,applied_context_hash:'a'.repeat(64)});
  for(let i=0;i<20;i++)trace.record('voice.context.waiting',{context_version:i+2});
  trace.record('voice.reply.forwarded',{response_id:'reply',text:'尚未说完',status:'interrupted'});
  trace.record('session.ended',{state:'closed'});
  const report=trace.summarySnapshot();assert.equal(trace.snapshot().rows.length,2);assert.equal(report.turns[0].input,'固定作者输入');assert.equal(report.turns[0].responses[0].expected.task,'初始预期');assert.equal(report.instruction_versions[0].instructions,'旧指令');
  trace.clear();assert.equal(trace.summarySnapshot(),null);
});
test('persisted summaries survive a store restart, isolate owners, serialize writes, and allow bounded explicit expectations',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ask-kai-report-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const {summary,event}=builder();event('student.input.accepted',{turn_id:'turn',source_event_id:'event',text:'作者输入'});event('voice.reply.started',{turn_id:'turn',response_id:'reply',applied_context_version:1,applied_context_hash:'a'.repeat(64)});event('session.ended',{state:'closed'});
  const store=new ObservationReports({directory,limit:2}),report=summary.snapshot();
  await store.save(identity,report);
  const restarted=new ObservationReports({directory,limit:2});assert.equal((await restarted.get(identity,report.id)).provider.log_id,'fixture-provider-log');
  assert.deepEqual(await restarted.list({...identity,learner_id:'other'}),[]);await assert.rejects(restarted.get({...identity,owner_id:'other'},report.id),/NOT_FOUND/);
  await assert.rejects(restarted.list({...identity,scopes:[]}),/AUTHORIZATION/);
  const reviewed=await restarted.review(identity,report.id,{reviews:[{response_id:'reply',expected_response:'没关系。今天可以休息。',expected_effect:'只用一级词',notes:'需要人工核对'}]});
  assert.equal(reviewed.turns[0].responses[0].review.expected_effect,'只用一级词');
  await assert.rejects(restarted.review(identity,report.id,{reviews:[{response_id:'foreign',expected_response:null,expected_effect:null,notes:null}]}),/INVALID/);
  await Promise.all([2,3].map(n=>restarted.save(identity,{...report,id:`session-${n}`,ended_at:`2026-10-19T00:00:0${n}Z`})));
  assert.equal((await restarted.list(identity)).length,2);assert.equal((await restarted.list(identity))[0].id,'session-3');
  assert.equal((await stat(directory)).mode&0o777,0o700);
});
