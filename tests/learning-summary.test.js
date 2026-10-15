import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { SUMMARY_POLICY_VERSION,SUMMARY_SCHEMA_VERSION,SUMMARY_LIMITS } from '../packages/agent-core/learning-summary.js';
import { ExperienceTrace } from '../apps/realtime-gateway/public/diagnostics.js';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { MOCK_MISSION } from '../apps/hskai-mock/src/server.js';
import { setup,until,TestProvider } from './helpers/realtime.js';

function unit(mode='sports',mission=MOCK_MISSION) {
  const teaching=new TeachingSession({sessionId:'s',mode,mission});let serial=0,turn=0;
  const event=(type,text,ids={})=>({version:1,event_id:`event-${++serial}`,session_id:'s',seq:serial,at_ms:serial,type,...ids,payload:text===undefined?{}:{text}});
  const say=text=>{const e=event('user.final',text,{turn_id:`t${++turn}`});assert.equal(teaching.accept(e),true);return e;};
  const forward=e=>teaching.forward({type:'event',event:e});
  const reply=(parts=['可以说：我喜欢足球。 You can say: I like football.'],ids={turn_id:`t${turn}`,response_id:`r${turn}`})=>{
    const start=event('response.started',undefined,ids);forward(start);
    const deltas=parts.map(text=>{const e=event('response.text.delta',text,ids);forward(e);return e;});
    const done=event('response.done',undefined,ids);forward(done);return {start,deltas,done};
  };
  const finish=options=>teaching.finalize({businessSource:'mock_hskai',providerKind:'test',ready:true,...options});
  return {teaching,event,say,forward,reply,finish};
}

