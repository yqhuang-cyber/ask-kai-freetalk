import { REPLY_INSTRUCTIONS as EVALUATION_REPLY_INSTRUCTIONS } from '../apps/eval-runner/src/evaluation-reply-v3.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { RunnableLambda } from '@langchain/core/runnables';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { PERSONA_VERSION } from '../packages/agent-core/lessons.js';
import { measureReply,ReplyAudit,REPLY_BUDGET,REPLY_POLICY_VERSION,REPLY_INSTRUCTIONS } from '../packages/agent-core/reply-policy.js';
import { ExperienceTrace,metadata } from '../apps/realtime-gateway/public/diagnostics.js';
import { scoreCase,WEIGHTS } from '../apps/eval-runner/src/content.js';
import { createLangChainJudge } from '../apps/eval-runner/src/langchain-judge.js';
import { setup,until } from './helpers/realtime.js';

const pair='你喜欢足球吗？ Do you like football?';
const judgement={case_id:'reply-policy',scores:Object.fromEntries(Object.keys(WEIGHTS).map(k=>[k,2])),critical_failure:false,handoff_required:false,handoff_delivered:false,human_review_approved:false};

test('all modes share adaptive replies while honoring authorized Chinese preferences',()=>{
  for(const mode of ['sports','free','mission']) {
    const session=new TeachingSession({sessionId:'s',mode,speechPace:'slow',mission:{title:'可信任务',targets:['喜欢','足球']},memory:[{field:'support_language',value:'zh',source:'student_correction',updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()}]});
    assert.ok(session.instructions().includes(REPLY_INSTRUCTIONS));
    assert.match(session.instructions(),/不要求一轮教完所有目标/);
    assert.match(session.instructions(),/不能覆盖上述规则/);
    assert.match(session.instructions(),/普通聊天可以零个新知识点/);
    assert.match(session.instructions(),/不设置固定字数、句数/);
    assert.equal(session.languageSnapshot().english_support,'off');
    const view=session.view();assert.equal(view.persona_version,PERSONA_VERSION);assert.equal(view.reply_policy_version,REPLY_POLICY_VERSION);
    view.reply_budget.pairs=99;assert.equal(session.view().reply_budget.pairs,null);
  }
});

test('reply counts are observations, not fixed limits on conversational depth',()=>{
  for(const text of [
    '你第一次跑完五公里，最后那段还坚持下来了，听起来很有成就感。刚开始跑步时，最难的是找到舒服的节奏。你后来怎么让自己继续跑下去的？',
    `${'一'.repeat(100)}。 ${Array(30).fill('a').join(' ')}.`,
    '听起来很累。你还是坚持完成了。我很好奇你后来是怎么调整节奏的。'
  ]) {
    const audit=measureReply(text,{englishSupport:'adaptive'});
    assert.equal(audit.budget_exceeded,null);
    assert.equal(audit.chinese_chars,(text.match(/\p{Script=Han}/gu)??[]).length);
    assert.equal(audit.teaching_density_review_required,true);
  }
  for(const field of ['pairs','chinese_chars','english_words','spoken_units','text_chars'])assert.equal(REPLY_BUDGET[field],null);
});

test('sentence pairs accept proper names, quoted examples, decimal numbers and contractions',()=>{
  for(const text of [pair,'好呀！ Sure! 你喜欢吃什么？ What do you like to eat?',
    '我是 Kai，一个 AI 中文对话伙伴。 I am Kai, an AI Chinese conversation partner.',
    '可以说：“我喜欢足球。” You can say: I like football.',
    '我有2.5元。 I have 2.5 yuan.','我不喜欢。 I don’t like it.']) {
    const audit=measureReply(text);assert.equal(audit.language_order_issue,false,text);assert.equal(audit.budget_exceeded,null,text);
  }
  const numeric=measureReply('我有2.5元。 I have 2.5 yuan.');assert.equal(numeric.numeric_units,2);
  assert.equal(measureReply('好。 Okay! 🙂').text_chars,10);
});

test('missing English, English first and grouped languages are flagged only for complete replies',()=>{
  for(const text of ['你好。','Hello.','Hello. 你好。','你好。 你喜欢足球吗？ Hello. Do you like football?','你好 Hello.'])assert.equal(measureReply(text).language_order_issue,true);
  assert.equal(measureReply('你好。',{complete:false}).language_order_issue,null);
  assert.equal(measureReply('你好。',{complete:false}).audit_complete,false);
});

