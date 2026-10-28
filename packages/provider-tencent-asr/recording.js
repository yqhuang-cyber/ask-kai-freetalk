import {createHash,createHmac} from 'node:crypto';
const check=(value,code='TENCENT_ASR_INVALID_RESULT')=>{if(!value)throw new Error(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
export function asrHeaders({secretId,secretKey,action,body,timestamp=Math.floor(Date.now()/1000),region='ap-shanghai'}){
  check(secretId&&secretKey&&['CreateRecTask','DescribeTaskStatus'].includes(action),'TENCENT_ASR_CONFIG_REQUIRED');
  const date=new Date(timestamp*1000).toISOString().slice(0,10),host='asr.tencentcloudapi.com',content='application/json; charset=utf-8',signed='content-type;host';
  const canonical=['POST','/','',`content-type:${content}\nhost:${host}\n`,signed,hash(body)].join('\n'),scope=`${date}/asr/tc3_request`;
  const signing=hmac(hmac(hmac('TC3'+secretKey,date),'asr'),'tc3_request'),signature=createHmac('sha256',signing).update(['TC3-HMAC-SHA256',String(timestamp),scope,hash(canonical)].join('\n')).digest('hex');
  return {'content-type':content,host,'X-TC-Action':action,'X-TC-Version':'2019-06-14','X-TC-Timestamp':String(timestamp),'X-TC-Region':region,authorization:`TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`};
}
export function pcmWav(pcm){
  check(Buffer.isBuffer(pcm)&&pcm.length>0&&pcm.length%2===0,'INVALID_ASR_AUDIO');const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);
}
export function normalizeAsr(data,{durationMs}){
  check(data&&data.Status===2&&Array.isArray(data.ResultDetail)&&data.ResultDetail.length<=1000);
  const sentences=data.ResultDetail.map(s=>{
    check(typeof s.FinalSentence==='string'&&s.FinalSentence.length<=2000&&Number.isInteger(s.StartMs)&&Number.isInteger(s.EndMs)&&s.StartMs>=0&&s.EndMs>s.StartMs&&s.EndMs<=durationMs+100);
    check(Number.isInteger(s.SpeakerId)&&s.SpeakerId>=0&&s.SpeakerId<=20&&Array.isArray(s.Words)&&s.Words.length<=1000);
    const words=s.Words.map(w=>{check(typeof w.Word==='string'&&w.Word.length<=100&&Number.isInteger(w.OffsetStartMs)&&Number.isInteger(w.OffsetEndMs)&&w.OffsetStartMs>=0&&w.OffsetEndMs>w.OffsetStartMs&&s.StartMs+w.OffsetEndMs<=s.EndMs+100);return {text:w.Word,start_ms:s.StartMs+w.OffsetStartMs,end_ms:s.StartMs+w.OffsetEndMs};});
    return {text:s.FinalSentence,start_ms:s.StartMs,end_ms:s.EndMs,speaker_id:s.SpeakerId,words};
  });
  check(sentences.every((s,i)=>!i||s.start_ms>=sentences[i-1].start_ms));
  return {schema_version:'audio-asr-v1',provider:'tencent_asr',engine:data.EngineModelType??null,sentences,identity_verified:false};
}
export class TencentRecordingASR {
  constructor({secretId,secretKey,region='ap-shanghai',engine='16k_zh_en',fetcher=fetch}={}){check(secretId&&secretKey&&['16k_zh_en','16k_zh_en_2.0'].includes(engine)&&/^ap-[a-z]+$/.test(region),'TENCENT_ASR_CONFIG_REQUIRED');Object.assign(this,{secretId,secretKey,region,engine,fetcher});this.provider='tencent_asr';}
  async request(action,body,{signal}={}){
    const current=signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);let response;
    try{response=await this.fetcher('https://asr.tencentcloudapi.com/',{method:'POST',redirect:'error',headers:asrHeaders({...this,action,body}),body,signal:current});}catch{throw new Error(current.aborted?'TENCENT_ASR_TIMEOUT':'TENCENT_ASR_UNAVAILABLE');}
    check(response.ok&&response.body,'TENCENT_ASR_UNAVAILABLE');const chunks=[];let bytes=0;
    for await(const chunk of response.body){bytes+=chunk.length;check(bytes<=2*1024*1024);chunks.push(chunk);}
    let value;try{value=JSON.parse(Buffer.concat(chunks).toString().replace(/("TaskId"\s*:\s*)(\d+)/g,'$1"$2"'));}catch{throw new Error('TENCENT_ASR_INVALID_RESULT');}
    const data=value?.Response,error=data?.Error;
    if(error){const code=String(error.Code);const failure=new Error(/AuthFailure|UnauthorizedOperation/.test(code)?'TENCENT_ASR_AUTH_FAILED':/ResourceUnavailable|ResourceNotFound|FailedOperation.ServiceNotOpened|FailedOperation.UserNotRegistered/.test(code)?'TENCENT_ASR_NOT_ENABLED':/LimitExceeded|RequestLimitExceeded/.test(code)?'TENCENT_ASR_RATE_LIMIT':'TENCENT_ASR_PROVIDER_FAILED');failure.provider_code=/^[A-Za-z.]{1,100}$/.test(code)?code:'Unknown';throw failure;}
    check(data);return data;
  }
  async submit(pcm,{signal,beforeSend=async()=>{}}={}){
    check(pcm.length<=16000*2*30,'INVALID_ASR_AUDIO');await beforeSend();signal?.throwIfAborted();const audio=pcmWav(pcm),data=await this.request('CreateRecTask',JSON.stringify({EngineModelType:this.engine,ChannelNum:1,ResTextFormat:1,SourceType:1,Data:audio.toString('base64'),DataLen:audio.length,SpeakerDiarization:1,FilterModal:0,FilterPunc:0,ConvertNumMode:0}),{signal});
    const task_id=data.Data?.TaskId;check(typeof task_id==='string'&&/^\d{1,20}$/.test(task_id));return {task_id,engine:this.engine};
  }
  async poll(taskId,{signal,durationMs}={}){
    check(typeof taskId==='string'&&/^\d{1,20}$/.test(taskId));const data=(await this.request('DescribeTaskStatus',`{"TaskId":${taskId}}`,{signal})).Data;
    check(data&&[0,1,2,3].includes(data.Status));if(data.Status===3)throw new Error('TENCENT_ASR_TASK_FAILED');if(data.Status!==2)return {state:'waiting'};
    return {state:'complete',result:normalizeAsr({...data,EngineModelType:this.engine},{durationMs})};
  }
}
