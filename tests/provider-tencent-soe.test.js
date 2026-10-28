import test from 'node:test';import assert from 'node:assert/strict';import {createHash,createHmac} from 'node:crypto';import {once} from 'node:events';import {WebSocketServer,WebSocket} from 'ws';
import {TencentAudioAssessmentPort,signedAssessmentURL,normalizeAssessment,validateAudioAssessment,audioEligibility} from '../packages/provider-tencent-soe/assessment.js';
const pcm=Buffer.alloc(3200,100),segment={id:'synthetic-audio',sha256:createHash('sha256').update(pcm).digest('hex'),stream_id:'synthetic-stream',sample_start:16000,sample_end:17600,sample_rate:16000,channels:1,encoding:'pcm_s16le',speaker:'learner_verified',quality:{noise:'not_detected',clipping:'not_detected',missing_frames:'not_detected',overlap:'not_detected'},alignment:null};
const raw={PronAccuracy:80,PronFluency:0.8,Words:[{Word:'我',MemBeginTime:0,MemEndTime:80,PronAccuracy:80,PronFluency:0.8,PhoneInfos:[{Phone:'w',MemBeginTime:0,MemEndTime:20,PronAccuracy:75}],Tone:{Valid:false,RefTone:-1,HypothesisTone:-1}}]};
async function providerFixture(t,{recording=true,action}={}){
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');t.after(()=>new Promise(resolve=>{for(const client of server.clients)client.terminate();server.close(resolve);}));const seen=[];
  server.on('connection',(socket,req)=>{const params=new URL(req.url,'http://localhost').searchParams,voice_id=params.get('voice_id');if(action)return action(socket,voice_id,seen);
    socket.send(JSON.stringify({code:0,message:'success',voice_id}));socket.on('message',(data,binary)=>{seen.push({binary,bytes:data.length,at:Date.now()});if(!binary&&JSON.parse(data).type==='end')socket.send(JSON.stringify({code:0,voice_id,final:1,result:raw}));});
  });
  const port=new TencentAudioAssessmentPort({appId:'123456',secretId:'synthetic-secret-id',secretKey:'synthetic-secret-key',recording,timeoutMs:150,socketFactory:url=>{const parsed=new URL(url);assert.equal(parsed.protocol,'wss:');assert.equal(parsed.hostname,'soe.cloud.tencent.com');assert.equal(parsed.searchParams.get('voice_format'),'0');return new WebSocket(`ws://127.0.0.1:${server.address().port}${parsed.pathname}${parsed.search}`);}});
  return {port,seen};
}
test('Tencent v2 signing sorts unescaped UTF-8 values before HMAC and encodes the final query once',()=>{
  const url=new URL(signedAssessmentURL({appId:'123',secretId:'test-id',secretKey:'test-key',voiceId:'synthetic-voice',mode:1,reference:'我是谁 +',timestamp:1000,nonce:17}));
  const canonical='soe.cloud.tencent.com/soe/api/123?eval_mode=1&expired=1300&nonce=17&rec_mode=1&ref_text=我是谁 +&score_coeff=1&secretid=test-id&sentence_info_enabled=0&server_engine_type=16k_zh&text_mode=0&timestamp=1000&voice_format=0&voice_id=synthetic-voice';
  assert.equal(url.searchParams.get('signature'),createHmac('sha1','test-key').update(canonical).digest('base64'));assert.equal(url.searchParams.get('ref_text'),'我是谁 +');
});
test('recording mode waits for authenticated handshake, sends PCM once, then requires a final result',async t=>{
  const {port,seen}=await providerFixture(t);const result=await port.assess({segment,pcm_base64:pcm.toString('base64')});assert.deepEqual(seen.map(s=>s.binary),[true,false]);assert.equal(seen[0].bytes,pcm.length);assert.equal(result.mode,3);assert.equal(result.words[0].tone,null);assert.deepEqual(result.words[0].phones,[]);assert.equal(validateAudioAssessment(result,segment),result);
});
test('offline streaming uses 40ms packets instead of dumping the file',async t=>{
  const {port,seen}=await providerFixture(t,{recording:false});port.timeoutMs=1000;await port.assess({segment,pcm_base64:pcm.toString('base64')});const frames=seen.filter(s=>s.binary);assert.deepEqual(frames.map(s=>s.bytes),[1280,1280,640]);assert.ok(frames[1].at-frames[0].at>=30);assert.ok(frames[2].at-frames[1].at>=30);
});
test('invalid scores, missing timings and free-speech tones remain unknown rather than invented diagnostics',()=>{
  const result=normalizeAssessment({...raw,PronAccuracy:-1,Words:[{...raw.Words[0],MemBeginTime:-1,MemEndTime:-1,Tone:{Valid:true,RefTone:1,HypothesisTone:4}}]},{segment});assert.equal(result.accuracy,null);assert.equal(result.words[0].range,null);assert.equal(result.words[0].tone,null);
  assert.throws(()=>normalizeAssessment({PronAccuracy:-1,Words:[]},{segment}),/EMPTY/);
});
test('unverified speakers, quality, references and changed bytes prevent all outbound connections',async()=>{
  let opened=0;const port=new TencentAudioAssessmentPort({socketFactory:()=>{opened++;throw new Error('should not connect');}});
  for(const bad of [{...segment,speaker:'unknown'},{...segment,quality:{...segment.quality,noise:'unknown'}},{...segment,sha256:'0'.repeat(64)}])await assert.rejects(port.assess({segment:bad,pcm_base64:pcm.toString('base64')}),/ELIGIBLE|SOURCE_CHANGED/);
  await assert.rejects(port.assess({segment,pcm_base64:pcm.toString('base64'),mode:1,reference:{text:'可能听错的ASR',verified:false}}),/REFERENCE/);assert.equal(opened,0);assert.equal(audioEligibility({...segment,speaker:'unknown'}).reason,'speaker_unverified');
});
test('wrong voice, service errors, empty final, disconnect and timeout produce sanitized failures',async t=>{
  const cases=[['TENCENT_WRONG_RESPONSE',(ws,id)=>ws.send(JSON.stringify({code:0,voice_id:'another'}))],['TENCENT_SERVICE_DISABLED',(ws,id)=>ws.send(JSON.stringify({code:4003,voice_id:id,message:'raw private provider message'}))],['TENCENT_INVALID_RESULT',(ws,id)=>{ws.send(JSON.stringify({code:0,voice_id:id}));ws.on('message',(_,binary)=>{if(!binary)ws.send(JSON.stringify({code:0,voice_id:id,final:1}));});}],['TENCENT_CONNECTION_LOST',ws=>ws.close()],['TENCENT_TIMEOUT',()=>{}]];
  for(const [code,action] of cases){await t.test(code,async sub=>{const {port}=await providerFixture(sub,{action});await assert.rejects(port.assess({segment,pcm_base64:pcm.toString('base64')}),e=>e.message===code);});}
});
test('cancellation closes the socket and authorizing before transmission can stop the entire call',async t=>{
  const {port}=await providerFixture(t,{action:()=>{}}),controller=new AbortController();const promise=port.assess({segment,pcm_base64:pcm.toString('base64')},{signal:controller.signal});setTimeout(()=>controller.abort(),15);await assert.rejects(promise,/CANCELLED/);
  let opened=0;port.socketFactory=()=>{opened++;throw new Error('forbidden');};await assert.rejects(port.assess({segment,pcm_base64:pcm.toString('base64')},{beforeSend:()=>{throw new Error('RECORD_AUTHORIZATION_REVOKED');}}),/RECORD_AUTHORIZATION/);assert.equal(opened,0);
});
test('sentence tone and phoneme candidates require an independently verified sealed reference',async t=>{
  const reference={text:'我',verified:true,basis:'author_verified',version:'synthetic-reference-v1'},verified={...segment,alignment:{basis:'author_verified',reference_text_verified:true,reference}};
  const result=normalizeAssessment({...raw,Words:[{...raw.Words[0],Tone:{Valid:true,RefTone:3,HypothesisTone:4}}]},{segment:verified,mode:1,reference});assert.deepEqual(result.words[0].tone,{reference:3,hypothesis:4});assert.equal(result.words[0].phones.length,1);assert.equal(validateAudioAssessment(result,verified),result);assert.throws(()=>validateAudioAssessment(result,segment),/REFERENCE/);
  const {port}=await providerFixture(t);await assert.rejects(port.assess({segment,pcm_base64:pcm.toString('base64'),mode:1,reference}),/REFERENCE/);
});
test('revocation between opening the socket and sending PCM stops all audio transmission',async t=>{
  const {port,seen}=await providerFixture(t);let authorizations=0;await assert.rejects(port.assess({segment,pcm_base64:pcm.toString('base64')},{beforeSend:async()=>{if(++authorizations===2)throw new Error('RECORD_AUTHORIZATION_REVOKED');}}),/RECORD_AUTHORIZATION_REVOKED/);assert.equal(seen.length,0);
});

test('a validated result followed by a separate final marker completes, while different sentence results are not silently dropped',async t=>{
  const action=(different=false)=>(ws,id)=>{ws.send(JSON.stringify({code:0,voice_id:id}));ws.on('message',(_,binary)=>{if(binary)return;ws.send(JSON.stringify({code:0,voice_id:id,result:{...raw,SentenceId:0}}));if(different)ws.send(JSON.stringify({code:0,voice_id:id,result:{...raw,SentenceId:1}}));ws.send(JSON.stringify({code:0,voice_id:id,final:1}));});};
  const good=await providerFixture(t,{action:action()});const result=await good.port.assess({segment,pcm_base64:pcm.toString('base64')});assert.equal(result.words[0].word,'我');
  const ambiguous=await providerFixture(t,{action:action(true)});await assert.rejects(ambiguous.port.assess({segment,pcm_base64:pcm.toString('base64')}),/MULTIPLE_SENTENCES/);
});