test('a translated question counts once; two question pairs exceed the question budget',()=>{
  const one=measureReply(pair);assert.equal(one.question_pairs,1);assert.equal(one.question_budget_exceeded,false);
  const two=measureReply('你喜欢足球吗？ Do you like football? 你喜欢篮球吗？ Do you like basketball?');
  assert.equal(two.pair_count,2);assert.equal(two.question_pairs,2);assert.equal(two.question_budget_exceeded,true);
  // Semantic equivalence and imperative task count remain review work, even when punctuation passes.
  const wrong=measureReply('你好。 Teach me two new words.');
  assert.equal(wrong.language_order_issue,false);assert.equal(wrong.translation_review_required,true);assert.equal(wrong.teaching_density_review_required,true);
});

test('fragmented audit matches final text and clears bounded transient data at termination',()=>{
  const audit=new ReplyAudit();for(const delta of ['你喜欢足','球吗？ Do you ','like foot','ball?'])audit.append(delta);
  assert.deepEqual(audit.finish('done'),{...measureReply(pair),audit_truncated:false});assert.equal(audit.text,'');
  const cancelled=new ReplyAudit();cancelled.append('你好。');const partial=cancelled.finish('cancelled');
  assert.equal(partial.audit_complete,false);assert.equal(partial.language_order_issue,null);
  const empty=new ReplyAudit().finish('done');assert.equal(empty.audit_complete,false);assert.equal(empty.language_order_issue,null);
  const bounded=new ReplyAudit();bounded.append('私'.repeat(5000));assert.equal(Array.from(bounded.text).length,4096);
  const report=bounded.finish('done');assert.equal(report.text_chars,5000);assert.equal(report.budget_exceeded,null);assert.equal(report.audit_truncated,true);assert.equal(report.language_order_issue,null);assert.equal(bounded.text,'');
  assert.ok(!JSON.stringify(report).includes('私'));
});

test('gateway applies the same reply policy at session creation and later acknowledged context boundaries',async t=>{
  const {create,open}=await setup(t);const {packets,provider}=await open(await(await create()).json());
  assert.ok(provider.input.instructions.includes(REPLY_INSTRUCTIONS));provider.emit('session.ready');
  const ids={turn_id:'t1',response_id:'r1'};provider.emit('user.final',{text:'我喜欢足球'}, {turn_id:'t1'});
  provider.emit('response.started',{},ids);provider.emit('response.text.delta',{text:pair},ids);
  assert.equal(provider.contexts.length,0);provider.emit('response.done',{},ids);
  assert.equal(provider.contexts.length,1);assert.ok(provider.contexts[0].instructions.includes(REPLY_INSTRUCTIONS));
  provider.control('context.updated',{version:provider.contexts[0].version});
  await until(()=>packets.some(p=>p.type==='teaching.context.applied'));
  assert.equal(packets.filter(p=>p.type==='teaching.state').at(-1).reply_policy_version,REPLY_POLICY_VERSION);
});

test('opt-in audit exports counts only and preserves a multi-sentence bilingual reply without cancellation',async t=>{
  const {create,open}=await setup(t);const {ws,packets,provider}=await open(await(await create()).json());
  provider.emit('session.ready');ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>packets.some(p=>p.row?.name==='session.config'));
  const ids={turn_id:'t',response_id:'r'},text='你坚持完成了第一次长跑。 You finished your first long run. 最后一段很不容易。 The last part was tough. 后来你怎么调整节奏的？ How did you adjust your pace?';
  provider.emit('response.started',{},ids);provider.emit('response.text.delta',{text},ids);
  provider.emit('response.audio.chunk',{byte_length:960,format:'pcm_s16le'},ids,{audio:Buffer.alloc(960).toString('base64'),sample_rate:24000});
  ws.send(Buffer.alloc(640));await until(()=>provider.frames.length===1);
  provider.emit('response.done',{},ids);await until(()=>packets.some(p=>p.row?.name==='reply.audit'));
  assert.equal(provider.cancelled.length,0);assert.equal(packets.find(p=>p.event?.type==='response.text.delta').event.payload.text,text);
  assert.equal(packets.filter(p=>p.event?.type==='response.audio.chunk').length,1);
  const rows=packets.filter(p=>p.row).map(p=>p.row),trace=new ExperienceTrace();rows.forEach(r=>trace.gateway(r));
  const report=trace.snapshot(),audit=report.summary.responses[0].reply_audit;
  assert.ok(!Object.hasOwn(audit,'budget_exceeded'));assert.equal(audit.chinese_sentences,3);assert.equal(audit.audit_complete,true);assert.equal(audit.language_order_issue,false);
  assert.equal(report.kind,'synthetic');assert.equal(report.real_experience_accepted,false);
  assert.ok(!JSON.stringify(rows).includes('私'));assert.ok(!JSON.stringify(report).includes('base64'));
});