test('planned goals/decisions alone are not learned items; empty and ordinary chat are distinct',()=> {
  const empty=unit();const a=empty.finish();assert.equal(a.focus,'insufficient');assert.equal(a.goals.length,1);assert.equal(a.learning_items.length,0);assert.equal(a.review_suggestions.length,0);
  const chat=unit('free');chat.say('今天很热');const b=chat.finish();assert.equal(b.focus,'conversation_only');assert.match(b.headline.zh,/以交流为主/);assert.equal(b.goals.length,0);
  const planned=unit();planned.say('足球');assert.equal(planned.teaching.view().decision.action,'TEACH_TARGET');
  const c=planned.finish();assert.equal(c.learning_items.length,0);assert.equal(c.counts.attempts,0);assert.equal(c.focus,'conversation_only');
});
test('supported Mission attempts have first-target course provenance without implying course achievement',()=> {
  const x=unit('mission',{...MOCK_MISSION,targets:[MOCK_MISSION.targets[0],'不要作为本轮目标']});const e=x.say('我很喜欢踢足球');
  const s=x.finish();assert.equal(s.focus,'practice_observed');assert.equal(s.goals.length,1);assert.equal(s.goals[0].source.target_index,0);
  assert.equal(s.goals[0].source.completion_id,MOCK_MISSION.completion_id);assert.equal(s.business_source,'mock_hskai');
  const item=s.learning_items[0];assert.equal(item.text,'我喜欢足球');assert.equal(item.attempt_refs[0].source_event_id,e.event_id);assert.equal(item.goal_id,'mission-target-1');
  assert.equal(item.attempt_refs[0].scaffolding,'start_tip_available');assert.equal(s.assessment.independent_use_assessed,false);assert.equal(s.voice.kind,'synthetic');
  assert.ok(!JSON.stringify(s).includes('不要作为本轮目标'));assert.equal(s.voice.real_experience_accepted,false);
});
test('literal Mission variants stay on the selected target; unsupported targets never inherit sports credit',()=> {
  const literal=unit('mission',{...MOCK_MISSION,targets:['我喜欢足球。','我喜欢篮球']});literal.say('我喜欢篮球');literal.say('我喜欢足球');
  const s=literal.finish();assert.equal(s.counts.attempts,1);assert.equal(s.learning_items[0].text,'我喜欢足球');
  const unsupported=unit('mission',{...MOCK_MISSION,targets:['问路','我喜欢足球']});unsupported.say('我喜欢足球');unsupported.reply();
  const other=unsupported.finish();assert.equal(other.goals[0].attempt_rule_supported,false);assert.equal(other.learning_items.length,0);assert.equal(other.review_suggestions.length,0);
});
test('free chat keywords and unsourced model text cannot invent a lesson',()=> {
  const x=unit('free');x.say('我喜欢足球');x.reply();x.say('我喜欢足球');
  const s=x.finish();assert.equal(s.learning_items.length,0);assert.equal(s.counts.attempts,0);assert.equal(s.goals.length,0);
  const advised=unit('free');advised.say('How do I say football in Chinese?');advised.say('我喜欢足球');assert.equal(advised.finish().counts.attempts,0);
});
test('complete forwarded target text is separately sourced and is never a playback or learner-attempt claim',()=> {
  const x=unit('free'),request=x.say('How do I say football in Chinese?');const r=x.reply(['可以说：我喜','欢足','球。 You can say: I like football.']);
  const s=x.finish(),item=s.learning_items[0];assert.equal(s.focus,'target_text_observed');assert.equal(item.kind,'target_text_observed');assert.equal(item.attempt_count,0);
  assert.equal(item.target_text_count,1);assert.deepEqual(item.target_text_refs[0].source_event_ids,r.deltas.map(e=>e.event_id));
  assert.equal(item.target_text_refs[0].completion_event_id,r.done.event_id);assert.equal(item.target_text_refs[0].request_event_id,request.event_id);
  assert.equal(item.target_text_refs[0].scope,'gateway_forwarded_text');assert.equal(item.target_text_refs[0].playback_confirmed,false);
  assert.equal(s.review_suggestions[0].reason,'target_text_without_attempt');assert.equal(s.coverage.complete_learning_inventory,false);
});
test('free chat can record a subsequent direct attempt with the actual prior scaffold source',()=> {
  const x=unit('free');x.say('How do I say football in Chinese?');const r=x.reply();const learner=x.say('我喜欢足球');
  x.teaching.view().attempts[0].scaffold_source.response_id='forged-source';
  const s=x.finish(),item=s.learning_items[0],attempt=item.attempt_refs[0];assert.equal(s.counts.attempts,1);assert.equal(item.kind,'attempted');
  assert.equal(attempt.source_event_id,learner.event_id);assert.equal(attempt.scaffolding,'model_text_available');assert.equal(attempt.scaffold_source.response_id,r.start.response_id);
  assert.equal(attempt.scaffold_ref,item.target_text_refs[0].ref_id);assert.equal(attempt.pronunciation_assessed,false);assert.equal(s.review_suggestions.length,1);
  assert.equal(s.review_suggestions[0].reason,'attempt_not_assessed');assert.equal(s.assessment.mastery_assessed,false);
});

test('free recap records curated student expressions separately from practice, without copying raw details',()=>{
  const x=unit('free'),student=x.say('我喜欢音乐。 PRIVATE_DETAIL');x.reply(['PRIVATE_TEACHER_DETAIL']);const s=x.finish();
  assert.equal(s.learning_items.length,0);assert.equal(s.counts.attempts,0);assert.deepEqual(s.conversation_recap.topics.map(t=>t.label),['兴趣爱好']);
  const entry=s.conversation_recap.expressions[0];assert.equal(entry.text,'我喜欢音乐');assert.equal(entry.kind,'student_text_observed');assert.equal(entry.source_refs[0].source_event_id,student.event_id);assert.equal(s.conversation_recap.correctness_assessed,false);assert.ok(!JSON.stringify(s).includes('PRIVATE'));
  const quote=unit('free');quote.say('他说“我喜欢音乐”。');assert.equal(quote.finish().conversation_recap.expressions.length,0);
});

