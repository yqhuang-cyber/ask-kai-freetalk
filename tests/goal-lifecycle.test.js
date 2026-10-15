import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { learnerFixture,SPORTS_RESOURCE } from '../apps/hskai-mock/src/planning-fixtures.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { PlanningState,conservativeTurn } from '../packages/agent-core/planning-state.js';
import { validateTurn,contextRefs } from '../packages/agent-core/plan-validator.js';
import { goalChoice,assessGoal } from '../packages/agent-core/goal-lifecycle.js';
import { boundedProposal } from '../packages/agent-core/planner-port.js';
import { projectSummary } from '../apps/realtime-gateway/public/summary-cards.js';
const identity={owner_id:'owner',learner_id:'learner',scopes:['session:create'],authorization_until:Date.now()+600000};
const event=(text,turn_id=randomUUID())=>({version:1,event_id:randomUUID(),seq:1,at_ms:0,session_id:'session-goals',turn_id,type:'user.final',payload:{text}});
async function prepared({mode='topic',variant='b'}={}) {
  const port={read:async()=>learnerFixture(identity,{variant}),getResource:async()=>mode==='free'?null:SPORTS_RESOURCE};
  const initializer=new ConversationInitializer({port}),p=await initializer.prepare({mode,topic_id:'sports'},identity);
  return new Preparations({initializer}).bind(p,'session-goals');
}
async function session(options={}) {
  return new TeachingSession({sessionId:'session-goals',mode:options.mode==='free'?'free':'sports',planning:await prepared(options),planner:options.planner});
}
async function turn(s,text){const e=event(text);assert.equal(s.accept(e),true);const p=await s.planTurn(e);return {e,p};}
test('explicit choices replace a trusted goal; old attempts retain their original goal and revision',async()=> {
  const s=await session();const first=await turn(s,'我下午打篮球。');
  await turn(s,'我想练习喜好表达。');assert.equal(s.planning.plan.primary_goal.id,'express-likes');assert.match(s.view().goal,/喜好/);
  const second=await turn(s,'我喜欢跑步。'),rows=s.learningRecord().observations;
  assert.equal(rows[0].goal_id,'express-time');assert.equal(rows[1].goal_id,'express-likes');assert.ok(rows[0].plan_revision<rows[1].plan_revision);
  assert.equal(rows[0].source_event_id,first.e.event_id);assert.equal(rows[1].source_event_id,second.e.event_id);
  const summary=s.finalize({businessSource:'mock_hskai',providerKind:'test',ready:true}),view=projectSummary({type:'teaching.summary',session_id:s.sessionId,summary},{sessionId:s.sessionId,mode:'sports'});
  assert.equal(view.goals.length,2);assert.equal(view.observations.length,2);assert.equal(summary.goals[0].status,'retired');assert.equal(summary.goals[1].status,'unverified');
});
test('retiring a goal clears tips/cards and ordinary keywords cannot restore it',async()=> {
  const s=await session();await turn(s,'取消这个目标。');
  assert.equal(s.planning.plan.primary_goal,null);assert.equal(s.planning.plan.goal_status,'retired');assert.deepEqual(s.view().cards,[]);
  await turn(s,'我下午打篮球。');assert.equal(s.planning.plan.primary_goal,null);assert.equal(s.learningRecord().observations.length,0);
  await turn(s,'我想练习喜好表达。');assert.equal(s.planning.plan.goal_status,'active');assert.equal(s.planning.plan.primary_goal.id,'express-likes');
});
test('refusal pauses before a slow planner completes, and stale results cannot undo it',async()=> {
  let release;const s=await session({planner:{planTurn:input=>new Promise(r=>{release=()=>r(conservativeTurn(input));})}});
  const old=event('你好。');s.accept(old);const pending=s.planTurn(old);await Promise.resolve();
  const decline=event('我不想练习了。');s.accept(decline);assert.equal(s.planning.plan.goal_status,'paused');assert.equal(s.view().start_tip,'');
  s.planning.invalidate('student_interruption');release();assert.equal(await pending,null);assert.equal(s.planning.plan.goal_status,'paused');
});
test('two explicit difficulty reports allow stepping back, but a single report or English answer does not',async()=> {
  const s=await session();await turn(s,'basketball');assert.equal(s.planning.plan.primary_goal.id,'express-time');
  await turn(s,'这个练习太难了。');assert.equal(s.planning.plan.primary_goal.id,'express-time');
  const {p}=await turn(s,'这个练习我还是不会。');assert.equal(p.proposed_plan_patch.goal_id,'express-likes');assert.equal(s.planning.plan.primary_goal.id,'express-likes');assert.equal(s.planning.plan.goal_status,'active');
});
test('unrelated input breaks the consecutive difficulty window',async()=> {
  const s=await session();await turn(s,'这个练习太难了。');await turn(s,'我喜欢篮球。');await turn(s,'这个练习太难了。');
  assert.equal(s.planning.review().difficulty_count,1);assert.equal(s.planning.plan.primary_goal.id,'express-time');
});
test('missing prerequisites do not silently replace the requested target with another active lesson',async()=> {
  const s=await session({variant:'a'});await turn(s,'我想练习时间表达。');
  assert.equal(s.planning.plan.goal_status,'paused');assert.equal(s.planning.plan.primary_goal.id,'express-likes');
  assert.deepEqual(s.view().cards,[]);assert.equal(s.learningRecord().observations.length,0);
});
test('local help expires on the next input and never requests formal curriculum or creates a goal',async()=> {
  const s=await session({mode:'free',planner:{planTurn:async input=>({...conservativeTurn(input),local_help_target:input.turn.text.includes('怎么说')?'表达当前词':null})}});
  await turn(s,'planet 中文怎么说？');assert.equal(s.planning.localHelp.text,'表达当前词');assert.equal(s.planning.plan.primary_goal,null);
  await turn(s,'我们继续聊宇宙。');assert.equal(s.planning.localHelp,null);assert.equal(s.planning.plan.primary_goal,null);assert.equal(s.planning.resource,null);
});
test('free promotion uses host capabilities only after explicit sustained choice, without curriculum',async()=> {
  const s=await session({mode:'free'});
  await turn(s,'“我想练习喜好表达”是什么意思？');assert.equal(s.planning.plan.primary_goal,null);
  await turn(s,'我想练习喜好表达。');assert.equal(s.planning.plan.mode,'free');assert.equal(s.planning.plan.primary_goal.id,'express-likes');assert.equal(s.planning.resource,null);assert.deepEqual(s.planning.plan.resource_refs,[]);assert.equal(s.planning.plan.skill_catalog_ref.id,'kai-communication-skills');
  await turn(s,'我喜欢篮球。');assert.deepEqual(s.learningRecord().observations,[]);assert.deepEqual(s.view().cards,[]);assert.equal(s.teaching.decision.goal_attempt_observed,false);
  await turn(s,'我不想练习了。');await turn(s,'篮球中文怎么说？');assert.equal(s.planning.plan.goal_status,'paused');
  const summary=s.finalize();assert.equal(summary.goals[0].attempt_rule_supported,false);assert.equal(summary.goals[0].assessment.mastery_assessed,false);
});
test('late model results after new input or close cannot restore a free practice goal',async()=> {
  for(const close of [false,true]) {
    let release;const state=new PlanningState({...await prepared({mode:'free'}),planner:{planTurn:input=>new Promise(r=>{release=()=>r(conservativeTurn(input));})}});
    const policy={action:'RESPOND',teaching_paused:false,teaching_cooldown:0};
    const old=state.acceptInput(event('我想练习喜好表达。'),policy,{});await Promise.resolve();
    if(close)state.close();else state.controls(event('取消这个目标。'),policy);
    release();assert.equal(await old,null);assert.equal(state.resource,null);assert.equal(state.plan.goal_status,close?'active':'retired');
  }
});
test('repeated attempts and self reports cannot satisfy independent success rules',async()=> {
  const s=await session({variant:'a'});await turn(s,'我喜欢篮球。');await turn(s,'我喜欢跑步。');await turn(s,'我已经会了。');
  const assessment=s.planning.review().assessment;assert.equal(assessment.attempt_count,2);assert.equal(assessment.status,'unverified');assert.ok(assessment.missing.includes('semantic_review'));assert.ok(assessment.missing.includes('independent_expression'));assert.equal(s.planning.plan.goal_status,'active');
  assert.ok(s.learningRecord().observations.every(o=>o.state==='attempted'&&o.support==='unknown'));
  assert.equal(s.planning.plan.strategy.support_level,'partial');
});
test('corrected finals replace observation candidates rather than inflating evidence',async()=> {
  const s=await session({variant:'a'}),first=event('我喜欢篮球。','same');s.observations.accept(first,{plan:s.planning.plan,resource:s.planning.resource});
  s.observations.accept(event('不是篮球。','same'),{plan:s.planning.plan,resource:s.planning.resource});assert.equal(s.observations.observations.size,0);
});
test('model cannot force a replacement, retire, resume or claim achieved from its own assessment',async()=> {
  const p=await prepared(),input={source_event_id:'input',text:'你好',expires_at:Date.now()+10000},policy={action:'RESPOND',teaching_paused:false,teaching_cooldown:0};
  const proposal=conservativeTurn({turn:input,policy}),allowedRefs=contextRefs(p.context,p.resource);allowedRefs.add('input');
  const state={...p,input,policy,allowedRefs};
  for(const patch of [{op:'replace',goal_id:'express-likes',refs:['input']},{op:'retire',goal_id:'express-time',refs:['input']},'resume',{op:'achieve',goal_id:'express-time',refs:['input']}])assert.throws(()=>validateTurn({...proposal,proposed_plan_patch:patch},state));
  assert.throws(()=>validateTurn({...proposal,goal_assessment:{progress:'mastered',gap:'none',refs:['input']}},state));
  assert.throws(()=>validateTurn({...proposal,action:'CLOSE'},state),/UNREQUESTED_CLOSING/);
});
test('authorized context correction pauses a target whose prerequisite is no longer verified',async()=> {
  const s=await session();s.updateLearnerContext(learnerFixture(identity,{variant:'d',revision:2}));
  assert.equal(s.planning.plan.goal_status,'paused');await turn(s,'继续练习。');assert.equal(s.planning.plan.goal_status,'paused');
});
test('rejection diagnostics preserve known reason codes but never arbitrary model error text',async()=> {
  const run=error=>boundedProposal({planner:{planTurn:async()=>{throw new Error(error);}},method:'planTurn',input:{},budgetMs:100,validate:x=>x,fallback:()=>({})});
  const known=await run('PREREQUISITE_UNVERIFIED');assert.equal(known.degraded_reason,'planner_validation_failed');assert.equal(known.attempts[0].code,'PREREQUISITE_UNVERIFIED');
  const secret=await run('private key or model body');assert.ok(!JSON.stringify(secret).includes('private'));assert.equal(secret.attempts[0].code,'PLANNER_VALIDATION_FAILED');
});
test('initialization reserves time for a marked fallback within the original total deadline',async()=> {
  const initializer=new ConversationInitializer({budgetMs:120,port:{read:async()=>{await new Promise(r=>setTimeout(r,20));return learnerFixture(identity);},getResource:async()=>SPORTS_RESOURCE},planner:{planConversation:()=>new Promise(()=>{})}});
  const started=performance.now(),result=await initializer.prepare({mode:'topic',topic_id:'sports'},identity);
  assert.equal(result.plan.planner_kind,'rule');assert.equal(result.plan.degraded_reason,'planner_timeout');assert.ok(performance.now()-started<120);
});
