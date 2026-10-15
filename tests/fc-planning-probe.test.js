import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { runFcPlanningProbe } from '../packages/provider-doubao/fc-planning-probe.js';
import { validateSeeduplexProfile } from '../packages/provider-doubao/seeduplex.js';
const template=JSON.parse(await readFile('docs/protocol/seeduplex-profile.template.json'));
const profile=()=>({...structuredClone(template),reviewed:true,realtime:{...template.realtime,reviewed:true,ordered_acks_reviewed:true}});
const pcm=Buffer.alloc(640,1),manifest={source:'local_os_authored_speech',pcm_sha256:createHash('sha256').update(pcm).digest('hex'),sample_rate:16000,channels:1};
const plan={proposal_id:'accepted-plan',hash:'a'.repeat(64),planner_kind:'llm',action:'RESPOND',reply_directive:{task:'fixture',new_points:0}};
async function probe({early=false,waiting=false,newInput=false,duplicate=false,expired=false,fail=false,noTool=false,expireDuringHold=false}={}) {
  const sent=[];let socket,first=true;
  const run=runFcPlanningProbe({profile:profile(),pcm,manifest,env:{DOUBAO_API_KEY:'synthetic-key'},holdMs:expireDuringHold?100:60,durationMs:400,planTurn:async()=>{await new Promise(r=>setTimeout(r,30));if(fail)throw new Error('PRIVATE_ERROR');return {...plan,expires_at:Date.now()+(expired?-1:expireDuringHold?30:1000)};},socketFactory:()=> {
    socket=new EventEmitter();socket.addEventListener=socket.on.bind(socket);socket.close=()=>{};
    const wire=raw=>socket.emit('message',{data:JSON.stringify(raw)});
    socket.send=bytes=>{
      const raw=JSON.parse(bytes);sent.push(raw);
      if(raw.type==='session.create')queueMicrotask(()=>wire({type:'session.created',session:{id:'private-session'}}));
      if(raw.type==='input_audio_buffer.append'&&first) {
        first=false;wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-input',text:'SYNTHETIC_PRIVATE_TEXT'});
        if(early)wire({type:'response.output_text.delta',response_id:'private-reply',delta:'PRIVATE_OUTPUT'});
        if(!noTool)wire({type:'response.function_call_arguments.done',items:[{call_id:'private-call',name:'plan_next_turn',arguments:'{"intent":"fixture"}'}]});
        if(waiting)wire({type:'response.output_audio.started',response_id:'private-reply'});
        if(newInput)setTimeout(()=>wire({type:'conversation.item.input_audio_transcription.completed',item_id:'new-private-input',text:'NEW_PRIVATE_TEXT'}),10);
        if(duplicate)wire({type:'response.function_call_arguments.done',items:[]});
      }
      if(raw.type==='conversation.item.create')queueMicrotask(()=>wire({type:'response.output_audio.done',response_id:'private-reply'}));
      if(raw.type==='session.close')queueMicrotask(()=>wire({type:'session.closed'}));
    };
    queueMicrotask(()=>socket.emit('open'));return socket;
  }});
  const report=await run;return {report,sent};
}
test('FC sample orders accepted plan before a call_id-bound result while continuous input persists',async()=> {
  const {report,sent}=await probe();assert.equal(report.status,'sample_order_observed');assert.equal(report.plan_accepted,true);assert.equal(report.tool_results_sent,1);assert.ok(report.input_frames_while_waiting>=1);
  const result=sent.find(e=>e.type==='conversation.item.create');assert.equal(result.items[0].call_id,'private-call');assert.equal(result.items[0].role,'tool');assert.equal(result.items[0].content[0].type,'input_text');
  assert.equal(report.current_turn_generation_gate_verified,false);assert.equal(report.mandatory_tool_api_verified,false);
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));assert.ok(!JSON.stringify(report).includes('private-call'));
  const names=report.timeline.map(x=>x.name);assert.ok(names.indexOf('plan_accepted')<names.indexOf('tool_result_sent'));
  assert.throws(()=>validateSeeduplexProfile({...profile(),session_create:sent[0]}),/UNREVIEWED/);
});
test('output before a tool or while awaiting its result is evidence of an uncontrolled sample',async()=> {
  for(const options of [{early:true},{waiting:true}])assert.equal((await probe(options)).report.status,'uncontrolled_output_observed');
});
test('new input and duplicate calls fence late plans and prevent old result delivery',async()=> {
  for(const options of [{newInput:true},{duplicate:true}]) {
    const {report,sent}=await probe(options);assert.equal(report.plan_accepted,false);assert.equal(report.tool_results_sent,0);assert.ok(!sent.some(e=>e.type==='conversation.item.create'));
  }
});
test('FC probes require reviewed source profile, fixed PCM provenance and bounded input',async()=> {
  await assert.rejects(runFcPlanningProbe({profile:template,pcm,manifest,planTurn:async()=>plan}));
  await assert.rejects(runFcPlanningProbe({profile:profile(),pcm,manifest:{...manifest,source:'unknown'},planTurn:async()=>plan}));
});
test('missing tools, planner failure and expired plans never produce a fabricated tool result',async()=> {
  for(const options of [{noTool:true},{fail:true},{expired:true},{expireDuringHold:true}]) {
    const {report,sent}=await probe(options);assert.equal(report.tool_results_sent,0);assert.ok(!sent.some(e=>e.type==='conversation.item.create'));assert.equal(report.status,'incomplete');
    if(options.expireDuringHold){assert.equal(report.plan_accepted,true);assert.equal(report.ended,'plan_expired_before_result');}
  }
});
