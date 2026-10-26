import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BASELINE_PATH,verifyEvaluationBaseline,planEvaluationBatches } from '../apps/eval-runner/src/eval-baseline.js';
import { runEvaluationBatch,scopedEvaluationProfile,validateBatchRequest } from '../apps/eval-runner/src/evaluation-batch.js';
import { sha256,selectCases } from '../apps/eval-runner/src/multiturn-plan.js';
const dataBytes=await readFile('docs/eval-datasets/freechat-v3.1/ask-kai-freechat-eval-v3.1.json'),data=JSON.parse(dataBytes),profileBytes=await readFile('docs/protocol/seeduplex-connect.profile.json'),profile=JSON.parse(profileBytes),baseline=JSON.parse(await readFile(BASELINE_PATH));
test('fixed baseline permits evaluation changes and rejects runtime/dependency/data/profile drift',async()=>{
  // Fixed archived manifest is not rewritten when the candidate runtime changes.
  // Exercise the original guard with isolated original bytes and drift probes.
  const key='packages/agent-core/original-fixture.js',bytes=Buffer.from('original runtime');
  const packageBytes=Buffer.from(JSON.stringify({dependencies:baseline.dependencies})),lockBytes=Buffer.from('original fixture lockfile');
  const pinned={...baseline,runtime_files:{[key]:sha256(bytes)},lock_sha256:sha256(lockBytes)},read=(p,...args)=>p===key?bytes:p==='package.json'?packageBytes:p==='package-lock.json'?lockBytes:readFile(p,...args),files=()=>[key];
  const info=await verifyEvaluationBaseline({baseline:pinned,dataBytes,profileBytes,read,files});assert.equal(info.baseline_verified,true);
  await assert.rejects(verifyEvaluationBaseline({baseline:pinned,dataBytes:Buffer.from('changed'),profileBytes,read,files}),/INPUT_DRIFT/);
  await assert.rejects(verifyEvaluationBaseline({baseline:pinned,dataBytes,profileBytes,read:(p,...args)=>p===key?Buffer.from('changed'):readFile(p,...args),files}),/RUNTIME_DRIFT/);
  await assert.rejects(verifyEvaluationBaseline({baseline:pinned,dataBytes,profileBytes,read,files:()=>[]}),/FILE_SET_DRIFT/);
  await assert.rejects(verifyEvaluationBaseline({baseline:pinned,dataBytes,profileBytes,read:(p,...args)=>p==='package.json'?Buffer.from('{"dependencies":{}}'):read(p,...args),files}),/DEPENDENCY_DRIFT/);
  await assert.rejects(verifyEvaluationBaseline({baseline:pinned,dataBytes,profileBytes,read:(p,...args)=>p==='package-lock.json'?Buffer.from('changed lock'):read(p,...args),files}),/DEPENDENCY_DRIFT/);
});

