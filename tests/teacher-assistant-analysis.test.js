import test from 'node:test';
import assert from 'node:assert/strict';
import {PresetPlanSource} from '../packages/teacher-assistant/preset.js';
import {EvidenceRecorder} from '../packages/teacher-assistant/evidence.js';
import {validEvidence} from '../packages/teacher-assistant/contracts.js';
import {ReportAnalyzer,projectReport,validateReport} from '../packages/teacher-assistant/report.js';

async function fixture(){
  const plan=await new PresetPlanSource().prepare({topic:'dining'},{learner_id:'l1'});
  const attempt={id:'a1',session_id:'s1',plan_hash:plan.hash};
  const ledger=new EvidenceRecorder({attemptId:'a1',sessionId:'s1',planHash:plan.hash,plan});
  let seq=0;
  const input=(text,turn_id=`t${++seq}`)=>ledger.input({type:'user.final',session_id:'s1',turn_id,event_id:`input-${turn_id}`,payload:{text}});
  const output=(text,{turn='t1',response=`r${++seq}`,end='response.done',session='s1'}={})=>{
    for(const [type,payload] of [['response.started',{}],['response.text.delta',{text}],[end,{}]])ledger.forward({type:'event',event:{type,session_id:session,turn_id:turn,response_id:response,event_id:`${response}-${type}`,payload}});
  };
  const seal=(extra={})=>ledger.finalize({ready:true,providerKind:'test',...extra});
  const analyze=snapshot=>new ReportAnalyzer().analyze(plan,snapshot,attempt);
  return {plan,attempt,ledger,input,output,seal,analyze};
}

test('report analyzes organization and sourced semantic replies without claiming hearing, independence or mastery',async()=>{
  const f=await fixture();f.input('我要一碗面条','t1');f.output('好的，一碗面条。口味有什么要求？',{turn:'t1'});f.input('不要辣','t2');
  const s=f.seal(),r=f.analyze(s);assert.equal(s.interactions.length,1);assert.equal(r.analysis.listening.status,'context_response_observed');
  assert.deepEqual(r.analysis.speaking.observations.map(o=>o.id),['order_structure','quantity_phrase','taste_detail']);
  assert.equal(r.analysis.next_steps[0].id,'connect_order');assert.equal(r.analysis.audio.status,'unassessed');assert.equal(r.mastery,'unassessed');assert.equal(r.grade,null);
  assert.match(r.analysis.listening.limitations.join(''),/不证明学生先听后答/);assert.equal(s.interactions[0].support_basis,'unknown');
  const student=projectReport(r,'learner'),teacher=projectReport(r,'teacher');
  assert.equal(student.analysis.listening.observations[0].example,'不要辣');
  assert.equal(student.analysis.listening.observations[0].evidence,undefined);assert.equal(student.grade,undefined);
  assert.equal(teacher.analysis.listening.observations[0].evidence.length,2);
  assert.equal(teacher.analysis.listening.observations[0].evidence[0].role,'kai_question');
  assert.ok(!s.replies.some(reply=>'text' in reply));validateReport(r,f.plan,s,f.attempt);
});

test('analysis changes with actual expression, uses extension instead of fabricated weakness, and deduplicates turns',async()=>{
  const f=await fixture();f.input('我要一碗面条，不要辣','t1');f.input('我要一碗面条，不要辣','t1');f.input('我要饺子','t2');
  const r=f.analyze(f.seal());assert.equal(r.analysis.coverage.accepted_turns,2);assert.equal(r.analysis.coverage.expression_turns,2);
  assert.ok(r.analysis.speaking.observations.some(o=>o.id==='connected_information'));
  assert.ok(r.analysis.speaking.observations.some(o=>o.id==='reuse_order_food'));
  assert.equal(r.analysis.next_steps[0].id,'transfer_order');assert.equal(r.analysis.next_steps[0].basis,'extension');
});

for(const [label,run] of [
  ['cancelled prompt',f=>{f.input('我要面条','t1');f.output('口味有什么要求？',{end:'response.cancelled'});f.input('不要辣','t2');}],
  ['unfinished prompt',f=>{f.input('我要面条','t1');f.output('口味有什么要求？',{end:'response.audio.chunk'});f.input('不要辣','t2');}],
  ['late response for old turn',f=>{f.input('我要面条','t1');f.input('谢谢','t2');f.output('口味有什么要求？',{turn:'t1'});f.input('不要辣','t3');}],
  ['cross-session output',f=>{f.input('我要面条','t1');f.output('口味有什么要求？',{session:'other'});f.input('不要辣','t2');}],
  ['quoted reply',f=>{f.input('我要面条','t1');f.output('口味有什么要求？');f.input('他说“不要辣”','t2');}],
  ['uncertain recognition',f=>{f.input('我要面条','t1');f.output('口味有什么要求？');f.input('识别不确定，不要辣','t2');}],
  ['intervening input consumes question',f=>{f.input('我要面条','t1');f.output('口味有什么要求？');f.input('天气真好','t2');f.input('不要辣','t3');}],
  ['truncated output',f=>{f.input('我要面条','t1');f.output('好'.repeat(330)+'。口味有什么要求？');f.input('不要辣','t2');}]
])test(`listening observations exclude ${label}`,async()=>{const f=await fixture();run(f);const r=f.analyze(f.seal());assert.equal(r.analysis.listening.observations.length,0);});

