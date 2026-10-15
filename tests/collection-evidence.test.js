import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CollectionEvidence,measureInputPcm,observeMemoryPort } from '../apps/eval-runner/src/collection-evidence.js';
import { sha256 } from '../apps/eval-runner/src/multiturn-plan.js';
import { validateDiagnosticRequest,summarizeCollectionEvidence } from '../apps/eval-runner/src/collection-diagnostic.js';
import { runMultiturn } from '../apps/eval-runner/src/multiturn.js';
import { protocolPeer,fixtureCases,fixtureInputs } from './helpers/multiturn.js';

test('PCM measurements preserve exact enqueue hashes and distinguish transport flush from supplier receipt',()=>{
  let clock=0;const e=new CollectionEvidence({now:()=>clock}),bytes=Buffer.alloc(1280);
  bytes.fill(1,640);const metrics=measureInputPcm(bytes);assert.equal(metrics.first_active_ms,20);assert.equal(metrics.last_active_ms,40);
  assert.equal(metrics.speech_content_verified,false);const row=e.begin(1,bytes);
  clock=10;e.enqueue(row,bytes.subarray(0,640));e.event('provider_adapter','user.final',{turn_id:'turn-1',payload:{text:'must not retain'}});
  clock=30;e.enqueue(row,bytes.subarray(640));
  let s=e.snapshot(1);assert.equal(s.enqueued_sha256,sha256(bytes));assert.equal(s.provider_final_before_input_end,true);
  assert.equal(s.all_input_enqueued,true);assert.equal(s.all_input_transport_flushed,false);
  e.flushed(row,640);e.flushed(row,640);s=e.snapshot(1);assert.equal(s.all_input_transport_flushed,true);
  assert.equal(s.provider_receipt_proven,false);assert.equal(s.playback_measured,false);assert.ok(!JSON.stringify(s).includes('must not retain'));
});

test('evidence caps streamed deltas, preserves first/last counts, and isolates late events from a completed collector turn',()=>{
  const e=new CollectionEvidence(),row=e.begin(1,Buffer.alloc(640,1));e.enqueue(row,Buffer.alloc(640,1));
  for(let n=0;n<300;n++)e.event('provider_adapter','user.partial',{turn_id:'old'});
  assert.equal(e.snapshot(1).event_counts['provider_adapter:user.partial'].count,300);
  assert.equal(e.snapshot(1).events.filter(x=>x.name==='user.partial').length,1);
  e.finishTurn();e.event('provider_adapter','user.final',{turn_id:'old'});
  assert.equal(e.snapshot(1).provider_final_before_input_end,null);
  assert.equal(e.snapshotSession().events.at(-1).collector_turn,null);
});

test('memory observer delegates exact arguments/results/errors, adds no requests and retains no identity/value',async()=>{
  const identity={owner_id:'private-owner',learner_id:'private-learner'},record={field:'support_language',value:'zh',source:'authorized_hskai_profile'},calls=[];
  const error=new Error('private provider message'),records=[record];
  const port={read:async(...args)=>{calls.push(['read',...args]);return records;},write:async(...args)=>{calls.push(['write',...args]);},delete:async(...args)=>{calls.push(['delete',...args]);throw error;}};
  const audit=observeMemoryPort(port);assert.equal(await audit.port.read(identity),records);await audit.port.write(identity,record);
  await assert.rejects(audit.port.delete(identity,'support_language'),e=>e===error);
  assert.equal(calls.length,3);assert.equal(calls[1][1],identity);assert.equal(calls[1][2],record);
  const snapshot=audit.snapshot();assert.equal(snapshot.added_port_calls,0);assert.equal(snapshot.internal_session_memory_observed,false);
  assert.equal(snapshot.write_calls,1);assert.equal(snapshot.delete_calls,1);assert.equal(snapshot.calls[2].status,'failed');
  assert.ok(!JSON.stringify(snapshot).includes('private'));assert.ok(!JSON.stringify(snapshot).includes('"value":"zh"'));
});

