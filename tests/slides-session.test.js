import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlidesSession} from '../apps/realtime-gateway/src/slides-session.js';
import {readConfig} from '../apps/realtime-gateway/src/config.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(t,{demoHistory=true,autoAck=true,coordinatorOptions={}}={}){
  const packets=[];let session;
  const ack=command=>session.receive({type:'slides.ack',...session.binding,command_id:command.command_id,status:'applied',page:command.page,revision:command.revision});
  session=new SlidesSession({sessionId:'test',demoHistory,coordinatorOptions,send:packet=>{
    packets.push(packet);if(autoAck&&packet.type==='slides.command')queueMicrotask(()=>ack(packet));
  }});
  t.after(()=>session.close());session.receive({type:'slides.ready',...session.binding});
  const config=await session.ready;session.confirm(config);session.observeStarted('input1');session.observeFinal('input1');
  return {session,packets,config,ack};
}
test('slides opt-in defaults off and authored history requires mock plus explicit enable',()=>{
  assert.equal(readConfig({}).slidesControls,false);
  assert.throws(()=>readConfig({ASK_KAI_SLIDES_CONTROL:'1'}),/INVALID_SLIDES_CONFIG/);
  assert.throws(()=>readConfig({ASK_KAI_SLIDES_DEMO_HISTORY:'true'}),/REQUIRES_MOCK/);
  assert.throws(()=>readConfig({ASK_KAI_SLIDES_CONTROL:'true',ASK_KAI_SLIDES_DEMO_HISTORY:'true',ASK_KAI_BACKEND:'external'}),/REQUIRES_MOCK/);
});
test('fresh normal viewer has only page1 history, no navigation tool, no fabricated forward progress',async t=>{
  const {session,config,packets}=await setup(t,{demoHistory:false});
  assert.deepEqual(config.state.shown,[1]);assert.equal(config.tools.length,1);assert.match(config.tools[0].name,/^cancel_pending_slides_/);
  session.receive({type:'slides.intent',...session.binding,request_id:'manual-forward',intent:{action:'goto',page:3}});await tick();
  assert.equal(packets.filter(p=>p.type==='slides.command').length,1);assert.equal(packets.at(-1).outcome.reason,'FORWARD_NAVIGATION_DISABLED');
});
test('accepted tools wait for exact component receipt; duplicate cannot apply twice and tool results are not learning events',async t=>{
  const {session,config,packets,ack}=await setup(t);session.coordinator.send=packet=>packets.push(packet);
  const call={name:config.registration.names.navigate,callId:'one',args:{action:'previous'}};
  let settled=false;const pending=session.calls([call])[0].then(value=>{settled=true;return value;});
  await tick();assert.equal(settled,false);const command=packets.filter(p=>p.type==='slides.command').at(-1);
  assert.equal(session.receive({type:'slides.ack',...session.binding,command_id:command.command_id,status:'applied',page:command.page,revision:command.revision+1}),false);
  ack(command);const result=await pending;assert.equal(result.outcome.page,2);assert.equal(result.outcome.learning_evidence,false);assert.equal(result.outcome.scope,'session_call');assert.ok(!Object.hasOwn(result,'turn_id'));
  assert.deepEqual(await session.calls([call])[0],result);assert.equal(packets.filter(p=>p.type==='slides.command').length,4);
});
test('cancel fences undispatched old calls; accepted in-flight completes and fresh speech is required after config ACK',async t=>{
  const {session,config,packets,ack}=await setup(t);session.coordinator.send=packet=>packets.push(packet);
  const nav=id=>({name:config.registration.names.navigate,callId:id,args:{action:'previous'}});
  const first=session.calls([nav('first')])[0],queued=session.calls([nav('queue')])[0];
  const cancel={name:config.registration.names.cancel,callId:'cancel',args:{}};
  assert.equal((await session.calls([cancel])[0]).outcome.cancelled_count,1);assert.equal((await queued).outcome.status,'cancelled');
  assert.equal((await session.calls([nav('old-first-arrival')])[0]).outcome.reason,'CAPABILITY_REVOKED');
  ack(packets.filter(p=>p.type==='slides.command').at(-1));assert.equal((await first).outcome.page,2);
  const next=session.configuration();session.observeStarted('during-update');session.confirm(next);session.observeFinal('during-update');
  const newNav={name:next.registration.names.navigate,callId:'new',args:{action:'previous'}};
  assert.equal((await session.calls([newNav])[0]).outcome.reason,'FRESH_INPUT_REQUIRED');
  session.observeStarted('fresh');session.observeFinal('fresh');const fresh=session.calls([{...newNav,callId:'fresh'}])[0];
  await session.calls([cancel])[0];assert.equal(session.coordinator.pending.target,1);
  ack(packets.filter(p=>p.type==='slides.command').at(-1));assert.equal((await fresh).outcome.page,1);
});
test('lost component receipt produces unknown once, freezes new operations, late exact receipt only reconciles',async t=>{
  const {session,config,packets,ack}=await setup(t,{coordinatorOptions:{ackMs:10,totalMs:25}});session.coordinator.send=packet=>packets.push(packet);
  const call={name:config.registration.names.navigate,callId:'lost',args:{action:'previous'}};
  const result=await session.calls([call])[0];assert.equal(result.outcome.status,'unknown');assert.deepEqual(session.configuration().tools,[]);
  assert.equal((await session.calls([{...call,callId:'new'}])[0]).outcome.reason,'SLIDES_STATE_UNCONFIRMED');
  ack(packets.filter(p=>p.type==='slides.command').at(-1));assert.equal(session.configuration().state.page,2);
  assert.equal((await session.calls([call])[0]).outcome.status,'unknown');
});
test('foreign viewer and closed generations cannot apply or complete an action',async t=>{
  const {session,config,packets}=await setup(t);session.coordinator.send=packet=>packets.push(packet);
  const action=session.calls([{name:config.registration.names.navigate,callId:'closing',args:{action:'previous'}}])[0];
  const command=packets.filter(p=>p.type==='slides.command').at(-1);
  assert.equal(session.receive({type:'slides.ack',...session.binding,viewer_instance_id:'foreign',command_id:command.command_id,status:'applied',page:2,revision:command.revision}),false);
  session.close();assert.equal((await action).outcome.status,'unknown');assert.equal(session.receive({type:'slides.ready',...session.binding}),false);
});
test('an invalid second call rejects the whole tool batch before a valid first navigation dispatches',async t=>{
  const {session,config,packets}=await setup(t);const before=packets.filter(packet=>packet.type==='slides.command').length;
  const values=await Promise.all(session.calls([{name:config.registration.names.navigate,callId:'valid',args:{action:'previous'}},{name:config.registration.names.navigate,callId:'invalid',args:{action:'goto',page:'1'}}]));
  assert.ok(values.every(value=>value.outcome.reason==='INVALID_UI_TOOL_BATCH'));assert.equal(packets.filter(packet=>packet.type==='slides.command').length,before);
});
