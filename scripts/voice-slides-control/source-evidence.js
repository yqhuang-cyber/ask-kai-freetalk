import {createHash} from 'node:crypto';

// Experimental content evidence, NOT a supplier-authenticated input identity.
// It never infers intent and retains only digests, not recognized text.
export function normalizeSource(text){
  if(typeof text!=='string'||!text.length||text.length>2000)throw new Error('INVALID_SOURCE_TEXT');
  const digits={一:'1',二:'2',三:'3'};
  const normalized=text.normalize('NFKC').replace(/[\p{P}\p{Z}\p{S}\s]/gu,'').toLowerCase()
    .replace(/第([一二三])页/gu,(_,digit)=>'第'+digits[digit]+'页');
  if(!normalized.length)throw new Error('INVALID_SOURCE_TEXT');return normalized;
}
const digest=text=>createHash('sha256').update(normalizeSource(text)).digest('hex');
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128;
export class SourceEvidenceLedger {
  #inputs=new Map();#claims=new Map();#used=new Map();#latest=null;#closed=false;#blocked=null;
  constructor({limit=64,maxAgeMs=15000,now=()=>performance.now()}={}){
    if(!Number.isSafeInteger(limit)||limit<1||limit>128||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>60000||typeof now!=='function')throw new Error('INVALID_SOURCE_LEDGER');
    Object.assign(this,{limit,maxAgeMs,now});
  }
  begin(inputId){
    if(!id(inputId))throw new Error('INVALID_SOURCE_INPUT');
    if(this.#closed||this.#blocked||this.#inputs.has(inputId))return false;
    if(this.#inputs.size>=this.limit){this.#blocked='SOURCE_INPUT_LIMIT';return false;}
    this.#inputs.set(inputId,{digest:null,at:this.now(),addressed:false,replySettled:false});this.#latest=inputId;return true;
  }
  settleReply(inputId){const input=this.#inputs.get(inputId);if(input&&!this.#closed)input.replySettled=true;}
  complete(inputId,text){
    if(this.#closed||this.#blocked)return false;
    const input=this.#inputs.get(inputId);
    if(!input){this.#blocked='SOURCE_UNBOUND_FINAL';return false;}
    const value=digest(text);
    if(input.digest&&input.digest!==value){this.#blocked='SOURCE_FINAL_CONFLICT';return false;}
    input.digest=value;return true;
  }
  claim(callId,sourceText,signature){
    const reject=reason=>Object.freeze({status:'rejected',reason});
    if(this.#closed)return reject('SOURCE_SESSION_CLOSED');
    if(this.#blocked)return reject(this.#blocked);
    if(!id(callId)||typeof sourceText!=='string'||!sourceText.length||sourceText.length>400||typeof signature!=='string'||signature.length>1024)return reject('SOURCE_INVALID_CLAIM');
    let sourceDigest;try{sourceDigest=digest(sourceText);}catch{return reject('SOURCE_INVALID_CLAIM');}
    const existing=this.#claims.get(callId);
    if(existing)return existing.digest===sourceDigest&&existing.signature===signature?existing.result:reject('SOURCE_CALL_CONFLICT');
    if(this.#claims.size>=this.limit)return reject('SOURCE_CALL_LIMIT');
    const candidates=[...this.#inputs].filter(([,input])=>input.digest===sourceDigest);
    let result;
    if(candidates.length!==1)result=reject(candidates.length?'SOURCE_AMBIGUOUS':'SOURCE_NOT_RECOGNIZED');
    else{
      const [inputId,input]=candidates[0];
      input.addressed=true;
      if(inputId!==this.#latest)result=reject('SOURCE_NOT_CURRENT');
      else if(this.now()-input.at>this.maxAgeMs)result=reject('SOURCE_EXPIRED');
      else if(this.#used.has(inputId))result=reject('SOURCE_ALREADY_USED');
      else if([...this.#inputs].some(([otherId,other])=>otherId!==inputId&&!other.addressed&&!other.replySettled))result=reject('SOURCE_UNRESOLVED_INPUT');
      else{result=Object.freeze({status:'matched',input_id:inputId,basis:'model_echo_unique_asr_match'});this.#used.set(inputId,callId);}
    }
    this.#claims.set(callId,{digest:sourceDigest,signature,result});return result;
  }
  close(){this.#closed=true;this.#inputs.clear();this.#claims.clear();this.#used.clear();this.#latest=null;}
}
export function withSourceEvidence(tools){
  return tools.map(base=>{
    const tool=structuredClone(base);
    tool.parameters.properties.source_text={type:'string',description:'逐字引用本次触发操作的学习者完整原话，包含开头和结尾，不要概括、删词或引用老师的话。此字段用于核对来源，不能自己编造。'};
    tool.parameters.required=[...new Set([...(tool.parameters.required??[]),'source_text'])];
    tool.description+=' 必须附带source_text完整原话；不匹配或有歧义时宿主不会执行。';
    return tool;
  });
}
export const SOURCE_INSTRUCTIONS=`
来源核对实验：每个工具调用必须携带source_text，逐字引用刚刚触发这个操作的学习者整句原话，不要删掉“帮我”“请”等词，不要改写为动作摘要，不要引用老师的话。保持听到的文字，标点差异可以。
例如学习者说“帮我回到上一页。”，参数为 {"action":"previous","source_text":"帮我回到上一页。"}；明确撤销“算了，不要翻了。”时参数为 {"source_text":"算了，不要翻了。"}。
source_text是待核验的模型来源声明，不代表已经授权。必须等宿主结果：SOURCE_NOT_CURRENT说明旧请求未接受，不要恢复执行；SOURCE_AMBIGUOUS或SOURCE_NOT_RECOGNIZED时说明没有切换，并请学习者换个完整说法明确想回看的页。不能自行改成另外一句再重试工具，不能声称翻页成功。重复的独立请求也必须保留完整原话。
本实验仍用原生S2S直接理解语音；宿主只核对内容来源，不从ASR关键词执行动作。`;
