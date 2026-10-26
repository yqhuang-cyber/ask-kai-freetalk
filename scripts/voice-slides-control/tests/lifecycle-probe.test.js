import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {runSlidesLifecycleProbe} from '../lifecycle-probe.js';
import {SLIDES_CASES} from '../cases.js';
import {SLIDES_CONTROL_CASES} from '../control-cases.js';
const template=JSON.parse(await readFile('docs/protocol/seeduplex-profile.template.json'));
const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(mode,{sourceEvidence=mode.startsWith('source-'),epochCapabilities=mode.startsWith('epoch-')}={}){
  const second=mode==='epoch-add-explicit'?'add-previous':['source-repeat','epoch-repeat'].includes(mode)?'previous':['source-delayed-old','epoch-resume','epoch-delayed-old'].includes(mode)?'revoke-review':mode==='scope-update'?'forward-already-shown':mode.startsWith('control-revoke')?'revoke-review':mode.startsWith('control-correct')?'correct-first':'first-from-two';
  const ids=[mode==='scope-update'?'goto-one':sourceEvidence||epochCapabilities?'previous':'recent',second,...(['epoch-resume','epoch-delayed-old'].includes(mode)?['previous']:[])];
  const inputs=ids.map((name,index)=>{
    const testCase=[...SLIDES_CASES,...SLIDES_CONTROL_CASES].find(item=>item.id===name),pcm=Buffer.alloc(640,index+1);
    return {pcm,testCase,manifest:{source:'local_os_authored_speech',sample_rate:16000,channels:1,pcm_sha256:hash(pcm),script_sha256:hash(testCase.text)}};
  });
  const sent=[];
  const report=await runSlidesLifecycleProbe({profile:{...structuredClone(template),reviewed:true,realtime:{...template.realtime,reviewed:true,ordered_acks_reviewed:true}},inputs,mode,sourceEvidence,epochCapabilities,env:{DOUBAO_API_KEY:'synthetic'},holdMs:10,socketFactory:()=>{
    const socket=new EventEmitter();socket.addEventListener=socket.on.bind(socket);socket.close=()=>{};
    const seen=new Set(),wire=raw=>socket.emit('message',{data:JSON.stringify(raw)});let registered=[];
    const reply=owner=>{
      wire({type:'response.output_audio.started',response_id:'private-reply-'+owner,question_id:'private-input-'+owner});
      wire({type:'response.output_text.done',response_id:'private-reply-'+owner,question_id:'private-input-'+owner,text:'PRIVATE_AUTHORED_REPLY'});
      wire({type:'response.output_audio.done',response_id:'private-reply-'+owner,question_id:'private-input-'+owner});
    };
    socket.send=bytes=>{
      const raw=JSON.parse(bytes);sent.push(raw);
      if(raw.type==='session.create'){registered=raw.session.tools;queueMicrotask(()=>wire({type:'session.created',session:{id:'private-session'}}));}
      if(raw.type==='input_audio_buffer.append'){
        const number=Buffer.from(raw.audio,'base64')[0];
        if(number&&number<=inputs.length&&!seen.has(number)){
          seen.add(number);const owner=number-1;
          wire({type:'conversation.item.input_audio_transcription.started',item_id:'private-input-'+owner});
          queueMicrotask(()=>{
            wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-input-'+owner,text:inputs[owner].testCase.text});
            const revoke=owner===1&&(mode.startsWith('control-revoke')||['source-delayed-old','epoch-resume','epoch-delayed-old'].includes(mode));
            if(mode==='scope-update'&&owner){reply(1);return;}
            const args=owner?(revoke?{}:['source-repeat','epoch-repeat','epoch-resume','epoch-delayed-old','epoch-add-explicit'].includes(mode)?{action:'previous'}:{action:'goto',page:1,...(mode.startsWith('control-correct')?{replace_pending:true}:{})}):mode==='scope-update'?{action:'goto',page:1}:{action:'recent'};
            if(sourceEvidence)args.source_text=inputs[owner].testCase.text;
            const base=revoke?'cancel_pending_slides':'navigate_slides';
            const name=epochCapabilities?registered.find(tool=>tool.name.startsWith(base+'_')).name:base;
            wire({type:'response.function_call_arguments.done',items:[{call_id:'private-call-'+owner,name,arguments:JSON.stringify(args)}]});
          });
        }
      }
      if(raw.type==='response.cancel')queueMicrotask(()=>wire({type:'response.canceled'}));
      if(raw.type==='session.update'){registered=raw.session.tools;queueMicrotask(()=>wire({type:'session.updated',session:{id:'private-session'}}));}
      if(raw.type==='conversation.item.retrieve')queueMicrotask(()=>wire({type:'conversation.item.retrieved',event_id:raw.event_id,items:raw.items.map(item=>({id:item.id,role:'user',content:[{type:'input_text',text:'PRIVATE_AUTHORED_TEXT'}]}))}));
      if(raw.type==='conversation.item.create')queueMicrotask(()=>reply(Number(raw.items[0].call_id.slice(-1))));
      if(raw.type==='session.close')queueMicrotask(()=>wire({type:'session.closed'}));
    };
    queueMicrotask(()=>socket.emit('open'));return socket;
  }});
  return {report,sent};
}
test('sequential native diagnostic observes two synthetic results without claiming production ownership',async()=>{
  const {report,sent}=await fixture('sequential');assert.equal(report.ended,'two_replies_observed');assert.equal(report.final_page,1);
  assert.equal(report.results_sent,2);assert.equal(report.synthetic_actions_applied,2);assert.equal(report.enable_allowed,false);
  assert.equal(report.session_closed_ack,true);assert.equal(report.tool_batches.every(batch=>batch.input_identity_present===false),true);
  assert.equal(JSON.stringify(report).includes('private-'),false);assert.equal(JSON.stringify(report).includes('PRIVATE_AUTHORED_REPLY'),false);
  assert.equal(sent.filter(e=>e.type==='conversation.item.create').length,2);
});
test('context inspection records fields and equalities without copying provider IDs or content',async()=>{
  const {report}=await fixture('inspect-context');assert.equal(report.ended,'two_replies_observed');assert.equal(report.context_queries_sent,2);
  assert.equal(report.context_query_shapes.length,2);assert.equal(report.context_query_shapes[0].event_id_echoes_outbound,true);
  assert.equal(report.context_query_shapes.flatMap(query=>query.items).every(item=>item.known_input_id&&!item.call_id_matches_known_tool),true);
  assert.equal(JSON.stringify(report).includes('private-'),false);assert.equal(JSON.stringify(report).includes('PRIVATE_AUTHORED_TEXT'),false);
});
test('committed page snapshot removes navigation capability before a later forward request',async()=>{
  const {report,sent}=await fixture('scope-update');assert.equal(report.ended,'scoped_forward_reply_observed');
  assert.equal(report.scoped_tools_update_ack,true);assert.equal(report.navigation_tools_after_update,0);
  assert.equal(report.final_page,1);assert.equal(report.results_sent,1);assert.equal(report.synthetic_actions_applied,1);
  const update=sent.findIndex(packet=>packet.type==='session.update'),result=sent.findIndex(packet=>packet.type==='conversation.item.create');
  assert.ok(result<update);assert.equal(report.scoped_update_boundary,'after_original_reply');
  assert.deepEqual(sent[update].session.tools,[]);assert.equal(report.enable_allowed,false);
});
test('cancel diagnostic does not execute either unowned tool and closes gracefully',async()=>{
  const {report,sent}=await fixture('interrupt-cancel');assert.equal(report.cancel_ack,true);assert.equal(report.results_sent,0);
  assert.equal(report.synthetic_actions_applied,0);assert.equal(report.session_closed_ack,true);
  assert.equal(report.ended,'second_tool_observed_no_execution');assert.equal(sent.some(e=>e.type==='conversation.item.create'),false);
});
test('returning an old cancellation result is explicitly diagnostic and flags old reply resumption',async()=>{
  const {report}=await fixture('interrupt-cancel-result');assert.equal(report.old_result_returned_after_cancel,true);
  assert.equal(report.old_reply_after_cancel,true);assert.equal(report.synthetic_actions_applied,0);assert.equal(report.enable_allowed,false);
});
test('accepted action can settle during new speech without sending provider cancellation',async()=>{
  const {report,sent}=await fixture('interrupt-finish');assert.equal(report.ended,'overlapping_inputs_settled');
  assert.equal(report.results_sent,2);assert.equal(report.final_page,1);assert.equal(report.cancel_sent,false);
  assert.equal(report.old_reply_after_new_input,true);assert.equal(report.stale_text_events_discarded,1);
  assert.equal(sent.some(packet=>packet.type==='response.cancel'),false);assert.equal(report.production_ownership_verified,false);
});
test('model-echo evidence is checked before acceptance and accepted work survives ordinary new input',async()=>{
  const {report}=await fixture('interrupt-finish',{sourceEvidence:true});assert.equal(report.ended,'overlapping_inputs_settled');
  assert.equal(report.synthetic_actions_applied,2);assert.deepEqual(report.source_evidence.map(item=>item.input_index),[0,1]);
  assert.equal(report.production_ownership_verified,false);assert.equal(JSON.stringify(report).includes('帮我'),false);
});
test('local delayed-call fault injection fences the old source and permits only the matched current cancellation',async()=>{
  const {report}=await fixture('source-delayed-old');assert.equal(report.ended,'source_delayed_call_fenced');
  assert.equal(report.source_evidence[0].reason,'SOURCE_NOT_CURRENT');assert.equal(report.synthetic_actions_applied,0);assert.equal(report.final_page,3);
  assert.equal(report.local_delivery_delay_injected,true);assert.equal(report.production_ownership_verified,false);
});
test('identical repeated source text cannot authorize a second action',async()=>{
  const {report}=await fixture('source-repeat');assert.equal(report.ended,'two_replies_observed');
  assert.equal(report.source_evidence[1].reason,'SOURCE_AMBIGUOUS');assert.equal(report.synthetic_actions_applied,1);assert.equal(report.final_page,2);
});
test('session capabilities allow identical repeated requests without guessing a tool turn_id',async()=>{
  const {report}=await fixture('epoch-repeat');assert.equal(report.ended,'two_replies_observed');assert.equal(report.final_page,1);
  assert.equal(report.action_scope,'session_call');assert.equal(report.capability_admissions.every(item=>item.status==='accepted'),true);
  assert.equal(report.production_ownership_verified,false);assert.equal(report.synthetic_actions_applied,2);
});
test('an explicit additive request during pending work remains a distinct session transaction',async()=>{
  const {report}=await fixture('epoch-add-explicit');assert.equal(report.ended,'overlapping_inputs_settled');
  assert.equal(report.final_page,1);assert.equal(report.synthetic_actions_applied,2);assert.equal(report.capability_admissions.length,2);
});
for(const mode of ['epoch-resume','epoch-delayed-old'])test(mode+' rotates, fences old permissions, and accepts fresh speech after update ACK',async()=>{
  const {report}=await fixture(mode);assert.equal(report.scoped_tools_update_ack,true);assert.equal(report.final_page,2);
  assert.equal(report.asr_finals,3);assert.equal(report.results_sent,3);assert.equal(report.synthetic_actions_applied,1);
  assert.equal(report.capability_admissions.at(-1).epoch_index,1);
  if(mode==='epoch-delayed-old')assert.equal(report.delayed_old_reason,'CAPABILITY_REVOKED');
  assert.equal(report.enable_allowed,false);
});
for(const mode of ['control-correct-queued','control-correct-dispatched','control-revoke-queued','control-revoke-dispatched']){
  test(mode+' returns each original call result and preserves dispatched facts',async()=>{
    const {report,sent}=await fixture(mode),queued=mode.endsWith('-queued'),revoke=mode.startsWith('control-revoke');
    assert.equal(report.ended,'control_requests_settled');assert.equal(report.results_sent,2);
    assert.equal(report.cancelled_queued_actions,queued?1:0);
    assert.equal(report.synthetic_actions_applied,revoke?(queued?0:1):(queued?1:2));
    assert.equal(report.final_page,revoke?(queued?3:2):1);
    assert.equal(report.correction_flag_observed,revoke?null:true);assert.equal(report.cancel_sent,false);
    assert.equal(report.production_ownership_verified,false);assert.equal(report.enable_allowed,false);
    const results=sent.filter(packet=>packet.type==='conversation.item.create');
    assert.deepEqual(results.map(packet=>packet.items[0].call_id),['private-call-0','private-call-1']);
    assert.equal(JSON.parse(results[0].items[0].content[0].text).status,queued?'cancelled':'applied');
    assert.equal(sent.some(packet=>packet.type==='response.cancel'),false);
  });
}
