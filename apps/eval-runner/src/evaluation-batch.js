import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { selectCases,readAudioManifest,sha256 } from './multiturn-plan.js';
import { prepareInputAudio,synthesizeInput,INPUT_TTS_TRANSPORT_VERSION } from './input-audio.js';
import { runMultiturn } from './multiturn.js';
import { atomicPrivateJson } from './private-artifacts.js';
import { validateSeeduplexProfile } from '../../../packages/provider-doubao/seeduplex.js';
import { preflight } from '../../../packages/provider-doubao/probe.js';
import { adaptRecordedObservations,reviewTemplate,evaluateRecorded } from './recorded-scoring.js';
import { RUBRIC_VERSION } from './content.js';
import { PERSONA_VERSION } from '../../../packages/agent-core/lessons.js';
import { LANGUAGE_POLICY_VERSION } from '../../../packages/agent-core/language-support.js';
import { REPLY_POLICY_VERSION } from '../../../packages/agent-core/reply-policy.js';
import { TEACHING_POLICY_VERSION } from '../../../packages/agent-core/natural-teaching.js';
import { SUMMARY_POLICY_VERSION } from '../../../packages/agent-core/learning-summary.js';
import { SeeduplexProvider } from '../../../packages/provider-doubao/seeduplex.js';
import { observeTrialProvider } from './actions-multiturn.js';
import { COLLECTION_EVIDENCE_VERSION } from './collection-evidence.js';

export function scopedEvaluationProfile(profile) {
  if(profile.review_scope!=='static_session_connect_only'||profile.realtime?.reviewed!==false||profile.realtime?.ordered_acks_reviewed!==false||profile.auth?.env!=='DOUBAO_API_KEY')throw new Error('INVALID_EVALUATION_PROBE_PROFILE');
  const scoped=structuredClone(profile);scoped.realtime={...scoped.realtime,reviewed:true,ordered_acks_reviewed:true,review_scope:'protocol_smoke'};
  validateSeeduplexProfile(scoped,{protocolProbe:true});return scoped;
}
export function validateBatchRequest(request,{baseline,data,dataSha,profileBytes,env}) {
  const allowed=['version','kind','request_id','agent_revision','dataset_sha256','profile_sha256','batch_count','duration_ms','case_ids','rerun_of'];
  if(request?.version!==1||request.kind!=='ask_kai_evaluation_batch'||!/^evaluation-\d{4}-\d{2}-\d{2}-\d{2}$/.test(request.request_id??'')||
    request.agent_revision!==baseline.agent_revision||request.dataset_sha256!==dataSha||request.profile_sha256!==sha256(profileBytes)||
    request.batch_count!==8||request.duration_ms!==1200000||!Array.isArray(request.case_ids)||Object.keys(request).some(k=>!allowed.includes(k))||
    request.rerun_of!==null&&!Number.isSafeInteger(request.rerun_of)||env.GITHUB_REF!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??''))throw new Error('INVALID_EVALUATION_BATCH_REQUEST');
  return selectCases(data,{includeLanguage:true,limit:100,caseIds:request.case_ids});
}

