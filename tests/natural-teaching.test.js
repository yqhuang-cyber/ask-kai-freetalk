import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { NATURAL_TEACHING_INSTRUCTIONS,TEACHING_POLICY_VERSION,TEACHING_ACTIONS,TEACHING_REASONS } from '../packages/agent-core/natural-teaching.js';
import { ExperienceTrace,metadata } from '../apps/realtime-gateway/public/diagnostics.js';
import { setup,until } from './helpers/realtime.js';

const mission={title:'示例 Mission',targets:['用「我喜欢……」表达喜好','SECOND_TARGET_MUST_NOT_BE_INSTRUCTIONS']};
function learner(mode='sports',options={}) {
  const session=new TeachingSession({sessionId:'s',mode,mission,...options});let n=0;
  return {session,say(text){const i=++n;assert.equal(session.accept(final(text,`t${i}`)),true);return session.view().decision;}};
}
const final=(text,turn='t1')=>({version:1,event_id:`e-${turn}`,session_id:'s',seq:1,at_ms:0,type:'user.final',turn_id:turn,payload:{text}});

test('three modes share the immediate policy; Mission uses one trusted target and free chat has none',()=>{
  for(const mode of ['sports','mission','free']) {
    const {session}=learner(mode);assert.ok(session.instructions().includes(NATURAL_TEACHING_INSTRUCTIONS));
    assert.equal(session.view().teaching_policy_version,TEACHING_POLICY_VERSION);assert.equal(session.view().decision,null);
    assert.ok(!session.instructions().includes('SECOND_TARGET_MUST_NOT_BE_INSTRUCTIONS'));
    if(mode==='mission')assert.equal(session.view().goal,mission.targets[0]);
  }
  const {say}=learner('free');const d=say('我喜欢足球');
  assert.equal(d.interaction,'chat');assert.equal(d.new_points,0);assert.equal(d.goal_id,null);
});

test('relevant short theme/Mission answers allow one opportunity; planned teaching is not evidence',()=>{
  for(const mode of ['sports','mission']) {
    const {session,say}=learner(mode);const d=say('Football.');
    assert.equal(d.action,'TEACH_TARGET');assert.equal(d.new_points,1);assert.equal(d.support_level,'model');
    assert.equal(d.reason,'relevant_short_answer');assert.equal(d.advisory,true);assert.equal(session.evidence.length,0);
    say('周末');say('和朋友');const again=say('篮球');
    assert.equal(again.interaction,'chat');assert.equal(again.new_points,0);
  }
});

test('explicit help respects a two-final-turn cooldown and can re-enter teaching later',()=>{
  const {say}=learner();assert.equal(say('football').action,'TEACH_TARGET');
  for(let i=0;i<2;i++) {
    const d=say('How do I say football in Chinese?');assert.equal(d.reason,'teaching_cooldown');
    assert.equal(d.action,'RESPOND');assert.equal(d.new_points,0);assert.equal(d.support_level,'choice');
  }
  const resumed=say('足球用中文怎么说');assert.equal(resumed.action,'TEACH_TARGET');assert.equal(resumed.teaching_cooldown,2);
});

test('a direct target attempt reduces scaffolding and suppresses repeated unsolicited practice',()=>{
  for(const mode of ['sports','mission']) {
    const {session,say}=learner(mode);const d=say('我喜欢足球');
    assert.equal(d.action,'FOLLOW_UP');assert.equal(d.reason,'goal_attempt_observed');assert.equal(d.support_level,'none');
    assert.equal(d.goal_attempt_observed,true);assert.equal(say('basketball').new_points,0);
    assert.equal(session.evidence.length,1); // Task 07 adds supported Mission attempt evidence.
    assert.ok(!JSON.stringify(session.view()).includes('mastered'));
  }
});

test('negations, questions, third-person and quoted expressions do not create an attempt',()=>{
  for(const text of ['我不喜欢足球','我喜欢足球吗？','我喜欢足球还是篮球','老师说我喜欢足球','“我喜欢足球”是什么意思？','我喜欢的不是足球']) {
    const {session,say}=learner();assert.equal(say(text).goal_attempt_observed,false,text);assert.equal(session.evidence.length,0,text);
  }
  const {session,say}=learner();say('我很喜欢踢足球。');assert.equal(session.evidence.length,1);
});

test('ordinary questions and unrelated stories answer first with zero new teaching points',()=>{
  for(const mode of ['sports','mission','free'])for(const text of ['足球什么时候比赛？','What is football?','今天我去买冰淇淋','我今天打篮球很开心']) {
    const {say}=learner(mode);const d=say(text);assert.equal(d.interaction,'chat',text);assert.equal(d.new_points,0,text);
    if(text.includes('?') || text.includes('？'))assert.equal(d.action,'RESPOND');
  }
  const {say}=learner('free');const d=say('How do I say ice cream in Chinese?');
  assert.equal(d.action,'TEACH_TARGET');assert.equal(d.goal_id,null);assert.equal(d.new_points,1);
});