test('candidate replay validates and copies exact authored PCM without synthesizing or silently repairing missing input',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kai-replay-batch-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const cases=selectCases(data,{limit:1}),c=cases[0],fixtures=join(root,'inputs'),caseDir=join(fixtures,c.id);
  await mkdir(caseDir,{recursive:true});const bytes=Buffer.alloc(640);bytes.writeInt16LE(20);
  const entries=[];for(const turn of c.turns){const path=`${turn.turn}.pcm`;await writeFile(join(caseDir,path),bytes);entries.push({case_id:c.id,turn:turn.turn,path,source:'authored_tts',bytes:bytes.length,sha256:sha256(bytes),script_sha256:sha256(Buffer.from(turn.text))});}
  await writeFile(join(caseDir,'audio-manifest.json'),JSON.stringify({version:1,kind:'ask-kai-eval-input-audio',dataset_sha256:sha256(dataBytes),format:'pcm_s16le',sample_rate:16000,channels:1,entries}));
  let calls=0;const info={agent_revision:baseline.agent_revision,runtime_digest:'c'.repeat(64),baseline_verified:false,candidate_verified:true,evaluation_contract_kind:'candidate'};
  const collect=async({inputs})=>{calls++;assert.deepEqual(inputs.get(`${c.id}/1`).bytes,bytes);return {observations:{cases:[{case_id:c.id,entry:'free',kind:c.kind,initial_profile:c.initial_profile,expected_turns:c.turns.length,status:'collected',failure:null,turns:c.turns.map(t=>({turn:t.turn,script_input:t.text,input_source:'authored_tts',actual_student_transcript:t.text,actual_kai:'你好。',reply_complete:true})),summary:{focus:'conversation_only'},session_terminal:'session.closed'}]}};};
  const run=async(name,extra={})=>{const directory=join(root,name);await mkdir(directory);return runEvaluationBatch({data,dataSha:sha256(dataBytes),cases,profile,env:{DOUBAO_API_KEY:'fixture-only-key',GITHUB_SHA:'a'.repeat(40)},directory,baselineInfo:info,observationScope:'candidate_collection',replayInputsRoot:fixtures,prepare:async()=>assert.fail('replay must not synthesize'),collect,...extra});};
  const good=await run('good');assert.equal(good.report.completed_cases,1);assert.equal(good.observations.cases[0].input_audio_origin,'replayed_authored_tts');
  assert.deepEqual(await readFile(join(root,'good',c.id,'turn-1.pcm')),bytes);
  await writeFile(join(caseDir,'1.pcm'),Buffer.alloc(640));const bad=await run('bad');assert.equal(bad.report.completed_cases,0);assert.equal(bad.observations.cases[0].failure,'AUDIO_HASH_MISMATCH');assert.equal(calls,1);
  await assert.rejects(run('old',{observationScope:'baseline_collection'}),/CANDIDATE_INPUT_REPLAY_REQUIRED/);
});
test('balanced batches include all 48 cases and 255 turns exactly once; retry selection never includes successful cases implicitly',()=>{
  const plan=planEvaluationBatches(data);assert.equal(plan.length,8);assert.equal(new Set(plan.flatMap(b=>b.case_ids)).size,48);assert.equal(plan.reduce((s,b)=>s+b.turns,0),255);
  assert.ok(Math.max(...plan.map(b=>b.turns))-Math.min(...plan.map(b=>b.turns))<=4);
  const retries=planEvaluationBatches(data,{caseIds:['ask-kai-v2-003','ask-kai-language-02']});assert.equal(retries.flatMap(b=>b.case_ids).length,2);
});
test('batch request pins Agent/data/profile/budget/main; scoped profile never changes submitted Web flags',()=>{
  const env={GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40)},request={version:1,kind:'ask_kai_evaluation_batch',request_id:'evaluation-2026-10-11-01',agent_revision:baseline.agent_revision,dataset_sha256:sha256(dataBytes),profile_sha256:sha256(profileBytes),batch_count:8,duration_ms:1200000,case_ids:[],rerun_of:null};
  assert.equal(validateBatchRequest(request,{baseline,data,dataSha:sha256(dataBytes),profileBytes,env}).length,48);
  const scoped=scopedEvaluationProfile(profile);assert.equal(scoped.realtime.review_scope,'protocol_smoke');assert.equal(profile.realtime.reviewed,false);
  assert.throws(()=>validateBatchRequest({...request,duration_ms:999},{baseline,data,dataSha:sha256(dataBytes),profileBytes,env}));
});
test('input prep failure is checkpointed and later cases continue without retrying or repairing history',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'kai-batch-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const cases=selectCases(data,{limit:3}),attempts=[],info={agent_revision:baseline.agent_revision,runtime_digest:'c'.repeat(64),baseline_verified:true};
  const result=await runEvaluationBatch({data,dataSha:sha256(dataBytes),cases,profile,env:{DOUBAO_API_KEY:'fixture-only-key',GITHUB_SHA:'a'.repeat(40)},directory,baselineInfo:info,
    prepare:async({cases})=>{attempts.push(cases[0].id);if(cases[0].id.endsWith('002'))throw new Error('TTS_TIMEOUT');},readInputs:async()=>({inputs:new Map(),manifest_sha256:'b'.repeat(64)}),
    collect:async({cases,checkpoint})=>{const c=cases[0],row={case_id:c.id,entry:'free',kind:c.kind,initial_profile:c.initial_profile,expected_turns:c.turns.length,status:'collected',failure:null,
      turns:c.turns.map(t=>({turn:t.turn,script_input:t.text,input_source:'authored_tts',actual_student_transcript:t.text,actual_kai:'你好。 Hello.',reply_complete:true})),summary:{focus:'conversation_only'},session_terminal:'session.closed'};
      const o={cases:[row]};await checkpoint(o);return {observations:o};}});
  assert.equal(attempts.length,3);assert.equal(result.report.completed_cases,2);assert.deepEqual(result.report.retry_case_ids,['ask-kai-v2-002']);
  assert.equal(result.observations.cases[1].failure_phase,'input_audio_preparation');assert.equal(result.bundle.units.filter(u=>u.eligible).length,8);
  const checkpoint=JSON.parse(await readFile(join(directory,'collection-report.json')));assert.equal(checkpoint.status,'incomplete');
});
