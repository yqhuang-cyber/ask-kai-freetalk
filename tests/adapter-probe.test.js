import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:http';
import WebSocket,{WebSocketServer} from 'ws';
import {runAdapterProbe} from '../packages/provider-doubao/adapter-probe.js';

const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-connect.profile.json',import.meta.url),'utf8'));
const request=JSON.parse(await readFile(new URL('../.github/live/doubao-adapter-request.json',import.meta.url),'utf8'));
const env={DOUBAO_API_KEY:'synthetic-private-secret',GITHUB_SHA:'b'.repeat(40)};
// Authored protocol peer, not replayed learner/provider content.
async function peer(t,{omitPostCancelUsage=false}={}) {
  const http=createServer(),wss=new WebSocketServer({server:http}),sent=[];
  http.listen(0,'127.0.0.1');await once(http,'listening');
  t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();http.close();http.closeAllConnections();});
  wss.on('connection',(socket,req)=>{
    assert.equal(req.headers['x-api-key'],env.DOUBAO_API_KEY);
    let seq=0,reply=0;
    const wire=raw=>socket.send(JSON.stringify({event_id:`authored-${++seq}`,...raw}));
    const ids=()=>({response_id:`authored-r${reply}`,question_id:`authored-q${reply}`});
    const audio=()=>wire({type:'response.output_audio.delta',delta:Buffer.alloc(60000,1).toString('base64')});
    const usage=()=>wire({type:'response.done',response:{usage:{output_tokens:1}}});
    socket.on('message',bytes=>{
      const raw=JSON.parse(bytes.toString());sent.push(raw);
      if(raw.type==='session.create')wire({type:'session.created',session:{id:'authored-session'}});
      else if(raw.type==='session.update')wire({type:'session.updated',session:{id:'authored-session'}});
      else if(raw.type==='speech_text_buffer.commit'){
        reply++;wire({type:'response.output_audio.started',...ids()});audio();
        if(reply===2)audio();
        else{wire({type:'response.output_audio.done',...ids()});usage();}
      }else if(raw.type==='response.cancel'){
        audio(); // request has been sent: adapter must discard this in-flight chunk
        wire({type:'response.canceled'});
        if(!omitPostCancelUsage)usage();
      }else if(raw.type==='session.close')wire({type:'session.closed'});
    });
  });
  const socketFactory=(url,options)=>{
    assert.equal(url,profile.endpoint);assert.equal(options.maxPayload,131072);
    assert.equal(options.followRedirects,false);return new WebSocket(`ws://127.0.0.1:${http.address().port}`,options);
  };
  return {sent,socketFactory};
}
test('actual adapter probe through local WS covers usage isolation, cancel fencing, resume and graceful ACK',async t=>{
  const x=await peer(t),original=structuredClone(profile);
  const report=await runAdapterProbe({profile,request,env,socketFactory:x.socketFactory,durationMs:2000});
  assert.equal(report.status,'passed');assert.equal(report.session_closed_observed,true);
  assert.deepEqual(report.context_ack_versions,[1,2]);
  assert.deepEqual(report.normalized,{started:3,done:2,cancelled:1});
  assert.equal(report.wire.in_flight_cancel_chunks,1);assert.equal(report.forwarded_cancel_audio_after_request,0);
  assert.equal(report.audio.cancel.chunks,2);assert.equal(report.audio.resume.chunks,1);
  assert.deepEqual(x.sent.map(p=>p.type),['session.create','input_audio_mute.commit','session.update',
    'speech_text_buffer.commit','session.update','speech_text_buffer.commit','response.cancel','speech_text_buffer.commit','session.close']);
  for(const name of ['microphone_uploaded','asr_tested','model_content_quality_evaluated','real_experience_accepted',
    'web_profile_enabled','realtime_reviewed','ordered_acks_reviewed'])assert.equal(report[name],false);
  for(const value of [env.DOUBAO_API_KEY,'authored-session','authored-r','你好','AAAA'])assert.ok(!JSON.stringify(report).includes(value));
  assert.deepEqual(profile,original);
});
test('missing post-cancel terminal times out without inventing a successful resumed reply',async t=>{
  const x=await peer(t,{omitPostCancelUsage:true});
  const report=await runAdapterProbe({profile,request,env,socketFactory:x.socketFactory,durationMs:150});
  assert.equal(report.status,'failed');assert.equal(report.ended,'duration_limit');
  assert.equal(report.cancel_ack_observed,true);assert.equal(report.normalized.started,2);
  assert.equal(report.audio.resume.chunks,0);assert.equal(report.session_closed_observed,true);
});
test('adapter probe missing key or invalid pinned scope cannot create a socket',async()=>{
  const socketFactory=()=>{throw Error('must not connect');};
  assert.equal((await runAdapterProbe({profile,request,socketFactory})).status,'blocked');
  for(const change of [
    {request:{...request,profile_sha256:'0'.repeat(64)}},
    {profile:{...profile,realtime:{...profile.realtime,reviewed:true}}},
    {request:{...request,request_id:'unbounded-private-name'}}
  ])await assert.rejects(runAdapterProbe({profile,request,env,socketFactory,...change}),/INVALID_ADAPTER_REQUEST/);
});
