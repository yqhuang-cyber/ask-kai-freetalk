import { Agent } from '@earendil-works/pi-agent-core';
import { PLANNER_PROMPT_VERSION } from './planner-draft.js';
import { fullContractMessages } from './planner-full-contract.js';
import { MiniMaxJsonTransport } from '../provider-minimax/planner.js';
import { minimaxToolStream } from '../provider-minimax/pi-stream.js';
import { LIMITS,isObject,boundedText } from '../contracts/planning.js';
import { REPLY_POLICY_VERSION } from './reply-policy.js';
import { FREE_INITIAL_GOAL_FIELDS,compileFreeInitialPlan } from './free-initial-plan.js';

export const PI_PACKAGE_VERSION='1.2.0';
const JSON_SENTENCE='只返回一个 JSON 对象，不返回思维链、Markdown或回复正文。';
const TOOL_SENTENCE='只调用一次提交工具，不要在正文输出 JSON、思维链、Markdown或回复正文。';
const KNOWN=new Set(['PLANNER_CANCELLED','PLANNER_UNAVAILABLE','PLANNER_INVALID_JSON','PLANNER_INVALID_RESPONSE','PLANNER_INCOMPLETE_OUTPUT','PLANNER_RESPONSE_TOO_LARGE','PLANNER_INPUT_TOO_LARGE','PLANNER_INVALID_DRAFT']);
const text={type:'string',minLength:1,maxLength:200};
const short={type:'string',minLength:1,maxLength:100};
const nullableText={anyOf:[text,{type:'null'}]};
const refs={type:'array',maxItems:12,items:{type:'string',minLength:1,maxLength:200}};
const SPEAKING_PARAMETERS={type:'object',additionalProperties:false,required:['lexical_style','sentence_structure','new_word_policy','focus_term','reason','refs'],properties:{lexical_style:{enum:['everyday','precise']},sentence_structure:{enum:['simple','linked','flexible']},new_word_policy:{enum:['avoid','one_explained','requested_only']},focus_term:{anyOf:[{type:'string',minLength:1,maxLength:80},{type:'null'}]},reason:{type:'string',minLength:1,maxLength:160},refs:{type:'array',minItems:1,maxItems:6,items:{type:'string',minLength:1,maxLength:200}}}};
const CONVERSATION_PARAMETERS={
  type:'object',additionalProperties:false,
  required:['conversation_purpose','content_focus','opening_options','primary_goal_id','candidate_goal_ids','key_points','strategy','selection_basis'],
  properties:{
    conversation_purpose:text,content_focus:text,
    opening_options:{type:'array',maxItems:2,items:{type:'string',minLength:1,maxLength:100}},
    primary_goal_id:nullableText,
    candidate_goal_ids:{type:'array',maxItems:2,items:text},
    key_points:{type:'array',maxItems:2,items:text},
    strategy:{type:'object',additionalProperties:false,required:['language_support','support_level','correction','pace','speaking_difficulty'],properties:{language_support:{enum:['auto','zh','zh_en']},support_level:{enum:['none','partial','model','unknown']},correction:{enum:['gentle','on_request']},pace:{enum:['slow','normal']},speaking_difficulty:SPEAKING_PARAMETERS}},
    selection_basis:{type:'array',minItems:1,maxItems:6,items:{type:'object',additionalProperties:false,required:['reason','refs'],properties:{reason:{type:'string',minLength:1,maxLength:80},refs}}}
  }
};
const TURN_PARAMETERS={
  type:'object',additionalProperties:false,
  required:['interpretation','prior_outcome','goal_assessment','action','active_goal_id','local_help_target','reply_directive','expected_observation','proposed_plan_patch','evidence_refs','rationale_code'],
  properties:{
    interpretation:{type:'object',additionalProperties:false,required:['intent','clarity','refs'],properties:{intent:short,clarity:{enum:['clear','ambiguous','unknown']},refs}},
    prior_outcome:{type:'object',additionalProperties:false,required:['execution_ref','status','unknown'],properties:{execution_ref:nullableText,status:{enum:['none','unknown','generated','forwarded','cancelled','partial','completed']},unknown:{type:'array',maxItems:4,items:short}}},
    goal_assessment:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['progress','gap','refs'],properties:{progress:{enum:['unknown','attempted','not_related']},gap:{type:'string',minLength:1,maxLength:150},refs}}]},
    action:{enum:['RESPOND','FOLLOW_UP','CLARIFY','SCAFFOLD','INVITE_PRACTICE','CORRECT','REVIEW','CLOSE']},
    active_goal_id:nullableText,
    local_help_target:{anyOf:[{type:'string',minLength:1,maxLength:100},{type:'null'}]},
    reply_directive:{type:'object',additionalProperties:false,required:['task','support_level','new_points','budget_ref','speaking_difficulty'],properties:{task:{type:'string',minLength:1,maxLength:400},support_level:{enum:['none','partial','model','choice']},new_points:{enum:[0,1]},budget_ref:{const:REPLY_POLICY_VERSION},speaking_difficulty:SPEAKING_PARAMETERS}},
    expected_observation:{type:'object',additionalProperties:false,required:['kind','required_student_answer'],properties:{kind:short,required_student_answer:{type:'null'}}},
    proposed_plan_patch:{anyOf:[{type:'null'},{enum:['pause','resume']},{type:'object',additionalProperties:false,required:['op','goal_id','refs'],properties:{op:{enum:['replace','retire']},goal_id:text,refs}}]},
    evidence_refs:refs,
    rationale_code:short
  }
};
function submissionTool(name,description,parameters) {
  return {name,label:name,description,parameters,execute(_id,params){
    if(!isObject(params)||Buffer.byteLength(JSON.stringify(params))>LIMITS.proposal_bytes||duplicateIds(params))throw new Error('PLANNER_INVALID_DRAFT');
    return {content:[{type:'text',text:'submitted'}],details:params,terminate:true};
  }};
}
function duplicateIds(value) {
  if(Array.isArray(value))return value.some(item=>duplicateIds(item));
  if(!isObject(value))return false;
  for(const [key,item] of Object.entries(value)) {
    if(['refs','evidence_refs','candidate_goal_ids','key_points'].includes(key)&&Array.isArray(item)&&new Set(item).size!==item.length)return true;
    if(duplicateIds(item))return true;
  }
  return false;
}
export const submitConversationPlanTool=submissionTool('submit_conversation_plan','提交一次自由对话或会话的初始计划。不要在正文再写一份 JSON。',CONVERSATION_PARAMETERS);
const FREE_CONVERSATION_PARAMETERS={...CONVERSATION_PARAMETERS,required:CONVERSATION_PARAMETERS.required.filter(key=>!FREE_INITIAL_GOAL_FIELDS.includes(key)),properties:Object.fromEntries(Object.entries(CONVERSATION_PARAMETERS.properties).filter(([key])=>!FREE_INITIAL_GOAL_FIELDS.includes(key)))};
export const submitFreeConversationPlanTool=submissionTool('submit_conversation_plan','提交自由聊天的交流内容、开场和策略。正式目标字段由宿主补齐，不提交这些字段。',FREE_CONVERSATION_PARAMETERS);
export const submitTurnPlanTool=submissionTool('submit_turn_plan','提交这一轮的下一步计划。不要在正文再写一份 JSON。',TURN_PARAMETERS);
const TOOLS={conversation:submitConversationPlanTool,turn:submitTurnPlanTool};
function plannerModel(transport) {
  return {id:transport.model,name:transport.model,api:'openai-completions',provider:transport.provider,baseUrl:'https://api.minimax.cn/v1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:204800,maxTokens:1600};
}
function toolPrompt(system) {
  if(!system.includes(JSON_SENTENCE))throw new Error('PLANNER_UNAVAILABLE');
  return system.replace(JSON_SENTENCE,TOOL_SENTENCE);
}
function knownError(message){return KNOWN.has(message)?message:'PLANNER_UNAVAILABLE';}
function readSubmission(agent,signal) {
  if(signal?.aborted)throw new Error('PLANNER_CANCELLED');
  const assistant=[...agent.state.messages].reverse().find(message=>message.role==='assistant');
  if(!assistant||assistant.stopReason==='aborted')throw new Error('PLANNER_CANCELLED');
  if(assistant.stopReason==='error')throw new Error(knownError(assistant.errorMessage));
  const calls=assistant.content.filter(block=>block.type==='toolCall');
  if(calls.length!==1)throw new Error('PLANNER_INVALID_JSON');
  const result=[...agent.state.messages].reverse().find(message=>message.role==='toolResult'&&message.toolCallId===calls[0].id);
  if(signal?.aborted)throw new Error('PLANNER_CANCELLED');
  if(!result||result.isError||!isObject(result.details))throw new Error('PLANNER_INVALID_DRAFT');
  return result.details;
}
export class PiMiniMaxPlanner {
  constructor(options={}) {
    this.transport=options.transport??new MiniMaxJsonTransport(options);
    if(typeof this.transport.completeTool!=='function'||!boundedText(this.transport.provider,80)||!boundedText(this.transport.model,100))throw new Error('INVALID_PLANNER_ADAPTER');
    this.model=this.transport.model;
  }
  describe(){return {provider:this.transport.provider,model:this.model,output_format:'pi_tool_v1',draft:'full_contract_v3',prompt:PLANNER_PROMPT_VERSION};}
  set observe(fn){this.transport.observe=fn;}
  get observe(){return this.transport.observe;}
  async propose(kind,input,options={}) {
    if(Buffer.byteLength(JSON.stringify(input))>49152)throw new Error('PLANNER_INPUT_TOO_LARGE');
    if(options.signal?.aborted)throw new Error('PLANNER_CANCELLED');
    const source=fullContractMessages(kind,input,options);
    const freeInitial=kind==='conversation'&&input.entry?.mode==='free';
    const tool=freeInitial?submitFreeConversationPlanTool:TOOLS[kind];
    let submissions=0;
    const agent=new Agent({
      initialState:{systemPrompt:toolPrompt(source[0].content),tools:[tool],model:plannerModel(this.transport),thinkingLevel:'off'},
      streamFn:minimaxToolStream(this.transport,kind),
      toolExecution:'sequential',
      maxRetryDelayMs:0,
      beforeToolCall:()=>{submissions+=1;if(submissions>1)return {block:true,reason:'ONE_SUBMISSION',terminate:true};},
      finishTurn:async turn=>{if(turn.message.stopReason==='error'||turn.message.stopReason==='aborted')return;return {action:'end'};}
    });
    const abort=()=>agent.abort();
    options.signal?.addEventListener('abort',abort,{once:true});
    try{await agent.prompt(source[1].content);const proposal=readSubmission(agent,options.signal);return freeInitial?compileFreeInitialPlan(proposal):proposal;}
    finally{options.signal?.removeEventListener('abort',abort);}
  }
  planConversation(input,options){return this.propose('conversation',input,options);}
  planTurn(input,options){return this.propose('turn',input,options);}
}
export class ModePlanner {
  constructor({free,shared}) {
    if(typeof free?.planConversation!=='function'||typeof free?.planTurn!=='function'||typeof shared?.planConversation!=='function'||typeof shared?.planTurn!=='function'||typeof shared?.planTopicConversation!=='function')throw new Error('INVALID_PLANNER_ADAPTER');
    Object.assign(this,{free,shared});
  }
  describe(){return {...this.free.describe(),output_format:'free_pi_tool_v1'};}
  plannerFor(entry){return entry?.mode==='free'?this.free:this.shared;}
  describeFor(entry){return this.plannerFor(entry).describe();}
  planConversation(input,options){return (input?.entry?.mode==='free'?this.free:this.shared).planConversation(input,options);}
  planTurn(input,options){return (input?.plan?.mode==='free'?this.free:this.shared).planTurn(input,options);}
  planTopicConversation(input,options){return this.shared.planTopicConversation(input,options);}
  set observe(fn){this.free.observe=fn;this.shared.observe=fn;}
  get observe(){return this.shared.observe;}
}