export async function runEvaluationBatch({data,dataSha,cases,profile,env,directory,baselineInfo,signal,onProgress=()=>{},
  prepare=prepareInputAudio,collect=runMultiturn,readInputs=readAudioManifest,synthesize=synthesizeInput,observationScope='baseline_collection',replayInputsRoot=null}={}) {
  if(!['baseline_collection','task02_independent_diagnostic','candidate_collection'].includes(observationScope))throw new Error('INVALID_OBSERVATION_SCOPE');
  if(observationScope==='candidate_collection'&&(baselineInfo.candidate_verified!==true||baselineInfo.evaluation_contract_kind!=='candidate'||baselineInfo.baseline_verified!==false))throw new Error('VERIFIED_CANDIDATE_REQUIRED');
  if(replayInputsRoot&&observationScope!=='candidate_collection')throw new Error('CANDIDATE_INPUT_REPLAY_REQUIRED');
  const scoped=scopedEvaluationProfile(profile);
  if(!preflight(profile,env).live_eligible)throw new Error('SERVER_CREDENTIAL_REQUIRED');
  const observations={version:1,kind:'ask-kai-multiturn-observations',run_id:`batch-${randomUUID()}`,execution:'recorded_real_model',
    input_source:'authored_scripts_as_audio',input_tts_transport_version:INPUT_TTS_TRANSPORT_VERSION,business_source:'mock_hskai',candidate_revision:env.GITHUB_SHA,...baselineInfo,
    dataset_version:data.dataset_version,dataset_sha256:dataSha,audio_manifest_sha256:null,model_version:profile.session_create.session.model,
    profile_sha256:sha256(Buffer.from(JSON.stringify(scoped))),policy_versions:{persona:PERSONA_VERSION,language:LANGUAGE_POLICY_VERSION,reply:REPLY_POLICY_VERSION,teaching:TEACHING_POLICY_VERSION,summary:SUMMARY_POLICY_VERSION,rubric:RUBRIC_VERSION},
    history_source:'actual_provider_session_only',references_sent_to_model:false,soft_goals_sent_to_model:false,protocol_probe:true,runtime_profile_scope:'protocol_smoke',
    collection_evidence_version:COLLECTION_EVIDENCE_VERSION,observation_scope:observationScope,historical_baseline_replaced:false,
    scores_present:false,judge_calls:0,browser_audio_tested:false,real_experience_accepted:false,cases:[]};
  const report=()=>({version:1,kind:'ask-kai-batch-collection-report',run_id:observations.run_id,...baselineInfo,
    runner_revision:env.GITHUB_SHA,observation_scope:observationScope,collection_evidence_version:COLLECTION_EVIDENCE_VERSION,
    input_tts_transport_version:INPUT_TTS_TRANSPORT_VERSION,dataset_sha256:dataSha,model_version:observations.model_version,selected_cases:cases.length,
    selected_turns:cases.reduce((s,c)=>s+c.turns.length,0),completed_cases:observations.cases.filter(c=>c.status==='collected').length,
    collected_turns:observations.cases.reduce((s,c)=>s+c.turns.filter(t=>t.reply_complete).length,0),
    status:observations.cases.length===cases.length&&observations.cases.every(c=>c.status==='collected')?'observations_collected':'incomplete',
    cases:observations.cases.map(c=>({case_id:c.case_id,status:c.status,failure:c.failure,expected_turns:c.expected_turns,collected_turns:c.turns.filter(t=>t.reply_complete).length})),
    retry_case_ids:cases.filter(c=>!observations.cases.some(o=>o.case_id===c.id&&o.status==='collected')).map(c=>c.id),content_scored:false,real_experience_accepted:false});
  const save=async()=>{await atomicPrivateJson(join(directory,'observations.json'),observations);await atomicPrivateJson(join(directory,'collection-report.json'),report());};
  await save();const audioCache=new Map(),protocolDiagnostics=[];let connection=0;
  const observer=(options,caseId,phase)=>{
    const ordinal=++connection;
    return observeTrialProvider(new SeeduplexProvider(options),{profile:options.profile,onDiagnostic:row=>{
      if(protocolDiagnostics.length<1024||row.failure)protocolDiagnostics.push({...row,case_id:caseId,phase,connection:ordinal});
    }});
  };
  for(const c of cases) {
    if(signal?.aborted)break;
    const row={case_id:c.id,entry:'free',kind:c.kind,initial_profile:c.initial_profile,profile_evidence:c.profile_evidence,expected_turns:c.turns.length,
      session_opened:false,status:'running',failure:null,turns:[],summary:null,session_terminal:null};observations.cases.push(row);
    let phase='input_audio_preparation';
    try {
      const caseDir=join(directory,c.id);await mkdir(caseDir,{mode:0o700});
      if(!replayInputsRoot)await prepare({cases:[c],datasetSha256:dataSha,profile:scoped,env,directory:caseDir,signal,timeoutMs:45000,protocolProbe:true,onProgress,
        synthesize:async args=>{const hash=sha256(Buffer.from(args.text));if(!audioCache.has(hash))audioCache.set(hash,await synthesize({...args,createProvider:options=>observer(options,c.id,'authored_input_tts')}));return audioCache.get(hash);}});
      const manifestPath=join(replayInputsRoot?join(replayInputsRoot,c.id):caseDir,'audio-manifest.json');
      let inputs=await readInputs(manifestPath,[c],{datasetSha256:dataSha});
      row.input_audio_origin=replayInputsRoot?'replayed_authored_tts':'synthesized_within_batch_cache';
      // Replayed bytes are validated first, then saved under canonical paths.
      // The new artifact remains independently replayable; no teacher record is read.
      if(replayInputsRoot) {
        const entries=[];
        for(const turn of c.turns) {
          const input=inputs.inputs.get(`${c.id}/${turn.turn}`),path=`turn-${turn.turn}.pcm`;
          await writeFile(join(caseDir,path),input.bytes,{mode:0o600,flag:'wx'});
          entries.push({case_id:c.id,turn:turn.turn,path,source:input.source,bytes:input.bytes.length,sha256:input.sha256,script_sha256:sha256(Buffer.from(turn.text))});
        }
        await atomicPrivateJson(join(caseDir,'audio-manifest.json'),{version:1,kind:'ask-kai-eval-input-audio',dataset_sha256:dataSha,format:'pcm_s16le',sample_rate:16000,channels:1,entries});
        row.input_fixture_manifest_sha256=inputs.manifest_sha256;
        inputs=await readInputs(join(caseDir,'audio-manifest.json'),[c],{datasetSha256:dataSha});
      }
      row.audio_manifest_sha256=inputs.manifest_sha256;phase='agent_collection';
      const result=await collect({cases:[c],inputs:inputs.inputs,profile:scoped,env,signal,candidateRevision:env.GITHUB_SHA,datasetVersion:data.dataset_version,
        datasetSha256:dataSha,manifestSha256:inputs.manifest_sha256,protocolProbe:true,turnTimeoutMs:45000,onProgress,
        providerFactory:ticket=>observer({profile:scoped,env,protocolProbe:true,speechPace:ticket.speech_pace},c.id,'agent_collection'),
        checkpoint:async o=>{if(o.cases[0])Object.assign(row,o.cases[0]);await save();}});
      Object.assign(row,result.observations.cases[0]);
    }catch(error){row.status='failed';row.failure=/^[A-Z_]{1,80}$/.test(error.message)?error.message:'BATCH_CASE_FAILED';row.failure_phase=phase;}
    await save();await atomicPrivateJson(join(directory,'protocol-diagnostics.json'),{kind:'evaluation_protocol_structure',raw_values_retained:false,rows:protocolDiagnostics});
    onProgress({case_id:c.id,state:row.status,failure:row.failure});
  }
  const bundle=adaptRecordedObservations(data,[observations],{datasetSha256:dataSha,caseIds:cases.map(c=>c.id),agentRevision:baselineInfo.agent_revision,runtimeDigest:baselineInfo.runtime_digest,verificationKind:observationScope==='candidate_collection'?'candidate':'baseline'});
  const judgements=reviewTemplate(bundle),scores=evaluateRecorded(bundle,judgements);
  await atomicPrivateJson(join(directory,'scoring-input.json'),bundle);await atomicPrivateJson(join(directory,'judgements.json'),judgements);
  await atomicPrivateJson(join(directory,'score-report.json'),scores);await save();
  return {observations,report:report(),bundle};
}