test('ambiguity asks once then waits; substantive answers clear clarification state',()=>{
  const {say}=learner();assert.equal(say('那个').action,'CLARIFY_INTENT');
  for(const text of ['不知道','嗯','what?']) {
    const d=say(text);assert.equal(d.reason,'clarification_limit');assert.equal(d.action,'RESPOND');assert.equal(d.new_points,0);
  }
  assert.equal(say('我喜欢足球').clarification_pending,false);
  assert.equal(say('不确定').action,'CLARIFY_INTENT');
});

test('bare references use only prior accepted input while unresolved clarification remains bounded',()=>{
  const {say}=learner('free');assert.equal(say('that').action,'CLARIFY_INTENT');assert.equal(say('this').reason,'clarification_limit');
  say('我喜欢音乐');const ref=say('that');assert.equal(ref.reason,'prior_context_reference');assert.equal(ref.reference_context_turn_id,'t3');assert.equal(ref.new_points,0);
  assert.equal(learner('free').say('that').reference_context_turn_id,null);
  say('我不想练习');assert.equal(say('这个').action,'CLARIFY_INTENT');
});

test('short acknowledgements/English answers do not automatically imply ambiguity or a teaching need',()=>{
  for(const text of ['yes','no','okay','ok','好的']) {
    const {say}=learner();const d=say(text);assert.equal(d.action,'RESPOND',text);assert.equal(d.new_points,0,text);
    assert.equal(d.teaching_paused,false,text);
  }
});

test('Chinese/English refusal pauses the goal until explicit help or practice; contractions are preserved',()=>{
  for(const mode of ['sports','mission','free'])for(const text of ['我不想练习，只想聊天。','我不想练习，你最喜欢的食物是什么？','先不复习了','跳过练习',"I don't want to practice. I'd like to chat.",'I don’t want to learn','No more lessons.',"Don't teach me.",'Skip the review.','别教我','不要教我中文']) {
    const {say}=learner(mode);const declined=say(text);assert.equal(declined.reason,'student_declined',text);
    assert.equal(declined.teaching_paused,true);assert.equal(say('football').new_points,0);
    const resumed=say('我想练习');assert.equal(resumed.reason,'student_requested_practice');
    assert.equal(resumed.teaching_paused,false);assert.equal(resumed.action,'TEACH_TARGET');
  }
});

test('topic change yields while keeping signed entry mode/goal; a later keyword cannot pull the student back',()=>{
  const {session,say}=learner('mission');assert.equal(say("Let's talk about food.").reason,'student_changed_topic');
  assert.equal(say('足球').teaching_paused,true);assert.equal(session.mode,'mission');assert.equal(session.view().goal,mission.targets[0]);
  const help=say('How do I say football in Chinese?');assert.equal(help.teaching_paused,false);assert.equal(help.action,'TEACH_TARGET');
  for(const text of ['不要换话题',"Don't change the topic."]) {
    const other=learner();assert.equal(other.say(text).teaching_paused,false);assert.equal(other.say('足球').action,'TEACH_TARGET');
  }
});

test('help on another topic does not reactivate or claim the original lesson goal',()=>{
  const {say}=learner('mission');say('我想聊食物');
  const d=say('How do I say ice cream in Chinese?');assert.equal(d.action,'TEACH_TARGET');assert.equal(d.goal_id,null);
  assert.equal(d.goal_source,null);assert.equal(d.teaching_paused,true);
  assert.equal(say('football').new_points,0);
});

test('paused goal is absent from sent instructions and a generic new-topic sentence cannot resume it',()=>{
  for(const mode of ['sports','mission']) {
    const {session,say}=learner(mode);say('我不想练习');
    assert.ok(!session.instructions().includes('当前目标：'));assert.ok(!session.instructions().includes(mission.targets[0]));
    const help=say('这个句子怎么说？');assert.equal(help.teaching_paused,true);assert.equal(help.goal_id,null);
    say('我喜欢足球');assert.equal(session.stage,'conversation');assert.equal(session.view().decision.teaching_paused,true);
    say('我想练习');assert.equal(session.view().decision.teaching_paused,false);
    assert.ok(session.instructions().includes(mode==='sports'?'当前目标：':mission.targets[0]));
  }
});

