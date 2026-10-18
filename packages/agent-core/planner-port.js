import { DraftPlanner,PLANNER_PROMPT_VERSION,safeDraftFields } from './planner-draft.js';
import { MiniMaxJsonTransport } from '../provider-minimax/planner.js';
import { FullContractPlanner } from './planner-full-contract.js';
import { ModePlanner,PiMiniMaxPlanner } from './pi-planner.js';
export { PLANNER_PROMPT_VERSION };
export class MiniMaxPlanner extends FullContractPlanner {
  constructor(options){super({transport:new MiniMaxJsonTransport(options)});}
}
export function plannerDescriptor(planner) {
  const description=planner?.describe?.()??{provider:planner?'injected':'none',model:planner?.model??null,output_format:'unknown',prompt:PLANNER_PROMPT_VERSION,draft:null};
  // Only bounded identity/version fields enter plans and public diagnostics.
  return Object.fromEntries(['provider','model','output_format','prompt','draft'].map(k=>[k,typeof description[k]==='string'&&/^[a-zA-Z0-9_.:/-]{1,100}$/.test(description[k])?description[k]:null]));
}
export function configuredPlanner(env=process.env,{factories={}}={}) {
  const provider=env.ASK_KAI_PLANNER_PROVIDER??'minimax';
  if(provider==='minimax'||provider==='pi') {
    const protocol=env.ASK_KAI_PLANNER_PROTOCOL??'full_contract_v3';
    if(!['full_contract_v3','draft_v1'].includes(protocol))throw new Error('PLANNER_PROTOCOL_NOT_REGISTERED');
    if(!env.MINIMAX_API_KEY)return null;
    const options={apiKey:env.MINIMAX_API_KEY,baseURL:env.MINIMAX_BASE_URL,model:env.MINIMAX_PLANNER_MODEL??'MiniMax-M3'};
    const shared=protocol==='draft_v1'?new DraftPlanner({transport:new MiniMaxJsonTransport(options)}):new MiniMaxPlanner(options);
    if(provider==='minimax')return shared;
    return new ModePlanner({free:new PiMiniMaxPlanner(options),shared});
  }
  if(!Object.hasOwn(factories,provider))throw new Error('PLANNER_PROVIDER_NOT_REGISTERED');
  const planner=factories[provider](env);
  if(!planner||typeof planner.planConversation!=='function'||typeof planner.planTurn!=='function')throw new Error('INVALID_PLANNER_ADAPTER');
  return planner;
}
// Deadline applies to fetching, body reading, repair and adapters that ignore abort.
export async function boundedProposal({planner,method,input,validate,fallback,signal,budgetMs,clock=()=>Date.now(),deadlineAt=clock()+budgetMs}) {
  const controller=new AbortController();let timer,timedOut=false;const attempts=[];
  const withinDeadline=(minimum=0)=>{if(deadlineAt-clock()<=minimum){timedOut=true;controller.abort();throw new Error('PLANNER_TIMEOUT');}};
  const safeCodes=new Set(['INVALID_CONVERSATION_PROPOSAL','INVALID_PLAN_RESOURCE_REFERENCE','FREE_INITIAL_GOAL_FORBIDDEN','RESOURCE_GOAL_REQUIRED','TOPIC_GOAL_REQUIRED','INVALID_TEACHING_DECISION','INVALID_NEED_REFERENCE','UNSOURCED_TEACHING_GOAL','INITIAL_CHOICE_CONFLICT','INITIAL_STRATEGY_CONFLICT','GOAL_KP_MISMATCH','DECLINED_INITIAL_GOAL','SESSION_DECLINED_GOAL_FORBIDDEN','PREREQUISITE_UNVERIFIED','INVALID_SELECTION_BASIS','INVALID_SELECTION_REASON','INVALID_SELECTION_REFERENCE','UNSUPPORTED_ATTEMPT_ASSESSMENT','INTERNAL_REFERENCE_IN_DIRECTIVE','MULTIPLE_QUESTIONS_IN_DIRECTIVE','INVALID_TURN_PROPOSAL','INVALID_TURN_DIRECTIVE','INVALID_SUPPORT_LEVEL','INVALID_NEW_POINT_COUNT','INVALID_REPLY_BUDGET_REF','INVALID_EXPECTED_OBSERVATION','PRIOR_OUTCOME_CONFLICT','INACTIVE_GOAL_ASSESSMENT','INVALID_PRIOR_OUTCOME','INVALID_GOAL_ASSESSMENT','INVALID_GOAL_PATCH','PLAN_EXPIRED','PLAN_POLICY_CONFLICT','CLOSE_TEACHING_FORBIDDEN','UNREQUESTED_CLOSING_FORBIDDEN','INACTIVE_GOAL_TEACHING_FORBIDDEN','LOCAL_HELP_SCOPE_CONFLICT','VALID_EXPRESSION_CORRECTION_FORBIDDEN','GOAL_RESUME_REQUIRES_CHOICE','GOAL_PATCH_REQUIRES_CURRENT_INPUT','GOAL_RETIRE_REQUIRES_CHOICE','GOAL_REPLACEMENT_REQUIRES_CHOICE','GOAL_REPLACEMENT_RESOURCE_OR_PREREQUISITE','INVALID_SPEAKING_DIFFICULTY','SPEAKING_CONSTRAINT_CONFLICT','INVALID_SPEAKING_REFERENCE','SPEAKING_TERM_OUT_OF_SCOPE','PLANNER_UNAVAILABLE','PLANNER_CANCELLED','PLANNER_INVALID_JSON','PLANNER_INVALID_DRAFT','PLANNER_INVALID_RESPONSE','PLANNER_INCOMPLETE_OUTPUT','PLANNER_INPUT_TOO_LARGE','PLANNER_RESPONSE_TOO_LARGE']);
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const work=async()=> {
    if(!planner)return {proposal:validate(fallback()),planner_kind:'rule',degraded_reason:'planner_unconfigured',attempts};
    for(let attempt=0;attempt<2;attempt++) {
      const started=performance.now();let phase='request';
      controller.signal.throwIfAborted();
      try{withinDeadline(attempt?Math.min(50,budgetMs/4):0);const p=await planner[method](input,{signal:controller.signal,repair:attempt===1,repairCode:attempts.at(-1)?.code,repairFields:attempts.at(-1)?.invalid_fields});controller.signal.throwIfAborted();withinDeadline();phase='validation';const proposal=validate(p);withinDeadline();attempts.push({attempt:attempt+1,state:'accepted',elapsed_ms:Math.round(performance.now()-started)});return {proposal,planner_kind:'llm',degraded_reason:null,attempts};}
      catch(error){if(controller.signal.aborted)throw error;attempts.push({attempt:attempt+1,state:'rejected',invalid_fields:safeDraftFields(error.invalid_fields),phase,elapsed_ms:Math.round(performance.now()-started),code:safeCodes.has(error.message)?error.message:'PLANNER_VALIDATION_FAILED'});if(attempt===1||['PLANNER_UNAVAILABLE','PLANNER_CANCELLED'].includes(error.message))throw error;}
    }
  };
  try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(new Error('PLANNER_TIMEOUT'));},Math.max(1,Math.min(budgetMs,deadlineAt-clock())));}),new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(new Error('PLANNER_CANCELLED')),{once:true});})]);}
  catch{if(signal?.aborted)throw new Error('PLANNER_CANCELLED');return {proposal:validate(fallback()),planner_kind:'rule',degraded_reason:timedOut?'planner_timeout':attempts.some(a=>!['PLANNER_UNAVAILABLE','PLANNER_CANCELLED'].includes(a.code))?'planner_validation_failed':'planner_unavailable',attempts};}
  finally{clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',abort);}
}
