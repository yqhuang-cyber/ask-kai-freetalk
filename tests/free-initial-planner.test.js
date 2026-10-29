import { PlanningTrace } from '../packages/agent-core/planning-trace.js';
import { MiniMaxJsonTransport } from '../packages/provider-minimax/planner.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_LEARNERS,accountContext,accountMemory } from '../apps/hskai-mock/src/learner-accounts.js';
import { ConversationInitializer,planProjection } from '../packages/agent-core/conversation-initializer.js';
import { DraftPlanner } from '../packages/agent-core/planner-draft.js';
import { FullContractPlanner } from '../packages/agent-core/planner-full-contract.js';
import { PiMiniMaxPlanner } from '../packages/agent-core/pi-planner.js';
import { compileFreeInitialPlan,FREE_INITIAL_GOAL_FIELDS } from '../packages/agent-core/free-initial-plan.js';
import { fallbackSpeakingDifficulty,deriveSpeakingConstraints } from '../packages/agent-core/speaking-policy.js';
import { FREE_PRACTICE_CATALOG } from '../packages/agent-core/skill-catalog.js';

function fixture(learner=MOCK_LEARNERS[0]) {
  const now=Date.now(),identity={owner_id:learner.owner_id,learner_id:learner.learner_id,scopes:['session:create','context:read'],authorization_until:now+60000};
  const context=accountContext(identity,{now,fixtureAt:now,memory:accountMemory(learner.learner_id,now),records:[]});
  const proposal={conversation_purpose:'跟随当前需要自然交流',content_focus:'有来源的熟悉生活内容',opening_options:[],strategy:{language_support:context.learning_profile.language_support,correction:context.student_profile.conversation_preferences.correction,pace:context.student_profile.conversation_preferences.pace,support_level:'partial',speaking_difficulty:fallbackSpeakingDifficulty(deriveSpeakingConstraints(context))},selection_basis:[{reason:'根据当前资料调整交流方式',refs:[context.snapshot_id]}]};
  return {identity,context,proposal,entry:{mode:'free',speech_pace:proposal.strategy.pace},port:{read:async()=>context,getResource:async()=>{throw new Error('FREE_MUST_NOT_READ_RESOURCE');}}};
}

function adapter(kind,proposalFor,captured=[]) {
  const transport={provider:'test',model:'synthetic',completeJSON:async args=>{captured.push(args);const p=proposalFor(captured.length);if(kind!=='draft')return p;const {strategy,...selection}=p;return {...selection,strategy:{support_level:strategy.support_level,speaking_difficulty:strategy.speaking_difficulty}};},completeTool:async args=>{captured.push(args);return {id:'synthetic-call-'+captured.length,name:args.tool.name,arguments:proposalFor(captured.length)};}};
  return kind==='pi'?new PiMiniMaxPlanner({transport}):kind==='draft'?new DraftPlanner({transport}):new FullContractPlanner({transport});
}

for(const kind of ['full','draft','pi']) {
  test(`${kind}: authored learners receive initial communication plans with host-owned empty goals`,async()=>{
    for(const learner of MOCK_LEARNERS) {
      const f=fixture(learner),captured=[],planner=adapter(kind,()=>f.proposal,captured);
      const result=await new ConversationInitializer({port:f.port,planner}).prepare(f.entry,f.identity);
      assert.equal(result.plan.planner_kind,'llm');assert.equal(result.plan.degraded_reason,null);
      assert.equal(result.plan.primary_goal_id,null);assert.equal(result.plan.primary_goal,null);assert.deepEqual(result.plan.candidate_goal_ids,[]);assert.deepEqual(result.plan.key_points,[]);assert.deepEqual(result.plan.resource_refs,[]);
      assert.deepEqual(result.plan.strategy.speaking_difficulty,f.proposal.strategy.speaking_difficulty);
      const request=captured[0],payload=JSON.parse(request.messages[1].content);
      for(const key of ['skill_catalog','goal_options','resource'])assert.equal(Object.hasOwn(payload,key),false);
      assert.ok(payload.available_refs.includes(f.context.snapshot_id));
      assert.ok(payload.available_refs.includes(f.context.learning_history[0].record_id));
      for(const key of ['student_profile','learning_profile','learning_history'])assert.deepEqual(payload[key],f.context[key]);
      assert.ok(!request.messages[0].content.includes('按已授权学习证据与近期需要选择目标'));
      assert.ok(!request.messages[0].content.includes('topic/mission'));
      if(kind==='pi'||kind==='draft'){
        const schema=request.tool?.parameters??request.schema;
        assert.equal(Object.keys(schema.properties).length,5);
        for(const key of FREE_INITIAL_GOAL_FIELDS)assert.equal(Object.hasOwn(schema.properties,key),false);
      }
      assert.equal(captured.length,1);
    }
  });

  test(`${kind}: direct calls also strip initial candidate inputs without changing turn-only catalogues`,async()=>{
    const f=fixture(),captured=[],planner=adapter(kind,()=>f.proposal,captured);
    await planner.planConversation({entry:{...f.entry,opening_request:'我想聊今天的活动'},snapshot_ref:f.context.snapshot_id,student_profile:f.context.student_profile,learning_profile:f.context.learning_profile,learning_history:f.context.learning_history,required_strategy:f.proposal.strategy,speaking_constraints:deriveSpeakingConstraints(f.context),skill_catalog:FREE_PRACTICE_CATALOG,resource:FREE_PRACTICE_CATALOG,goal_options:[{goal_id:'invented'}],available_refs:['foreign-source']});
    const payload=JSON.parse(captured[0].messages[1].content);
    for(const key of ['skill_catalog','goal_options','resource'])assert.equal(Object.hasOwn(payload,key),false);
    assert.ok(!payload.available_refs.includes('foreign-source'));
    assert.ok(!payload.available_refs.includes(FREE_PRACTICE_CATALOG.id));
    assert.ok(payload.available_refs.includes('initial-choice'));
    assert.ok(FREE_PRACTICE_CATALOG.goals.length>0);
  });

  test(`${kind}: a model goal is rejected and repaired instead of silently removed`,async()=>{
    const f=fixture(),captured=[],planner=adapter(kind,n=>n===1?{...f.proposal,primary_goal_id:'supporting-opinions'}:f.proposal,captured);
    const result=await new ConversationInitializer({port:f.port,planner}).prepare(f.entry,f.identity);
    assert.equal(result.plan.planner_kind,'llm');assert.equal(captured.length,2);
    assert.equal(result.plan.planner_attempts[0].state,'rejected');
    assert.match(result.plan.planner_attempts[0].code,/FREE_INITIAL_GOAL_FORBIDDEN|PLANNER_INVALID_DRAFT/);
    assert.match(captured[1].messages[0].content,/宿主会补齐空目标/);
    assert.equal(result.plan.primary_goal_id,null);
  });
}

