import test from 'node:test';import assert from 'node:assert/strict';
import {syntheticRecord,textRef} from './helpers/teaching-record.js';
import {ConversationReportAnalyzer,textWindows,validateSemanticResult,SEMANTIC_VERSION} from '../packages/teacher-assistant/deep-analysis/semantic.js';
import {semanticPlan,syntheticSemanticTransport} from './helpers/semantic-analysis.js';
test('semantic analysis covers long non-dining records, including the final window, with exact source refs',async()=>{
  const record=syntheticRecord({rounds:100});let calls=0;const analyzer=new ConversationReportAnalyzer({transport:syntheticSemanticTransport()});
  const result=await analyzer.analyze(semanticPlan,record,{beforeCall:async()=>calls++});assert.ok(calls>1);assert.equal(result.coverage.unprocessed_windows,0);assert.ok(result.coverage.windows.every(w=>w.state==='complete'));assert.ok(result.candidates.some(c=>c.evidence_refs.some(ref=>ref.source_id==='learner-99')));assert.ok(result.candidates.every(c=>c.status==='review_required'&&c.support==='unknown'));assert.equal(validateSemanticResult(result,record),result);
});
test('invented refs, acoustic diagnoses, grades and interrupted question claims are rejected after one repair',async()=>{
  for(const change of [v=>{v.observations[0].evidence_refs[0].quote='伪造原文';},v=>{v.observations[0].observation='这次声调不准';},v=>{v.observations[0].observation='说话没有停顿，语速合适';},v=>{v.grade='A';}]){
    let calls=0;const record=syntheticRecord(),analyzer=new ConversationReportAnalyzer({transport:syntheticSemanticTransport(v=>{calls++;change(v);return v;})});const result=await analyzer.analyze(semanticPlan,record);assert.equal(calls,2);assert.equal(result.candidates.length,0);assert.equal(result.coverage.windows[0].state,'failed');
  }
  const record=syntheticRecord({interrupted:true}),result=await new ConversationReportAnalyzer({transport:syntheticSemanticTransport()}).analyze(semanticPlan,record);assert.equal(result.candidates.length,0);assert.equal(result.coverage.windows[0].state,'failed');
});
test('authorization failure and restricted/private input never reach the model',async()=>{
  let calls=0;const analyzer=new ConversationReportAnalyzer({transport:{...syntheticSemanticTransport(),completeJSON:async()=>{calls++;return {};}}});
  await assert.rejects(analyzer.analyze(semanticPlan,syntheticRecord(),{beforeCall:()=>{throw new Error('RECORD_AUTHORIZATION_REVOKED');}}),/RECORD_/);assert.equal(calls,0);
  const record=syntheticRecord();record.transcript[1].text='我的手机号是13812345678';const {snapshot_hash,...body}=record;const {sealRecord}=await import('../packages/teacher-assistant/teaching-record/contracts.js');
  await assert.rejects(analyzer.analyze(semanticPlan,sealRecord(body)),/RESTRICTED/);assert.equal(calls,0);
});
test('commit validator rejects future questions, unprocessed windows and foreign snapshots',async()=>{
  const record=syntheticRecord({rounds:2}),result=await new ConversationReportAnalyzer({transport:syntheticSemanticTransport()}).analyze(semanticPlan,record);
  const bad=structuredClone(result),understanding=bad.candidates.find(c=>c.dimension==='context_understanding');understanding.evidence_refs=[textRef(record,'kai-1'),textRef(record,'learner-0')];assert.throws(()=>validateSemanticResult(bad,record),/ORDER/);
  assert.throws(()=>validateSemanticResult({...result,snapshot_hash:'a'.repeat(64)},record),/SEMANTIC_RESULT/);
  const missed=structuredClone(result);missed.coverage.windows[0].state='failed';missed.coverage.windows[0].reason='output_rejected';assert.throws(()=>validateSemanticResult(missed,record),/WINDOW_SOURCE/);
});
test('model repair is bounded, timeout does not accept a late response, and large context exposes omitted windows',async()=>{
  const hold=setTimeout(()=>{},200);try{
    const analyzer=new ConversationReportAnalyzer({transport:{...syntheticSemanticTransport(),completeJSON:()=>new Promise(resolve=>setTimeout(()=>resolve({observations:[]}),80))},windowBudgetMs:15,budgetMs:100});const result=await analyzer.analyze(semanticPlan,syntheticRecord());assert.equal(result.coverage.windows[0].reason,'timeout');assert.equal(result.candidates.length,0);
  }finally{clearTimeout(hold);}
  const record=syntheticRecord({rounds:1000}),windows=textWindows(record);assert.ok(windows.length>12);
  const result=await new ConversationReportAnalyzer({transport:syntheticSemanticTransport()}).analyze(semanticPlan,record);assert.equal(result.coverage.windows.length,12);assert.equal(result.coverage.unprocessed_windows,windows.length-12);assert.equal(result.analyzer_version,SEMANTIC_VERSION);
});
