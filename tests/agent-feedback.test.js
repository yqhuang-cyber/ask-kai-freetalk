import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateAgentFeedbackCase } from '../apps/eval-runner/src/agent-feedback.js';
import { PlanningObservations } from '../packages/agent-core/planning-observations.js';
import { supportedExpression } from '../packages/agent-core/learner-feedback.js';
import { learnerFixture,SPORTS_RESOURCE } from '../apps/hskai-mock/src/planning-fixtures.js';
import { conservativeConversation } from '../packages/agent-core/conversation-initializer.js';
import { conservativeTurn } from '../packages/agent-core/planning-state.js';
import { validateTurn,contextRefs } from '../packages/agent-core/plan-validator.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
const context=learnerFixture({owner_id:'owner',learner_id:'learner'}),resource=SPORTS_RESOURCE;
const plan={...conservativeConversation({mode:'topic',topic_id:'sports'},context,resource),session_id:'s',plan_id:'p',revision:1,primary_goal:resource.goals[0],goal_status:'active',resource_refs:[{id:resource.id,version:resource.version}],input_refs:{context:context.snapshot_id},execution_mode:'next_turn_advisory'};
const final=(text,turn='t')=>({version:1,event_id:'input-'+turn,seq:1,at_ms:0,session_id:'s',type:'user.final',turn_id:turn,payload:{text}});
const input={source_event_id:'input-t',text:'这个练习太难了。',expires_at:Date.now()+100000},policy={action:'RESPOND',teaching_paused:false,teaching_cooldown:0};
const base=conservativeTurn({turn:input,policy}),allowedRefs=contextRefs(context,resource);allowedRefs.add('input-t');
test('independent paired feedback cases preserve roles, output scope and attempted-only learning',async()=> {
  const data=JSON.parse(await readFile('docs/eval-datasets/agent-feedback-v1/cases.json'));
  assert.equal(data.cases.length,20);
  for(const c of data.cases){const r=await evaluateAgentFeedbackCase(c);assert.equal(r.passed,true,c.id);assert.equal(r.learner_attempt_count,c.expect.attempts,c.id);assert.ok(Array.isArray(r.planner_attempts));assert.equal(r.planner,'rule');assert.equal(r.semantic_quality_accepted,false);}
});
test('corrected finals replace feedback/source and do not keep a previous attempt',()=> {
  const o=new PlanningObservations({sessionId:'s',plan,resource});o.accept(final('我喜欢篮球。'));const before=o.feedback.get('t');
  o.accept({...final('老师说，我喜欢篮球。'),event_id:'corrected'});
  assert.equal(o.observations.size,0);assert.equal(o.feedback.get('t').source_event_id,'corrected');assert.equal(o.feedback.get('t').observation_ref,null);assert.equal(before.signal,'supported_attempt');assert.ok(Object.isFrozen(before));
});
test('a difficulty/self-report/input reference cannot support attempted assessment without a real observation',()=> {
  const proposal={...base,goal_assessment:{progress:'attempted',gap:'needs help',refs:['input-t']}};
  const state={plan,input,policy,allowedRefs,context,resource,review:{observed_attempts:[]}};
  assert.throws(()=>validateTurn(proposal,state),/UNSUPPORTED_ATTEMPT/);
  assert.throws(()=>validateTurn({...proposal,goal_assessment:{...proposal.goal_assessment,refs:['history-sports']}},state),/UNSUPPORTED_ATTEMPT/);
  assert.equal(validateTurn({...proposal,goal_assessment:{...proposal.goal_assessment,progress:'unknown'}},state).goal_assessment.progress,'unknown');
  assert.equal(validateTurn(proposal,{...state,review:{observed_attempts:[{observation_id:'obs',source_event_id:'input-t'}]}}).goal_assessment.progress,'attempted');
});
test('actual runtime assessment references exclude retired-goal attempts',async()=> {
  let snapshot;
  const s=new TeachingSession({sessionId:'s',mode:'sports',planning:{plan,resource,context},planner:{planTurn:async v=>{snapshot=v;return conservativeTurn(v);}}});
  const first=final('我喜欢篮球。');s.accept(first);await s.planTurn(first);
  assert.equal(snapshot.goal_review.observed_attempts.length,1);assert.equal(snapshot.learner_feedback.source_event_id,first.event_id);
  const copy=structuredClone(snapshot.learner_feedback);
  const stop=final('取消这个目标。','stop');s.accept(stop);await s.planTurn(stop);
  assert.equal(snapshot.goal_review.observed_attempts.length,0);assert.equal(copy.signal,'supported_attempt');assert.equal(snapshot.learner_feedback.signal,'no_active_goal');
});
test('visible directives reject internal IDs and two same-language questions but allow a translated single question',()=> {
  const state={plan,input,policy,allowedRefs,context,resource};
  for(const task of ['先说express-likes再问学生。','使用likes-card给示范。','你喜欢什么运动？你常常和谁一起打？'])assert.throws(()=>validateTurn({...base,reply_directive:{...base.reply_directive,task}},state),/INTERNAL_REFERENCE|MULTIPLE_QUESTIONS/);
  assert.equal(validateTurn({...base,reply_directive:{...base.reply_directive,task:'你喜欢什么运动？What sport do you like?'}},state).action,'RESPOND');
});
test('foreign-session output and same-turn autonomous output cannot become a prior prompt',async()=> {
  let snapshot;
  const s=new TeachingSession({sessionId:'s',mode:'sports',planning:{plan,resource,context},planner:{planTurn:async v=>{snapshot=v;return conservativeTurn(v);}}});
  s.planning.observe({event:{...final('','foreign'),session_id:'other',response_id:'foreign-reply',type:'response.started'}});
  s.planning.observe({event:{...final('','foreign'),session_id:'other',response_id:'foreign-reply',type:'response.text.delta',payload:{text:'我喜欢篮球。'}}});
  const e=final('我喜欢篮球。');s.accept(e);await s.planTurn(e);
  assert.equal(snapshot.learner_feedback.prompt.execution_ref,null);assert.ok(!JSON.stringify(snapshot.learner_feedback).includes('我喜欢篮球'));assert.equal(snapshot.learner_feedback.semantic_review,'unverified');
});
test('limited rules do not reinterpret an unrecognized paraphrase as inability',()=> {
  assert.equal(supportedExpression('篮球是我最喜欢的运动。','likes-attempt-v1'),null);
  assert.equal(supportedExpression('我喜欢篮球。','unassessed'),null);
});
