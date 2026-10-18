import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DraftPlanner,compilePlannerDraft,DRAFT_SCHEMAS } from '../packages/agent-core/planner-draft.js';
import { configuredPlanner,boundedProposal,plannerDescriptor } from '../packages/agent-core/planner-port.js';
import { MiniMaxJsonTransport } from '../packages/provider-minimax/planner.js';
import { FullContractPlanner } from '../packages/agent-core/planner-full-contract.js';
import { MiniMaxPlanner as FrozenPlanner } from '../apps/eval-runner/src/legacy-planner-v3.js';
import { AGENT_REASONING_INSTRUCTIONS } from '../packages/agent-core/agent-reasoning.js';
import { learnerFixture,SPORTS_RESOURCE } from '../apps/hskai-mock/src/planning-fixtures.js';
import { validateConversation,validateTurn,contextRefs } from '../packages/agent-core/plan-validator.js';
const context=learnerFixture({owner_id:'owner',learner_id:'learner'});
const initial={entry:{mode:'topic',topic_id:'sports'},resource:SPORTS_RESOURCE,required_strategy:{language_support:'zh',correction:'on_request',pace:'slow'}};
const selection={conversation_purpose:'聊运动',content_focus:'篮球',opening_options:[],primary_goal_id:'express-likes',candidate_goal_ids:[],support_level:'partial',selection_basis:[{reason:'needs_support',refs:[context.snapshot_id]}]};
const turn={interpretation:{intent:'share',clarity:'clear',refs:['input']},goal_assessment:null,action:'FOLLOW_UP',active_goal_id:'express-likes',local_help_target:null,reply_task:'接住篮球话题',support_level:'none',new_points:0,expected_observation_kind:'conversation_continuity',proposed_plan_patch:null,evidence_refs:['input'],rationale_code:'follow_current_content'};
test('draft compilation binds KP, explicit preferences, real execution and budget from immutable host input',()=> {
  const p=compilePlannerDraft('conversation',selection,initial);
  assert.deepEqual(p.strategy,{...initial.required_strategy,support_level:'partial'});assert.deepEqual(p.key_points,['likes-expression']);assert.ok(Object.isFrozen(p));
  const t=compilePlannerDraft('turn',turn,{prior_execution:{execution_id:'reply',status:'cancelled'}});
  assert.equal(t.prior_outcome.status,'cancelled');assert.equal(t.prior_outcome.execution_ref,'reply');assert.equal(t.reply_directive.budget_ref,'kai-reply-v7');assert.equal(t.expected_observation.required_student_answer,null);
});
test('model cannot submit fields owned by host or bypass resource/semantic policy during compilation',()=> {
  for(const field of ['strategy','key_points','owner_id','plan_revision'])assert.throws(()=>compilePlannerDraft('conversation',{...selection,[field]:'injected'},initial),/INVALID_DRAFT/);
  for(const field of ['prior_outcome','reply_directive','expected_observation','session_id'])assert.throws(()=>compilePlannerDraft('turn',{...turn,[field]:'injected'},{}),/INVALID_DRAFT/);
  assert.throws(()=>compilePlannerDraft('conversation',{...selection,primary_goal_id:'invented'},initial),/RESOURCE_REFERENCE/);
  assert.throws(()=>compilePlannerDraft('conversation',selection,{...initial,entry:{mode:'free'}}),/INVALID_DRAFT/);
  const spoken={lexical_style:'everyday',sentence_structure:'simple',new_word_policy:'avoid',focus_term:null,reason:'按已达范围',refs:[context.snapshot_id]};
  const freeInput={...initial,entry:{mode:'free'}};
  const p=compilePlannerDraft('conversation',{...selection,speaking_difficulty:spoken},freeInput);
  assert.throws(()=>validateConversation(p,{entry:freeInput.entry,context,resource:SPORTS_RESOURCE}),/FREE/);
  const t=compilePlannerDraft('turn',{...turn,action:'CLOSE',active_goal_id:null},{});
  assert.throws(()=>validateTurn(t,{plan:{primary_goal:SPORTS_RESOURCE.goals[0],goal_status:'active'},input:{text:'聊篮球',source_event_id:'input',expires_at:Date.now()+1000},policy:{action:'RESPOND',teaching_paused:false,teaching_cooldown:0},allowedRefs:new Set(['input']),priorExecution:null}),/UNREQUESTED/);
});
test('draft shape rejects missing fields, invalid enums, model mastery and nested injections',()=> {
  for(const value of [{...turn,new_points:'0'},{...turn,support_level:'high'},{...turn,goal_assessment:{progress:'mastered',gap:'none',refs:[]}},{...turn,interpretation:{...turn.interpretation,private_contact:'x'}}])assert.throws(()=>compilePlannerDraft('turn',value,{}));
  const missing={...turn};delete missing.expected_observation_kind;assert.throws(()=>compilePlannerDraft('turn',missing,{}));
});
test('future provider adapters use identical drafts and guards, and provider config stays server owned',async()=> {
  const factory=()=>new DraftPlanner({transport:{provider:'future_test',model:'stronger-test-fixture',outputFormat:'json_schema',completeJSON:async({schema,messages})=>{assert.equal(schema,DRAFT_SCHEMAS.conversation);assert.equal(messages[1].role,'user');return selection;}}});
  const planner=configuredPlanner({ASK_KAI_PLANNER_PROVIDER:'future_test'},{factories:{future_test:factory}});
  assert.equal(plannerDescriptor(planner).model,'stronger-test-fixture');
  const result=await planner.planConversation(initial);assert.deepEqual(result.key_points,['likes-expression']);
  assert.throws(()=>configuredPlanner({ASK_KAI_PLANNER_PROVIDER:'unregistered'}),/NOT_REGISTERED/);
});
test('MiniMax transport does not infer native schema support, print reasoning or conceal length/body failures',async()=> {
  const observed=[];let sent;
  const transport=new MiniMaxJsonTransport({apiKey:'fixture',observe:r=>observed.push(r),fetcher:async(_url,args)=>{sent=JSON.parse(args.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(selection),reasoning_content:'PRIVATE_REASONING'}}]}));}});
  await new DraftPlanner({transport}).planConversation(initial);
  assert.equal(sent.response_format,undefined);assert.equal(sent.tools,undefined);assert.deepEqual(sent.thinking,{type:'disabled'});assert.equal(sent.max_completion_tokens,1600);
  assert.ok(!JSON.stringify(observed).includes('PRIVATE_REASONING'));assert.equal(observed.find(r=>r.state==='output_shape').reasoning_present,true);
  const incomplete=new MiniMaxJsonTransport({apiKey:'fixture',fetcher:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}))});
  await assert.rejects(incomplete.completeJSON({kind:'turn',messages:[]}),/INCOMPLETE_OUTPUT/);
});
test('unavailable or invalid drafts still share the deadline and never become LLM acceptance',async()=> {
  const planner=new DraftPlanner({transport:{provider:'fixture',model:'fixture',completeJSON:async()=>({...turn,budget_ref:'injected'})}});
  const r=await boundedProposal({planner,method:'planTurn',input:{},budgetMs:100,validate:x=>x,fallback:()=>({safe:true})});
  assert.equal(r.planner_kind,'rule');assert.equal(r.attempts.length,2);assert.equal(r.attempts[0].code,'PLANNER_INVALID_DRAFT');
});
test('full-contract versions adaptive reply directives while retaining fields and repair; frozen baseline stays independent',async()=> {
  const requests=[];
  const fetcher=async(_url,args)=>{requests.push(JSON.parse(args.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{}'}}]}));};
  const old=new FrozenPlanner({apiKey:'fixture',fetcher}),current=new FullContractPlanner({transport:new MiniMaxJsonTransport({apiKey:'fixture',fetcher})});
  for(const kind of ['Conversation','Turn'])for(const options of [{},{repair:true,repairCode:'INVALID_SELECTION_REFERENCE'}]) {
    await old['plan'+kind](initial,options);await current['plan'+kind](initial,options);const sent=requests.at(-1),baseline=requests.at(-2);assert.ok(sent.messages[0].content.includes(AGENT_REASONING_INSTRUCTIONS));assert.deepEqual(sent.messages[1],baseline.messages[1]);assert.equal(sent.model,baseline.model);assert.equal(sent.max_completion_tokens,baseline.max_completion_tokens);if(kind==='Turn'){assert.match(sent.messages[0].content,/kai-reply-v7/);assert.match(sent.messages[0].content,/承接内容、相关补充与自然追问/);assert.match(baseline.messages[0].content,/kai-reply-v4/);}if(options.repair)assert.match(sent.messages[0].content,/INVALID_SELECTION_REFERENCE/);
  }
  assert.equal(plannerDescriptor(configuredPlanner({MINIMAX_API_KEY:'fixture'})).prompt,'kai-planner-v10');
  assert.equal(plannerDescriptor(configuredPlanner({MINIMAX_API_KEY:'fixture',ASK_KAI_PLANNER_PROTOCOL:'draft_v1'})).prompt,'kai-planner-v10');
  assert.throws(()=>configuredPlanner({MINIMAX_API_KEY:'fixture',ASK_KAI_PLANNER_PROTOCOL:'unknown'}),/NOT_REGISTERED/);
});
test('planner metadata exports only bounded descriptor fields',()=> {
  const result=plannerDescriptor({describe:()=>({provider:'fixture',model:'fixture',draft:'v1',prompt:'v1',output_format:'json_schema',apiKey:'PRIVATE_SECRET',endpoint:'https://private.example'})});
  assert.deepEqual(Object.keys(result),['provider','model','output_format','prompt','draft']);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
