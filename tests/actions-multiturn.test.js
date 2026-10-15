import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateActionsTrial,runActionsTrial,trialProviderFactory,observeTrialProvider } from '../apps/eval-runner/src/actions-multiturn.js';
import { prepareInputAudio,synthesizeInput } from '../apps/eval-runner/src/input-audio.js';
import { runMultiturn,runPreflight } from '../apps/eval-runner/src/multiturn.js';
import { sha256 } from '../apps/eval-runner/src/multiturn-plan.js';
import { SeeduplexProvider,validateSeeduplexProfile } from '../packages/provider-doubao/seeduplex.js';
import { protocolPeer } from './helpers/multiturn.js';

const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-connect.profile.json',import.meta.url)));
const request=JSON.parse(await readFile(new URL('../.github/live/doubao-multiturn-request.json',import.meta.url)));
const bytes=await readFile(new URL('../docs/eval-datasets/freechat-v3.1/ask-kai-freechat-eval-v3.1.json',import.meta.url));
const data=JSON.parse(bytes),datasetSha256=sha256(bytes),env={DOUBAO_API_KEY:'fixture-only-secret',GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40)};
const params=()=>({profile,request,data,datasetSha256,env});

test('Actions trial pins the first four authored turns and creates only a Web-rejected scoped profile',()=>{
  const original=structuredClone(profile),result=validateActionsTrial(params());
  assert.equal(result.cases.length,1);assert.equal(result.cases[0].turns.length,4);assert.equal(result.cases[0].entry,'free');
  assert.equal(result.credentialReady,true);assert.equal(result.scoped.realtime.review_scope,'protocol_smoke');
  assert.deepEqual(profile,original);assert.throws(()=>validateSeeduplexProfile(result.scoped),/SEEDUPLEX_PROBE_ONLY/);
  assert.equal(validateSeeduplexProfile(result.scoped,{protocolProbe:true}),result.scoped);
  assert.equal(runPreflight({cases:result.cases,profile:result.scoped,env,prepareAudio:true}).live_eligible,false);
  assert.equal(runPreflight({cases:result.cases,profile:result.scoped,env,prepareAudio:true,protocolProbe:true}).live_eligible,true);
  const text=JSON.stringify(result.cases);assert.ok(!text.includes('reference_for_judge_only'));assert.ok(!text.includes('opening_soft_goal'));
});
test('changed profile/data, different branch or unbounded trial request are rejected before a call',async()=>{
  let calls=0;const prepare=()=>{calls++;throw new Error('SHOULD_NOT_CALL');};
  const variations=[{request:{...request,profile_sha256:'0'.repeat(64)}},{datasetSha256:'0'.repeat(64)},
    {request:{...request,case_id:'ask-kai-v2-002'}},{request:{...request,expected_turns:8}},
    {request:{...request,duration_ms:600000}},{request:{...request,extra:'unexpected'}},
    {env:{...env,GITHUB_REF:'refs/heads/other'}},{env:{...env,GITHUB_SHA:'wrong'}}];
  for(const change of variations)await assert.rejects(runActionsTrial({...params(),...change,prepare}),/INVALID_MULTITURN_TRIAL_REQUEST/);
  assert.equal(calls,0);
});
test('missing existing Secret produces a metadata-only blocked report, without preparing or collecting',async()=>{
  let calls=0;const fail=()=>{calls++;throw new Error('SHOULD_NOT_CALL');};
  const r=await runActionsTrial({...params(),env:{...env,DOUBAO_API_KEY:''},prepare:fail,collect:fail});
  assert.equal(r.status,'blocked');assert.equal(r.failure,'SERVER_CREDENTIAL_REQUIRED');assert.equal(calls,0);
  assert.equal(r.web_profile_enabled,false);assert.equal(r.content_scored,false);assert.equal(r.real_experience_accepted,false);
});
test('trial propagates probe scope through fixed input preparation and actual authorized gateway collection',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'kai-actions-trial-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const scripts=[data.cases[0].turns.map(t=>t.input.text)],outputs=[scripts[0].map(()=> '你好。Hello.')];
  const peer=await protocolPeer(t,{scripts,outputs,asrFinalField:'text'});let preparedScope,collectionScope;
  const r=await runActionsTrial({...params(),directory,
    prepare:args=>{preparedScope=args.protocolProbe;return prepareInputAudio({...args,synthesize:async()=>Buffer.alloc(640,1)});},
    collect:args=>{collectionScope=args.protocolProbe;return runMultiturn({...args,providerKind:'test',turnTimeoutMs:3000,
      providerFactory:ticket=>peer.providerFactory(args.profile,{protocolProbe:true})(ticket)});}});
  assert.equal(preparedScope,true);assert.equal(collectionScope,true);assert.equal(r.status,'observations_collected');
  assert.equal(r.input_audio_prepared_turns,4);assert.equal(r.collection.collected_turns,4);assert.equal(r.collection.protocol_probe,true);
  assert.equal(r.collection.execution,'synthetic_fixture');assert.equal(r.collection.live_provider_sessions,0);
  const obs=JSON.parse(await readFile(join(directory,'observations.json')));
  assert.equal(obs.cases[0].turns.length,4);assert.equal(obs.references_sent_to_model,false);
  assert.equal(obs.runtime_profile_scope,'protocol_smoke');assert.equal(obs.cases[0].summary.business_source,'mock_hskai');
  assert.ok(!JSON.stringify(r).includes(env.DOUBAO_API_KEY));assert.ok(!JSON.stringify(r).includes(outputs[0][0]));
  assert.equal(profile.realtime.reviewed,false);assert.equal(profile.realtime.ordered_acks_reviewed,false);
});
test('probe-only authored TTS remains inaccessible by default and works only through explicit trial scope',async t=>{
  const {scoped}=validateActionsTrial(params()),peer=await protocolPeer(t);
  await assert.rejects(synthesizeInput({text:'你好',profile:scoped,env,socketFactory:peer.socketFactory}),/SEEDUPLEX_PROBE_ONLY/);
  const rows=[];
  const pcm=await synthesizeInput({text:'你好',profile:scoped,env,socketFactory:peer.socketFactory,protocolProbe:true,timeoutMs:3000,
    createProvider:options=>observeTrialProvider(new SeeduplexProvider(options),{profile:scoped,onDiagnostic:row=>rows.push(row)})});
  assert.equal(pcm.length,3200);assert.equal(peer.sessions.length,1);
  assert.ok(rows.some(r=>r.type==='response.output_audio.done'));assert.ok(!JSON.stringify(rows).includes('你好'));
});
test('failed preparation stops collection and never exposes provider error text or credentials',async()=>{
  let collected=false;
  const r=await runActionsTrial({...params(),prepare:async({onProgress})=>{onProgress({state:'input_audio_prepared'});throw new Error('private provider error: '+env.DOUBAO_API_KEY);},collect:async()=>{collected=true;}});
  assert.equal(r.status,'failed');assert.equal(r.phase,'prepare_authored_input_audio');assert.equal(r.failure,'MULTITURN_TRIAL_FAILED');
  assert.equal(collected,false);assert.ok(!JSON.stringify(r).includes(env.DOUBAO_API_KEY));
  assert.equal(r.input_audio_prepared_turns,1);
});
test('failed trial wire mapping records structure and isolated aliases, never payload strings or secrets',async t=>{
  const {scoped}=validateActionsTrial(params()),peer=await protocolPeer(t),rows=[];
  const provider=trialProviderFactory({profile:scoped,env,onDiagnostic:row=>rows.push(row),socketFactory:peer.socketFactory})({speech_pace:'slow'});
  await new Promise((resolve,reject)=>provider.open({sessionId:'authored-session',onEvent:p=>{if(p.event?.type==='session.ready')resolve();},onFailure:reject}));
  assert.throws(()=>provider.receive({type:'conversation.item.input_audio_transcription.delta',event_id:'private-event-id',question_id:'private-question-id',delta:'private transcript',api_key:env.DOUBAO_API_KEY}),/INVALID_PROVIDER_ID/);
  const failure=rows.at(-1);assert.equal(failure.failure,'INVALID_PROVIDER_ID');assert.equal(failure.item_id,null);assert.equal(failure.question_id,'id-1');assert.equal(failure.shape.fields.delta.type,'string');
  for(const text of ['private transcript','private-question-id','private-event-id',env.DOUBAO_API_KEY,'fixture-session','api_key'])assert.ok(!JSON.stringify(rows).includes(text));
  assert.equal((await provider.close()).acknowledged,true);
});
