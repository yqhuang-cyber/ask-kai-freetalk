import test from 'node:test';import assert from 'node:assert/strict';
import {TencentRecordingASR,normalizeAsr,pcmWav} from '../packages/provider-tencent-asr/recording.js';
const opts={secretId:'synthetic-id',secretKey:'synthetic-secret'};
const complete={Status:2,ResultDetail:[{FinalSentence:'我要面条',StartMs:200,EndMs:900,SpeakerId:0,Words:[{Word:'面条',OffsetStartMs:300,OffsetEndMs:600}]}]};
test('recording ASR sends original WAV with diarization and preserves 64-bit task IDs exactly',async()=>{
 const requests=[],port=new TencentRecordingASR({...opts,fetcher:async(url,options)=>{assert.equal(url,'https://asr.tencentcloudapi.com/');assert.match(options.headers.authorization,/^TC3-HMAC-SHA256/);requests.push(options);return new Response(requests.length===1?'{"Response":{"Data":{"TaskId":12345678901234567890}}}':JSON.stringify({Response:{Data:complete}}));}}),pcm=Buffer.alloc(32000);let authorized=false;
 const task=await port.submit(pcm,{beforeSend:async()=>{authorized=true;}});assert.equal(authorized,true);assert.equal(task.task_id,'12345678901234567890');const body=JSON.parse(requests[0].body);assert.equal(body.SpeakerDiarization,1);assert.equal(body.ResTextFormat,1);assert.equal(body.FilterModal,0);assert.equal(body.DataLen,32044);assert.deepEqual(Buffer.from(body.Data,'base64').subarray(44),pcm);
 const result=await port.poll(task.task_id,{durationMs:1000});assert.equal(requests[1].body,'{"TaskId":12345678901234567890}');assert.equal(result.result.sentences[0].words[0].start_ms,500);assert.equal(result.result.identity_verified,false);
});
test('ASR errors are redacted and separate not-opened service from authentication and task failure',async()=>{
 for(const [code,expected] of [['FailedOperation.UserNotRegistered','NOT_ENABLED'],['AuthFailure.SignatureFailure','AUTH_FAILED'],['RequestLimitExceeded','RATE_LIMIT']]){const port=new TencentRecordingASR({...opts,fetcher:async()=>new Response(JSON.stringify({Response:{Error:{Code:code,Message:'private provider trace must not escape'}}}))});await assert.rejects(port.submit(Buffer.alloc(32000)),error=>error.message==='TENCENT_ASR_'+expected&&!error.message.includes('private'));}
 const port=new TencentRecordingASR({...opts,fetcher:async()=>new Response(JSON.stringify({Response:{Data:{Status:3}}}))});await assert.rejects(port.poll('12',{durationMs:1000}),/TASK_FAILED/);
});
test('unauthorized and oversized uploads are blocked before network use; malformed timing never becomes evidence',async()=>{
 let sent=0;const port=new TencentRecordingASR({...opts,fetcher:async()=>{sent++;throw Error('must not send');}});await assert.rejects(port.submit(Buffer.alloc(32000),{beforeSend:async()=>{throw Error('RECORD_NOT_AUTHORIZED');}}),/RECORD_NOT_AUTHORIZED/);await assert.rejects(port.submit(Buffer.alloc(960002)),/INVALID_ASR_AUDIO/);assert.equal(sent,0);
 assert.throws(()=>normalizeAsr({...complete,ResultDetail:[{...complete.ResultDetail[0],EndMs:5000}]},{durationMs:1000}),/INVALID_RESULT/);assert.throws(()=>pcmWav(Buffer.alloc(3)),/INVALID_ASR_AUDIO/);
});
