import {randomBytes,createHash} from 'node:crypto';
import {SLIDES_TOOL,SLIDES_CANCEL_TOOL,slidesReviewTools,validateSlidesIntent,validateSlidesCancellation,resolveSlidesTarget} from '../../../packages/contracts/ui-actions.js';

// Experimental SESSION-scoped action admission. It does not manufacture a turn_id.
// Epoch names fence emitted old calls; they do not prove model intent or input origin.
export class SlidesCommandCapabilities {
  #current;#epochs=new Map();#calls=new Map();#inputs=new Map();#active=false;#armed=false;#available=new Set();#closed=false;#disabled=null;
  constructor({makeToken=()=>randomBytes(8).toString('hex'),limit=64}={}){
    if(typeof makeToken!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>128)throw new Error('INVALID_SLIDES_CAPABILITIES');
    this.makeToken=makeToken;this.limit=limit;this.epochIndex=-1;this.#rotate();
  }
  #rotate(){
    if(this.#epochs.size>=16){this.#disabled='CAPABILITY_EPOCH_LIMIT';this.#active=false;this.#armed=false;return;}
    const token=this.makeToken();
    if(typeof token!=='string'||!/^[a-z0-9]{8,32}$/.test(token)||this.#epochs.has(token))throw new Error('INVALID_CAPABILITY_TOKEN');
    this.#current=token;this.epochIndex++;this.#epochs.set(token,this.epochIndex);this.#active=false;this.#armed=false;this.#available.clear();
  }
  kind(name){
    for(const token of this.#epochs.keys()){
      if(name===SLIDES_TOOL.name+'_'+token)return 'navigate';
      if(name===SLIDES_CANCEL_TOOL.name+'_'+token)return 'cancel';
    }
    return null;
  }
  registration(state){
    if(this.#closed||this.#disabled)throw new Error('CAPABILITIES_CLOSED');
    const tools=[...slidesReviewTools(state),structuredClone(SLIDES_CANCEL_TOOL)].map(tool=>({...tool,name:tool.name+'_'+this.#current}));
    const names={navigate:SLIDES_TOOL.name+'_'+this.#current,cancel:SLIDES_CANCEL_TOOL.name+'_'+this.#current};
    this.#available=new Set(tools.map(tool=>tool.name));
    return {token:this.#current,epoch_index:this.epochIndex,tools,names};
  }
  acknowledge(token){if(this.#closed||this.#disabled||token!==this.#current||this.#active)return false;this.#active=true;this.#armed=false;return true;}
  observeStarted(inputId){
    if(this.#closed||this.#disabled||typeof inputId!=='string'||!inputId.length||inputId.length>128||this.#inputs.has(inputId))return false;
    if(this.#inputs.size>=this.limit){this.#disabled='CAPABILITY_INPUT_LIMIT';this.#active=false;this.#armed=false;return false;}
    this.#inputs.set(inputId,{token:this.#active?this.#current:null,completed:false});return true;
  }
  observeFinal(inputId){
    const input=this.#inputs.get(inputId);if(this.#closed||this.#disabled||!input||input.completed)return false;
    input.completed=true;if(this.#active&&input.token===this.#current)this.#armed=true;return true;
  }
  admit({name,callId,args},state){
    const reject=reason=>Object.freeze({status:'rejected',reason,scope:'session_call'});
    if(this.#closed)return reject('CAPABILITIES_CLOSED');
    if(typeof callId!=='string'||!callId.length||callId.length>128)return reject('INVALID_CALL_ID');
    const kind=this.kind(name);
    if(!kind)return reject('UNREGISTERED_TOOL');
    const valid=kind==='navigate'?validateSlidesIntent(args):validateSlidesCancellation(args);
    if(!valid)return reject('INVALID_SLIDES_ARGUMENTS');
    const normalized=kind==='navigate'?{action:args.action,...(args.action==='goto'?{page:args.page}:{}),...(args.replace_pending===true?{replace_pending:true}:{})}:{};
    const signature=JSON.stringify({name,args:normalized}),cached=this.#calls.get(callId);
    if(cached)return cached.signature===signature?{...cached.decision,replayed:true}:reject('CALL_ARGUMENT_CONFLICT');
    if(this.#disabled)return reject(this.#disabled);
    if(this.#calls.size>=this.limit){this.#disabled='CAPABILITY_CALL_LIMIT';this.#active=false;this.#armed=false;return reject(this.#disabled);}
    let decision;
    const currentName=(kind==='navigate'?SLIDES_TOOL.name:SLIDES_CANCEL_TOOL.name)+'_'+this.#current;
    if(name!==currentName)decision=reject('CAPABILITY_REVOKED');
    else if(!this.#active)decision=reject('CAPABILITY_NOT_CONFIRMED');
    else if(!this.#armed)decision=reject('FRESH_INPUT_REQUIRED');
    else if(!this.#available.has(name))decision=reject('CAPABILITY_NOT_AVAILABLE');
    else if(state?.confirmed===false)decision=reject('SLIDES_STATE_UNCONFIRMED');
    else{
      const resolution=kind==='navigate'?resolveSlidesTarget(normalized,state):null;
      if(resolution?.status==='rejected')decision=reject(resolution.reason);
      else{
        decision=Object.freeze({status:'accepted',scope:'session_call',kind,epoch_index:this.epochIndex,
          request_id:createHash('sha256').update(this.#current+'\0'+callId).digest('hex'),intent:normalized,
          rotated:kind==='cancel'||normalized.replace_pending===true});
        // A repeated control call returns its cached admission; it never rotates twice.
        if(decision.rotated)this.#rotate();
      }
    }
    this.#calls.set(callId,{signature,decision});return decision;
  }
  close(){this.#closed=true;this.#calls.clear();this.#inputs.clear();this.#available.clear();}
}

export function capabilityInstructions(text,registration){
  return text.replaceAll('navigate_slides',registration.names.navigate).replaceAll('cancel_pending_slides',registration.names.cancel)+`
本次页面操作属于当前会话的独立控制事务，不作为学习证据。只调用当前工具列表里的精确名称。
cancel工具只在明确撤销此前提出、尚未完成的回看时使用。首次说“先不要翻页”只是保持当前页，不调用工具。
撤销或明确改口后，旧批次工具不再有执行权限；如收到CAPABILITY_REVOKED、CAPABILITY_NOT_CONFIRMED或FRESH_INPUT_REQUIRED，说明没有执行这次请求，不得换工具名自动重试。等学习者新的明确请求。
普通插话不撤销已接受的页面动作。已派发动作不能声称回滚；按真实结果反馈。必须等applied且confirmed才说切换成功。`;
}
