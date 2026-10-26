import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setupSlidesGateway as setup} from './helpers/slides-gateway.js';
import {until} from './helpers/realtime.js';
const results=x=>x.sent.filter(packet=>packet.type==='conversation.item.create').flatMap(packet=>packet.items).map(item=>({id:item.call_id,...JSON.parse(item.content[0].text)}));
function reply(x,id,question,text){
  x.wire({type:'response.output_text.delta',response_id:id,question_id:question,delta:text});
  x.wire({type:'response.output_text.done',response_id:id,question_id:question,text});
  x.wire({type:'response.output_audio.started',response_id:id,question_id:question});
  x.wire({type:'response.output_audio.delta',delta:'AAAAAA=='});
  x.wire({type:'response.output_audio.done',response_id:id,question_id:question});
}
test('a page reply first arriving after a newer learner question cannot take the screen or audio lane',async t=>{
  const x=await setup(t,{replyGraceMs:0});await x.ready();x.hold();x.input('old','回到上一页。');x.call('old-call');await until(()=>x.commands.length===4);
  x.input('new','下一页用英语怎么说？');x.ack(x.commands[3]);await until(()=>results(x).length===1);
  reply(x,'old-reply','old','旧翻页确认不应播放。');reply(x,'new-reply','new','新问题回应。');
  await until(()=>x.packets.some(packet=>packet.event?.payload?.text==='新问题回应。'));
  assert.equal(results(x)[0].status,'applied');assert.equal(results(x)[0].page,2);
  assert.ok(!x.packets.some(packet=>packet.event?.payload?.text==='旧翻页确认不应播放。'));
  assert.ok(!x.sent.some(packet=>packet.type==='response.cancel'));assert.ok(!x.packets.some(packet=>packet.type==='session.failed'));
});
test('explicit correction replaces queued relative review while retaining the original dispatched command',async t=>{
  const x=await setup(t);await x.ready();x.hold();x.input('first','回上一页。');x.call('one');x.call('two');await until(()=>x.commands.length===4);
  x.input('correction','不是上一页，改成第一页。');x.call('correct',{action:'goto',page:1,replace_pending:true});
  await until(()=>results(x).some(result=>result.id==='two'));assert.equal(results(x).find(result=>result.id==='two').reason,'REQUEST_REPLACED');
  x.ack(x.commands[3]);await until(()=>x.commands.length===5);assert.equal(x.commands[4].page,1);x.ack(x.commands[4]);
  await until(()=>results(x).length===3);assert.deepEqual(x.commands.slice(3).map(command=>command.page),[2,1]);
  assert.equal(results(x).find(result=>result.id==='one').status,'applied');assert.equal(results(x).find(result=>result.id==='correct').status,'applied');
});
test('fresh speech begun during a revoked configuration cannot arm tools even when its final follows the ACK',async t=>{
  const x=await setup(t);await x.ready();x.input('cancel','算了不要翻了。');x.call('cancel',{},x.tools().find(tool=>tool.name.startsWith('cancel_pending_slides_')).name);
  await until(()=>results(x).length===1);x.reply('cancel-reply','cancel');await until(()=>x.sent.some(packet=>packet.type==='session.update'));
  const nextName=x.tools().find(tool=>tool.name.startsWith('navigate_slides_')).name;
  x.wire({type:'conversation.item.input_audio_transcription.started',item_id:'during-update'});
  x.wire({type:'session.updated',session:{id:'raw-session'}});
  x.wire({type:'conversation.item.input_audio_transcription.completed',item_id:'during-update',text:'回上一页。'});x.call('not-fresh',{action:'previous'},nextName);
  await until(()=>results(x).length===2);assert.equal(results(x)[1].reason,'FRESH_INPUT_REQUIRED');assert.equal(x.commands.length,3);
  x.reply('during-reply','during-update');x.input('fresh','再回上一页。');x.call('fresh',{action:'previous'},nextName);
  await until(()=>results(x).some(result=>result.id==='fresh'));assert.equal(results(x).find(result=>result.id==='fresh').page,2);
});
test('ending a session with dispatched and queued review isolates both from a new WebSocket generation',async t=>{
  const x=await setup(t);await x.ready();x.hold();x.input('first','回上一页。');x.call('one');x.call('two');await until(()=>x.commands.length===4);
  x.send({type:'session.end'});await once(x.ws,'close');const previous=x.commands[3];
  const next=await setup(t);await next.ready();next.send({type:'slides.ack',...x.binding(),command_id:previous.command_id,status:'applied',page:previous.page,revision:previous.revision});
  next.input('new','回上一页。');next.call('new');await until(()=>results(next).length===1);
  assert.equal(results(next)[0].page,2);assert.equal(next.commands.length,4);assert.equal(results(x).length,0);
});
