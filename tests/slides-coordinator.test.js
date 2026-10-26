import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlidesCoordinator} from '../apps/realtime-gateway/src/slides-coordinator.js';
const binding={session_id:'s1',viewer_instance_id:'viewer',generation:'gen1',deck_id:'kai-demo',deck_version:'1'};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(options={}){
  const packets=[],states=[];
  const controller=new SlidesCoordinator({sessionId:'s1',viewerId:'viewer',generation:'gen1',send:packet=>packets.push(packet),onState:state=>states.push(state),...options});
  const last=()=>packets.filter(packet=>packet.type==='slides.command').at(-1);
  const ack=(command=last(),extra={})=>controller.receive({...binding,type:'slides.ack',command_id:command.command_id,page:command.page,revision:command.revision,status:'applied',...extra});
  const present=async page=>{const promise=controller.present(page,{requestId:'host-'+page});assert.equal(ack(),true);return promise;};
  return {controller,packets,states,last,ack,present};
}
async function atThree(options){const f=fixture(options);await f.present(1);await f.present(2);await f.present(3);return f;}
test('review commands require confirmed initialization; only matched component receipts add history',async()=>{
  const {controller,ack,present}=fixture();
  assert.equal((await controller.execute({action:'previous'},{requestId:'r0'})).reason,'SLIDES_STATE_UNCONFIRMED');
  const pending=controller.present(1,{requestId:'init'});assert.equal(controller.snapshot().confirmed,false);
  assert.equal(ack(undefined,{generation:'stale'}),false);assert.equal(controller.snapshot().visits.length,0);
  ack();assert.equal((await pending).status,'applied');assert.deepEqual(controller.snapshot().visits,[1]);
  await present(2);assert.deepEqual(controller.snapshot().allowed_review_pages,[1,2]);controller.close();
});
test('duplicates join one command; distinct previous requests use committed state in order',async()=>{
  const {controller,packets,ack,last,states}=await atThree();const before=packets.length;
  const first=controller.execute({action:'previous'},{requestId:'r1'}),duplicate=controller.execute({action:'previous'},{requestId:'r1'});
  assert.equal(first,duplicate);const second=controller.execute({action:'previous'},{requestId:'r2'});
  assert.equal(states.at(-1).queued,1);assert.equal(states.at(-1).pending,true);
  assert.equal(packets.length,before+1);assert.equal(last().page,2);ack();assert.equal((await first).page,2);
  assert.equal(last().page,1);ack();assert.equal((await second).page,1);
  assert.equal((await controller.execute({action:'goto',page:1},{requestId:'r1'})).reason,'REQUEST_ID_CONFLICT');
  assert.equal(await duplicate,await first);controller.close();
});
test('queue dispatch rechecks forward restriction and recent keeps its accepted target',async()=>{
  const {controller,ack,packets}=await atThree();
  const first=controller.execute({action:'goto',page:1},{requestId:'first'});
  const staleGoto=controller.execute({action:'goto',page:2},{requestId:'goto'});
  const recent=controller.execute({action:'recent'},{requestId:'recent'});const count=packets.length;
  ack();await first;
  assert.equal((await staleGoto).reason,'FORWARD_NAVIGATION_DISABLED');
  assert.equal((await recent).reason,'FORWARD_NAVIGATION_DISABLED');assert.equal(packets.length,count);
  assert.deepEqual(controller.snapshot().allowed_review_pages,[1]);controller.close();
});
test('missing ACK uses ordered snapshot barrier without repeating relative actions',async()=>{
  const {controller,ack,packets,last}=await atThree({ackMs:15,totalMs:200});
  const action=controller.execute({action:'previous'},{requestId:'review'}),command=last();await wait(30);
  const sync=packets.find(packet=>packet.type==='slides.sync');assert.ok(sync);
  assert.equal(packets.filter(packet=>packet.type==='slides.command'&&packet.command_id===command.command_id).length,1);
  assert.equal(controller.receive({...binding,type:'slides.snapshot',command_id:command.command_id,sync_id:'wrong',page:2,revision:command.revision,applied_command_id:command.command_id}),false);
  assert.equal(controller.receive({...binding,type:'slides.snapshot',command_id:command.command_id,sync_id:sync.sync_id,page:2,revision:command.revision,applied_command_id:command.command_id}),true);
  assert.equal((await action).status,'applied');assert.equal(ack(command),false);controller.close();
});
test('timeout is unknown, freezes the queue; late exact receipt reconciles without repeating its result',async()=>{
  const {controller,ack,last,packets}=await atThree({ackMs:10,totalMs:35});
  const action=controller.execute({action:'previous'},{requestId:'a'}),command=last();
  const queued=controller.execute({action:'previous'},{requestId:'b'});
  const result=await action;assert.equal(result.status,'unknown');assert.equal(result.page,null);
  assert.equal((await queued).reason,'SLIDES_STATE_UNCONFIRMED');assert.equal(controller.snapshot().confirmed,false);
  assert.equal((await controller.execute({action:'previous'},{requestId:'c'})).reason,'SLIDES_STATE_UNCONFIRMED');
  const count=packets.length;assert.equal(ack(command),true);assert.equal(controller.snapshot().page,2);
  assert.equal(await action,result);assert.equal(packets.length,count);controller.close();
});
test('definite not-applied receipt preserves state; wrong page, extra fields and foreign session cannot commit',async()=>{
  const {controller,ack,last}=await atThree();const action=controller.execute({action:'previous'},{requestId:'r'}),command=last();
  assert.equal(ack(command,{page:1}),false);assert.equal(ack(command,{session_id:'other'}),false);
  assert.equal(ack(command,{arbitrary:'extra'}),false);assert.equal(controller.snapshot().page,3);
  assert.equal(ack(command,{status:'not_applied',page:3,revision:command.base_revision}),true);
  assert.equal((await action).status,'failed');assert.equal(controller.snapshot().page,3);controller.close();
});
test('cancel only queued requests; closed generation ignores dispatched results and settles unknown',async()=>{
  const {controller,ack,last}=await atThree();const first=controller.execute({action:'previous'},{requestId:'first'}),command=last();
  const second=controller.execute({action:'previous'},{requestId:'second'});
  assert.equal(controller.cancelQueued('first'),false);assert.equal(controller.cancelQueued('second'),true);
  assert.equal((await second).status,'cancelled');controller.close();assert.equal((await first).status,'unknown');
  assert.equal(ack(command),false);assert.equal(controller.snapshot().available,false);
});
test('queue pressure and invalidated request do not execute; cache and snapshots are isolated',async()=>{
  const {controller,ack,last}=await atThree();const first=controller.execute({action:'previous'},{requestId:'first'});
  const invalid=controller.execute({action:'previous'},{requestId:'invalid',isCurrent:()=>false});
  const third=controller.execute({action:'previous'},{requestId:'third'});
  assert.equal((await controller.execute({action:'previous'},{requestId:'overflow'})).reason,'SLIDES_BUSY');
  ack();await first;assert.equal((await invalid).status,'cancelled');assert.equal(last().page,1);ack();await third;
  const view=controller.snapshot();view.shown.push(99);assert.deepEqual(controller.snapshot().shown,[1,2,3]);controller.close();
});
test('queued recent keeps page 2 instead of being reinterpreted as page 3 or page 1',async()=>{
  const {controller,ack,packets}=await atThree();const first=controller.execute({action:'previous'},{requestId:'first'});
  const recent=controller.execute({action:'recent'},{requestId:'recent'}),count=packets.length;
  ack();await first;assert.equal((await recent).reason,'ALREADY_ON_PAGE');assert.equal(packets.length,count);controller.close();
});
test('expired queued intents settle without dispatch; action cache has a session bound',async()=>{
  const {controller,ack,packets}=await atThree({ackMs:100,totalMs:300,queueTtlMs:10});
  const first=controller.execute({action:'previous'},{requestId:'first'}),queued=controller.execute({action:'previous'},{requestId:'expired'}),count=packets.length;
  await wait(20);ack();await first;assert.equal((await queued).reason,'QUEUE_EXPIRED');assert.equal(packets.length,count);controller.close();
  const other=fixture();await other.present(1);
  for(let i=0;i<63;i++)assert.equal((await other.controller.execute({action:'goto',page:1},{requestId:'same-page-'+i})).status,'unchanged');
  assert.equal((await other.controller.execute({action:'goto',page:1},{requestId:'over-limit'})).reason,'ACTION_LIMIT');other.controller.close();
});
test('snapshot barrier can prove not applied without changing revision or page',async()=>{
  const {controller,ack,packets,last}=await atThree({ackMs:10,totalMs:150});const previous=last();
  const action=controller.execute({action:'previous'},{requestId:'r'}),command=last();await wait(20);
  const sync=packets.find(packet=>packet.type==='slides.sync');
  assert.equal(controller.receive({...binding,type:'slides.snapshot',command_id:command.command_id,sync_id:sync.sync_id,page:3,revision:command.base_revision,applied_command_id:previous.command_id}),true);
  const outcome=await action;assert.equal(outcome.status,'failed');assert.equal(outcome.page,3);assert.equal(outcome.revision,command.base_revision);assert.equal(ack(command),false);controller.close();
});
test('explicit correction replaces queued review only, retaining the dispatched action and its facts',async()=>{
  const {controller,ack,last}=await atThree();
  const first=controller.execute({action:'previous'},{requestId:'first'});
  const queued=controller.execute({action:'previous'},{requestId:'old-queued'});
  const replacement=controller.execute({action:'goto',page:1,replace_pending:true},{requestId:'replace'});
  assert.equal((await queued).reason,'REQUEST_REPLACED');assert.equal(last().page,2);
  ack();assert.equal((await first).page,2);assert.equal(last().page,1);
  const next=controller.execute({action:'previous'},{requestId:'after-replacement'});
  assert.equal(controller.execute({action:'goto',page:1,replace_pending:true},{requestId:'replace'}),replacement);
  ack();assert.equal((await replacement).page,1);assert.equal((await next).reason,'NO_REVIEW_HISTORY');controller.close();
});
test('cancellation clears queued reviews once without claiming an in-flight action was undone',async()=>{
  const {controller,ack}=await atThree();const first=controller.execute({action:'previous'},{requestId:'first'});
  const queued=controller.execute({action:'previous'},{requestId:'second'});
  const cancellation=controller.cancelPendingReviews({requestId:'cancel'}),outcome=await cancellation;
  assert.equal(outcome.cancelled_count,1);assert.equal(outcome.in_flight,true);assert.equal(outcome.page,null);assert.equal(outcome.confirmed,false);
  assert.equal((await queued).reason,'REQUEST_CANCELLED');
  const newRequest=controller.execute({action:'previous'},{requestId:'third'});
  assert.equal(controller.cancelPendingReviews({requestId:'cancel'}),cancellation);
  ack();await first;ack();assert.equal((await newRequest).page,1);controller.close();
});
test('control requests respect authority, retain host work and reject conflicts without queue changes',async()=>{
  const {controller,ack}=await atThree();const first=controller.execute({action:'previous'},{requestId:'first'});
  const host=controller.present(1,{requestId:'host-presentation'}),queued=controller.execute({action:'previous'},{requestId:'review'});
  assert.equal((await controller.execute({action:'goto',page:1,replace_pending:true},{requestId:'stale',isCurrent:()=>false})).reason,'REQUEST_SUPERSEDED');
  assert.equal((await controller.cancelPendingReviews({requestId:'stale-cancel',isCurrent:()=>false})).reason,'REQUEST_SUPERSEDED');
  assert.equal((await controller.cancelPendingReviews({requestId:'first'})).reason,'REQUEST_ID_CONFLICT');
  assert.equal((await controller.cancelPendingReviews({requestId:'valid-cancel'})).cancelled_count,1);
  assert.equal((await queued).status,'cancelled');ack();await first;ack();assert.equal((await host).page,1);controller.close();
});