test('farewell pauses the goal and continuing conversation does not implicitly authorize old practice',()=>{
  const {session,say}=learner();const end=say('I need to go.');assert.equal(end.action,'CLOSE');assert.equal(end.goal_id,null);assert.equal(end.teaching_paused,true);
  assert.equal(session.stage,'closing');assert.ok(!session.instructions().includes('当前目标：'));
  const resumed=say('我还想聊一下');assert.equal(resumed.new_points,0);assert.equal(resumed.teaching_paused,true);assert.equal(session.stage,'conversation');
  assert.equal(say('继续练习').teaching_paused,false);
  for(const text of ['别结束聊天','不要说再见','Goodbye 是什么意思？'])assert.notEqual(learner().say(text).action,'CLOSE',text);
});

test('ending is advisory, quotes/translation questions cannot control the session',()=>{
  for(const text of ['再见。','我不聊了。','Goodbye Kai.','End the conversation.','I have to go. Can we chat tomorrow?']) {
    const {session,say}=learner();const d=say(text);assert.equal(d.action,'CLOSE');assert.equal(d.new_points,0);
    assert.equal(session.stage,'closing');assert.equal(d.advisory,true);
  }
  for(const text of ['“再见”用中文怎么说？','How do I say goodbye?','How do I say "I don\'t want to practice" in Chinese?',"How do I say 'goodbye' in Chinese?",'换话题是什么意思？']) {
    const {say}=learner();const d=say(text);assert.notEqual(d.action,'CLOSE',text);
    if(text.includes('say') || text.includes('怎么说'))assert.equal(d.action,'TEACH_TARGET',text);
    assert.equal(d.teaching_paused,false,text);
  }
});

test('an ACK before the response-start notice can match a source turn without proving teaching delivery',async t=>{
  const {create,open}=await setup(t);const {ws,provider,packets}=await open(await(await create()).json());provider.emit('session.ready');
  ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>packets.some(p=>p.row?.name==='session.config'));
  const greeting={turn_id:'greeting',response_id:'greeting-reply'};provider.emit('response.started',{},greeting);
  provider.emit('user.final',{text:'football'},{turn_id:'t1'});provider.emit('response.done',{},greeting);
  provider.control('context.updated',{version:provider.contexts[0].version});provider.emit('response.started',{}, {turn_id:'t1',response_id:'r1'});
  await until(()=>packets.filter(p=>p.row?.name==='teaching.response').length===2);
  const context=packets.filter(p=>p.row?.name==='teaching.response').at(-1).row.fields;
  assert.equal(context.decision_context_matched,true);assert.equal(context.applied_context_version,provider.contexts[0].version);
  const state=packets.filter(p=>p.type==='teaching.state').at(-1);assert.equal(state.attempts.length,0);
  ws.send(JSON.stringify({type:'session.end'}));await once(ws,'close');
});

test('only unique validated finals produce sourced decisions; mutable views and old memory cannot change policy',()=>{
  const {session}=learner('sports',{memory:[{field:'interest',value:'private old preference',source:'authorized',updated_at:'2026-10-09'}]});
  for(const e of [{...final('football'),type:'user.partial'},{...final('football'),session_id:'foreign'},{...final('football'),type:'response.text.delta',response_id:'r'},{...final('football'),extra:'bad'}])assert.equal(session.accept(e),false);
  assert.equal(session.version,1);assert.equal(session.accept(final('football')),true);
  const d=session.view().decision;assert.equal(d.source_event_id,'e-t1');assert.equal(d.session_id,'s');assert.equal(d.turn_id,'t1');assert.equal(d.context_version,session.version);
  assert.ok(!JSON.stringify(d).includes('football'));assert.ok(!JSON.stringify(d).includes('private'));
  d.action='CLOSE';assert.equal(session.view().decision.action,'TEACH_TARGET');
  const version=session.version;assert.equal(session.accept(final('我喜欢足球')),false);assert.equal(session.version,version);assert.equal(session.evidence.length,0);
});

test('decision state is session isolated and bounded by the existing 1000-final-turn limit',()=>{
  const first=learner(),second=learner();first.say('不要练习');assert.equal(second.say('football').action,'TEACH_TARGET');
  for(let i=1;i<1000;i++)first.say('今天很好');
  assert.equal(first.session.view().decision.turn_count,1000);assert.throws(()=>first.say('more'),/TEACHING_TURN_LIMIT/);
});

