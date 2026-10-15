import { MiniMaxJsonTransport } from '../packages/provider-minimax/planner.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateLearnerContext,validateCurriculum,validateLearningRecord } from '../packages/contracts/planning.js';
import { learnerFixture,SPORTS_RESOURCE,missionResource } from '../apps/hskai-mock/src/planning-fixtures.js';
import { MOCK_IDENTITY,MOCK_MISSION } from '../apps/hskai-mock/src/server.js';
import { ConversationInitializer,INITIAL_PLANNING_BUDGET_MS,conservativeConversation,normalizeEntry } from '../packages/agent-core/conversation-initializer.js';
import { validateConversation,contextRefs,validateTurn } from '../packages/agent-core/plan-validator.js';
import { MiniMaxPlanner,boundedProposal } from '../packages/agent-core/planner-port.js';
import { PlanningState,conservativeTurn } from '../packages/agent-core/planning-state.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { projectSummary } from '../apps/realtime-gateway/public/summary-cards.js';
import { ReplyExecutor,SEEDUPLEX_PLANNING_CAPABILITIES } from '../apps/realtime-gateway/src/reply-executor.js';
const identity=()=>({...MOCK_IDENTITY,authorization_until:Date.now()+600000,scopes:['session:create','context:read','curriculum:read','learning:write'],mission:MOCK_MISSION});
const event=(session_id,turn_id,text)=>({version:1,event_id:randomUUID(),session_id,turn_id,seq:1,at_ms:0,type:'user.final',payload:{text}});
function portFor(variant='a') {
  let revision=1;
  return {read:async i=>learnerFixture(i,{variant,revision}),getResource:async(i,e)=>e.mode==='free'?null:e.mode==='mission'?missionResource(i.mission):SPORTS_RESOURCE,bump:()=>revision++};
}
async function prepare(mode='sports',variant='a',planner=null) {
  const i=identity(),port=portFor(variant),initializer=new ConversationInitializer({port,planner});
  const entry=normalizeEntry({mode,...(mode==='mission'?{mission_id:MOCK_MISSION.id}:{})},i),result=await initializer.prepare(entry,i);
  const bound=new Preparations({initializer}).bind(result,'session-a');return {...bound,initializer,port,identity:i,entry};
}
test('paired mock fixtures change content independently from evidence-driven goals',async()=> {
  const a=await prepare(),b=await prepare('sports','b'),c=await prepare('sports','c');
  assert.equal(a.plan.content_focus,'篮球');assert.equal(c.plan.content_focus,'跑步');
  assert.equal(a.plan.primary_goal.id,c.plan.primary_goal.id);assert.equal(a.plan.primary_goal.id,'express-likes');assert.equal(b.plan.primary_goal.id,'express-time');
  assert.equal(b.plan.planner_kind,'rule');assert.equal(b.plan.degraded_reason,'planner_unconfigured');assert.equal(b.initializer.budgetMs,INITIAL_PLANNING_BUDGET_MS);
  assert.notEqual(a.plan.hash,b.plan.hash);assert.ok(Object.isFrozen(a.plan));
});
test('Mission selects all authored targets and unknown/free/declined contexts retain honest limits',async()=> {
  const mission=await prepare('mission','b'),free=await prepare('free'),unknown=await prepare('sports','d');
  assert.equal(mission.plan.primary_goal.id,'express-time');assert.equal(free.plan.primary_goal,null);assert.deepEqual(free.plan.key_points,[]);
  assert.equal(unknown.context.coverage.learning_history,'unavailable');assert.equal(unknown.plan.strategy.support_level,'unknown');await assert.rejects(prepare('sports','e'),/TOPIC_NO_ELIGIBLE_GOAL/);
});
test('context and curriculum validators reject foreign owners, private fields, stale or oversized snapshots and wrong references',()=> {
  const i=identity(),context=learnerFixture(i);
  assert.throws(()=>validateLearnerContext(context,{...i,owner_id:'foreign'}));
  for(const mutate of [v=>v.student_profile.contact='secret',v=>v.revision=0,v=>v.coverage.learning_history='complete',v=>v.as_of=new Date(Date.now()-61000).toISOString(),v=>v.student_profile.interests.push(...Array(6).fill(v.student_profile.interests[0])),v=>v.learning_profile.kp_states[0].skill_dimension='pronunciation']){const v=structuredClone(context);mutate(v);assert.throws(()=>validateLearnerContext(v,i));}
  for(const mutate of [r=>r.goals[0].kp_ids=['imaginary'],r=>r.key_points[0].prerequisites=['missing'],r=>r.cards[0].url='https://example.com',r=>r.goals.push(r.goals[0])]){const r=structuredClone(SPORTS_RESOURCE);mutate(r);assert.throws(()=>validateCurriculum(r));}
});
test('conversation validator rejects free goals, missing evidence, declined goals and unverified prerequisites',()=> {
  const i=identity(),entry={mode:'topic',topic_id:'sports'},context=learnerFixture(i),p=conservativeConversation(entry,context,SPORTS_RESOURCE);
  assert.throws(()=>validateConversation({...p,learner_id:'foreign'},{entry,context,resource:SPORTS_RESOURCE}));
  assert.throws(()=>validateConversation(p,{entry:{mode:'free'},context,resource:SPORTS_RESOURCE}),/FREE/);
  assert.throws(()=>validateConversation({...p,selection_basis:[{reason:'invented',refs:['future-input']}]},{entry,context,resource:SPORTS_RESOURCE}));
  assert.throws(()=>validateConversation({...p,primary_goal_id:'express-time',key_points:['time-expression']},{entry,context,resource:SPORTS_RESOURCE}),/PREREQUISITE/);
  assert.throws(()=>validateConversation({...p,primary_goal_id:null,key_points:[]},{entry,context,resource:SPORTS_RESOURCE}),/TOPIC_GOAL_REQUIRED/);
  assert.throws(()=>normalizeEntry({mode:'sports',learner_id:'foreign'},i));assert.throws(()=>normalizeEntry({mode:'mission',mission_id:'foreign'},i));
});
test('shadow planning leaves the legacy preview and runtime instructions unchanged',async()=> {
  const p=await prepare('sports','b'),initializer=new ConversationInitializer({port:p.port,mode:'shadow'}),preparations=new Preparations({initializer});
  const created=preparations.create(p.identity,{mode:'sports'});await preparations.get(p.identity,created.preparation_id).done;
  assert.match(preparations.view(p.identity,created.preparation_id).view.goal,/我喜欢/);
  const result=preparations.bind(await preparations.consume(p.identity,created.preparation_id,{mode:'sports'}),'session-a');
  const shadow=new TeachingSession({sessionId:'session-a',mode:'sports',planning:result}),legacy=new TeachingSession({sessionId:'session-a',mode:'sports'});
  assert.equal(shadow.instructions(),legacy.instructions());const e=event('session-a','turn-a','你好');shadow.accept(e);assert.equal(await shadow.planTurn(e),null);assert.equal(shadow.planning.accepted,null);assert.match(shadow.view().goal,/我喜欢/);preparations.close();
});
test('resource reads and planner timeouts are bounded even when injected ports ignore abort',async()=> {
  const i=identity(),initializer=new ConversationInitializer({port:{read:()=>new Promise(()=>{}),getResource:async()=>null},budgetMs:20});
  await assert.rejects(initializer.prepare({mode:'free'},i),/CANCELLED/);
  const result=await boundedProposal({planner:{planTurn:()=>new Promise(()=>{})},method:'planTurn',input:{},budgetMs:20,validate:x=>x,fallback:()=>({safe:true})});assert.equal(result.degraded_reason,'planner_timeout');
});
test('authorized context correction cancels pending work and removes superseded interests from future planner input',async()=> {
  const p=await prepare(),state=new PlanningState({...p}),i=p.identity;
  const memory=[{field:'interest',value:'跑步'}],context=learnerFixture(i,{revision:2,memory});state.updateContext(context);
  assert.equal(state.context.student_profile.interests[0].label,'跑步');assert.equal(state.plan.content_focus,'跑步');assert.equal(state.plan.input_refs.revision,2);assert.equal(state.plan.selection_basis[0].refs[0],context.snapshot_id);
});
test('M3 adapter uses the reviewed official endpoint, disables thinking and returns only parsed business JSON',async()=> {
  let request;
  const planner=new MiniMaxJsonTransport({apiKey:'synthetic-key',fetcher:async(url,options)=>{request={url,options};return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"action":"RESPOND"}',reasoning_content:'never exported'}}]}));}});
  assert.deepEqual(await planner.completeJSON({kind:'turn',messages:[{role:'user',content:'{}'}]}),{action:'RESPOND'});
  const body=JSON.parse(request.options.body);assert.equal(body.model,'MiniMax-M3');assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(request.options.redirect,'error');assert.equal(body.stream,false);assert.equal(body.messages[0].role,'user');
  assert.throws(()=>new MiniMaxPlanner({apiKey:'synthetic',baseURL:'https://evil.example/v1'}));assert.throws(()=>new MiniMaxPlanner({apiKey:'synthetic',model:'MiniMax-M3.1-Flash-Preview'}));
});
test('M3 truncated, malformed, oversized or provider-error results cannot masquerade as accepted proposals',async()=> {
  for(const result of [{choices:[{finish_reason:'length',message:{content:'{}'}}]},{choices:[{finish_reason:'stop',message:{content:'not-json'}}]},{choices:[{finish_reason:'stop',message:{content:'[]'}}]},{base_resp:{status_code:1000},choices:[{finish_reason:'stop',message:{content:'{}'}}]}]){
    const planner=new MiniMaxPlanner({apiKey:'synthetic',fetcher:async()=>new Response(JSON.stringify(result))});await assert.rejects(planner.planTurn({}));
  }
});
test('bounded proposals share one deadline, repair at most once and mark fallback separately',async()=> {
  let calls=0;const planner={planTurn:async()=>{calls++;return {bad:true};}};
  const result=await boundedProposal({planner,method:'planTurn',input:{},budgetMs:100,validate:p=>{if(p.bad)throw new Error('INVALID');return p;},fallback:()=>({safe:true})});
  assert.equal(calls,2);assert.equal(result.planner_kind,'rule');assert.ok(result.degraded_reason);
  const controller=new AbortController();controller.abort();await assert.rejects(boundedProposal({planner,method:'planTurn',input:{},signal:controller.signal,budgetMs:10,validate:x=>x,fallback:()=>({})}),/CANCELLED/);
});
test('each semantic final uses actual context and no future/reference input; control goodbye avoids LLM',async()=> {
  const captured=[],planner={planConversation:async input=>conservativeConversation(input.entry,{snapshot_id:input.snapshot_ref,student_profile:input.student_profile,learning_profile:input.learning_profile,learning_history:input.learning_history},input.resource),planTurn:async input=>{captured.push(input);return conservativeTurn(input);}};
  const prepared=await prepare('free','a',planner),teaching=new TeachingSession({sessionId:'session-a',mode:'free',planning:prepared,planner});
  const first=event('session-a','turn-a','今天想聊宇宙。');teaching.accept(first);await teaching.planTurn(first);
  const second=event('session-a','turn-b','planet 中文怎么说？');teaching.accept(second);await teaching.planTurn(second);
  assert.equal(captured.length,2);assert.deepEqual(captured[0].actual_context,[]);assert.equal(captured[1].actual_context[0].text,first.payload.text);assert.equal(captured[1].plan.primary_goal,null);
  assert.ok(!JSON.stringify(captured).includes('reference_answer'));assert.ok(Object.isFrozen(captured[0]));
  const bye=event('session-a','turn-c','再见。');teaching.accept(bye);const plan=await teaching.planTurn(bye);assert.equal(plan.action,'CLOSE');assert.equal(plan.planner_kind,'rule');assert.equal(captured.length,2);
});
test('new input cancels stale planners even when model ignores cancellation; duplicate finals do not replan',async()=> {
  let release;const planner={planTurn:input=>input.turn.turn_id==='old'?new Promise(resolve=>{release=()=>resolve(conservativeTurn(input));}):Promise.resolve(conservativeTurn(input))};
  const state=new PlanningState({...await prepare('free'),planner});const policy={action:'RESPOND',teaching_paused:false,teaching_cooldown:0};
  const first=state.acceptInput(event('session-a','old','旧输入'),policy,{});await Promise.resolve();
  const latest=event('session-a','new','不是篮球，是跑步。');const plan=await state.acceptInput(latest,policy,{});release();assert.equal(await first,null);assert.equal(state.accepted,plan);assert.equal(await state.acceptInput(latest,policy,{}),null);
  state.close();assert.equal(state.isCurrent(plan),false);
});
test('ASR revision creates a correction input revision and invalidates the previous accepted plan',async()=> {
  const state=new PlanningState({...await prepare('free')});const policy={action:'RESPOND',teaching_paused:false,teaching_cooldown:0};
  const old=await state.acceptInput(event('session-a','same','篮球'),policy,{}),next=await state.acceptInput(event('session-a','same','跑步'),policy,{});
  assert.equal(next.input_revision,2);assert.equal(state.isCurrent(old),false);assert.equal(state.history.filter(h=>h.turn_id==='same').length,1);
});
test('turn validators enforce current references, paused goals, cooldown and closing boundaries',async()=> {
  const prepared=await prepare(),turn={source_event_id:'input-a',expires_at:Date.now()+1000};
  const policy={action:'RESPOND',teaching_paused:true,teaching_cooldown:2};const input={turn,policy};const p=conservativeTurn(input),allowedRefs=contextRefs(prepared.context,prepared.resource);allowedRefs.add('input-a');const state={plan:prepared.plan,input:turn,policy,allowedRefs};
  assert.throws(()=>validateTurn({...p,active_goal_id:'express-likes'},state),/POLICY/);
  assert.throws(()=>validateTurn({...p,reply_directive:{...p.reply_directive,new_points:1}},state),/POLICY/);
  assert.throws(()=>validateTurn({...p,evidence_refs:['future-input']},state));
  assert.throws(()=>validateTurn(p,{...state,input:{...turn,expires_at:0}}),/EXPIRED/);
});
test('advisory execution keeps actual generated, forwarded, consumed and planned states distinct',async()=> {
  const state=new PlanningState({...await prepare('free')}),e=event('session-a','turn-a','你好');await state.acceptInput(e,{action:'RESPOND',teaching_paused:false,teaching_cooldown:0},{});
  const packet=(type,payload={})=>({event:{...e,event_id:randomUUID(),type,response_id:'reply-a',payload}});
  state.observe(packet('response.started'));state.observe(packet('response.text.delta',{text:'你好。'}));state.observe(packet('response.done'));
  const execution=state.executions.get('reply-a');assert.equal(execution.generation_requested_at,null);assert.equal(execution.turn_plan_ref,null);assert.equal(execution.generation_basis,'unknown');assert.equal(execution.consumption,'unknown');
  assert.equal(state.consumption('foreign',{state:'client_reported_complete',audio_ms:20}),false);assert.equal(state.consumption('reply-a',{state:'partial',audio_ms:20}),true);
});
test('unverified duplex execution is blocked; a synthetic verified port orders plan acceptance before generation',async()=> {
  const state=new PlanningState({...await prepare('free')}),plan=await state.acceptInput(event('session-a','turn-a','你好'),{action:'RESPOND',teaching_paused:false,teaching_cooldown:0},{});
  await assert.rejects(new ReplyExecutor({provider:{planningCapabilities:SEEDUPLEX_PLANNING_CAPABILITIES},state}).execute(plan,{hash:'context'}),/NOT_VERIFIED/);
  let called=0;const executor=new ReplyExecutor({provider:{planningCapabilities:{generation_gate_verified:true,explicit_generation_verified:true},generateFromPlan:async args=>{called++;assert.equal(args.plan,state.accepted);assert.ok([...state.executions.values()][0].generation_requested_at>=plan.accepted_at);return {synthetic:true};}},state});
  assert.deepEqual(await executor.execute(plan,{hash:'context'}),{synthetic:true});await assert.rejects(executor.execute(plan,{hash:'context'}),/ALREADY/);assert.equal(called,1);
});
test('dynamic observations and summary keep attempted-only sources; plans and teacher outputs are not student facts',async()=> {
  const prepared=await prepare('sports','b'),teaching=new TeachingSession({sessionId:'session-a',mode:'sports',planning:prepared});
  assert.equal(teaching.view().goal,'用简单时间表达聊运动安排');assert.equal(teaching.learningRecord().observations.length,0);
  const e=event('session-a','turn-a','我下午打篮球。');teaching.accept(e);await teaching.planTurn(e);
  const record=teaching.learningRecord();assert.equal(record.observations[0].state,'attempted');assert.equal(record.observations[0].support,'unknown');assert.equal(record.observations[0].source_event_id,e.event_id);
  assert.throws(()=>validateLearningRecord({...record,mastered:true}));assert.throws(()=>validateLearningRecord({...record,observations:[{...record.observations[0],state:'mastered'}]}));
  const summary=teaching.finalize({businessSource:'mock_hskai',providerKind:'test',ready:true});
  const projected=projectSummary({type:'teaching.summary',session_id:'session-a',summary},{sessionId:'session-a',mode:'sports'});assert.equal(projected.observations[0].count,1);assert.equal(summary.assessment.mastery_assessed,false);
  assert.equal(summary.planning.controlled_execution,false);assert.equal(summary.goals[0].id,'express-time');
});
test('preparation ownership, fresh revisions, expiry, cancellation and single-use consumption fence concurrent work',async()=> {
  const p=await prepare(),preparations=new Preparations({initializer:p.initializer}),i=p.identity;
  const created=preparations.create(i,{mode:'sports'});await preparations.get(i,created.preparation_id).done;
  assert.throws(()=>preparations.view({...i,learner_id:'other'},created.preparation_id),/NOT_FOUND/);
  p.port.bump();await assert.rejects(preparations.consume(i,created.preparation_id,{mode:'sports'}),/STALE/);
  const ready=preparations.create(i,{mode:'free'});await preparations.get(i,ready.preparation_id).done;
  const results=await Promise.allSettled([preparations.consume(i,ready.preparation_id,{mode:'free'}),preparations.consume(i,ready.preparation_id,{mode:'free'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const pending=preparations.create(i,{mode:'sports'});preparations.revoke(i);await pending.done;assert.throws(()=>preparations.view(i,pending.preparation_id));preparations.close();
});
