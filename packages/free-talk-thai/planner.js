import {FullContractPlanner} from '../agent-core/planner-full-contract.js';
import {MiniMaxJsonTransport} from '../provider-minimax/planner.js';
import {thaiPolicyLiteral} from './session.js';

export function thaiPlannerTransport(transport){return {provider:transport.provider,model:transport.model,outputFormat:transport.outputFormat,completeJSON:request=>transport.completeJSON({...request,messages:request.messages.map(m=>m.role==='system'?{...m,content:thaiPolicyLiteral(m.content)+'\n本规划仅用于中泰 Free Talk。当前支架语种固定泰语；旧资料中的 language_support 是原数据，不授权切换语种。strategy 按原契约逐字保留，回复任务用中文描述并按需要求泰语解释，不要求英文输出。不把资料中的英文释义照读。'}:m)})};}
export function configuredThaiPlanner(env=process.env){return env.MINIMAX_API_KEY?new FullContractPlanner({transport:thaiPlannerTransport(new MiniMaxJsonTransport({apiKey:env.MINIMAX_API_KEY,baseURL:env.MINIMAX_BASE_URL,model:env.MINIMAX_PLANNER_MODEL??'MiniMax-M3'}))}):null;}