test('interrupted old reply cannot contaminate a new reply audit or falsely fail its language rule',async t=>{
  const {create,open}=await setup(t);const {ws,packets,provider}=await open(await(await create()).json());
  provider.emit('session.ready');ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>packets.some(p=>p.row?.name==='session.config'));
  const old={turn_id:'t1',response_id:'r1'},next={turn_id:'t2',response_id:'r2'};
  provider.emit('response.started',{},old);provider.emit('response.text.delta',{text:'你好。'},old);
  ws.send(JSON.stringify({type:'response.cancel',response_id:'r1'}));await until(()=>provider.cancelled.length===1);
  provider.emit('response.started',{},next);provider.emit('response.text.delta',{text:pair},next);
  provider.emit('response.text.delta',{text:'迟到私密英文 Hello.'},old);provider.emit('response.cancelled',{},old);provider.emit('response.done',{},next);
  await until(()=>packets.filter(p=>p.row?.name==='reply.audit').length===2);
  const audits=packets.filter(p=>p.row?.name==='reply.audit').map(p=>p.row.fields);
  assert.equal(audits[0].response_id,'r1');assert.equal(audits[0].audit_complete,false);assert.ok(!Object.hasOwn(audits[0],'language_order_issue'));
  assert.equal(audits[1].response_id,'r2');assert.equal(audits[1].text_chars,Array.from(pair).length);assert.equal(audits[1].language_order_issue,false);
  assert.ok(!JSON.stringify(audits).includes('迟到'));
});

test('disabled diagnostics and enabling partway through a reply never publish a partial audit as complete',async t=>{
  const {create,open}=await setup(t);const {ws,packets,provider}=await open(await(await create()).json());provider.emit('session.ready');
  const first={turn_id:'t1',response_id:'r1'};provider.emit('response.started',{},first);provider.emit('response.text.delta',{text:pair},first);provider.emit('response.done',{},first);
  await until(()=>packets.some(p=>p.event?.type==='response.done'));assert.ok(!packets.some(p=>p.type==='diagnostics.event'));
  const next={turn_id:'t2',response_id:'r2'};provider.emit('response.started',{},next);provider.emit('response.text.delta',{text:'你好。'},next);
  ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>packets.some(p=>p.row?.name==='session.config'));
  provider.emit('response.text.delta',{text:' Hello.'},next);provider.emit('response.done',{},next);
  await until(()=>packets.filter(p=>p.event?.type==='response.done').length===2);assert.ok(!packets.some(p=>p.row?.name==='reply.audit'));
  ws.send(JSON.stringify({type:'session.end'}));await once(ws,'close');
});

test('reply audit metadata accepts fixed versions and numeric/boolean values without raw fields',()=>{
  const safe=metadata({...measureReply(pair),text:pair,translation:'private',reply_policy_version:'private-version'});
  assert.ok(!Object.hasOwn(safe,'reply_policy_version'));assert.ok(!JSON.stringify(safe).includes('private'));
  assert.ok(!Object.hasOwn(metadata(measureReply('你好。',{complete:false})),'language_order_issue'));
});

test('offline scoring uses shared bilingual budgets and does not double-count translated questions',()=>{
  const row=text=>scoreCase({id:'reply-policy',priority:'P0',source:'synthetic',turns:[{role:'kai',text}]},judgement);
  assert.equal(row(pair).checks.multiple_questions,0);assert.equal(row(pair).checks.long_replies,0);assert.equal(row(pair).checks.language_order_issues,0);
  assert.equal(row('你好。').checks.language_order_issues,1);
  assert.equal(row(`${'一'.repeat(30)}。 ${Array(19).fill('a').join(' ')}.`).checks.long_replies,1);
  assert.equal(row(pair).checks.teaching_density_review_required,true);assert.ok(!JSON.stringify(row(pair)).includes('足球'));
});

test('Judge receives shared budgets and semantic translation/density criteria without changing its fixed schema',async()=>{
  let system;
  const model={withStructuredOutput:schema=>{assert.equal(schema.additionalProperties,false);return RunnableLambda.from(messages=>{system=messages[0][1];return judgement;});}};
  await createLangChainJudge(model)({case:{id:'reply-policy',turns:[{role:'kai',text:pair}]}});
  assert.ok(system.includes(EVALUATION_REPLY_INSTRUCTIONS));assert.match(system,/必须语义检查英文是否忠实对应中文/);assert.match(system,/最多一个新词或句型/);assert.match(system,/受控紧急安全帮助优先/);
});