test('quantity response is contextual evidence without pretending the whole goal was achieved',async()=>{
  const f=await fixture();f.input('我想点餐','t1');f.output('你要几碗？');f.input('一碗','t2');const r=f.analyze(f.seal());
  assert.equal(r.analysis.listening.observations.length,1);assert.equal(r.goals[0].status,'unassessed');
});

test('late-session observations are collected; capacity gaps are explicit and fences immutable',async()=>{
  const f=await fixture();for(let i=1;i<=6;i++)f.input('你好',`t${i}`);f.input('我要面条','t7');f.output('口味有什么要求？',{turn:'t7'});f.input('不要辣','t8');
  assert.equal(f.analyze(f.seal()).analysis.listening.observations.length,1);
  assert.equal(f.input('我要饺子','late'),false);const sealed=f.seal();sealed.observations[0].excerpt='changed';assert.notEqual(f.seal().observations[0].excerpt,'changed');
  const g=await fixture();for(let i=0;i<30;i++)g.input('我要面条',`t${i}`);const r=g.analyze(g.seal());assert.equal(r.analysis.coverage.accepted_turns,30);assert.equal(r.analysis.coverage.expression_turns,24);assert.equal(r.analysis.coverage.truncated,true);assert.match(r.limitations.join(''),/不能代表整场/);
});

test('revocation and safety suppression remove all new content; unavailable provider never proves performance',async()=>{
  for(const reason of ['authorization_revoked','safety_restricted']){
    const f=await fixture();f.input('我要面条','t1');f.output('口味有什么要求？');f.input('不要辣','t2');const s=f.seal({endReason:reason});assert.deepEqual(s.interactions,[]);assert.deepEqual(s.organization_observations,[]);assert.equal(f.analyze(s).analysis.speaking.status,'unassessed');
  }
  const f=await fixture();f.input('我要面条','t1');const r=f.analyze(f.seal({ready:false}));assert.equal(r.analysis.speaking.status,'unassessed');
});

test('source and semantic tampering are rejected before reporting or storage',async()=>{
  const f=await fixture();f.input('我要面条','t1');f.output('口味有什么要求？');f.input('不要辣','t2');const s=f.seal();
  for(const change of [s=>s.interactions[0].prompt.response_id='invented',s=>s.interactions[0].interpretation='听力很好',s=>s.interactions[0].answer.excerpt='我不要面条',s=>s.interactions[0].answer.turn_id='t1',s=>s.observations[0].excerpt='面条']){
    const bad=structuredClone(s);change(bad);assert.throws(()=>validEvidence(bad,f.attempt,f.plan),/INVALID/);
  }
  const report=f.analyze(s);report.analysis.speaking.observations[0].description='已掌握';assert.throws(()=>validateReport(report,f.plan,s,f.attempt),/INVALID_REPORT_ANALYSIS/);
});

test('legacy fences remain readable without manufacturing question-answer evidence',async()=>{
  const f=await fixture();f.input('我要面条','t1');const s=f.seal();for(const k of ['analysis_version','interactions','recognized_questions','organization_observations'])delete s[k];const r=f.analyze(s);assert.equal(r.analysis.coverage.legacy_evidence,true);assert.equal(r.analysis.listening.status,'unassessed');
});

test('explicit reasoning, sequencing and clarification retain minimal observations without diagnosing generic goals',async()=>{
  const f=await fixture();f.input('我喜欢蝴蝶，因为它的翅膀很漂亮','t1');f.input('我先去了公园，然后看见了蝴蝶','t2');f.input('请再说一遍','t3');f.input('他说“我喜欢蝴蝶，因为它很漂亮”','t4');const r=f.analyze(f.seal());
  assert.deepEqual(r.analysis.speaking.observations.map(o=>o.id),['reason_link','sequence_link','clarification']);assert.equal(r.analysis.coverage.expression_turns,3);assert.ok(r.goals.every(g=>g.status==='unassessed'));
});

test('new topic keeps generic organization observations separate from unassessed goal semantics',async()=>{
  const {AIPlanSource}=await import('../packages/teacher-assistant/ai-plan-source.js');const {AuthoredHomeworkTransport}=await import('./helpers/homework-planning.js');
  const plan=await new AIPlanSource({transport:new AuthoredHomeworkTransport(),source:'synthetic'}).prepare({topic:'昆虫',kind:'description',direction:'描述昆虫的外形',target_pattern:null},{learner_id:'l1'});
  const ledger=new EvidenceRecorder({attemptId:'a1',sessionId:'s1',planHash:plan.hash,plan});
  for(const [turn,text] of [['t1','我喜欢蝴蝶，因为它的翅膀很漂亮'],['t2','请再说一遍'],['t3','我要一碗面条']])ledger.input({type:'user.final',turn_id:turn,event_id:turn,payload:{text}});
  const snapshot=ledger.finalize({ready:true,providerKind:'test'}),report=new ReportAnalyzer().analyze(plan,snapshot,{id:'a1',session_id:'s1',plan_hash:plan.hash});
  assert.equal(report.goals.every(g=>g.status==='unassessed'),true);assert.equal(report.analysis.speaking.status,'observed');assert.match(report.headline,/昆虫/);assert.equal(report.analysis.support.status,'help_observed');
  assert.equal(report.analysis.next_steps.some(s=>/面条|口味/.test(s.activity)),false);assert.equal(snapshot.observations.length,0);
  report.analysis.coverage.private_grade='A';report.analysis.speaking.private_note='private';report.analysis.next_steps[0].private_note='private';
  assert.ok(!JSON.stringify(projectReport(report,'learner')).includes('private'));
});