test('the host compiler rejects even empty model-owned goal fields and extra fields',()=>{
  const {proposal}=fixture();
  for(const [key,value] of Object.entries({primary_goal_id:null,candidate_goal_ids:[],key_points:[]}))assert.throws(()=>compileFreeInitialPlan({...proposal,[key]:value}),/FREE_INITIAL_GOAL_FORBIDDEN/);
  assert.throws(()=>compileFreeInitialPlan({...proposal,owner_id:'foreign'}),/INVALID_CONVERSATION_PROPOSAL/);
});

test('repeated invalid goals remain an honest fallback and safe public failure reason',async()=>{
  const f=fixture(),planner=adapter('full',()=>({...f.proposal,primary_goal_id:'invented'}));
  const result=await new ConversationInitializer({port:f.port,planner}).prepare(f.entry,f.identity);
  assert.equal(result.plan.planner_kind,'rule');assert.equal(result.plan.degraded_reason,'planner_validation_failed');assert.equal(result.plan.primary_goal_id,null);
  const publicView=planProjection(result.plan,null);
  assert.equal(publicView.planning.degraded_reason,'planner_validation_failed');
  assert.ok(!JSON.stringify(publicView).includes('planner_attempts'));
  assert.equal(planProjection({...result.plan,degraded_reason:'PRIVATE_BODY'},null).planning.degraded_reason,null);
});


test('Pi and JSON initial planning expose their actual transport requests on the same preparation trace',async()=>{
  for(const kind of ['full','pi']) {
    const f=fixture(),trace=new PlanningTrace();
    const transport=new MiniMaxJsonTransport({apiKey:'synthetic-fixture-key',fetcher:async(_url,init)=>{
      const body=JSON.parse(init.body);
      const message=kind==='pi'?{tool_calls:[{id:'fixture-call',type:'function',function:{name:body.tool_choice.function.name,arguments:JSON.stringify(f.proposal)}}]}:{content:JSON.stringify(f.proposal)};
      return new Response(JSON.stringify({choices:[{finish_reason:kind==='pi'?'tool_calls':'stop',message}]}));
    }});
    const planner=kind==='pi'?new PiMiniMaxPlanner({transport}):new FullContractPlanner({transport});
    const result=await new ConversationInitializer({port:f.port,planner}).prepare(f.entry,f.identity,{trace});
    assert.equal(result.plan.planner_kind,'llm');
    const rows=trace.snapshot().rows,request=rows.find(row=>row.stage==='planner.request'),response=rows.find(row=>row.stage==='planner.response');
    assert.equal(request.data.kind,'conversation');assert.equal(response.data.planning_id,request.data.planning_id);
    if(kind==='pi')assert.equal(Object.keys(request.data.body.tools[0].function.parameters.properties).length,5);
    else assert.ok(!request.data.body.tools);
    assert.ok(!JSON.stringify(rows).includes('synthetic-fixture-key'));
  }
});
