import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlidesCommandCapabilities} from '../command-capabilities.js';
import {SlidesCoordinator} from '../../../apps/realtime-gateway/src/slides-coordinator.js';
const state={page:3,shown:[1,2,3],visits:[1,2,3]};
function fixture(){let index=0;const gate=new SlidesCommandCapabilities({makeToken:()=>('token000'+index++)});const registration=gate.registration(state);return {gate,registration};}
function input(gate,id){gate.observeStarted(id);gate.observeFinal(id);}
function ready(){const f=fixture();f.gate.acknowledge(f.registration.token);input(f.gate,'input1');return f;}
test('calls require registered capability, configuration ACK and fresh input; no invented turn ownership',()=>{
  const {gate,registration:r}=fixture();const call={name:r.names.navigate,callId:'c1',args:{action:'previous'}};
  assert.equal(gate.admit(call,state).reason,'CAPABILITY_NOT_CONFIRMED');gate.acknowledge(r.token);
  assert.equal(gate.admit({...call,callId:'c2'},state).reason,'FRESH_INPUT_REQUIRED');input(gate,'input1');
  const accepted=gate.admit({...call,callId:'c3'},state);assert.equal(accepted.scope,'session_call');assert.equal(accepted.status,'accepted');assert.equal('turn_id' in accepted,false);
});
test('revocation fences a delayed old navigation and a late old cancellation, without needing source text',()=>{
  const {gate,registration:r}=ready();
  const cancel=gate.admit({name:r.names.cancel,callId:'cancel',args:{}},state);assert.equal(cancel.rotated,true);
  assert.equal(gate.admit({name:r.names.navigate,callId:'late',args:{action:'previous'}},state).reason,'CAPABILITY_REVOKED');
  const next=gate.registration(state);gate.acknowledge(next.token);input(gate,'input2');
  assert.equal(gate.admit({name:r.names.cancel,callId:'late-cancel',args:{}},state).reason,'CAPABILITY_REVOKED');
  assert.equal(gate.admit({name:next.names.navigate,callId:'new',args:{action:'previous'}},state).status,'accepted');
});
test('repeated learner wording produces distinct transactions while duplicate calls cannot rotate again',()=>{
  const {gate,registration:r}=ready();const one=gate.admit({name:r.names.navigate,callId:'first',args:{action:'previous'}},state);
  input(gate,'input2');const two=gate.admit({name:r.names.navigate,callId:'second',args:{action:'previous'}},state);assert.notEqual(one.request_id,two.request_id);
  const cancel={name:r.names.cancel,callId:'cancel',args:{}};gate.admit(cancel,state);const next=gate.registration(state);gate.acknowledge(next.token);input(gate,'input3');
  assert.equal(gate.admit(cancel,state).replayed,true);assert.equal(gate.epochIndex,1);
  assert.equal(gate.admit({name:next.names.navigate,callId:'third',args:{action:'previous'}},state).status,'accepted');
});
test('correction rotates only after legal validation; callbacks retain original transaction identity',()=>{
  const {gate,registration:r}=ready();assert.equal(gate.admit({name:r.names.navigate,callId:'bad',args:{action:'next'}},state).reason,'INVALID_SLIDES_ARGUMENTS');assert.equal(gate.epochIndex,0);
  const first={name:r.names.navigate,callId:'first',args:{action:'previous'}},accepted=gate.admit(first,state);
  const corrected=gate.admit({name:r.names.navigate,callId:'correct',args:{action:'goto',page:1,replace_pending:true}},state);assert.equal(corrected.rotated,true);
  assert.equal(gate.admit(first,state).request_id,accepted.request_id);
  assert.equal(gate.admit({...first,args:{action:'goto',page:1}},state).reason,'CALL_ARGUMENT_CONFLICT');
});
test('capabilities cannot cross connections and stale ACK/final cannot rearm a new epoch',()=>{
  const {gate,registration:r}=ready();gate.admit({name:r.names.cancel,callId:'cancel',args:{}},state);
  const next=gate.registration(state);assert.equal(gate.acknowledge(r.token),false);gate.observeStarted('during-update');gate.acknowledge(next.token);
  gate.observeFinal('during-update');assert.equal(gate.observeFinal('during-update'),false);
  assert.equal(gate.admit({name:next.names.navigate,callId:'too-early',args:{action:'previous'}},state).reason,'FRESH_INPUT_REQUIRED');
  const foreign=new SlidesCommandCapabilities({makeToken:()=> 'foreign0000'});const f=foreign.registration(state);foreign.acknowledge(f.token);input(foreign,'f');
  assert.equal(foreign.admit({name:next.names.navigate,callId:'cross',args:{action:'previous'}},state).reason,'UNREGISTERED_TOOL');
});
test('current page policy is rechecked and speech begun under an old epoch cannot rearm after ACK',()=>{
  const {gate,registration:r}=ready();
  assert.equal(gate.admit({name:r.names.navigate,callId:'forward',args:{action:'goto',page:3}},{page:1,shown:[1,2,3],visits:[1,2,3,1]}).reason,'FORWARD_NAVIGATION_DISABLED');
  gate.observeStarted('old-speech');gate.admit({name:r.names.cancel,callId:'cancel',args:{}},state);
  const next=gate.registration(state);gate.acknowledge(next.token);gate.observeFinal('old-speech');
  assert.equal(gate.admit({name:next.names.navigate,callId:'blocked',args:{action:'previous'}},state).reason,'FRESH_INPUT_REQUIRED');
  input(gate,'fresh');assert.equal(gate.admit({name:next.names.navigate,callId:'new',args:{action:'previous'}},state).status,'accepted');
});
test('capability transactions compose with the real coordinator: cancel queued only, finish dispatched, deduplicate',async()=>{
  const {gate,registration:r}=ready(),packets=[];
  const coordinator=new SlidesCoordinator({sessionId:'s',viewerId:'v',generation:'g',send:packet=>packets.push(packet)});
  const receipt=()=>{const p=packets.at(-1);return coordinator.receive({type:'slides.ack',session_id:'s',viewer_instance_id:'v',generation:'g',deck_id:'kai-demo',deck_version:'1',command_id:p.command_id,page:p.page,revision:p.revision,status:'applied'});};
  for(let page=1;page<=3;page++){const pending=coordinator.present(page,{requestId:'host'+page});receipt();await pending;}
  const first=gate.admit({name:r.names.navigate,callId:'first',args:{action:'previous'}},state);
  const oldQueued=gate.admit({name:r.names.navigate,callId:'second',args:{action:'previous'}},state);
  const firstResult=coordinator.execute(first.intent,{requestId:first.request_id}),oldResult=coordinator.execute(oldQueued.intent,{requestId:oldQueued.request_id});
  const cancellation={name:r.names.cancel,callId:'cancel',args:{}},acceptedCancel=gate.admit(cancellation,state);
  const cancelResult=coordinator.cancelPendingReviews({requestId:acceptedCancel.request_id});assert.equal((await cancelResult).cancelled_count,1);
  assert.equal((await oldResult).status,'cancelled');receipt();assert.equal((await firstResult).page,2);
  const next=gate.registration({page:2,shown:[1,2,3],visits:[1,2,3,2]});gate.acknowledge(next.token);input(gate,'fresh');
  const fresh=gate.admit({name:next.names.navigate,callId:'fresh',args:{action:'previous'}},{page:2,shown:[1,2,3],visits:[1,2,3,2]});
  const freshResult=coordinator.execute(fresh.intent,{requestId:fresh.request_id});
  const replay=gate.admit(cancellation,state);assert.equal(replay.replayed,true);assert.equal(coordinator.cancelPendingReviews({requestId:replay.request_id}),cancelResult);
  const count=packets.length;assert.equal(gate.admit({name:r.names.navigate,callId:'late',args:{action:'previous'}},state).reason,'CAPABILITY_REVOKED');assert.equal(packets.length,count);
  receipt();assert.equal((await freshResult).page,1);coordinator.close();gate.close();
});
test('capacity disables new actions while preserving already accepted duplicate transaction identity',()=>{
  const gate=new SlidesCommandCapabilities({makeToken:()=> 'bounded0000',limit:1});const r=gate.registration(state);gate.acknowledge(r.token);input(gate,'one');
  const call={name:r.names.navigate,callId:'first',args:{action:'previous'}},first=gate.admit(call,state);
  assert.equal(gate.admit({...call,callId:'overflow'},state).reason,'CAPABILITY_CALL_LIMIT');
  assert.equal(gate.admit(call,state).request_id,first.request_id);assert.equal(gate.admit(call,state).replayed,true);
});
