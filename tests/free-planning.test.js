import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { learnerFixture,SPORTS_RESOURCE } from '../apps/hskai-mock/src/planning-fixtures.js';
import { ConversationInitializer,conservativeConversation } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { PlanningState,conservativeTurn } from '../packages/agent-core/planning-state.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { FREE_PRACTICE_CATALOG } from '../packages/agent-core/skill-catalog.js';
import { draftInputConstraints,plannerMessages } from '../packages/agent-core/planner-draft.js';
import { FullContractPlanner } from '../packages/agent-core/planner-full-contract.js';
const identity={owner_id:'free-owner',learner_id:'free-learner',scopes:['session:create','context:read'],authorization_until:Date.now()+600000};
const final=text=>({version:1,event_id:randomUUID(),session_id:'free-session',turn_id:randomUUID(),seq:1,at_ms:0,type:'user.final',payload:{text}});
async function fixture(planner) {
  const calls={facts:0,resources:0};let revision=1;
  const port={read:async()=>{calls.facts++;return learnerFixture(identity,{revision});},getResource:async()=>{calls.resources++;throw new Error('CURRICULUM_FORBIDDEN');}};
  const preparations=new Preparations({initializer:new ConversationInitializer({port,planner})});
  const entry={mode:'free'},created=preparations.create(identity,entry);await preparations.get(identity,created.preparation_id).done;
  assert.equal(preparations.view(identity,created.preparation_id).status,'ready');
  const consume=()=>preparations.consume(identity,created.preparation_id,entry);
  return {calls,preparations,consume,changeFacts:()=>revision++};
}
async function turn(session,text){const e=final(text);session.accept(e);return session.planTurn(e);}
test('free prepare and one-shot consume read authorized learner facts only, even with Topic Manager offline',async()=>{
  let initial;
  const f=await fixture({planConversation:async input=>{initial=input;return conservativeConversation(input.entry,{snapshot_id:input.snapshot_ref,...input},null);}});
  const bound=f.preparations.bind(await f.consume(),'free-session');
  assert.equal(initial.resource,null);assert.equal(initial.skill_catalog.source,'host_policy');
  for(const key of ['student_profile','learning_profile','learning_history'])assert.deepEqual(initial[key],bound.context[key]);
  assert.equal(bound.plan.primary_goal,null);assert.deepEqual(bound.plan.resource_refs,[]);assert.equal(bound.resource,null);
  assert.deepEqual(f.calls,{facts:2,resources:0});await assert.rejects(f.consume(),/PREPARATION_NOT_FOUND/);
  assert.throws(()=>new PlanningState({...bound,resource:SPORTS_RESOURCE}),/FREE_RESOURCE_FORBIDDEN/);
  f.preparations.close();
});
test('free consume still rejects changed learner revisions without reading course resources',async()=>{
  const f=await fixture();f.changeFacts();await assert.rejects(f.consume(),/PREPARATION_STALE/);
  assert.deepEqual(f.calls,{facts:2,resources:0});f.preparations.close();
});
test('non-sports free practice uses current dialogue and three learner sources; refusals and local help remain scoped',async()=>{
  const inputs=[],f=await fixture(),bound=f.preparations.bind(await f.consume(),'free-session');
  const session=new TeachingSession({sessionId:'free-session',mode:'free',planning:bound,planner:{planTurn:async input=>{inputs.push(input);return conservativeTurn(input);}}});
  await turn(session,'我正在选一本小说。');assert.equal(session.planning.plan.primary_goal,null);
  await turn(session,'“我想练习比较选项”是什么意思？');assert.equal(session.planning.plan.primary_goal,null);
  await turn(session,'novel 中文怎么说？');assert.ok(session.planning.localHelp);
  await turn(session,'继续聊读书吧。');assert.equal(session.planning.localHelp,null);
  await turn(session,'我想练习比较选项。');assert.equal(session.planning.plan.primary_goal.id,'comparison');
  assert.equal(session.view().lesson_source,'host_policy');assert.equal(session.view().resource_version,null);assert.deepEqual(session.view().cards,[]);
  const latest=inputs.at(-1);assert.equal(latest.resource,null);assert.deepEqual(latest.skill_catalog,FREE_PRACTICE_CATALOG);
  for(const key of ['student_profile','learning_profile','learning_history'])assert.deepEqual(latest[key],bound.context[key]);
  assert.ok(latest.actual_context.some(row=>row.text==='我正在选一本小说。'));assert.ok(draftInputConstraints(latest).goal_options.some(g=>g.goal_id==='comparison'&&g.eligible));
  assert.ok(!session.instructions().includes('帮助 HSK1 初学者'));assert.match(session.instructions(),/comparison/);
  await turn(session,'我不想练习了。');assert.equal(session.planning.plan.goal_status,'paused');assert.equal(session.view().start_tip,'');
  await turn(session,'这本小说比另一本有趣。');assert.equal(session.planning.plan.goal_status,'paused');
  await turn(session,'我想练习表达频率。');assert.equal(session.planning.plan.primary_goal.id,'frequency-expression');
  await turn(session,'取消这个目标。');assert.equal(session.planning.plan.primary_goal,null);
  assert.deepEqual(session.learningRecord().observations,[]);assert.equal(session.learningRecord().resource_ref,null);
  const summary=session.finalize();assert.equal(summary.counts.attempts,0);assert.ok(summary.goals.every(g=>!g.attempt_rule_supported&&!g.assessment.mastery_assessed));
  assert.deepEqual(f.calls,{facts:2,resources:0});f.preparations.close();
});
test('free host skills preserve prerequisites and reject invented goals and unsupported attempted claims from a model',async()=>{
  const f=await fixture(),bound=f.preparations.bind(await f.consume(),'free-session');
  const session=new TeachingSession({sessionId:'free-session',mode:'free',planning:bound,planner:{planTurn:async input=>({...conservativeTurn(input),proposed_plan_patch:{op:'replace',goal_id:'invented-lesson',refs:[input.turn.source_event_id]}})}});
  await turn(session,'我想练习用具体理由和例子支持观点。');assert.equal(session.planning.plan.primary_goal,null);
  await turn(session,'我想练习说明原因。');assert.equal(session.planning.plan.primary_goal.id,'simple-reasons');
  session.planning.planner={planTurn:async input=>({...conservativeTurn(input),goal_assessment:{progress:'attempted',gap:'待复核',refs:[input.turn.source_event_id]}})};
  const plan=await turn(session,'因为这本书很有趣。');assert.equal(plan.planner_kind,'rule');assert.equal(plan.degraded_reason,'planner_validation_failed');
  assert.deepEqual(session.learningRecord().observations,[]);assert.deepEqual(session.planning.plan.resource_refs,[]);session.finalize();f.preparations.close();
});
test('both replaceable planner protocols describe the free skill boundary without adding a topic resource',async()=>{
  const f=await fixture(),bound=f.preparations.bind(await f.consume(),'free-session');
  const input={plan:bound.plan,resource:null,skill_catalog:FREE_PRACTICE_CATALOG};let messages;
  const planner=new FullContractPlanner({transport:{provider:'test',model:'test',completeJSON:async args=>{messages=args.messages;return {};}}});
  await planner.planTurn(input);assert.match(messages[0].content,/skill_catalog/);assert.match(messages[0].content,/resource为空/);
  const draft=plannerMessages('turn',input);assert.match(draft[0].content,/skill_catalog/);assert.equal(JSON.parse(draft[1].content).resource,null);
  f.preparations.close();
});
