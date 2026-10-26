import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {until} from './helpers/realtime.js';
import {setupSlidesGateway as setup} from './helpers/slides-gateway.js';
test('ordinary gateway defaults to its original no-tool connection, no viewer handshake',async t=>{
  const x=await setup(t,{slidesControls:false});await x.ready();assert.ok(!x.sent[0].session.tools);assert.ok(!x.packets.some(p=>p.type==='slides.bind'));
});
test('enabled gateway waits for real viewer receipts before native registration and labels authored demo history separately',async t=>{
  const x=await setup(t);await x.ready();assert.deepEqual(x.commands.map(p=>p.page),[1,2,3]);
  assert.equal(x.packets.find(p=>p.type==='slides.bind').history_source,'synthetic_author_demo');
  assert.equal(x.tools().length,2);assert.match(x.sent[0].session.instructions,/不代表学习者看过或学会/);
  assert.ok(x.packets.every(p=>p.synthetic!==false));
  for(const path of ['/slides-viewer.js','/slides-viewer.css','/slides/demo-deck.json'])assert.equal((await fetch(x.origin+path)).status,200);
});
test('native result waits for matching ACK, PCM remains live, and full context preserves tools and speed after the response',async t=>{
  const x=await setup(t);await x.ready();x.hold();x.input('input','帮我回到上一页。');x.call('call');
  await until(()=>x.commands.length===4);assert.equal(x.sent.filter(p=>p.type==='conversation.item.create').length,0);
  x.call('call');x.ws.send(Buffer.alloc(640));await until(()=>x.sent.some(p=>p.type==='input_audio_buffer.append'));
  x.send({type:'slides.ack',...x.binding(),viewer_instance_id:'foreign',command_id:x.commands[3].command_id,status:'applied',page:2,revision:x.commands[3].revision});
  await new Promise(resolve=>setTimeout(resolve,15));assert.ok(!x.sent.some(p=>p.type==='conversation.item.create'));
  x.ack(x.commands[3]);await until(()=>x.sent.some(p=>p.type==='conversation.item.create'));
  const result=x.sent.find(p=>p.type==='conversation.item.create');assert.equal(result.items[0].call_id,'call');assert.equal(JSON.parse(result.items[0].content[0].text).page,2);
  x.call('call');assert.equal(x.sent.filter(p=>p.type==='conversation.item.create').length,1);assert.ok(!x.packets.some(p=>p.type==='session.failed'));
  assert.ok(!x.sent.some(p=>p.type==='session.update'));x.reply();await until(()=>x.sent.some(p=>p.type==='session.update'));
  const update=x.sent.find(p=>p.type==='session.update');assert.equal(update.session.audio.output.speed,-20);assert.equal(update.session.tools.length,2);assert.match(update.session.instructions,/"page":2/);
  x.wire({type:'session.updated',session:{id:'raw-session'}});await until(()=>x.packets.some(p=>p.type==='teaching.context.applied'));
  assert.equal(x.packets.find(p=>p.type==='teaching.context.applied').context_hash,createHash('sha256').update(update.session.instructions).digest('hex'));
});
test('explicit cancel preserves dispatched action, rotates tool epoch only after results and voice boundary, old first arrival cannot execute',async t=>{
  const x=await setup(t);await x.ready();x.hold();x.input('input','帮我回上一页。');const old=x.tools();x.call('first');x.call('queue');
  await until(()=>x.commands.length===4);x.input('cancel-input','算了，不要翻了。');
  x.call('cancel',{},old.find(tool=>tool.name.startsWith('cancel_pending_slides_')).name);
  await until(()=>x.sent.filter(p=>p.type==='conversation.item.create').length===2);
  const cancellation=x.sent.filter(p=>p.type==='conversation.item.create').flatMap(p=>p.items).find(item=>item.call_id==='cancel');
  assert.equal(JSON.parse(cancellation.content[0].text).cancelled_count,1);assert.equal(JSON.parse(cancellation.content[0].text).in_flight,true);
  x.call('late',{action:'previous'},old[0].name);await until(()=>x.sent.filter(p=>p.type==='conversation.item.create').length===3);
  assert.equal(x.commands.length,4);x.ack(x.commands[3]);await until(()=>x.sent.filter(p=>p.type==='conversation.item.create').length===4);
  x.reply('cancel-reply','cancel-input');await until(()=>x.sent.some(p=>p.type==='session.update'));
  assert.notEqual(x.tools()[0].name,old[0].name);x.wire({type:'session.updated',session:{id:'raw-session'}});
  x.input('fresh','再往前一页。');x.call('fresh');await until(()=>x.commands.length===5);assert.equal(x.commands[4].page,1);x.ack(x.commands[4]);
});
test('handshake failure falls back to ordinary voice; closing an in-flight transaction never returns applied',async t=>{
  const absent=await setup(t,{viewer:false,slidesHandshakeMs:20});await absent.ready();assert.ok(!absent.sent[0].session.tools);assert.ok(absent.packets.some(packet=>packet.type==='slides.unavailable'));absent.ws.close();
  const x=await setup(t);await x.ready();x.hold();x.input('input','帮我回上一页。');x.call('first');await until(()=>x.commands.length===4);
  x.send({type:'session.end'});await once(x.ws,'close');assert.ok(!x.sent.some(p=>p.type==='conversation.item.create'));
});
test('speech pace and a native page transaction share a full update without blocking tool results behind fixed confirmations',async t=>{
  const x=await setup(t);await x.ready();x.input('input','慢一点，帮我回上一页。');x.call('mixed');
  await until(()=>x.sent.some(packet=>packet.type==='conversation.item.create'));
  x.reply();await until(()=>x.sent.some(packet=>packet.type==='speech_text_buffer.commit'));
  const fixed=async(phase)=>{
    x.wire({type:'response.output_audio.started',response_id:'fixed-'+phase,question_id:'fixed-question-'+phase});
    x.wire({type:'response.output_audio.delta',response_id:'fixed-'+phase,question_id:'fixed-question-'+phase,delta:'AAAAAA=='});
    x.wire({type:'response.output_audio.done',response_id:'fixed-'+phase,question_id:'fixed-question-'+phase});
    await until(()=>x.packets.some(packet=>packet.type==='speech.state'&&packet.phase==='awaiting_'+phase+'_playback'));
    const state=x.packets.filter(packet=>packet.type==='speech.state').at(-1);
    x.send({type:'speech.playback',request_id:state.request_id,response_id:state.response_id,phase,state:'played',audio_ms:state.audio_ms});
  };
  await fixed('before');await until(()=>x.sent.some(packet=>packet.type==='session.update'));
  const update=x.sent.filter(packet=>packet.type==='session.update').at(-1);assert.equal(update.session.audio.output.speed,-40);assert.equal(update.session.tools.length,2);assert.match(update.session.instructions,/"page":2/);
  x.wire({type:'session.updated',session:{id:'raw-session'}});await until(()=>x.sent.filter(packet=>packet.type==='speech_text_buffer.commit').length===2);
  await fixed('after');await until(()=>x.packets.some(packet=>packet.type==='speech.state'&&packet.phase==='complete'));
  assert.equal(x.commands.at(-1).page,2);assert.ok(!x.packets.some(packet=>packet.type==='session.failed'));
});
test('manual review while a context update waits survives its ACK and recompiles the latest confirmed page',async t=>{
  const x=await setup(t);await x.ready();x.input('input','回上一页。');x.call('first');await until(()=>x.sent.some(packet=>packet.type==='conversation.item.create'));x.reply();
  await until(()=>x.sent.some(packet=>packet.type==='session.update'));const first=x.sent.filter(packet=>packet.type==='session.update').at(-1);
  x.send({type:'slides.intent',...x.binding(),request_id:'manual',intent:{action:'previous'}});await until(()=>x.commands.length===5);
  await until(()=>x.packets.some(packet=>packet.type==='slides.state'&&packet.page===1&&packet.confirmed));
  assert.equal(x.sent.filter(packet=>packet.type==='session.update').length,1);x.wire({type:'session.updated',session:{id:'raw-session'}});
  await until(()=>x.sent.filter(packet=>packet.type==='session.update').length===2);const second=x.sent.filter(packet=>packet.type==='session.update').at(-1);
  assert.match(first.session.instructions,/"page":2/);assert.match(second.session.instructions,/"page":1/);assert.equal(second.session.tools.length,1);assert.match(second.session.tools[0].name,/^cancel_pending_slides_/);
});
