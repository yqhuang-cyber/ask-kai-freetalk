import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {SeeduplexProvider} from '../packages/provider-doubao/seeduplex.js';
import {SlidesCommandCapabilities} from '../apps/realtime-gateway/src/slides-command-gate.js';
import {validateSlidesToolSet} from '../packages/contracts/ui-actions.js';
const template=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url)));
function setup(t,{enabled=true}={}){
  const profile=structuredClone(template);profile.reviewed=true;Object.assign(profile.realtime,{reviewed:true,ordered_acks_reviewed:true});
  const socket=new EventEmitter(),sent=[],packets=[],failures=[];
  Object.assign(socket,{readyState:1,bufferedAmount:0,send:value=>sent.push(JSON.parse(value)),terminate:()=>{}});
  const provider=new SeeduplexProvider({profile,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});
  const gate=new SlidesCommandCapabilities(),registration=gate.registration({page:3,shown:[1,2,3],visits:[1,2,3]});
  if(enabled)provider.enableSlidesTools(registration.tools);
  provider.open({sessionId:'s',instructions:'test',onEvent:packet=>packets.push(packet),onFailure:code=>failures.push(code)});socket.emit('open');
  let seq=0;const wire=packet=>socket.emit('message',Buffer.from(JSON.stringify({event_id:'wire'+(++seq),...packet})),false);
  wire({type:'session.created',session:{id:'raw-session'}});
  t.after(()=>{void provider.close();socket.emit('message',Buffer.from(JSON.stringify({type:'session.closed'})),false);});
  return {provider,sent,packets,failures,wire,registration,gate};
}
const fc=(r,items=[{call_id:'raw-call',name:r.names.navigate,arguments:'{"action":"previous"}'}])=>({type:'response.function_call_arguments.done',items});
test('ordinary provider still rejects tools and enabled calls are separate controls with no invented speech owner',t=>{
  const off=setup(t,{enabled:false});off.wire(fc(off.registration));assert.deepEqual(off.failures,['PROVIDER_PROTOCOL_ERROR']);assert.ok(!off.sent[0].session.tools);
  const on=setup(t);on.wire(fc(on.registration));const packet=on.packets.at(-1);
  assert.equal(packet.control,'ui.calls');assert.equal(packet.calls[0].callId,'raw-call');assert.ok(!packet.event);assert.ok(!packet.turn_id);assert.deepEqual(on.failures,[]);
});
test('only closed reviewed schemas can be registered, no generic or forward function escapes',t=>{
  const x=setup(t),tools=structuredClone(x.registration.tools);
  assert.equal(validateSlidesToolSet(tools),true);tools[0].parameters.properties.action.enum.push('next');assert.equal(validateSlidesToolSet(tools),false);
  assert.equal(validateSlidesToolSet([{type:'function',name:'arbitrary',parameters:{}}]),false);
  assert.throws(()=>x.provider.enableSlidesTools(x.registration.tools),/INVALID_SLIDES_TOOLS/);
});
test('tool results retain raw call identity, bypass pending configuration ACK and never use fixed speech',t=>{
  const x=setup(t);x.provider.updateContext({instructions:'new context',version:2,uiTools:x.registration.tools,speechSpeed:-40});
  x.wire(fc(x.registration));assert.equal(x.provider.uiBusy,true);
  x.provider.sendUiResults([{callId:'raw-call',outcome:{status:'applied',confirmed:true,page:2}}]);
  assert.equal(x.sent.at(-1).type,'conversation.item.create');assert.equal(x.sent.at(-1).items[0].call_id,'raw-call');assert.equal(x.sent.at(-1).items[0].role,'tool');
  assert.ok(!x.sent.some(value=>value.type==='speech_text_buffer.commit'));
  assert.throws(()=>x.provider.sendUiResults([{callId:'foreign',outcome:{}}]),/INVALID_UI_TOOL_RESULT/);
  x.wire({type:'session.updated',session:{id:'raw-session'}});assert.equal(x.provider.profile.session_create.session.audio.output.speed,-40);
});
test('configuration waits for tool result and an actual output boundary then preserves tools and speed together',t=>{
  const x=setup(t);x.wire(fc(x.registration));assert.throws(()=>x.provider.updateContext({instructions:'too early',version:2}),/CONTROL_PENDING/);
  x.provider.sendUiResults([{callId:'raw-call',outcome:{status:'applied',confirmed:true,page:2}}]);
  assert.throws(()=>x.provider.updateContext({instructions:'still early',version:2}),/CONTROL_PENDING/);
  x.wire({type:'response.done',response:{usage:{}}});assert.equal(x.provider.uiBusy,true);
  for(const type of ['response.output_audio.started','response.output_audio.done'])x.wire({type,response_id:'reply',question_id:'input'});
  assert.equal(x.provider.uiBusy,false);
  x.provider.updateContext({instructions:'confirmed',version:2,speechSpeed:20});assert.deepEqual(x.sent.at(-1).session.tools,x.registration.tools);assert.equal(x.sent.at(-1).session.audio.output.speed,20);
});
test('barge-in while a tool waits closes only the old output lane without waiting for native cancel ACK',t=>{
  const x=setup(t);x.wire({type:'response.output_text.delta',response_id:'reply',question_id:'input',delta:'我看看'});x.wire(fc(x.registration));
  const reply=x.packets.find(packet=>packet.event?.type==='response.started').event;
  assert.equal(x.provider.cancel(reply.response_id),'local');assert.equal(x.packets.at(-1).event.type,'response.cancelled');assert.ok(!x.sent.some(packet=>packet.type==='response.cancel'));
  x.provider.sendUiResults([{callId:'raw-call',outcome:{status:'applied',confirmed:true,page:2}}]);
  x.wire({type:'response.output_text.delta',response_id:'reply',question_id:'input',delta:'已经翻好了'});
  x.wire({type:'response.output_audio.done',response_id:'reply',question_id:'input'});
  assert.ok(!x.packets.some(packet=>packet.event?.payload?.text==='已经翻好了'));assert.equal(x.provider.uiBusy,false);
});
test('malformed multi-call structure validates as a batch before any tool enters the control channel',t=>{
  const x=setup(t);x.wire(fc(x.registration,[{call_id:'one',name:x.registration.names.navigate,arguments:'{}'},{call_id:'two',name:'foreign',arguments:'{}'}]));
  assert.deepEqual(x.failures,['PROVIDER_PROTOCOL_ERROR']);assert.ok(!x.packets.some(packet=>packet.control==='ui.calls'));
});
test('native call retransmissions cannot create competing result waiters; parameter conflict fails closed',t=>{
  const x=setup(t);x.wire(fc(x.registration));x.wire(fc(x.registration));
  assert.equal(x.packets.filter(packet=>packet.control==='ui.calls').length,1);
  x.provider.sendUiResults([{callId:'raw-call',outcome:{status:'applied',confirmed:true,page:2}}]);
  x.wire(fc(x.registration));assert.equal(x.packets.filter(packet=>packet.control==='ui.calls').length,1);assert.deepEqual(x.failures,[]);
  x.wire(fc(x.registration,[{call_id:'raw-call',name:x.registration.names.navigate,arguments:'{"action":"goto","page":1}'}]));assert.deepEqual(x.failures,['PROVIDER_PROTOCOL_ERROR']);
});
test('text-first discarded reply owns a discard-only PCM lane; an overlapping unfinished start cannot relabel newer audio',t=>{
  const x=setup(t);x.wire({type:'response.output_text.delta',response_id:'old',question_id:'old-input',delta:'旧确认'});
  const old=x.packets.find(packet=>packet.event?.type==='response.started').event.response_id;x.provider.discardReply(old);
  x.wire({type:'response.output_audio.started',response_id:'old',question_id:'old-input'});x.wire({type:'response.output_audio.delta',delta:'AAAAAA=='});
  assert.ok(!x.packets.some(packet=>packet.audio));x.wire({type:'response.output_audio.done',response_id:'old',question_id:'old-input'});
  x.wire({type:'response.output_audio.started',response_id:'new',question_id:'new-input'});x.wire({type:'response.output_audio.delta',delta:'AAAAAA=='});
  assert.equal(x.packets.filter(packet=>packet.audio).length,1);assert.deepEqual(x.failures,[]);
  x.wire({type:'response.output_audio.started',response_id:'old',question_id:'old-input'});assert.deepEqual(x.failures,[]);
  const y=setup(t);y.wire({type:'response.output_text.delta',response_id:'old',question_id:'old-input',delta:'旧确认'});
  y.provider.discardReply(y.packets.find(packet=>packet.event?.type==='response.started').event.response_id);
  y.wire({type:'response.output_audio.started',response_id:'new',question_id:'new-input'});
  y.wire({type:'response.output_audio.started',response_id:'old',question_id:'old-input'});assert.deepEqual(y.failures,['PROVIDER_PROTOCOL_ERROR']);
});