test('failed turn retains full enqueue evidence, speech/final timing and read-only mock port audit',async t=>{
  const profile=JSON.parse(await readFile('docs/protocol/seeduplex-profile.template.json'));profile.reviewed=profile.realtime.reviewed=profile.realtime.ordered_acks_reviewed=true;
  const cases=fixtureCases([['你好']]),inputs=fixtureInputs(cases),peer=await protocolPeer(t,{scripts:[['你好']],outputs:[['你好']],omitReplyTurn:1});
  const r=await runMultiturn({cases,inputs,profile,providerKind:'test',providerFactory:peer.providerFactory(profile),
    candidateRevision:'a'.repeat(40),datasetVersion:'fixture',datasetSha256:'b'.repeat(64),manifestSha256:'c'.repeat(64),turnTimeoutMs:700});
  const c=r.observations.cases[0],turn=c.turns[0];assert.equal(c.failure,'TURN_TIMEOUT');assert.equal(turn.reply_complete,false);
  assert.equal(turn.collection_evidence.enqueued_sha256,inputs.values().next().value.sha256);
  assert.equal(turn.collection_evidence.all_input_transport_flushed,true);assert.ok(turn.diagnostics.some(d=>d.name==='user.final'));
  assert.ok(turn.collection_evidence.events.some(e=>e.site==='provider_adapter'&&e.name==='user.speech.candidate'));
  assert.ok(c.memory_audit.calls.some(c=>c.operation==='read'&&c.status==='completed'));assert.equal(c.memory_audit.write_calls,0);
  assert.equal(c.memory_audit.internal_session_memory_observed,false);assert.ok(c.collection_evidence.events.some(e=>e.name==='session.closed'));
  const report=summarizeCollectionEvidence(r.observations);assert.equal(report.partial_turns,1);assert.equal(report.historical_baseline_replaced,false);
  assert.ok(!JSON.stringify(report).includes('你好'));assert.equal(report.internal_memory_audit_covered,false);
});

test('diagnostic request binds frozen runtime, exact cases, budget and historical bundle without exposing gold',async()=>{
  const dataBytes=await readFile('docs/eval-datasets/freechat-v3.1/ask-kai-freechat-eval-v3.1.json'),profileBytes=await readFile('docs/protocol/seeduplex-connect.profile.json');
  const request=JSON.parse(await readFile('.github/live/collection-diagnostic-request.json')),baseline=JSON.parse(await readFile('docs/eval-baselines/freechat-v3.1-baseline.json'));
  const options={baseline,data:JSON.parse(dataBytes),dataSha:sha256(dataBytes),profileBytes,env:{GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40)}};
  const cases=validateDiagnosticRequest(request,options);assert.equal(cases.length,5);assert.deepEqual(Object.keys(cases[0].turns[0]),['turn','text','dependency']);
  for(const change of [{case_ids:['ask-kai-v2-001']},{duration_ms:1},{baseline_artifact_sha256:'a'.repeat(64)},{agent_revision:'a'.repeat(40)},{unexpected:true}])assert.throws(()=>validateDiagnosticRequest({...request,...change},options),/INVALID_COLLECTION_DIAGNOSTIC_REQUEST/);
});

test('a completed model fragment from a split ASR input remains a failed collector turn, never a scored complete reply',async t=>{
  const profile=JSON.parse(await readFile('docs/protocol/seeduplex-profile.template.json'));profile.reviewed=profile.realtime.reviewed=profile.realtime.ordered_acks_reviewed=true;
  const cases=fixtureCases([['你好']]),peer=await protocolPeer(t,{scripts:[['你好','tail']],outputs:[['你好','unused']],omitReplyTurn:2});
  const bytes=Buffer.concat([Buffer.alloc(640,1),Buffer.alloc(19200),Buffer.alloc(640,1),Buffer.alloc(12800)]);
  const inputs=new Map([[`${cases[0].id}/1`,{bytes,source:'synthetic_fixture',sha256:sha256(bytes),duration_ms:bytes.length/32}]]);
  const r=await runMultiturn({cases,inputs,profile,providerKind:'test',providerFactory:peer.providerFactory(profile),
    candidateRevision:'a'.repeat(40),datasetVersion:'fixture',datasetSha256:'b'.repeat(64),manifestSha256:'c'.repeat(64),turnTimeoutMs:3000});
  const turn=r.observations.cases[0].turns[0];assert.equal(turn.failure,'MULTIPLE_ASR_TURNS');assert.equal(turn.state,'partial');
  assert.equal(turn.model_reply_complete,true);assert.equal(turn.reply_complete,false);assert.equal(r.report.collected_turns,0);
  assert.deepEqual(turn.asr_segments.map(s=>s.text),['你好','tail']);assert.equal(new Set(turn.asr_segments.map(s=>s.turn_id)).size,2);
  assert.equal(turn.reply_fragments[0].text,'你好');assert.equal(turn.fragments_truncated,false);
  assert.equal(turn.collection_evidence.provider_final_before_input_end,true);assert.equal(turn.collection_evidence.all_input_enqueued,false);
  assert.equal(turn.author_provider_association.case_id,cases[0].id);assert.equal(turn.author_provider_association.author_turn,1);
  assert.equal(turn.author_provider_association.status,'fragmented');assert.equal(turn.author_provider_association.provider_turn_ids.length,2);
  assert.equal(turn.author_provider_association.provider_ids_merged,false);assert.equal(turn.author_provider_association.eligible_as_complete_turn,false);
  // Legacy diagnostic records retain their original raw flag; the supplement
  // explicitly separates raw/model completion from validated collector turns.
  turn.reply_complete=true;const report=summarizeCollectionEvidence(r.observations);
  assert.equal(report.raw_reported_reply_complete,1);assert.equal(report.collected_turns,0);assert.equal(report.partial_turns,1);
});
