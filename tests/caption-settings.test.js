import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {classifyCaptionPinyin} from '../packages/agent-core/caption-settings.js';
import {CaptionSettings} from '../apps/realtime-gateway/src/caption-settings.js';
import {TeachingSession} from '../packages/agent-core/teaching.js';
import {setupSlidesGateway} from './helpers/slides-gateway.js';
import {until} from './helpers/realtime.js';
const event=text=>({version:1,event_id:randomUUID(),session_id:'synthetic',seq:1,at_ms:0,type:'user.final',turn_id:randomUUID(),payload:{text}});
test('pinyin display commands distinguish disable, enable, quotes, negation and other settings',()=>{
 for(const text of ['关闭拼音','请把拼音关掉。','不要显示拼音了','不用拼音','帮我把字幕上的拼音关掉，中文保留。','拼音关闭','Please hide the pinyin in the captions but keep the Chinese.','turn off pinyin'])assert.equal(classifyCaptionPinyin(text),false,text);
 for(const text of ['打开拼音','重新打开拼音','请把字幕拼音再打开','恢复拼音显示','show pinyin again','Please turn on pinyin.'])assert.equal(classifyCaptionPinyin(text),true,text);
 for(const text of ['不要关闭拼音','别关掉拼音','不要关掉拼音，继续显示','“关闭拼音”用英语怎么说','关闭拼音是什么意思','他说关闭拼音','关闭字幕','结束对话','关闭拼音，然后解释银行','关闭拼音，打开拼音','我想学拼音',"don't hide pinyin",''])assert.equal(classifyCaptionPinyin(text),null,text);
});
function coordinator(t,options={}){const packets=[],spoken=[],applied=[];const c=new CaptionSettings({sessionId:'synthetic',send:p=>packets.push(p),speak:(...a)=>spoken.push(a),available:()=>true,settled:()=>true,onApplied:v=>applied.push(v),voiceSupported:true,...options});t.after(()=>c.close());const ack=(p=packets.findLast(p=>p.type==='caption.settings'),extra={})=>c.acknowledge({...p,status:'applied',...extra});return {c,packets,spoken,applied,ack};}
test('voice acknowledgement waits for exact UI receipt and preserves accepted input provenance',t=>{
 const f=coordinator(t),e=event('关闭拼音');f.c.input(e,{enabled:false});assert.equal(f.c.enabled,true);assert.equal(f.spoken.length,0);
 assert.equal(f.ack(undefined,{revision:999}),false);assert.equal(f.ack(undefined,{session_id:'foreign'}),false);assert.equal(f.spoken.length,0);
 assert.equal(f.ack(),true);assert.equal(f.c.enabled,false);assert.equal(f.spoken.length,1);assert.equal(f.spoken[0][1].turn_id,e.turn_id);assert.equal(f.spoken[0][1].request_id,e.event_id);assert.match(f.spoken[0][0],/已关闭/);
});
test('rapid opposite settings reject late receipts and never announce the superseded state',t=>{
 const f=coordinator(t);f.c.input(event('关闭拼音'),{enabled:false});const old=f.packets.findLast(p=>p.type==='caption.settings');f.c.input(event('打开拼音'),{enabled:true});assert.equal(f.ack(old),false);f.ack();assert.equal(f.c.enabled,true);assert.equal(f.spoken.length,1);assert.match(f.spoken[0][0],/已打开/);
});
test('ordinary barge-in retains the pending UI action while suppressing stale spoken confirmation',t=>{
 const f=coordinator(t);f.c.input(event('关闭拼音'),{enabled:false});f.c.input(event('我们聊音乐'),null);assert.equal(f.ack(),true);assert.equal(f.c.enabled,false);assert.equal(f.spoken.length,0);assert.deepEqual(f.applied,[false]);
});
test('unavailable or timed out renderer never proves application or speaks success',async t=>{
 const f=coordinator(t,{ackMs:15});f.c.input(event('打开拼音'),{enabled:true});f.ack(undefined,{status:'unavailable'});assert.equal(f.spoken.length,0);assert.equal(f.applied.length,0);
 f.c.input(event('关闭拼音'),{enabled:false});await new Promise(r=>setTimeout(r,25));assert.equal(f.c.enabled,true);assert.equal(f.spoken.length,0);assert.equal(f.packets.at(-1).phase,'failed');
});
test('confirmed caption settings survive context refresh and never become learning evidence',async()=>{
 const s=new TeachingSession({sessionId:'synthetic',mode:'free'});s.captionControls=true;const e=event('关闭拼音');assert.equal(s.accept(e),true);assert.equal(s.view().decision.action,'RESPOND');assert.equal(s.view().attempt_count,0);assert.equal(await s.planTurn(e),null);assert.equal(s.captionPinyin,true);s.setCaptionPinyin(false);s.updateMemory([]);assert.equal(s.contextSnapshot().caption_settings.pinyin_enabled,false);assert.match(s.instructions(),/拼音状态：隐藏/);assert.equal(new TeachingSession({sessionId:'new',mode:'free'}).captionPinyin,true);
});
test('ordinary Gateway owns voice setting, component ACK, fixed confirmation and playback without changing speed or tools',async t=>{
 const f=await setupSlidesGateway(t,{slidesControls:false});await f.ready();f.input('off','关闭拼音');
 await until(()=>f.packets.some(p=>p.type==='caption.settings'));const command=f.packets.findLast(p=>p.type==='caption.settings');assert.equal(command.pinyin_enabled,false);assert.equal(f.sent.some(p=>p.type==='speech_text_buffer.commit'),false);
 f.wire({type:'response.output_text.delta',response_id:'auto-off',question_id:'off',delta:'自动确认不应展示'});f.wire({type:'response.canceled',response_id:'auto-off'});
 assert.equal(f.sent.some(p=>p.type==='speech_text_buffer.commit'),false);
 f.send({type:'caption.ack',session_id:command.session_id,request_id:command.request_id,revision:command.revision,pinyin_enabled:false,status:'applied'});
 await until(()=>f.sent.some(p=>p.type==='speech_text_buffer.commit'));assert.match(f.sent.find(p=>p.type==='speech_text_buffer.commit').text,/已关闭字幕拼音/);
 f.wire({type:'response.output_audio.started',response_id:'fixed-off',question_id:'fixed-question'});f.wire({type:'response.output_audio.delta',response_id:'fixed-off',delta:Buffer.alloc(4800).toString('base64')});f.wire({type:'response.output_audio.done',response_id:'fixed-off',question_id:'fixed-question'});
 await until(()=>f.packets.some(p=>p.type==='caption.state'&&p.phase==='awaiting_after_playback'));
 const state=f.packets.findLast(p=>p.type==='caption.state'&&p.phase==='awaiting_after_playback');f.send({type:'caption.playback',request_id:state.request_id,response_id:state.response_id,phase:'after',state:'played',audio_ms:state.audio_ms});
 await until(()=>f.sent.some(p=>p.type==='session.update'));const update=f.sent.findLast(p=>p.type==='session.update');assert.match(update.session.instructions,/拼音状态：隐藏/);assert.equal(update.session.audio.output.speed,-20);assert.equal(update.session.tools?.length??0,0);assert.ok(!f.packets.some(p=>p.event?.payload.text==='自动确认不应展示'));
});
test('manual caption setting shares exact receipts and does not fabricate a speech input',async t=>{
 const f=await setupSlidesGateway(t,{slidesControls:false});await f.ready();const config=f.packets.find(p=>p.type==='session.config');assert.equal(config.captions.pinyin_enabled,true);
 f.send({type:'caption.set',session_id:config.session_id,pinyin_enabled:false});await until(()=>f.packets.some(p=>p.type==='caption.settings'));const command=f.packets.findLast(p=>p.type==='caption.settings');f.send({type:'caption.ack',session_id:command.session_id,request_id:command.request_id,revision:command.revision,pinyin_enabled:false,status:'applied'});await until(()=>f.sent.some(p=>p.type==='session.update'));assert.equal(f.sent.some(p=>p.type==='speech_text_buffer.commit'),false);
});
test('a final-only second command cannot cancel its own confirmation while interrupting the previous fixed reply',async t=>{
 const f=await setupSlidesGateway(t,{slidesControls:false});await f.ready();
 async function ackSettings(){await until(()=>f.packets.filter(p=>p.type==='caption.settings').length>=(f.captionCommands??0)+1);const p=f.packets.findLast(p=>p.type==='caption.settings');f.captionCommands=(f.captionCommands??0)+1;f.send({type:'caption.ack',session_id:p.session_id,request_id:p.request_id,revision:p.revision,pinyin_enabled:p.pinyin_enabled,status:'applied'});return p;}
 f.input('first','关闭拼音');f.wire({type:'response.output_text.delta',response_id:'auto-first',question_id:'first',delta:'旧自动回复'});f.wire({type:'response.canceled',response_id:'auto-first'});await ackSettings();await until(()=>f.sent.some(p=>p.type==='speech_text_buffer.commit'));
 f.wire({type:'response.output_audio.started',response_id:'old-fixed',question_id:'old-fixed-question'});f.wire({type:'response.output_audio.delta',response_id:'old-fixed',delta:Buffer.alloc(4800).toString('base64')});f.wire({type:'response.output_audio.done',response_id:'old-fixed',question_id:'old-fixed-question'});
 await until(()=>f.packets.some(p=>p.type==='caption.state'&&p.phase==='awaiting_after_playback'));const old=f.packets.findLast(p=>p.type==='caption.state'&&p.phase==='awaiting_after_playback');f.send({type:'caption.playback',request_id:old.request_id,response_id:old.response_id,phase:'after',state:'played',audio_ms:old.audio_ms});
 await until(()=>f.sent.some(p=>p.type==='session.update'));f.wire({type:'session.updated',session:{id:'raw-session'}});
 // No partial event: the accepted final and old-reply interruption occur together.
 f.input('second','重新打开拼音');await ackSettings();f.wire({type:'response.output_text.delta',response_id:'auto-second',question_id:'second',delta:'新自动回复'});f.wire({type:'response.canceled',response_id:'auto-second'});
 await until(()=>f.sent.filter(p=>p.type==='speech_text_buffer.commit').length===2);assert.match(f.sent.findLast(p=>p.type==='speech_text_buffer.commit').text,/已打开字幕拼音/);
});
