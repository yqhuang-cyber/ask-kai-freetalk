import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runOutputProbe,OUTPUT_PROBE_TEXT} from '../packages/provider-doubao/output-probe.js';
const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-connect.profile.json',import.meta.url),'utf8'));
const request=JSON.parse(await readFile(new URL('../.github/live/doubao-output-request.json',import.meta.url),'utf8'));
const pcm=Buffer.from([1,0,2,0]).toString('base64');
class Peer extends EventTarget {
  sent=[];closed=false;completeId=true;badUpdate=false;badAudio=false;badCancel=false;
  constructor(options={}){super();Object.assign(this,options);setTimeout(()=>this.dispatchEvent(new Event('open')),0);}
  message(raw){setTimeout(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(raw)})),0);}
  send(value){
    const raw=JSON.parse(value);this.sent.push(raw);
    if(raw.type==='session.create')this.message({type:'session.created',session:{id:'private-session'},event_id:'private-created'});
    if(raw.type==='session.update')this.message({type:'session.updated',session:{id:this.badUpdate?'foreign':'private-session'},event_id:raw.event_id});
    if(raw.type==='speech_text_buffer.commit'&&raw.text===OUTPUT_PROBE_TEXT.complete){
      this.message({type:'response.output_text.delta',response_id:'private-r1',delta:'private model text'});
      this.message({type:'response.output_audio.delta',response_id:'private-r1',delta:this.badAudio?'malformed base64':pcm});
      this.message({type:'response.output_audio.done',response_id:'private-r1'});
      this.message({type:'response.done',...(this.completeId?{response_id:'private-r1'}:{})});
    }
    if(raw.type==='speech_text_buffer.commit'&&raw.text===OUTPUT_PROBE_TEXT.cancel){
      this.message({type:'response.output_audio.delta',response_id:'private-r2',delta:pcm});
      this.message({type:'response.output_audio.delta',response_id:'private-r2',delta:pcm});
    }
    if(raw.type==='response.cancel')this.message({type:'response.canceled',event_id:raw.event_id,response_id:this.badCancel?'foreign':'private-r2'});
    if(raw.type==='session.close')this.message({type:'session.closed',session:{id:'private-session'}});
  }
  close(){this.closed=true;}
}
async function simulated(options={}){
  const socket=new Peer(options);
  const report=await runOutputProbe({profile,request,env:{DOUBAO_API_KEY:'synthetic-secret-only'},durationMs:500,socketFactory:(url,settings)=>{
    assert.equal(url,profile.endpoint);assert.equal(settings.followRedirects,false);assert.equal(settings.headers['X-Api-Key'],'synthetic-secret-only');return socket;
  }});
  return {socket,report};
}
test('fixed synthetic peer verifies serial update/full output/cancel/close without accepting Web',async()=>{
  const {socket,report}=await simulated();
  assert.equal(report.status,'passed');assert.equal(report.session_closed_observed,true);
  assert.equal(report.update_ack_shape.client_event_id_echo,true);assert.equal(report.cancel_ack_shape.response_matches,true);
  assert.equal(report.audio.complete.bytes,4);assert.equal(report.audio.cancel.bytes,8);
  assert.equal(report.provider_connected,false);assert.equal(socket.closed,true);
  assert.deepEqual(socket.sent.map(s=>s.type),['session.create','input_audio_mute.commit','session.update','speech_text_buffer.commit',
    'speech_text_buffer.commit','response.cancel','session.close']);
  assert.equal(socket.sent[3].text,OUTPUT_PROBE_TEXT.complete);
  for(const name of ['microphone_uploaded','asr_tested','model_content_quality_evaluated','real_experience_accepted','realtime_reviewed','ordered_acks_reviewed'])assert.equal(report[name],false);
  for(const value of ['private-session','private-r1','private-r2','private-created','private model text','synthetic-secret-only',pcm])assert.ok(!JSON.stringify(report).includes(value));
});
test('terminal ID omission remains visible evidence and never grants runtime review',async()=>{
  const {report}=await simulated({completeId:false});
  assert.equal(report.status,'passed');assert.equal(report.terminal_shapes[0].response_id_present,false);
  assert.equal(report.realtime_reviewed,false);assert.equal(report.ordered_acks_reviewed,false);
});
test('foreign ACKs and invalid audio fail, then wait for the session close ACK',async()=>{
  for(const [options,reason]of [[{badUpdate:true},'foreign_update_ack'],[{badCancel:true},'foreign_cancel_ack'],[{badAudio:true},'invalid_audio']]){
    const {report}=await simulated(options);assert.equal(report.status,'failed');assert.equal(report.ended,reason);
    assert.equal(report.session_closed_observed,true);
  }
});
test('unapproved profile, missing credentials, request mismatch and abort cannot open a socket',async()=>{
  let calls=0;const socketFactory=()=>{calls++;throw Error('unexpected network');};
  for(const change of [{env:{}},{request:{...request,profile_sha256:'0'.repeat(64)}},{profile:{...profile,realtime:{...profile.realtime,reviewed:true}}}]){
    await assert.rejects(runOutputProbe({profile,request,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory,...change}));
  }
  const controller=new AbortController();controller.abort();
  const report=await runOutputProbe({profile,request,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory,signal:controller.signal});
  assert.equal(report.ended,'aborted');assert.equal(calls,0);
});

test('large JSON PCM envelope is bounded separately from decoded bytes; transport reasons are masked',async()=>{
  class LargePeer extends Peer{
    send(value){
      if(JSON.parse(value).type==='speech_text_buffer.commit'&&JSON.parse(value).text===OUTPUT_PROBE_TEXT.complete){
        this.sent.push(JSON.parse(value));
        this.message({type:'response.output_audio.started',response_id:'private-r1'});
        this.message({type:'response.output_audio.delta',delta:Buffer.alloc(60000,1).toString('base64')});
        this.message({type:'response.done',response:{id:'private-r1',usage:{total_tokens:1}}});
        return;
      }
      if(JSON.parse(value).type==='speech_text_buffer.commit'&&JSON.parse(value).text===OUTPUT_PROBE_TEXT.cancel){
        this.message({type:'response.output_audio.started',response_id:'private-r2'});
        this.message({type:'response.output_audio.delta',delta:pcm});
        this.message({type:'response.output_audio.delta',delta:pcm});
        return;
      }
      super.send(value);
    }
  }
  const socket=new LargePeer();
  const report=await runOutputProbe({profile,request,env:{DOUBAO_API_KEY:'synthetic-only'},durationMs:500,socketFactory:(_url,options)=>{
    assert.equal(options.maxPayload,131072);return socket;
  }});
  assert.equal(report.status,'passed');assert.equal(report.audio.complete.bytes,60000);
  assert.equal(report.terminal_shapes[0].nested_id_matches,true);
  assert.deepEqual(report.terminal_shapes[0].response_keys,['id','usage']);
  assert.equal(report.cancel_ack_shape.response_matches,true);
  const errorSocket=new Peer();
  const failed=runOutputProbe({profile,request,env:{DOUBAO_API_KEY:'synthetic-only'},durationMs:500,socketFactory:()=>errorSocket});
  const event=new Event('error');event.error={code:'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',message:'private secret failure'};
  errorSocket.dispatchEvent(event);
  const errorReport=await failed;
  assert.equal(errorReport.transport_code,'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH');
  assert.ok(!JSON.stringify(errorReport).includes('private secret failure'));
});