test('general free expressions need a complete forwarded scaffold and later actual input; unsupported text stays outside the directory',()=>{
  const x=unit('free');x.say('What is apple in Chinese?');const r=x.reply(['“苹','果”。 Apple.']);const learner=x.say('苹果。');const s=x.finish();
  assert.equal(s.learning_items[0].id,'apple');assert.equal(s.counts.attempts,1);assert.equal(s.learning_items[0].attempt_refs[0].source_event_id,learner.event_id);assert.equal(s.learning_items[0].attempt_refs[0].scaffold_source.response_id,r.start.response_id);
  assert.equal(s.learning_items[0].content_source.directory_version,'kai-expression-directory-v1');assert.equal(s.review_suggestions.length,1);
  const unknown=unit('free');unknown.say('How do I say violin in Chinese?');unknown.reply(['小提琴。 Violin.']);unknown.say('小提琴。');assert.equal(unknown.finish().learning_items.length,0);
  const cancelled=unit('free');cancelled.say('What is apple in Chinese?');const ids={turn_id:'t1',response_id:'old'};cancelled.forward(cancelled.event('response.started',undefined,ids));cancelled.forward(cancelled.event('response.text.delta','苹果。',ids));cancelled.teaching.forward({type:'output.stop',response_id:'old'});cancelled.forward(cancelled.event('response.done',undefined,ids));cancelled.say('苹果。');assert.equal(cancelled.finish().counts.attempts,0);
});
test('quoted, questioned, negated, partial, foreign and duplicate student expressions cannot earn attempts',()=> {
  for(const mode of ['sports','mission','free']) {
    const x=unit(mode);if(mode==='free'){x.say('How do I say football in Chinese?');x.reply();}
    for(const text of ['我不喜欢足球','我喜欢足球吗？','他说我喜欢足球','“我喜欢足球”','请翻译“我喜欢足球”'])x.say(text);
    const partial=x.event('user.partial','我喜欢足球',{turn_id:'partial'});assert.equal(x.teaching.accept(partial),false);
    const foreign=x.event('user.final','我喜欢足球',{turn_id:'foreign'});foreign.session_id='other';assert.equal(x.teaching.accept(foreign),false);
    const first=x.say('我喜欢足球');assert.equal(x.teaching.accept(first),false);assert.equal(x.teaching.accept({...first,event_id:'duplicate-final'}),false);
    assert.equal(x.finish().counts.attempts,1);
  }
});
test('cancelled/incomplete replies and late completions cannot provide free-chat scaffolds',()=> {
  const x=unit('free');x.say('How do I say football in Chinese?');const ids={turn_id:'t1',response_id:'old'};
  x.forward(x.event('response.started',undefined,ids));x.forward(x.event('response.text.delta','可以说：我喜欢足球。',ids));
  x.teaching.forward({type:'output.stop',response_id:'old'});assert.equal(x.forward(x.event('response.done',undefined,ids)),false);
  x.say('我喜欢足球');assert.equal(x.finish().learning_items.length,0);
  const stopped=unit('free');stopped.say('How do I say football in Chinese?');const r=stopped.reply();stopped.teaching.forward({type:'output.stop',response_id:r.start.response_id});stopped.say('我喜欢足球');
  const s=stopped.finish();assert.equal(s.counts.attempts,0);assert.equal(s.learning_items[0].target_text_refs[0].interrupted,true);
});
test('response/turn ownership, duplicate packets and reused IDs preserve evidence isolation',()=> {
  const x=unit('free');x.say('How do I say football in Chinese?');const ids={turn_id:'t1',response_id:'r'};
  const start=x.event('response.started',undefined,ids);assert.equal(x.forward(start),true);assert.equal(x.forward(start),false);
  assert.equal(x.forward(x.event('response.text.delta','我喜欢足球。',{...ids,turn_id:'foreign'})),false);
  const text=x.event('response.text.delta','我喜欢足球。',ids);assert.equal(x.forward(text),true);assert.equal(x.forward(text),false);
  assert.equal(x.forward({...text,event_id:'foreign-session',session_id:'other'}),false);
  x.forward(x.event('response.done',undefined,ids));assert.equal(x.forward(x.event('response.started',undefined,ids)),false);
  x.say('我喜欢足球');const s=x.finish();assert.equal(s.counts.attempts,1);assert.equal(s.learning_items[0].target_text_count,1);
});
test('oversized or excessively fragmented replies remain unassessed and buffers are cleared',()=> {
  for(const parts of [['我喜欢足球。','x'.repeat(2000),'x'.repeat(2000),'x'.repeat(500)],Array.from({length:257},()=> '我喜欢足球。')]) {
    const x=unit('free');x.say('How do I say football in Chinese?');x.reply(parts);x.say('我喜欢足球');
    const s=x.finish();assert.equal(s.learning_items.length,0);assert.equal(s.coverage.unassessed_replies,1);assert.equal(x.teaching.learning.active,null);
  }
});
test('summary refs/views are bounded, counts remain exact and immutable finalization rejects late evidence',()=> {
  const x=unit();for(let i=0;i<30;i++)x.say('我喜欢足球');
  const view=x.teaching.view();assert.equal(view.attempt_count,30);assert.equal(view.attempts.length,SUMMARY_LIMITS.view_attempts);assert.equal(view.attempts_truncated,true);
  const s=x.finish();assert.equal(s.counts.attempts,30);assert.equal(s.learning_items[0].attempt_refs.length,SUMMARY_LIMITS.refs_per_item);assert.equal(s.learning_items[0].refs_truncated,true);
  s.learning_items[0].attempt_refs[0].kind='mastered';s.goals[0].source.kind='forged';
  assert.equal(x.teaching.accept(x.event('user.final','我喜欢足球',{turn_id:'late'})),false);
  assert.equal(x.forward(x.event('response.started',undefined,{turn_id:'late',response_id:'late'})),false);
  const again=x.finish({outcome:'failed'});assert.equal(again.outcome,'ended');assert.equal(again.learning_items[0].attempt_refs[0].kind,'attempted');assert.notEqual(again.goals[0].source.kind,'forged');
});
test('source samples retain the prior scaffold even when the corresponding text-ref sample was evicted',()=> {
  const x=unit('free');let source;
  for(let i=0;i<10;i++){
    x.say('今天很热');x.say('今天晴天');const request=x.say('How do I say football in Chinese?');
    const r=x.reply(undefined,{turn_id:request.turn_id,response_id:`extra${i}`});
    if(i===4){source=r.start.response_id;x.say('我喜欢足球');}
  }
  const s=x.finish(),item=s.learning_items[0];assert.equal(s.counts.attempts,1);assert.equal(item.target_text_count,10);
  assert.equal(item.attempt_refs[0].scaffold_source.response_id,source);assert.ok(!item.target_text_refs.some(ref=>ref.response_id===source));
});
test('failed ends retain accepted partial facts; safety/revocation suppress all learning data',()=> {
  const failed=unit();failed.say('我喜欢足球');const s=failed.finish({outcome:'failed',endReason:'service_failure'});
  assert.equal(s.partial,true);assert.equal(s.counts.attempts,1);assert.equal(s.focus,'practice_observed');
  for(const reason of ['safety_restricted','authorization_revoked']) {
    const x=unit();x.say('我喜欢足球');x.reply();const restricted=x.finish({outcome:'failed',endReason:reason});
    assert.equal(restricted.focus,'unavailable');assert.equal(restricted.counts.attempts,0);assert.deepEqual(restricted.goals,[]);assert.deepEqual(restricted.learning_items,[]);assert.deepEqual(restricted.review_suggestions,[]);
    assert.deepEqual(restricted.conversation_recap.topics,[]);assert.deepEqual(restricted.conversation_recap.expressions,[]);
  }
});
test('summaries/diagnostics omit raw student/model text, preference data and owner identity',()=> {
  const x=unit();x.say('我喜欢足球。 PRIVATE_LEARNER_DETAIL');x.reply(['我喜欢足球。 PRIVATE_MODEL_DETAIL']);
  const s=x.finish();for(const secret of ['PRIVATE_LEARNER_DETAIL','PRIVATE_MODEL_DETAIL','owner_id','learner_id'])assert.ok(!JSON.stringify(s).includes(secret));
  const trace=new ExperienceTrace();trace.gateway({name:'session.config',at_ms:0,fields:{synthetic:true}});
  trace.record('summary.finalized',{summary_policy_version:SUMMARY_POLICY_VERSION,summary_focus:s.focus,summary_outcome:s.outcome,summary_partial:s.partial,summary_attempts:1,summary_items:1,summary:s,text:'PRIVATE_DETAIL'});
  const report=trace.snapshot();assert.equal(report.real_experience_accepted,false);assert.equal(report.kind,'synthetic');assert.ok(!JSON.stringify(report).includes('我喜欢足球'));assert.ok(!JSON.stringify(report).includes('PRIVATE_DETAIL'));
});

