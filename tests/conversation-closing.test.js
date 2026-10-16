import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {TeachingSession} from '../packages/agent-core/teaching.js';
import {ClosingCoordinator} from '../apps/realtime-gateway/src/closing-coordinator.js';
import {ConversationStore} from '../apps/hskai-mock/src/conversation-store.js';
import {startMockBackend} from '../apps/hskai-mock/src/backend.js';
import {setup,until} from './helpers/realtime.js';
import {projectSummary} from '../apps/realtime-gateway/public/summary-cards.js';
import {ClosingPlayback} from '../apps/realtime-gateway/public/closing-playback.js';
const e=(type,text,turn='t',response='r')=>({version:1,event_id:randomUUID(),session_id:'s',seq:1,at_ms:0,type,turn_id:turn,...(type.startsWith('response.')?{response_id:response}:{}),payload:text?{text}:{}});
const output=(session,text,turn='t',response='r')=>{for(const event of [e('response.started',null,turn,response),e('response.text.delta',text,turn,response),e('response.done',null,turn,response)])session.forward({type:'event',event});};
test('nonterminal recap keeps actual vocabulary and expressions separately from attempted-only results',()=>{
  const s=new TeachingSession({sessionId:'s',mode:'free'});s.accept(e('user.final','subway中文怎么说？'));
  output(s,'中文可以说“地铁”。比如说“我坐地铁上班”。');
  const a=s.summarySnapshot();assert.equal(a.objective.initial_goal,null);assert.equal(a.objective.progress,'unverified');assert.deepEqual(a.knowledge_points.map(k=>k.text),['地铁','我坐地铁上班']);assert.equal(s.evidence.length,0);assert.equal(s.closed,undefined);
  a.knowledge_points.length=0;assert.equal(s.summarySnapshot().knowledge_points.length,2);
  s.accept(e('user.final','就聊到这儿吧。','end'));assert.equal(s.stage,'closing');
  output(s,'我们刚才说到了“假的收尾新知识”。再见。','end','end-r');assert.equal(s.summarySnapshot().knowledge_points.length,2);
  const summary=s.finalize();assert.equal(summary.counts.attempts,0);assert.equal(summary.session_recap.knowledge_points.length,2);
});
test('cancelled and incomplete replies never supply recap examples; a later stop cannot erase completed forwarded facts',()=>{
  const s=new TeachingSession({sessionId:'s',mode:'free'});s.accept(e('user.final','帮我说中文。'));
  s.forward({type:'event',event:e('response.started')});s.forward({type:'event',event:e('response.text.delta','中文可以说“地铁”。')});s.forward({type:'event',event:e('response.cancelled')});assert.equal(s.summarySnapshot().knowledge_points.length,0);
  output(s,'中文可以说“地铁”。','t2','r2');s.forward({type:'output.stop',response_id:'r2'});assert.equal(s.summarySnapshot().knowledge_points.length,1);assert.equal(s.summarySnapshot().knowledge_points[0].occurrence,'teacher_demonstrated');
});
test('closing reply completed before final ASR is removed from learning recap',()=>{
  const s=new TeachingSession({sessionId:'s',mode:'free'});output(s,'中文可以说“地铁”。','late','late-r');assert.equal(s.summarySnapshot().knowledge_points.length,1);
  s.accept(e('user.final','今天就到这里吧。','late'));assert.equal(s.summarySnapshot().knowledge_points.length,0);
});
test('explicit vocabulary requests and natural single-quoted explanations keep the actual word and meaning',()=>{
  const s=new TeachingSession({sessionId:'s',mode:'free'});s.accept(e('user.final','这里的坐是什么意思？'));output(s,'‘坐’的意思是乘坐交通工具。比如说‘我坐地铁上班’。');const points=s.summarySnapshot().knowledge_points;
  assert.deepEqual(points.map(p=>p.text),['坐','我坐地铁上班']);assert.equal(points[0].meaning_or_usage,'乘坐交通工具');assert.equal(points[0].occurrence,'teacher_demonstrated');assert.equal(s.evidence.length,0);
});
test('playback closure requires current closing token, owned done and exact audio; continuation fences late receipts',()=>{
  const packets=[];let finished=0;const c=new ClosingCoordinator({sessionId:'s',send:p=>packets.push(p),finish:()=>finished++});
  const summary=new TeachingSession({sessionId:'s',mode:'free'}).summarySnapshot();
  c.input(e('user.final','再见'),{action:'CLOSE'},summary);const token=c.current.closing_id;
  const report={closing_id:token,response_id:'r',summary_revision:summary.revision,state:'played',audio_ms:100};assert.equal(c.report(report),false);
  for(const event of [e('response.started'),{...e('response.audio.chunk'),payload:{byte_length:4800,format:'pcm_s16le'}},e('response.done')])c.forward({type:'event',event,sample_rate:24000});
  assert.equal(c.report({...report,closing_id:'foreign'}),false);assert.equal(c.report({...report,audio_ms:0}),false);
  c.input(e('user.final','等等我还想聊','new'),{action:'RESPOND'},summary);assert.equal(c.report(report),false);assert.equal(finished,0);c.close();
});
test('session record has versioned idempotency, owner isolation, no arbitrary sessions, and erasure',()=>{
  const store=new ConversationStore(),i={owner_id:'o',learner_id:'l'},summary=new TeachingSession({sessionId:'s',mode:'free'}).summarySnapshot(),record={schema_version:'conversation-record-v1',session_id:'s',summary,outcome:'ended',end_reason:'student_end',summary_delivery:'text_only'};
  assert.throws(()=>store.save(i,record),/NOT_FOUND/);store.open(i,'s','free');const a=store.save(i,record);assert.deepEqual(store.save(i,record),a);assert.throws(()=>store.save(i,{...record,outcome:'partial'}),/CONFLICT/);
  assert.throws(()=>store.read({...i,learner_id:'other'},'s'),/NOT_FOUND/);assert.equal(store.read(i,'s').record.summary.objective.initial_goal,null);store.erase(i);assert.throws(()=>store.read(i,'s'),/NOT_FOUND/);
});
async function gateway(t,options={}) {
  const backend=await startMockBackend();t.after(()=>backend.close());const f=await setup(t,{...backend,planningMode:'next_turn_advisory',...options});
  const call=async(method,path,input,uid)=>{const launch=await fetch(f.origin+'/api/poc/launch',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'},body:JSON.stringify(uid?{uid}:{})});return fetch(f.origin+path,{method,headers:{Origin:f.origin,Cookie:launch.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});};
  const ticket=await(await call('POST','/api/sessions',{mode:'free'})).json(),live=await f.open(ticket);
  live.provider.updateContext=v=>{live.provider.contexts.push(v);live.provider.control('context.updated',{version:v.version});};live.provider.emit('session.ready');return {...f,...live,backend,ticket,call};
}
test('oral close saves without checkbox only after owned playback and can be read back under correct learner',async t=>{
  const f=await gateway(t),{provider:p,ws,packets,ticket}=f;
  p.emit('user.final',{text:'subway中文怎么说？'},{turn_id:'help'});p.emit('response.started',{}, {turn_id:'help',response_id:'help-r'});p.emit('response.text.delta',{text:'中文可以说“地铁”。'},{turn_id:'help',response_id:'help-r'});p.emit('response.done',{}, {turn_id:'help',response_id:'help-r'});
  p.emit('user.final',{text:'就聊到这儿吧。'},{turn_id:'end'});p.emit('response.started',{}, {turn_id:'end',response_id:'end-r'});p.emit('response.audio.chunk',{byte_length:4800,format:'pcm_s16le'},{turn_id:'end',response_id:'end-r'},{audio:Buffer.alloc(4800).toString('base64'),sample_rate:24000});p.emit('response.done',{}, {turn_id:'end',response_id:'end-r'});
  await until(()=>packets.some(v=>v.type==='session.closing'&&v.phase==='awaiting_playback'));assert.equal(p.closed,undefined);
  const c=packets.filter(v=>v.type==='session.closing').at(-1);ws.send(JSON.stringify({type:'closing.playback',closing_id:c.closing_id,response_id:c.response_id,summary_revision:c.summary_revision,state:'played',audio_ms:100}));await once(ws,'close');
  assert.equal(packets.find(v=>v.type==='conversation.record.receipt').status,'accepted');const saved=await(await f.call('GET',`/api/conversations/${ticket.session_id}`)).json();assert.equal(saved.record.summary.knowledge_points[0].text,'地铁');assert.equal(saved.record.summary_delivery,'advisory_played');assert.equal(saved.persistence,'process_memory');
  assert.equal((await f.call('GET',`/api/conversations/${ticket.session_id}`,null,'mock-maya-hsk3')).status,404);
  const packet=packets.find(v=>v.type==='teaching.summary');assert.equal(projectSummary(packet,{sessionId:ticket.session_id,mode:'free'}).sessionRecap.knowledge_points[0].text,'地铁');
  const identity=f.backend.bridge.verify(await f.backend.pocPort.issue(),'session:create'),context=await f.backend.planningPort.read(identity);assert.ok(context.learning_history.some(h=>h.resource_id===ticket.session_id&&h.observations[0].includes('会话小结')));assert.equal(packet.summary.counts.attempts,0);
});
test('closing wait timeout ends and saves incomplete delivery without fabricating playback',async t=>{
  const f=await gateway(t,{closingWaitMs:30});f.provider.emit('user.final',{text:'再见。'},{turn_id:'end'});await once(f.ws,'close');const saved=await(await f.call('GET',`/api/conversations/${f.ticket.session_id}`)).json();assert.equal(saved.record.summary_delivery,'incomplete');assert.equal(f.packets.find(p=>p.type==='conversation.record.receipt').status,'accepted');
});
test('immediate end automatically saves summary even when learning-write opt-in is absent',async t=>{
  const f=await gateway(t);f.provider.emit('user.final',{text:'我喜欢音乐。'},{turn_id:'t'});f.ws.send(JSON.stringify({type:'session.end'}));await once(f.ws,'close');const saved=await(await f.call('GET',`/api/conversations/${f.ticket.session_id}`)).json();assert.equal(saved.record.summary.knowledge_points[0].text,'我喜欢音乐');assert.equal(saved.record.summary_delivery,'skipped');
});
test('browser reports once after owned output-clock drain, and never while paused or after cancellation',()=>{
  const sent=[],presentation={current:'r',mode:'complete'};let running=false,queued=10;
  const p=new ClosingPlayback({presentation,getPlayback:()=>({running,queued_ms:queued,received_ms:100}),isMuted:()=>false,send:r=>sent.push(r)}),c={session_id:'s',closing_id:'c',response_id:'r',summary_revision:2,phase:'awaiting_playback'};
  assert.equal(p.update({...c,session_id:'foreign'},'s'),false);p.update(c,'s');assert.equal(sent.length,0);running=true;p.check();assert.equal(sent.length,0);queued=0;p.check();p.check();assert.equal(sent.length,1);assert.equal(sent[0].state,'played');
  p.update({...c,phase:'cancelled'},'s');assert.equal(p.check(),false);
});
test('confirmed interruption blocks an already-completed closing receipt until a new input resolves it',()=>{
  let finished=false;const c=new ClosingCoordinator({sessionId:'s',send:()=>{},finish:()=>{finished=true;}}),summary=new TeachingSession({sessionId:'s',mode:'free'}).summarySnapshot();
  c.input(e('user.final','再见'),{action:'CLOSE'},summary);c.forward({type:'event',event:e('response.started')});c.forward({type:'event',event:e('response.done')});const token=c.current.closing_id;c.suspend();assert.equal(c.report({closing_id:token,response_id:'r',summary_revision:summary.revision,state:'text_only',audio_ms:0}),false);assert.equal(finished,false);c.close();
});
test('a newer student turn cancels closing and late playback cannot disconnect the continued session',async t=>{
  const f=await gateway(t),p=f.provider;p.emit('user.final',{text:'再见。'},{turn_id:'end'});p.emit('response.started',{}, {turn_id:'end',response_id:'end-r'});p.emit('response.done',{}, {turn_id:'end',response_id:'end-r'});
  await until(()=>f.packets.some(v=>v.type==='session.closing'&&v.phase==='awaiting_playback'));const c=f.packets.filter(v=>v.type==='session.closing').at(-1);
  p.emit('user.final',{text:'等等，我还想问一个问题。'},{turn_id:'continue'});f.ws.send(JSON.stringify({type:'closing.playback',closing_id:c.closing_id,response_id:c.response_id,summary_revision:c.summary_revision,state:'text_only',audio_ms:0}));await until(()=>f.packets.some(v=>v.type==='session.closing'&&v.phase==='cancelled'));assert.equal(p.closed,undefined);
  f.ws.send(JSON.stringify({type:'session.end'}));await once(f.ws,'close');
});
test('explicit immediate spoken exit bypasses playback and records skipped delivery',async t=>{
  const f=await gateway(t);f.provider.emit('user.final',{text:'请马上结束对话，不用总结。'},{turn_id:'end'});await once(f.ws,'close');const saved=await(await f.call('GET',`/api/conversations/${f.ticket.session_id}`)).json();assert.equal(saved.record.summary_delivery,'skipped');assert.equal(f.packets.some(p=>p.phase==='awaiting_playback'),false);
});
test('failed server write never claims accepted and the registered record remains unfinished',async t=>{
  const f=await gateway(t);f.backend.planningPort.saveConversation=async()=>{throw new Error('TEST_FAILURE');};f.ws.send(JSON.stringify({type:'session.end'}));await once(f.ws,'close');assert.equal(f.packets.find(p=>p.type==='conversation.record.receipt').status,'failed');const saved=await(await f.call('GET',`/api/conversations/${f.ticket.session_id}`)).json();assert.equal(saved.record,null);
});
test('completed teacher knowledge updates publish the new context version before its ACK',async t=>{
  const f=await gateway(t),p=f.provider;p.emit('user.final',{text:'这里的坐是什么意思？'},{turn_id:'help'});p.emit('response.started',{}, {turn_id:'help',response_id:'help-r'});p.emit('response.text.delta',{text:'“坐”的意思是乘坐交通工具。'},{turn_id:'help',response_id:'help-r'});p.emit('response.done',{}, {turn_id:'help',response_id:'help-r'});
  await until(()=>f.packets.some(p=>p.type==='teaching.context.applied'));
  const state=f.packets.filter(p=>p.type==='teaching.state').at(-1),ack=f.packets.filter(p=>p.type==='teaching.context.applied').at(-1);assert.equal(ack.version,state.context_version);
  f.ws.send(JSON.stringify({type:'session.end'}));await once(f.ws,'close');
});
test('revocation suppresses the recap and cannot automatically write a session record',async t=>{
  const f=await gateway(t);f.provider.emit('user.final',{text:'我喜欢音乐。'},{turn_id:'t'});await f.call('POST','/api/authorization/revoke',{});await until(()=>f.ws.readyState===3);const packet=f.packets.find(p=>p.type==='teaching.summary');assert.equal(packet.summary.focus,'unavailable');assert.equal(packet.summary.session_recap,undefined);const saved=await(await f.call('GET',`/api/conversations/${f.ticket.session_id}`)).json();assert.equal(saved.record,null);
});

test('a valid playback receipt finishes once, while duplicate, negative-duration and wrong-revision reports do not',()=>{
  let finished=0;const c=new ClosingCoordinator({sessionId:'s',send:()=>{},finish:()=>finished++}),summary=new TeachingSession({sessionId:'s',mode:'free'}).summarySnapshot();
  c.input(e('user.final','再见'),{action:'CLOSE'},summary);for(const event of [e('response.started'),e('response.done')])c.forward({type:'event',event});
  const report={closing_id:c.current.closing_id,response_id:'r',summary_revision:summary.revision,state:'text_only',audio_ms:0};
  assert.equal(c.report({...report,summary_revision:summary.revision+1}),false);assert.equal(c.report({...report,audio_ms:-1}),false);assert.equal(c.report(report),true);assert.equal(c.report(report),false);assert.equal(finished,1);c.close();
});
