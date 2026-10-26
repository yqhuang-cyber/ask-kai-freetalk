import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {runSlidesProtocolProbe} from '../protocol-probe.js';
import {SLIDES_CASES} from '../cases.js';
import {SLIDES_BATCH_CASES} from '../batch-cases.js';
import {resolveSlidesTarget,validateSlidesIntent,validateSlidesCancellation,slidesReviewTools,SLIDES_TOOL} from '../../../packages/contracts/ui-actions.js';

const template=JSON.parse(await readFile('docs/protocol/seeduplex-profile.template.json','utf8'));
const profile=()=>({...structuredClone(template),reviewed:true,realtime:{...template.realtime,reviewed:true,ordered_acks_reviewed:true}});
const pcm=Buffer.alloc(640,1),hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture({id='recent',newInput=false,lateNewInput=false,early=false,duplicate=false,batch=false,badSecond=false,repeatedCall=false,earlyTool=false,missingFinal=false,fcAfterNew=false,sourceEvidence=false,sourceMismatch=false,epochCapabilities=false}={}){
  const testCase=batch?(SLIDES_BATCH_CASES.find(item=>item.id===id)??SLIDES_BATCH_CASES[0]):SLIDES_CASES.find(item=>item.id===id),sent=[];
  const inspection=testCase.id==='inspect-slide-batch';
  const report=await runSlidesProtocolProbe({profile:profile(),pcm,testCase,sourceEvidence,epochCapabilities,holdMs:60,durationMs:missingFinal?1800:500,
    manifest:{source:'local_os_authored_speech',pcm_sha256:hash(pcm),script_sha256:hash(testCase.text),sample_rate:16000,channels:1},env:{DOUBAO_API_KEY:'synthetic'},socketFactory:()=>{
      const socket=new EventEmitter();socket.addEventListener=socket.on.bind(socket);socket.close=()=>{};let first=true,registered=[];
      const wire=raw=>socket.emit('message',{data:JSON.stringify(raw)});
      const reply=()=>{
        wire({type:'response.output_audio.started',response_id:'private-reply',question_id:'private-input'});
        wire({type:'response.output_text.done',response_id:'private-reply',question_id:'private-input',text:'好，已经回到第二页了。'});
        wire({type:'response.output_audio.done',response_id:'private-reply',question_id:'private-input'});
        if(lateNewInput)setTimeout(()=>wire({type:'conversation.item.input_audio_transcription.started',item_id:'private-new-input'}),30);
      };
      socket.send=bytes=>{
        const raw=JSON.parse(bytes);sent.push(raw);
        if(raw.type==='session.create'){registered=raw.session.tools;queueMicrotask(()=>wire({type:'session.created',session:{id:'private-session'}}));}
        if(raw.type==='input_audio_buffer.append'&&first){
          first=false;wire({type:'conversation.item.input_audio_transcription.started',item_id:'private-input'});
          const final=()=>wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-input',text:testCase.text});
          if(!earlyTool&&!missingFinal)final();else if(earlyTool)setTimeout(final,10);
          if(early)wire({type:'response.output_text.delta',response_id:'private-reply',question_id:'private-input',delta:'好，'});
          const items=[{id:'private-function-item',call_id:'private-call',name:inspection?'inspect_current_slide':'navigate_slides',arguments:inspection?'{}':batch?' {"action":"previous"}':'{"action":"recent"}'}];
          if(batch)items.push({call_id:repeatedCall?'private-call':'private-call-2',name:inspection?'inspect_review_history':'navigate_slides',arguments:inspection?'{}':badSecond?' {"action":"goto","page":1}':'{"action":"previous"}'});
          if(sourceEvidence){const args=JSON.parse(items[0].arguments);args.source_text=sourceMismatch?'回去看看':testCase.text;items[0].arguments=JSON.stringify(args);}
          if(epochCapabilities)items[0].name=registered.find(tool=>tool.name.startsWith('navigate_slides_')).name;
          const tool=()=>wire({type:'response.function_call_arguments.done',items});
          if(fcAfterNew){setTimeout(()=>wire({type:'conversation.item.input_audio_transcription.started',item_id:'private-new-input'}),10);setTimeout(tool,25);}else tool();
          if(newInput)setTimeout(()=>wire({type:'conversation.item.input_audio_transcription.started',item_id:'private-new-input'}),10);
          if(duplicate)wire({type:'response.function_call_arguments.done',items:[]});
        }
        if(raw.type==='conversation.item.create')queueMicrotask(reply);
        if(raw.type==='session.close')queueMicrotask(()=>wire({type:'session.closed'}));
      };
      queueMicrotask(()=>socket.emit('open'));return socket;
    }});
  return {report,sent};
}
test('isolated native probe matches call_id, keeps audio pumping, and labels synthetic execution',async()=>{
  const {report,sent}=await fixture();assert.equal(report.status,'sample_observed');
  assert.ok(report.input_frames_while_waiting>0);assert.equal(report.synthetic_viewer,true);assert.equal(report.production_ownership_verified,false);
  assert.equal(report.final_page,2);assert.equal(report.tool_order_observed,true);
  const result=sent.find(e=>e.type==='conversation.item.create');assert.equal(result.items[0].call_id,'private-call');
  assert.equal(JSON.parse(result.items[0].content[0].text).execution_source,'synthetic_viewer');
  const serialized=JSON.stringify(report);assert.ok(!serialized.includes('private-'));assert.ok(!serialized.includes('好，已经'));assert.equal(report.semantics_accepted,null);
});
test('new recognized input fences the single-input experiment before its delayed result',async()=>{
  const {report,sent}=await fixture({newInput:true});assert.equal(report.ended,'new_input_ownership_fence');
  assert.equal(report.synthetic_actions_applied,0);assert.equal(sent.filter(e=>e.type==='conversation.item.create').length,0);
});
test('duplicate batch never applies or replies twice',async()=>{
  const {report,sent}=await fixture({duplicate:true});assert.equal(report.ended,'unsupported_or_duplicate_tool_batch');
  assert.equal(report.synthetic_actions_applied,0);assert.equal(sent.filter(e=>e.type==='conversation.item.create').length,0);
});
test('output before tool result remains a separate failed ordering observation',async()=>{
  const {report}=await fixture({early:true});assert.equal(report.tool_order_observed,false);assert.equal(report.status,'needs_review');
});
test('a completed old reply does not turn a later ownership fence into sample success',async()=>{
  const {report}=await fixture({lateNewInput:true});assert.equal(report.reply_observed,true);
  assert.equal(report.ended,'new_input_ownership_fence');assert.equal(report.status,'needs_review');
});
test('review policy rejects forward, unseen, malformed and excess arguments',()=>{
  const state={page:2,shown:[1,2,3],visits:[1,2,3,2]};
  assert.equal(resolveSlidesTarget({action:'next'},state).reason,'FORWARD_NAVIGATION_DISABLED');
  assert.equal(resolveSlidesTarget({action:'goto',page:3},state).reason,'FORWARD_NAVIGATION_DISABLED');
  assert.equal(resolveSlidesTarget({action:'recent'},state).reason,'FORWARD_NAVIGATION_DISABLED');
  assert.equal(resolveSlidesTarget({action:'goto',page:1},{page:2,shown:[2],visits:[2]}).reason,'PAGE_NOT_PREVIOUSLY_SHOWN');
  assert.equal(validateSlidesIntent({action:'goto',page:'1'}),false);assert.equal(validateSlidesIntent({action:'previous',page:1}),false);
  assert.equal(validateSlidesIntent({action:'goto',page:1,code:'arbitrary'}),false);
  assert.equal(validateSlidesIntent({action:'goto',page:1,replace_pending:'true'}),false);
  assert.equal(validateSlidesIntent({action:'goto',page:1,replace_pending:true}),true);
  assert.equal(validateSlidesCancellation({}),true);assert.equal(validateSlidesCancellation({action_id:'other'}),false);
  assert.equal(validateSlidesCancellation([]),false);assert.equal(validateSlidesCancellation(null),false);
  assert.equal(resolveSlidesTarget({action:'previous'},state).target_page,1);
  assert.equal(resolveSlidesTarget({action:'goto',page:2},state).status,'unchanged');
});
test('confirmed review capability omits empty navigation and narrows targets without mutating the base tool',()=>{
  assert.deepEqual(slidesReviewTools({page:1,shown:[1,2,3],visits:[1,2,3,1]}),[]);
  const [tool]=slidesReviewTools({page:2,shown:[1,2,3],visits:[1,2,3,2]});
  assert.deepEqual(tool.parameters.properties.action.enum,['previous','goto']);
  assert.equal(tool.parameters.properties.page.maximum,2);assert.equal(Object.hasOwn(tool.parameters.properties.page,'enum'),false);
  tool.parameters.properties.action.enum.push('next');assert.equal(SLIDES_TOOL.parameters.properties.action.enum.includes('next'),false);
  assert.throws(()=>slidesReviewTools({page:null,shown:[1],visits:[1]}),/INVALID_SLIDES_STATE/);
});
test('two native calls execute serially and return both call results in one batch',async()=>{
  const {report,sent}=await fixture({batch:true});assert.equal(report.status,'sample_observed');
  assert.equal(report.final_page,1);assert.equal(report.synthetic_actions_applied,2);assert.equal(report.result_batches_sent,1);
  const results=sent.filter(packet=>packet.type==='conversation.item.create');assert.equal(results.length,1);
  assert.deepEqual(results[0].items.map(item=>item.call_id),['private-call','private-call-2']);
  assert.deepEqual(results[0].items.map(item=>JSON.parse(item.content[0].text).page),[2,1]);
});
test('independent read-only batch returns two matching results without any navigation',async()=>{
  const {report,sent}=await fixture({batch:true,id:'inspect-slide-batch'});assert.equal(report.status,'sample_observed');
  assert.equal(report.final_page,3);assert.equal(report.synthetic_actions_applied,0);assert.equal(report.result_batches_sent,1);
  const packet=sent.find(packet=>packet.type==='conversation.item.create');assert.equal(packet.items.length,2);
  assert.equal(JSON.parse(packet.items[0].content[0].text).page,3);assert.deepEqual(JSON.parse(packet.items[1].content[0].text).allowed_review_pages,[1,2,3]);
});
for(const options of [{batch:true,badSecond:true},{batch:true,repeatedCall:true}]){
  test('invalid or repeated second batch call prevents all execution: '+JSON.stringify(options),async()=>{
    const {report,sent}=await fixture(options);assert.equal(report.synthetic_actions_applied,0);
    assert.equal(sent.some(packet=>packet.type==='conversation.item.create'),false);
  });
}
test('single reserved author slot waits for final when the native tool arrives first',async()=>{
  const {report}=await fixture({earlyTool:true});assert.equal(report.status,'sample_observed');assert.equal(report.production_ownership_verified,false);
});
test('missing final expires without executing or returning a fabricated result',async()=>{
  const {report}=await fixture({missingFinal:true});assert.equal(report.ended,'tool_without_final');assert.equal(report.synthetic_actions_applied,0);assert.equal(report.tool_results_sent,0);
});
test('late tool after a new input remains fenced rather than assigned to the latest input',async()=>{
  const {report}=await fixture({fcAfterNew:true});assert.equal(report.ended,'new_input_ownership_fence');assert.equal(report.synthetic_actions_applied,0);
});
test('experimental source evidence compares actual ASR rather than the fixed author oracle',async()=>{
  const {report}=await fixture({sourceEvidence:true});assert.equal(report.status,'sample_observed');assert.equal(report.source_evidence[0].matched_reserved_input,true);
  assert.equal(report.production_ownership_verified,false);assert.equal(JSON.stringify(report).includes('刚才那页'),false);
});
test('an abbreviated model source claim cannot execute the action',async()=>{
  const {report}=await fixture({sourceEvidence:true,sourceMismatch:true});assert.equal(report.source_evidence[0].reason,'SOURCE_NOT_RECOGNIZED');
  assert.equal(report.synthetic_actions_applied,0);assert.equal(report.status,'needs_review');
});
test('session action admission accepts current tool capability without assigning a learner turn',async()=>{
  const {report}=await fixture({epochCapabilities:true});assert.equal(report.status,'sample_observed');
  assert.equal(report.capability_admissions[0].status,'accepted');assert.equal(report.action_scope,'session_call');assert.equal(report.production_ownership_verified,false);
});
test('a capability call before final is conservatively rejected instead of acquiring later authority',async()=>{
  const {report}=await fixture({epochCapabilities:true,earlyTool:true});assert.equal(report.capability_admissions[0].reason,'FRESH_INPUT_REQUIRED');
  assert.equal(report.synthetic_actions_applied,0);assert.equal(report.status,'needs_review');
});