test('metadata allowlists every action/reason and exports aliases/counts without texts or goal labels',()=>{
  for(const action of TEACHING_ACTIONS)assert.equal(metadata({action}).action,action);
  for(const decision_reason of TEACHING_REASONS)assert.equal(metadata({decision_reason}).decision_reason,decision_reason);
  assert.deepEqual(metadata({action:'secret',decision_reason:'secret',goal:'secret',source_event_id:'secret',text:'secret'}),{});
  const trace=new ExperienceTrace();trace.gateway({name:'teaching.decision',at_ms:0,fields:{turn_id:'private-turn',action:'TEACH_TARGET',new_points:1,teaching_policy_version:TEACHING_POLICY_VERSION,context_version:2,text:'private transcript'}});
  trace.gateway({name:'teaching.response',at_ms:1,fields:{response_id:'private-response',turn_id:'private-turn',applied_context_version:1,decision_context_matched:false}});
  const report=trace.snapshot();assert.equal(report.timeline[0].action,'TEACH_TARGET');assert.equal(report.timeline[0].turn_ref,report.timeline[1].turn_ref);
  assert.equal(report.summary.responses[0].teaching_context.decision_context_matched,false);assert.ok(!JSON.stringify(report).includes('private'));
});

test('gateway keeps decisions separate from response context; a late ACK never upgrades an already started reply',async t=>{
  const {create,open}=await setup(t);const {ws,provider,packets}=await open(await(await create()).json());provider.emit('session.ready');
  ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>packets.some(p=>p.row?.name==='session.config'));
  const a={turn_id:'t1',response_id:'r1'},b={turn_id:'t2',response_id:'r2'};
  provider.emit('user.final',{text:'football'},{turn_id:'t1'});provider.emit('response.started',{},a);
  assert.equal(provider.contexts.length,0);provider.emit('response.done',{},a);assert.equal(provider.contexts.length,1);
  const v2=provider.contexts[0].version;provider.emit('user.final',{text:'我不想练习'},{turn_id:'t2'});provider.emit('response.started',{},b);
  provider.control('context.updated',{version:v2});assert.equal(provider.contexts.length,1);
  provider.emit('response.done',{},b);assert.equal(provider.contexts.length,2);
  const v3=provider.contexts[1].version;assert.ok(v3>v2);provider.control('context.updated',{version:v2});provider.control('context.updated',{version:v3});
  provider.emit('response.started',{}, {turn_id:'t3',response_id:'r3'});
  await until(()=>packets.filter(p=>p.row?.name==='teaching.response').length===3);
  const rows=packets.filter(p=>p.row).map(p=>p.row),responses=rows.filter(r=>r.name==='teaching.response');
  assert.equal(responses[1].fields.applied_context_version,1);assert.equal(responses[1].fields.pending_context,true);assert.equal(responses[1].fields.decision_context_matched,false);
  assert.equal(responses[2].fields.applied_context_version,v3);assert.equal(responses[2].fields.decision_context_version,v3);assert.equal(responses[2].fields.decision_context_matched,false); // Context is from t2, not t3.
  const applied=rows.filter(r=>r.name==='context.applied');assert.deepEqual(applied.map(r=>r.fields.turn_id),['t1','t2']);
  const decisions=rows.filter(r=>r.name==='teaching.decision');assert.equal(decisions.length,2);assert.equal(decisions[1].fields.teaching_paused,true);
  assert.ok(!JSON.stringify(rows).includes('我不想练习'));ws.send(Buffer.alloc(640));await until(()=>provider.frames.length===1);
  ws.close();await once(ws,'close');
});

test('early response/duplicate final/stale output cannot manufacture decision application or teaching evidence',async t=>{
  const {create,open}=await setup(t);const {ws,provider,packets}=await open(await(await create()).json());provider.emit('session.ready');
  ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>packets.some(p=>p.row?.name==='session.config'));
  const ids={turn_id:'early',response_id:'early-reply'};provider.emit('response.started',{},ids);
  provider.emit('user.partial',{text:'足球'},{turn_id:'early'});provider.emit('user.final',{text:'足球'},{turn_id:'early'});
  provider.emit('user.final',{text:'我喜欢足球'},{turn_id:'early'});provider.emit('response.done',{},ids);
  provider.emit('response.text.delta',{text:'我喜欢足球'},ids);provider.control('context.updated',{version:provider.contexts[0].version});
  await until(()=>packets.some(p=>p.type==='teaching.context.applied'));
  const state=packets.filter(p=>p.type==='teaching.state').at(-1);assert.equal(state.decision.turn_count,1);assert.equal(state.attempts.length,0);
  assert.equal(packets.filter(p=>p.row?.name==='teaching.decision').length,1);assert.equal(packets.find(p=>p.row?.name==='teaching.response').row.fields.applied_context_version,1);
  assert.equal(packets.find(p=>p.row?.name==='teaching.response').row.fields.decision_context_matched,false);
  ws.send(JSON.stringify({type:'session.end'}));await once(ws,'close');
});
