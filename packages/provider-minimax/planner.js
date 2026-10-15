import { LIMITS,isObject } from '../contracts/planning.js';
// Only M3's reviewed profile is registered today. Future models/providers get
// their own transport profile; the Agent Core contract does not name a model.
export class MiniMaxJsonTransport {
  constructor({apiKey,baseURL='https://api.minimax.cn/v1',model='MiniMax-M3',fetcher=fetch,observe=()=>{}}={}) {
    const url=new URL(baseURL);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['api.minimax.cn','api.minimaxi.com','api.minimax.io'].includes(url.hostname)||url.pathname.replace(/\/$/,'')!=='/v1'||!apiKey||model!=='MiniMax-M3')throw new Error('MINIMAX_PLANNER_CONFIG_REQUIRED');
    Object.assign(this,{apiKey,endpoint:url.origin+'/v1/chat/completions',model,fetcher,observe});this.provider='minimax';this.outputFormat='json_prompt';
  }
  async completeJSON({kind,messages,signal}) {
    let response;const started=performance.now(),observe=fields=>{try{this.observe({kind,elapsed_ms:Math.round(performance.now()-started),...fields});}catch{}};
    const payload={model:this.model,thinking:{type:'disabled'},max_completion_tokens:kind==='topic_generation'?3200:1600,stream:false,messages};
    observe({state:'request_started',input_bytes:Buffer.byteLength(JSON.stringify(payload))});
    try{response=await this.fetcher(this.endpoint,{method:'POST',redirect:'error',signal,headers:{Authorization:'Bearer '+this.apiKey,'Content-Type':'application/json'},body:JSON.stringify(payload)});}
    catch{observe({state:signal?.aborted?'cancelled':'network_failed'});throw new Error(signal?.aborted?'PLANNER_CANCELLED':'PLANNER_UNAVAILABLE');}
    observe({state:'http_response',http_status:response.status});
    if(!response.ok||!response.body)throw new Error('PLANNER_UNAVAILABLE');
    const chunks=[];let size=0;
    try{for await(const chunk of response.body){size+=chunk.length;if(size>32768)throw new Error('PLANNER_RESPONSE_TOO_LARGE');chunks.push(chunk);}}
    catch(error){observe({state:signal?.aborted?'cancelled':'body_failed',response_bytes:size});throw new Error(signal?.aborted?'PLANNER_CANCELLED':error.message==='PLANNER_RESPONSE_TOO_LARGE'?error.message:'PLANNER_UNAVAILABLE');}
    let result;try{result=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new Error('PLANNER_INVALID_RESPONSE');}
    if(!isObject(result)||!Array.isArray(result.choices))throw new Error('PLANNER_INVALID_RESPONSE');
    observe({state:'body_received',response_bytes:size,provider_status_code:Number.isSafeInteger(result.base_resp?.status_code)?result.base_resp.status_code:null,finish_reason:['stop','length','tool_calls'].includes(result.choices?.[0]?.finish_reason)?result.choices[0].finish_reason:'other',prompt_tokens:Number.isSafeInteger(result.usage?.prompt_tokens)?result.usage.prompt_tokens:null,completion_tokens:Number.isSafeInteger(result.usage?.completion_tokens)?result.usage.completion_tokens:null});
    if(result.base_resp?.status_code&&result.base_resp.status_code!==0)throw new Error('PLANNER_UNAVAILABLE');
    if(result.choices?.[0]?.finish_reason!=='stop')throw new Error('PLANNER_INCOMPLETE_OUTPUT');
    const content=result.choices[0].message?.content;
    observe({state:'output_shape',content_bytes:typeof content==='string'?Buffer.byteLength(content):null,json_prefix:typeof content==='string'&&content.trimStart().startsWith('{'),reasoning_present:typeof result.choices[0].message?.reasoning_content==='string'&&result.choices[0].message.reasoning_content.length>0});
    if(typeof content!=='string'||Buffer.byteLength(content)>(kind==='topic_generation'?16000:LIMITS.proposal_bytes))throw new Error('PLANNER_INVALID_JSON');
    let value;try{value=JSON.parse(content);}catch{throw new Error('PLANNER_INVALID_JSON');}
    if(!isObject(value))throw new Error('PLANNER_INVALID_JSON');
    return value;
  }
}
