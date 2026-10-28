import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket from 'ws';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ThaiLanguageSupport,THAI_POLICY} from '../packages/free-talk-thai/language.js';
import {ThaiFreeTalkSession} from '../packages/free-talk-thai/session.js';
import {thaiPlannerTransport} from '../packages/free-talk-thai/planner.js';
import {TeachingSession} from '../packages/agent-core/teaching.js';
import {captionUnits,takeCaptionPhrase} from '../apps/free-talk-thai/public/caption-phrases.js';
import {startMockBackend} from '../apps/hskai-mock/src/backend.js';
import {createThaiApp} from '../apps/free-talk-thai/src/server.js';
import {TestProvider,until} from './helpers/realtime.js';

const event=(session,turn,text)=>({version:1,event_id:randomUUID(),session_id:session,turn_id:turn,seq:1,at_ms:1,type:'user.final',payload:{text}});
test('Thai scenario leaves the eight frozen FreeTalk files byte-identical',()=>{const baseline=JSON.parse(readFileSync('scripts/teacher-assistant/freetalk-baseline.json'));for(const [path,hash] of Object.entries(baseline.files))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),hash,path);});
test('Thai session state does not reinterpret or mutate the saved English language preference',()=>{
  const memory=[{field:'support_language',value:'zh_en',source:'authorized_hskai_profile',updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()}],before=JSON.stringify(memory);
  const en=new TeachingSession({sessionId:'english',mode:'free',memory}),original=en.instructions();
  const th=new ThaiFreeTalkSession({sessionId:'thai',mode:'free',memory});
  assert.equal(th.languageSnapshot().support_locale,'th');assert.equal(th.languageSnapshot().session_preference,'auto');assert.equal(th.languageSnapshot().support_mode,'required');assert.equal(th.languageSnapshot().english_support,'off');
  assert(th.instructions().includes('泰语'));assert(!th.instructions().includes('必要英文紧接'));assert.equal(en.instructions(),original);assert(original.includes('短英文'));assert.equal(JSON.stringify(memory),before);
  assert.throws(()=>new ThaiFreeTalkSession({sessionId:'bad',mode:'topic'}),/THAI_FREE_ONLY/);
});
test('Thai reply-only, session-only, quoted and negated requests stay scoped and reset in a new session',()=>{
  const s=new ThaiLanguageSupport(),turn=(text,id)=>s.observe(text,{turn_id:id,source_event_id:id});
  turn('这次只用中文。','t1');assert.equal(s.snapshot().support_mode,'off');assert.equal(s.snapshot().request_scope,'reply');assert.equal(s.completeReply('old'),false);assert.equal(s.snapshot().support_mode,'off');s.completeReply('t1');assert.equal(s.snapshot().support_mode,'required');
  turn('接下来只用中文。','t2');turn('我没听懂。','t3');assert.equal(s.snapshot().support_mode,'off');turn('这次加上泰语解释。','t4');assert.equal(s.snapshot().support_mode,'required');s.completeReply('t4');assert.equal(s.snapshot().support_mode,'off');
  turn('“加上泰语解释”是什么意思？','t5');assert.equal(s.snapshot().support_mode,'off');turn('不要改成双语。','t6');assert.equal(s.snapshot().support_mode,'off');turn('恢复自动语言模式。','t7');assert.equal(s.snapshot().support_mode,'required');assert.equal(new ThaiLanguageSupport().snapshot().session_preference,'auto');
});
test('Thai context keeps original quoted data intact and uses a distinct content hash',()=>{
  const th=new ThaiFreeTalkSession({sessionId:'thai',mode:'free'}),en=new TeachingSession({sessionId:'english',mode:'free'});
  th.accept(event('thai','t1','我没听懂。'));const snapshot=th.contextSnapshot();assert.equal(snapshot.policy_version,THAI_POLICY);assert.notEqual(snapshot.hash,en.contextSnapshot().hash);assert.equal(snapshot.hash,createHash('sha256').update(snapshot.instructions).digest('hex'));
  assert(snapshot.instructions.includes('最新输入优先'));assert.equal(snapshot.language.support_mode,'required');assert.equal(th.view().cards.length,0);
});
test('Thai planner adaptation changes trusted system messages only',async()=>{
  const messages=[{role:'system',content:'必要时给英文解释。'},{role:'user',content:'{"student_text":"英文怎么说？"}'}],before=JSON.stringify(messages);let request;
  const transport=thaiPlannerTransport({completeJSON:async r=>{request=r;return {ok:true};}});await transport.completeJSON({messages,kind:'turn'});
  assert.equal(JSON.stringify(messages),before);assert(request.messages[0].content.includes('泰语解释'));assert.equal(request.messages[1].content,messages[1].content);
});
test('Thai controls and audit use Thai while Chinese-only controls omit the support language',()=>{
  const s=new ThaiFreeTalkSession({sessionId:'thai',mode:'free'}),request={intent:'slower',changed:true};assert(/\p{Script=Thai}/u.test(s.speechConfirmation(request,'before')));assert(/\p{Script=Thai}/u.test(s.captionConfirmation(false)));
  s.accept(event('thai','t1','只用中文。'));assert(!/\p{Script=Thai}/u.test(s.speechConfirmation(request,'after')));
  const audit=s.createReplyAudit({languageContextMatched:true,language:{support_mode:'required'}});audit.append('我喜欢音乐。 ฉันชอบดนตรี');assert.equal(audit.finish('done').language_order_issue,false);
});
test('Thai captions count Thai words and preserve source text and combining characters',()=>{
  const text='วันนี้ฉันอยากไปเดินเล่นที่สวนสาธารณะ';assert(captionUnits(text)>1);let rest=text,joined='';while(rest){const p=takeCaptionPhrase(rest,{flush:true});assert(p);joined+=p;rest=rest.slice(p.length);}assert.equal(joined,text);
});
async function setup(t){
  const backend=await startMockBackend(),providers=[],server=createThaiApp({backend,providerKind:'test',providerFactory:()=>{const p=new TestProvider();providers.push(p);return p;}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;let cookie;
  t.after(async()=>{server.stopRealtime();await new Promise(r=>{server.close(r);server.closeAllConnections();});await backend.close();});
  const call=async(path,body,headers={})=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const launch=await call('/api/poc/launch',{uid:'poc-learner'});cookie=launch.headers.get('set-cookie').split(';')[0];
  const prepare=async()=>{const r=await call('/api/conversation-preparations',{mode:'free',speech_pace:'slow'}),p=await r.json();const deadline=Date.now()+3000;for(;;){const view=await(await call('/api/conversation-preparations/'+p.preparation_id)).json();if(view.status==='ready')break;if(view.status==='failed'||Date.now()>deadline)throw Error('THAI_PREPARATION_FAILED');await new Promise(r=>setTimeout(r,10));}return {mode:'free',speech_pace:'slow',preparation_id:p.preparation_id};};
  return {server,origin,providers,call,prepare,backend,get cookie(){return cookie;}};
}
test('independent Thai HTTP entry rejects old cookies, foreign learners, new language values and non-free modes',async t=>{
  const f=await setup(t);assert.equal((await f.call('/api/conversation-preparations',{mode:'topic'})).status,400);assert.equal((await f.call('/api/conversation-preparations',{mode:'free',support_locale:'en'})).status,400);
  assert.equal((await f.call('/api/conversation-preparations',{mode:'free'},{Cookie:f.cookie.replace('ask_kai_thai_launch','ask_kai_launch')})).status,401);
  assert.equal((await f.call('/api/conversation-preparations',{mode:'free'},{'X-Ask-Kai-Mock-Uid':'other'})).status,401);
  assert.equal((await f.call('/api/conversation-preparations',{mode:'free'},{Origin:'http://evil.example'})).status,403);assert.equal((await f.call('/api/memory',{field:'support_language',value:'zh_th'})).status,404);
  assert((await(await f.call('/api/runtime')).json()).experimental);
});
test('Thai preparation, ticket, sourced recap and cancellation use the ordinary ownership fences',async t=>{
  const f=await setup(t),entry=await f.prepare(),ticket=await(await f.call('/api/sessions',entry)).json();assert.equal(ticket.scenario,'free_thai');assert.equal(ticket.protocol,'ask-kai.thai.v1');assert.equal((await f.call('/api/sessions',entry)).status,409);
  const ws=new WebSocket(f.origin.replace('http:','ws:')+ticket.websocket_path,[ticket.protocol,'ticket.'+ticket.ticket],{origin:f.origin}),packets=[];ws.on('error',()=>{});ws.on('message',b=>packets.push(JSON.parse(b)));await once(ws,'open');t.after(()=>ws.terminate());const p=f.providers[0];p.emit('session.ready');await until(()=>packets.some(x=>x.event?.type==='session.ready'));
  assert(p.input.instructions.includes('中泰自由对话'));assert(!p.input.instructions.includes('短英文'));
  p.emit('user.final',{text:'我喜欢音乐。'},{turn_id:'t1'});p.emit('response.started',{}, {turn_id:'t1',response_id:'r1'});p.emit('response.text.delta',{text:'音乐很好听。 เพลงเพราะมาก'},{turn_id:'t1',response_id:'r1'});
  ws.send(JSON.stringify({type:'response.cancel',response_id:'r1'}));await until(()=>p.cancelled.includes('r1'));p.emit('response.cancelled',{}, {turn_id:'t1',response_id:'r1'});p.emit('response.text.delta',{text:'迟到泰语'},{turn_id:'t1',response_id:'r1'});
  ws.send(JSON.stringify({type:'session.end',save_learning:true}));await until(()=>packets.some(x=>x.type==='session.closed'));assert(!packets.some(x=>x.event?.payload?.text==='迟到泰语'));
  const summary=packets.find(x=>x.type==='teaching.summary').summary;assert.equal(summary.scenario,'free_thai');assert.equal(summary.assessment.mastery_assessed,false);assert(!summary.headline.en);assert(summary.headline.th);
});
