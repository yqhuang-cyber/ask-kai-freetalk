import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRootCausePlan,ROOT_CASE_IDS,SOURCE_MANIFEST_HASHES,validateRootCauseRequest,readRootCauseInputs,trialInputs } from '../apps/eval-runner/src/root-cause-plan.js';
import { summarizeRootCauseTrial,summarizeRootCauseRun,compiledContextMetadata } from '../apps/eval-runner/src/root-cause-report.js';
import { CollectionEvidence } from '../apps/eval-runner/src/collection-evidence.js';
import { sha256,selectCases } from '../apps/eval-runner/src/multiturn-plan.js';
const db=await readFile('docs/eval-datasets/freechat-v3.1/ask-kai-freechat-eval-v3.1.json'),data=JSON.parse(db),plan=buildRootCausePlan(data);

test('preregistered root scope has 16 fresh trials / 40 steps, only four source cases and labeled derivatives without gold',()=>{
  assert.equal(plan.trial_count,16);assert.equal(plan.max_input_steps,40);assert.deepEqual(plan.source_case_ids,ROOT_CASE_IDS);
  assert.equal(new Set(plan.trials.map(t=>t.trial_id)).size,16);
  const a=plan.trials.find(t=>t.trial_id==='language-initial-zh-r1'),b=plan.trials.find(t=>t.trial_id==='language-initial-bilingual-r1');
  assert.equal(a.case.turns[0].text,b.case.turns[0].text);
  assert.equal(a.case.initial_profile.support_language,'zh');assert.equal(b.case.initial_profile.support_language,'zh_en');
  assert.deepEqual({...a.case.initial_profile,support_language:'auto'},{...b.case.initial_profile,support_language:'auto'});
  const chain=plan.trials.find(t=>t.trial_id==='language-chain-r1');assert.equal(chain.steps[4].diagnostic_probe,true);assert.equal(chain.steps[4].source_turn,4);
  assert.equal(chain.case.turns[4].text,chain.case.turns[3].text);assert.equal(a.steps[0].derived_without_prior_history,true);
  assert.ok(!JSON.stringify(plan).includes('reference_candidate'));assert.ok(!JSON.stringify(plan).includes('expected_mode'));
  assert.equal(plan.automatic_retries,0);assert.deepEqual(plan.trials.slice(8).map(t=>t.condition),plan.trials.slice(0,8).map(t=>t.condition).reverse());
});

test('same-input controls and repeated probes reference identical immutable PCM, not resynthesis',()=>{
  const source=new Map();for(const cid of ROOT_CASE_IDS)for(let t=1;t<=16;t++)source.set(`${cid}/${t}`,{bytes:Buffer.alloc(640,t),sha256:'fixture',source:'authored_tts'});
  const a=plan.trials[0],inputs=trialInputs(a,source);assert.equal(inputs.get(`${a.case_id}/4`),inputs.get(`${a.case_id}/5`));
  const isolated=plan.trials.find(t=>t.condition==='language-initial-zh');assert.equal(trialInputs(isolated,source).get(`${a.case_id}/1`),inputs.get(`${a.case_id}/4`));
  assert.throws(()=>trialInputs(a,new Map()),/ROOT_FIXTURE_MISSING/);
});

test('root request pins runtime, source artifact/manifests, plan and budget before any live call',async()=>{
  const request=JSON.parse(await readFile('.github/live/root-cause-request.json')),baseline=JSON.parse(await readFile('docs/eval-baselines/freechat-v3.1-baseline.json'));
  const options={baseline,data,dataSha:sha256(db),profileBytes:await readFile('docs/protocol/seeduplex-connect.profile.json'),env:{GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40)}};
  assert.equal(validateRootCauseRequest(request,options).trial_count,16);
  for(const change of [{plan_version:'other'},{source_fixture_run:1},{source_fixture_artifact_id:1},{duration_ms:1},{source_manifest_hashes:{}},{extra:true}])assert.throws(()=>validateRootCauseRequest({...request,...change},options),/INVALID_ROOT_CAUSE_REQUEST/);
  assert.deepEqual(request.source_manifest_hashes,SOURCE_MANIFEST_HASHES);
});

