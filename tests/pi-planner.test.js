import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,existsSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MiniMaxJsonTransport } from '../packages/provider-minimax/planner.js';
import { PiMiniMaxPlanner,ModePlanner,PI_PACKAGE_VERSION } from '../packages/agent-core/pi-planner.js';
import { boundedProposal,configuredPlanner,plannerDescriptor } from '../packages/agent-core/planner-port.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { learnerFixture,SPORTS_RESOURCE } from '../apps/hskai-mock/src/planning-fixtures.js';
import { MOCK_IDENTITY } from '../apps/hskai-mock/src/server.js';
import { runGoalEval } from '../scripts/goal-eval.js';
import { REPLY_POLICY_VERSION } from '../packages/agent-core/reply-policy.js';

const turnPlan=()=>({interpretation:{intent:'打招呼',clarity:'clear',refs:['turn-1']},prior_outcome:{execution_ref:null,status:'none',unknown:['播放与理解未知']},goal_assessment:null,action:'RESPOND',active_goal_id:null,local_help_target:null,reply_directive:{task:'先接住这句问候',support_level:'none',new_points:0,budget_ref:REPLY_POLICY_VERSION,speaking_difficulty:{lexical_style:'everyday',sentence_structure:'simple',new_word_policy:'avoid',focus_term:null,reason:'先接住问候。',refs:['turn-1']}},expected_observation:{kind:'conversation_continuity',required_student_answer:null},proposed_plan_patch:null,evidence_refs:['turn-1'],rationale_code:'greet'});
function toolResponse(body,{status=200}={}) {
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
}
function acceptedBody(plan=turnPlan(),{calls}={}) {
  return {choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:calls??[{id:'call-1',type:'function',function:{name:'submit_turn_plan',arguments:JSON.stringify(plan)}}]}}],usage:{prompt_tokens:11,completion_tokens:7}};
}
test('pinned Pi packages and the repository Node engine match the recorded 1.2.0 decision',()=>{
  const root=JSON.parse(readFileSync('package.json','utf8'));
  const agent=JSON.parse(readFileSync('node_modules/@earendil-works/pi-agent-core/package.json','utf8'));
  const ai=JSON.parse(readFileSync('node_modules/@earendil-works/pi-ai/package.json','utf8'));
  assert.equal(root.dependencies['@earendil-works/pi-agent-core'],PI_PACKAGE_VERSION);
  assert.equal(root.dependencies['@earendil-works/pi-ai'],PI_PACKAGE_VERSION);
  assert.equal(root.engines.node,'>=22.19.0');
  assert.equal(agent.version,PI_PACKAGE_VERSION);
  assert.equal(ai.version,PI_PACKAGE_VERSION);
});
test('the tool request stays on the current MiniMax profile and does not retry or load coding tools',async()=>{
  const home=mkdtempSync(join(tmpdir(),'ask-kai-pi-'));
  const previous=process.env.HOME;
  process.env.HOME=home;
  const bodies=[];
  try {
    const transport=new MiniMaxJsonTransport({apiKey:'synthetic',fetcher:async(url,init)=>{bodies.push({url,body:JSON.parse(init.body)});return toolResponse(acceptedBody());}});
    const planner=new PiMiniMaxPlanner({transport});
    const proposal=await planner.planTurn({entry:{mode:'free'},text:'你好'});
    assert.equal(proposal.action,'RESPOND');
    assert.equal(bodies.length,1);
    assert.equal(bodies[0].url,'https://api.minimax.cn/v1/chat/completions');
    assert.equal(bodies[0].body.model,'MiniMax-M3');
    assert.deepEqual(bodies[0].body.thinking,{type:'disabled'});
    assert.equal(bodies[0].body.stream,false);
    assert.deepEqual(bodies[0].body.tools.map(tool=>tool.function.name),['submit_turn_plan']);
    assert.equal(bodies[0].body.tool_choice.function.name,'submit_turn_plan');
    assert.equal(bodies[0].body.messages.some(message=>String(message.content).includes('Working on Ask Kai')),false);
    assert.equal(bodies[0].body.messages[0].content.includes('只调用一次提交工具'),true);
    assert.equal(bodies[0].body.messages[0].content.includes('只返回一个 JSON 对象'),false);
    assert.equal(existsSync(join(home,'.pi')),false);
    assert.equal(planner.describe().output_format,'pi_tool_v1');
  } finally {process.env.HOME=previous;}
});
test('a failed MiniMax response is not retried inside one Pi submission',async()=>{
  let calls=0;
  const transport=new MiniMaxJsonTransport({apiKey:'synthetic',fetcher:async()=>{calls++;return toolResponse({error:true},{status:503});}});
  const planner=new PiMiniMaxPlanner({transport});
  await assert.rejects(planner.planTurn({}),/PLANNER_UNAVAILABLE/);
  assert.equal(calls,1);
});
test('two tool calls, duplicate ids, and prose without a tool stay unaccepted',async()=>{
  const transport=new MiniMaxJsonTransport({apiKey:'synthetic',fetcher:async()=>toolResponse(acceptedBody(turnPlan(),{calls:[{id:'a',type:'function',function:{name:'submit_turn_plan',arguments:'{}'}},{id:'b',type:'function',function:{name:'submit_turn_plan',arguments:'{}'}}]}))});
  await assert.rejects(transport.completeTool({kind:'turn',messages:[],tool:{name:'submit_turn_plan',description:'submit',parameters:{type:'object'}},signal:undefined}),/PLANNER_INVALID_JSON/);
  const duplicate={...turnPlan(),evidence_refs:['turn-1','turn-1']};
  const duplicatePlanner=new PiMiniMaxPlanner({transport:{provider:'minimax',model:'MiniMax-M3',completeTool:async()=>({id:'call-1',name:'submit_turn_plan',arguments:duplicate})}});
  await assert.rejects(duplicatePlanner.planTurn({}),/PLANNER_INVALID_DRAFT/);
  const prose=new PiMiniMaxPlanner({transport:{provider:'minimax',model:'MiniMax-M3',completeTool:async()=>{throw new Error('PLANNER_INVALID_JSON');}}});
  await assert.rejects(prose.planTurn({}),/PLANNER_INVALID_JSON/);
});
test('business rejection repairs once, and a late tool result cannot replace the rule plan',async()=>{
  let calls=0;
  const planner=new PiMiniMaxPlanner({transport:{provider:'minimax',model:'MiniMax-M3',completeTool:async()=>{calls++;return {id:'call-'+calls,name:'submit_turn_plan',arguments:calls===1?{...turnPlan(),action:'NOT_AN_ACTION'}:{...turnPlan(),action:'RESPOND'}};}}});
  const repaired=await boundedProposal({planner,method:'planTurn',input:{},budgetMs:1000,validate:proposal=>{if(proposal.action!=='RESPOND')throw new Error('INVALID_TURN_PROPOSAL');return proposal;},fallback:()=>({action:'RULE'})});
  assert.equal(repaired.planner_kind,'llm');
  assert.equal(repaired.proposal.action,'RESPOND');
  assert.equal(calls,2);
  let release;
  const late=new PiMiniMaxPlanner({transport:{provider:'minimax',model:'MiniMax-M3',completeTool:()=>new Promise(resolve=>{release=()=>resolve({id:'late',name:'submit_turn_plan',arguments:turnPlan()});})}});
  const timed=boundedProposal({planner:late,method:'planTurn',input:{},budgetMs:20,validate:proposal=>proposal,fallback:()=>({action:'RULE'})});
  const result=await timed;
  release();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(result.planner_kind,'rule');
  assert.equal(result.degraded_reason,'planner_timeout');
  assert.equal(result.proposal.action,'RULE');
});
test('cancellation before the request does not call MiniMax',async()=>{
  const controller=new AbortController();controller.abort();
  let calls=0;
  const planner=new PiMiniMaxPlanner({transport:{provider:'minimax',model:'MiniMax-M3',completeTool:async()=>{calls++;return {id:'x',name:'submit_turn_plan',arguments:turnPlan()};}}});
  await assert.rejects(planner.planTurn({}, {signal:controller.signal}),/PLANNER_CANCELLED/);
  assert.equal(calls,0);
});
test('free conversation uses Pi and topic or mission stays on the JSON planner',async()=>{
  const calls=[];
  const freeProposal=input=>({conversation_purpose:'跟随学生选择进行自然交流',content_focus:'由学生选择话题',opening_options:[],primary_goal_id:null,candidate_goal_ids:[],key_points:[],strategy:{...input.required_strategy,support_level:'unknown',speaking_difficulty:{lexical_style:'everyday',sentence_structure:'simple',new_word_policy:'avoid',focus_term:null,reason:'按已达范围先用常见说法。',refs:[input.snapshot_ref]}},selection_basis:[{reason:'free_student_choice',refs:[input.snapshot_ref]}]});
  const free={describe:()=>({provider:'minimax',model:'MiniMax-M3',output_format:'pi_tool_v1',draft:'full_contract_v3',prompt:'kai-planner-v9'}),planConversation:async input=>{calls.push(['free',input.entry.mode]);return freeProposal(input);},planTurn:async input=>{calls.push(['free-turn',input.plan.mode]);return turnPlan();}};
  const shared={describe:()=>({provider:'minimax',model:'MiniMax-M3',output_format:'json_prompt',draft:'full_contract_v3',prompt:'kai-planner-v9'}),planConversation:async input=>{calls.push(['json',input.entry.mode]);const {conservativeConversation}=await import('../packages/agent-core/conversation-initializer.js');return conservativeConversation(input.entry,{student_profile:input.student_profile,learning_profile:input.learning_profile,learning_history:input.learning_history,snapshot_id:input.snapshot_ref},input.resource);},planTurn:async input=>{calls.push(['json-turn',input.plan.mode]);return turnPlan();},planTopicConversation:async()=>{calls.push(['topic-model']);throw new Error('TOPIC_MODEL');}};
  const router=new ModePlanner({free,shared});
  assert.equal(router.describe().output_format,'free_pi_tool_v1');
  assert.equal(router.describeFor({mode:'free'}).output_format,'pi_tool_v1');
  assert.equal(router.describeFor({mode:'topic'}).output_format,'json_prompt');
  const identity={...MOCK_IDENTITY,authorization_until:Date.now()+60000,scopes:['session:create','context:read','curriculum:read']};
  const port={read:async()=>learnerFixture(identity),getResource:async(_identity,entry)=>entry.mode==='free'?null:SPORTS_RESOURCE};
  const freePlan=await new ConversationInitializer({port,planner:router}).prepare({mode:'free'},identity);
  const topicPlan=await new ConversationInitializer({port,planner:router}).prepare({mode:'topic',topic_id:'sports'},identity);
  assert.deepEqual(calls.map(call=>call[0]),['free','json']);
  assert.equal(freePlan.plan.planner_profile.output_format,'pi_tool_v1');
  assert.equal(freePlan.plan.planner_kind,'llm');
  assert.equal(topicPlan.plan.planner_profile.output_format,'json_prompt');
  assert.equal(configuredPlanner({MINIMAX_API_KEY:'synthetic',ASK_KAI_PLANNER_PROVIDER:'pi'}).describe().output_format,'free_pi_tool_v1');
  assert.equal(plannerDescriptor(configuredPlanner({MINIMAX_API_KEY:'synthetic'})).output_format,'json_prompt');
  assert.equal(configuredPlanner({ASK_KAI_PLANNER_PROVIDER:'pi'}),null);
});
test('the frozen goal comparison rejects a Pi run that is not an explicit live batch',async()=>{
  await assert.rejects(runGoalEval({pi:true}),/INVALID_GOAL_EVAL_ARGUMENT/);
  await assert.rejects(runGoalEval({pi:true,live:true,draftContract:true}),/INVALID_GOAL_EVAL_ARGUMENT/);
});
