import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {encodeAsr,decodeAsr,asrRequest,bridgeGate} from '../scripts/thai-support-spike/asr-s2s/protocol.js';
import {readAsrConfig,asrPreflight} from '../scripts/thai-support-spike/asr-s2s/config.js';

const frame=(text,{last=true,gzip=true,sequence=true}={})=>{
  const payload=Buffer.from(JSON.stringify({result:{text}})),body=gzip?gzipSync(payload):payload;
  const metadata=Buffer.alloc(sequence?8:4);if(sequence)metadata.writeInt32BE(last?-3:3,0);metadata.writeUInt32BE(body.length,sequence?4:0);
  return Buffer.concat([Buffer.from([0x11,0x90|(last?2:0)|(sequence?1:0),0x10|(gzip?1:0),0]),metadata,body]);
};
test('Thai ASR final supports documented compressed/sequence variants and preserves Unicode',()=>{
  for(const gzip of [false,true])for(const sequence of [false,true]){
    const final=decodeAsr(frame('ฉันชอบดนตรี 中文',{gzip,sequence}));assert.equal(final.final,true);assert.equal(final.text,'ฉันชอบดนตรี 中文');
    assert.equal(decodeAsr(frame('ฉัน',{last:false,gzip,sequence})).final,false);
  }
});
test('truncated, trailing, unsupported and oversized ASR frames cannot become a final',()=>{
  const valid=frame('สวัสดี');
  for(const bad of [Buffer.alloc(0),valid.subarray(0,7),valid.subarray(0,-1),Buffer.concat([valid,Buffer.alloc(1)]),Buffer.alloc(600000)])assert.throws(()=>decodeAsr(bad));
  const wrong=Buffer.from(valid);wrong[2]=0x12;assert.throws(()=>decodeAsr(wrong));
  assert.throws(()=>decodeAsr(frame('a'.repeat(600000))));
});
test('ASR error frames discard raw error text and never yield learner input',()=>{
  const secret='sensitive_error_content',body=Buffer.from(secret),meta=Buffer.alloc(8);meta.writeUInt32BE(45000001);meta.writeUInt32BE(body.length,4);
  const result=decodeAsr(Buffer.concat([Buffer.from([0x11,0xf0,0,0]),meta,body]));
  assert.deepEqual(result,{error:true,code:45000001,final:false,text:''});assert.equal(JSON.stringify(result).includes(secret),false);
});
test('ASR multilingual requests use explicit fixed or auto modes and the documented last flag',()=>{
  assert.equal(asrRequest({auto:true}).request.enable_auto_lang,true);assert.equal(asrRequest({auto:true}).audio.language,undefined);
  assert.equal(asrRequest({language:'th-TH'}).audio.language,'th-TH');assert.throws(()=>asrRequest({language:'th-TH',auto:true}));
  assert.equal(encodeAsr('audio',Buffer.alloc(640),{last:true})[1],0x22);
});
test('bridge acceptance rejects history ACK, recitation, substituted text and synthetic-only success',()=>{
  const good={source:'real_asr_final',asrFinal:true,asrText:'สามบวกห้าเท่ากับเท่าไร',sentText:'สามบวกห้าเท่ากับเท่าไร',responseComplete:true,audioBytes:100,audioNonSilent:true,echo:false,semanticReviewed:true};
  assert.equal(bridgeGate(good),true);
  for(const change of [{source:'authored_text'},{asrFinal:false},{sentText:'三加五等于几'},{responseComplete:false},{audioBytes:0},{audioNonSilent:false},{echo:true},{semanticReviewed:false}])assert.equal(bridgeGate({...good,...change}),false);
});
test('ASR preflight distinguishes credentials from permission without disclosing a key',()=>{
  const key='private-asr-test-value',existing='private-s2s-test-value';
  const env={DOUBAO_ASR_API_KEY:key,DOUBAO_API_KEY:existing,DOUBAO_ASR_RESOURCE_ID:'volc.seedasr.sauc.concurrent'};
  const result=asrPreflight(env),serialized=JSON.stringify(result);
  assert.equal(result.configured,true);assert.equal(result.credential_variable,'DOUBAO_ASR_API_KEY');assert.equal(result.permission_verified,false);assert.equal(result.network_called,false);
  assert.equal(serialized.includes(key),false);assert.equal(serialized.includes(existing),false);
  assert.equal(readAsrConfig(env).credential,key);assert.equal(readAsrConfig(env).resource,'volc.seedasr.sauc.concurrent');
  assert.equal(asrPreflight({DOUBAO_API_KEY:existing}).credential_variable,'DOUBAO_API_KEY');assert.equal(asrPreflight({}).configured,false);
  // Explicit invalid dedicated credentials must not silently use the S2S key.
  for(const invalid of ['',key+'\n']){
    const failed=asrPreflight({...env,DOUBAO_ASR_API_KEY:invalid});assert.equal(failed.configured,false);assert.equal(failed.error_code,'INVALID_ASR_CREDENTIAL');assert.equal(JSON.stringify(failed).includes(key),false);
  }
  assert.equal(asrPreflight({...env,DOUBAO_ASR_RESOURCE_ID:'unknown'}).error_code,'INVALID_ASR_RESOURCE');
});