test('fixed input loading checks both source manifest and every original script/audio hash',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kai-root-source-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const cases=selectCases(data,{caseIds:ROOT_CASE_IDS,includeLanguage:true,limit:100}),hashes={};
  for(const c of cases) {
    const dir=join(root,c.id);await mkdir(dir);const entries=[];
    for(const turn of c.turns) {const bytes=Buffer.alloc(640,1),path=`input-${turn.turn}.pcm`;await writeFile(join(dir,path),bytes);entries.push({case_id:c.id,turn:turn.turn,path,source:'authored_tts',bytes:bytes.length,sha256:sha256(bytes),script_sha256:sha256(Buffer.from(turn.text))});}
    const m=JSON.stringify({version:1,kind:'ask-kai-eval-input-audio',dataset_sha256:sha256(db),format:'pcm_s16le',sample_rate:16000,channels:1,entries});
    await writeFile(join(dir,'audio-manifest.json'),m);hashes[c.id]=sha256(Buffer.from(m));
  }
  assert.equal((await readRootCauseInputs({data,datasetSha256:sha256(db),directory:root,manifestHashes:hashes})).size,28);
  await assert.rejects(readRootCauseInputs({data,datasetSha256:sha256(db),directory:root}),/ROOT_FIXTURE_MANIFEST_DRIFT/);
  await writeFile(join(root,ROOT_CASE_IDS[0],'input-1.pcm'),Buffer.alloc(640,2));
  await assert.rejects(readRootCauseInputs({data,datasetSha256:sha256(db),directory:root,manifestHashes:hashes}),/AUDIO_HASH_MISMATCH/);
});

test('same-clock timing matches actual owner/version and reports counterexamples without a causal or content verdict',()=>{
  const trial=plan.trials.find(t=>t.condition==='language-initial-zh'),row={turn:1,script_input:trial.case.turns[0].text,actual_student_transcript:trial.case.turns[0].text,
    actual_kai:'好的，我只说中文。',reply_complete:true,context_update_confirmed:true,
    diagnostics:[{name:'language.decision',at_ms:10,fields:{turn_id:'owner',context_version:2,english_support:'off'}},
      {name:'response.started',at_ms:20,fields:{turn_id:'owner',response_id:'reply'}},
      {name:'context.applied',at_ms:15,fields:{turn_id:'foreign',context_version:2}},
      {name:'context.requested',at_ms:40,fields:{turn_id:'owner',context_version:2}},
      {name:'context.applied',at_ms:50,fields:{turn_id:'owner',context_version:2}}]};
  const observations={run_id:'fixture',cases:[{status:'collected',turns:[row]}]};
  const r=summarizeRootCauseTrial(trial,observations);assert.equal(r.turns[0].gateway_reply_start_to_ack_ms,30);assert.equal(r.turns[0].gateway_reply_start_to_context_request_ms,20);
  const combined=summarizeRootCauseRun(plan,[{trial,observations}]);assert.equal(combined.signals.no_latin_surface_despite_late_ack,1);
  assert.equal(combined.automatic_causal_verdict,false);assert.equal(combined.content_scored,false);assert.ok(!JSON.stringify(combined).includes(row.actual_kai));
  row.failure='MULTIPLE_ASR_TURNS';row.state='partial';row.actual_kai='English fragment';
  assert.equal(summarizeRootCauseTrial(trial,observations).turns[0].contains_latin_surface,null);
  assert.equal(summarizeRootCauseTrial(trial,observations).valid_steps,0);
});

test('enqueue cadence records exact observed stalls without altering PCM or inferring supplier receipt',()=>{
  let clock=0;const e=new CollectionEvidence({now:()=>clock}),bytes=Buffer.alloc(1920,1),row=e.begin(1,bytes);
  e.enqueue(row,bytes.subarray(0,640));clock=20;e.enqueue(row,bytes.subarray(640,1280));clock=75;e.enqueue(row,bytes.subarray(1280));
  const s=e.snapshot(1);assert.deepEqual(s.enqueue_intervals,{count:2,total_ms:75,min_ms:20,max_ms:55,over_40ms:1});
  assert.equal(s.enqueued_sha256,sha256(bytes));assert.equal(s.provider_receipt_proven,false);
});

test('compiled context evidence retains only bounded language state and a hash, never raw instructions or hidden values',()=>{
  const instructions='private instruction\n本轮语言状态（JSON 数据）：'+JSON.stringify({english_support:'off',preference:'zh',comprehension:'comfortable',secret:'private profile value'});
  const r=compiledContextMetadata(instructions,2,'context_request');assert.equal(r.english_support,'off');assert.equal(r.instructions_sha256,sha256(Buffer.from(instructions)));
  assert.equal(r.provider_semantic_application_proven,false);assert.ok(!JSON.stringify(r).includes('private'));
  assert.equal(compiledContextMetadata('missing language data',1,'session_create').english_support,null);
});