test('all three gateway entry modes send one sourced summary before closing via actual local mock authorization',async t=> {
  const backend=await startMockBackend();t.after(()=>backend.close());const {origin,create,open}=await setup(t,{...backend});
  for(const mode of ['sports','mission','free']) {
    const launch=await fetch(origin+'/api/poc/launch',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    const cookie=launch.headers.get('set-cookie').split(';')[0];const ticket=await(await create({mode,...(mode==='mission'?{mission_id:MOCK_MISSION.id}:{})},{Cookie:cookie})).json();
    const {provider,packets,ws}=await open(ticket);provider.emit('session.ready');provider.emit('user.final',{text:mode==='free'?'今天很热':'我喜欢足球'},{turn_id:'t1'});
    ws.send(JSON.stringify({type:'session.end'}));await once(ws,'close');
    const summaries=packets.filter(p=>p.type==='teaching.summary');assert.equal(summaries.length,1);const packet=summaries[0],s=packet.summary;
    assert.equal(s.schema_version,SUMMARY_SCHEMA_VERSION);assert.equal(s.policy_version,SUMMARY_POLICY_VERSION);assert.equal(s.session_id,ticket.session_id);assert.equal(s.mode,mode);assert.equal(s.business_source,'mock_hskai');assert.equal(s.voice.kind,'synthetic');
    assert.equal(s.counts.attempts,mode==='free'?0:1);assert.equal(s.end_reason,'student_end');assert.ok(packets.indexOf(packet)<packets.findIndex(p=>p.type==='session.closed'));assert.equal(provider.closed,true);
  }
});
test('held completed output and acknowledged plans do not become forwarded target facts',async t=> {
  let provider;const {create,open}=await setup(t,{replyGraceMs:250,providerFactory:()=>provider=Object.assign(new TestProvider(),{speechStartKind:'asr_candidate'})});
  const {packets,ws}=await open(await(await create({mode:'free'})).json());provider.emit('session.ready');
  provider.emit('user.final',{text:'How do I say football in Chinese?'},{turn_id:'t1'});const ids={turn_id:'t1',response_id:'r1'};
  provider.emit('response.started',{},ids);provider.emit('response.text.delta',{text:'可以说：我喜欢足球。'},ids);provider.emit('response.done',{},ids);
  provider.control('context.updated',{version:provider.contexts[0].version});ws.send(JSON.stringify({type:'session.end'}));await once(ws,'close');
  assert.ok(packets.some(p=>p.type==='teaching.context.applied'));assert.ok(!packets.some(p=>p.event?.type==='response.text.delta'));
  const s=packets.find(p=>p.type==='teaching.summary').summary;assert.equal(s.learning_items.length,0);assert.equal(s.counts.forwarded_completed_replies,0);
});
test('provider errors preserve prior accepted attempts; readiness timeout reports insufficient/not connected',async t=> {
  const normal=await setup(t),a=await normal.open(await(await normal.create()).json());a.provider.emit('session.ready');a.provider.emit('user.final',{text:'我喜欢足球'},{turn_id:'t1'});
  const closing=once(a.ws,'close');a.provider.input.onFailure('SYNTHETIC_FAILURE');await closing;
  const s=a.packets.find(p=>p.type==='teaching.summary').summary;assert.equal(s.outcome,'failed');assert.equal(s.partial,true);assert.equal(s.counts.attempts,1);
  const notReady=await setup(t,{readyTimeoutMs:20}),b=await notReady.open(await(await notReady.create()).json());await once(b.ws,'close');
  const noData=b.packets.find(p=>p.type==='teaching.summary').summary;assert.equal(noData.voice.kind,'not_connected');assert.equal(noData.focus,'insufficient');assert.equal(noData.counts.attempts,0);
});
test('provider terminal event finalizes once; synchronous late failure during close cannot rewrite it',async t=> {
  let provider;const {create,open}=await setup(t,{providerFactory:()=>{const p=provider=new TestProvider();p.close=()=>{p.closed=true;p.input.onFailure('LATE_FAILURE');};return p;}});
  const {packets,ws}=await open(await(await create()).json());const closing=once(ws,'close');
  provider.emit('session.ready');provider.emit('user.final',{text:'我喜欢足球'},{turn_id:'t1'});provider.emit('session.closed');await closing;
  assert.equal(packets.filter(p=>p.type==='teaching.summary').length,1);const s=packets.find(p=>p.type==='teaching.summary').summary;assert.equal(s.outcome,'ended');assert.equal(s.end_reason,'provider_closed');assert.equal(s.counts.attempts,1);
  assert.ok(!packets.some(p=>p.type==='session.failed'));
});

test('completed owned text before final ASR links once and never credits the same turn as an attempt',()=>{
  const x=unit('free'),r=x.reply(['“苹果”。 Apple.'],{turn_id:'t1',response_id:'early'});
  const final=x.say('What is apple in Chinese?');
  assert.equal(x.teaching.view().attempts.length,0);
  const learner=x.say('苹果。');const s=x.finish();
  assert.equal(s.learning_items.length,1);assert.equal(s.learning_items[0].target_text_count,1);
  assert.equal(s.learning_items[0].target_text_refs[0].request_event_id,final.event_id);
  assert.equal(s.learning_items[0].target_text_refs[0].completion_event_id,r.done.event_id);
  assert.equal(s.counts.forwarded_completed_replies,1);assert.equal(s.counts.attempts,1);
  assert.equal(s.learning_items[0].attempt_refs[0].source_event_id,learner.event_id);
  const same=unit('free');same.reply(['可以说：我喜欢足球。'],{turn_id:'t1',response_id:'early'});
  same.say('How do I say 我喜欢足球 in Chinese?');assert.equal(same.finish().counts.attempts,0);
});
test('late-final summary linking respects turn ownership, stop fences and absence of an expression request',()=>{
  for(const kind of ['wrong-turn','stopped','ordinary','unfinished']) {
    const x=unit('free'),ids={turn_id:kind==='wrong-turn'?'other':'t1',response_id:'early'};
    if(kind==='unfinished'){x.forward(x.event('response.started',undefined,ids));x.forward(x.event('response.text.delta','苹果。',ids));}
    else x.reply(['苹果。'],ids);
    if(kind==='stopped')x.teaching.forward({type:'output.stop',response_id:'early'});
    x.say(kind==='ordinary'?'今天不错':'What is apple in Chinese?');
    const s=x.finish();assert.equal(s.learning_items.length,0);assert.equal(s.counts.attempts,0);
  }
});
test('late-final completed reply retention is bounded and unresolved sources never become learning items',()=>{
  const x=unit('free');
  for(let i=0;i<SUMMARY_LIMITS.pending_replies+2;i++)x.reply(['苹果。'],{turn_id:`pending-${i}`,response_id:`r-${i}`});
  const s=x.finish();assert.equal(s.learning_items.length,0);assert.equal(s.counts.attempts,0);
  assert.equal(s.coverage.unassessed_replies,SUMMARY_LIMITS.pending_replies+2);
});
