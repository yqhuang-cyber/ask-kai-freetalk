import { AssistantMessageEventStream,getCurrentTools } from '@earendil-works/pi-ai';

const EMPTY_USAGE={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const KNOWN=new Set(['PLANNER_CANCELLED','PLANNER_UNAVAILABLE','PLANNER_INVALID_JSON','PLANNER_INVALID_RESPONSE','PLANNER_INCOMPLETE_OUTPUT','PLANNER_RESPONSE_TOO_LARGE','PLANNER_INPUT_TOO_LARGE']);

function textOf(content) {
  if(typeof content==='string')return content;
  if(!Array.isArray(content))return '';
  return content.filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>block.text).join('\n');
}
function assistantMessage(model,{content,stopReason,errorMessage}) {
  return {role:'assistant',content,api:model.api,provider:model.provider,model:model.id,usage:EMPTY_USAGE,stopReason,...(errorMessage?{errorMessage}:{}),timestamp:Date.now()};
}
export function minimaxToolStream(transport,kind) {
  return (model,context,options={})=>{
    const stream=new AssistantMessageEventStream();
    const fail=(stopReason,errorMessage)=>{
      const message=assistantMessage(model,{content:[],stopReason,errorMessage});
      stream.push({type:'error',reason:stopReason,error:message});
      return stream;
    };
    const signal=options.signal;
    if(signal?.aborted)return fail('aborted','PLANNER_CANCELLED');
    const tools=getCurrentTools(context.messages??[]);
    const tool=tools.length===1?tools[0]:null;
    if(!tool)return fail('error','PLANNER_UNAVAILABLE');
    const messages=[];
    for(const message of context.messages??[]) {
      if(message.role==='system'){const content=textOf(message.content);if(content)messages.push({role:'system',content});}
      else if(message.role==='user')messages.push({role:'user',content:textOf(message.content)});
    }
    Promise.resolve(transport.completeTool({kind,messages,tool,signal})).then(call=>{
      if(signal?.aborted){fail('aborted','PLANNER_CANCELLED');return;}
      const message=assistantMessage(model,{content:[{type:'toolCall',id:call.id,name:call.name,arguments:call.arguments}],stopReason:'toolUse'});
      stream.push({type:'done',reason:'toolUse',message});
    }).catch(error=>{
      const code=KNOWN.has(error?.message)?error.message:'PLANNER_UNAVAILABLE';
      fail(signal?.aborted||code==='PLANNER_CANCELLED'?'aborted':'error',signal?.aborted?'PLANNER_CANCELLED':code);
    });
    return stream;
  };
}
