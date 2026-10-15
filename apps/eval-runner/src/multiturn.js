import { mkdir,realpath } from 'node:fs/promises';
import { resolve,relative,isAbsolute,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateSeeduplexProfile } from '../../../packages/provider-doubao/seeduplex.js';
import { RUBRIC_VERSION } from './content.js';
import { REPLY_POLICY_VERSION } from '../../../packages/agent-core/reply-policy.js';
import { LANGUAGE_POLICY_VERSION } from '../../../packages/agent-core/language-support.js';
import { PERSONA_VERSION } from '../../../packages/agent-core/lessons.js';
import { TEACHING_POLICY_VERSION } from '../../../packages/agent-core/natural-teaching.js';
import { SUMMARY_POLICY_VERSION } from '../../../packages/agent-core/learning-summary.js';
import { openAgentHarness } from './agent-harness.js';
import { sha256 } from './multiturn-plan.js';
import { atomicPrivateJson } from './private-artifacts.js';
import { COLLECTION_EVIDENCE_VERSION } from './collection-evidence.js';

export function runPreflight({cases,profile,env={},inputs,worktreeClean=true,prepareAudio=false,protocolProbe=false}={}) {
  const blockers=[];
  if(!worktreeClean)blockers.push('candidate_worktree_not_clean');
  if(!profile){blockers.push('reviewed_realtime_profile_required');if(!env.DOUBAO_API_KEY)blockers.push('server_credential_required');}
  else {
    try{validateSeeduplexProfile(profile,{protocolProbe});}catch{blockers.push('reviewed_realtime_profile_required');}
    const key=env[profile.auth?.env];
    if(typeof key!=='string'||!key||key.length>8192||/[^\x21-\x7e]/.test(key))blockers.push('server_credential_required');
  }
  if(!prepareAudio) {
    if(!inputs)blockers.push('input_audio_manifest_required');
    else for(const c of cases)for(const t of c.turns){const audio=inputs.get(`${c.id}/${t.turn}`);if(!audio)blockers.push('turn_audio_missing');else if(audio.source==='synthetic_fixture')blockers.push('synthetic_audio_not_live_input');}
  }
  return {kind:'multiturn_preflight',live_eligible:blockers.length===0,blockers:[...new Set(blockers)],
    selected_cases:cases.length,selected_turns:cases.reduce((n,c)=>n+c.turns.length,0),
    case_ids:cases.map(c=>c.id),input_mode:'paced_audio_through_agent_gateway',
    provider_connected:false,provider_calls:0,judge_calls:0,content_scored:false,real_experience_accepted:false};
}
export async function privateRunDirectory(path) {
  const cwd=await realpath(process.cwd()),root=resolve(cwd,'.local'),directory=resolve(path??join(root,'eval-runs',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`));
  const rel=relative(root,directory);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('EVAL_OUTPUT_MUST_BE_PRIVATE');
  await mkdir(root,{recursive:true,mode:0o700});
  if(await realpath(root)!==root)throw new Error('EVAL_OUTPUT_SYMLINK');
  const parent=resolve(directory,'..');await mkdir(parent,{recursive:true,mode:0o700});
  if(await realpath(parent)!==parent)throw new Error('EVAL_OUTPUT_SYMLINK');
  await mkdir(directory,{mode:0o700});return directory;
}

export async function runMultiturn({cases,inputs,profile,env,signal,candidateRevision,datasetVersion,datasetSha256,manifestSha256,
  providerKind='doubao',providerFactory,turnTimeoutMs=45000,openSession=openAgentHarness,onProgress=()=>{},checkpoint=async()=>{},protocolProbe=false}={}) {
  if(!/^[a-f0-9]{40}$/.test(candidateRevision??'')||!Number.isSafeInteger(turnTimeoutMs)||turnTimeoutMs<1||turnTimeoutMs>120000||!cases?.length)throw new Error('INVALID_MULTITURN_RUN');
  if(providerKind==='doubao') {
    const check=runPreflight({cases,inputs,profile,env,protocolProbe});if(!check.live_eligible)throw new Error('MULTITURN_PREFLIGHT_BLOCKED');
  }else if(providerKind!=='test'||!providerFactory)throw new Error('INVALID_EVAL_PROVIDER');
  const runId=`multiturn-${randomUUID()}`;
  const observations={version:1,kind:'ask-kai-multiturn-observations',run_id:runId,
    execution:providerKind==='doubao'?'recorded_real_model':'synthetic_fixture',
    input_source:'authored_scripts_as_audio',business_source:'mock_hskai',candidate_revision:candidateRevision,
    dataset_version:datasetVersion,dataset_sha256:datasetSha256,audio_manifest_sha256:manifestSha256,
    model_version:providerKind==='doubao'?profile.session_create.session.model:'synthetic-protocol-peer',
    profile_sha256:profile?sha256(Buffer.from(JSON.stringify(profile))):null,
    policy_versions:{persona:PERSONA_VERSION,language:LANGUAGE_POLICY_VERSION,reply:REPLY_POLICY_VERSION,teaching:TEACHING_POLICY_VERSION,summary:SUMMARY_POLICY_VERSION,rubric:RUBRIC_VERSION},
    history_source:'actual_provider_session_only',references_sent_to_model:false,soft_goals_sent_to_model:false,
    protocol_probe:protocolProbe,runtime_profile_scope:profile?.realtime?.review_scope??'normal_realtime',
    collection_evidence_version:COLLECTION_EVIDENCE_VERSION,scores_present:false,judge_calls:0,browser_audio_tested:false,real_experience_accepted:false,cases:[]};
  const report=()=>({version:1,kind:'ask-kai-multiturn-run-report',run_id:runId,execution:observations.execution,
    candidate_revision:candidateRevision,dataset_version:datasetVersion,dataset_sha256:datasetSha256,
    model_version:observations.model_version,policy_versions:observations.policy_versions,
    protocol_probe:protocolProbe,runtime_profile_scope:observations.runtime_profile_scope,
    selected_cases:cases.length,selected_turns:cases.reduce((n,c)=>n+c.turns.length,0),
    completed_cases:observations.cases.filter(c=>c.status==='collected').length,
    collected_turns:observations.cases.reduce((n,c)=>n+c.turns.filter(t=>t.reply_complete).length,0),
    provider_sessions:observations.cases.filter(c=>c.session_opened).length,
    live_provider_sessions:providerKind==='doubao'?observations.cases.filter(c=>c.session_opened).length:0,
    status:observations.cases.length===cases.length&&observations.cases.every(c=>c.status==='collected')?'observations_collected':'incomplete',
    content_scored:false,judge_calls:0,real_experience_accepted:false,browser_audio_tested:false,
    needs_review:true,cases:observations.cases.map(c=>({case_id:c.case_id,status:c.status,expected_turns:c.expected_turns,
      collected_turns:c.turns.filter(t=>t.reply_complete).length,failure:c.failure,summary_observed:!!c.summary,
      session_terminal:c.session_terminal,
      asr_review_turns:c.turns.filter(t=>t.asr_surface_match!==true).map(t=>t.turn),
      dependency_review_turns:c.turns.filter(t=>t.dependency_review==='required').map(t=>t.turn)}))});
  await checkpoint(observations,report());
  for(const c of cases) {
    const result={case_id:c.id,entry:c.entry,kind:c.kind,initial_profile:structuredClone(c.initial_profile),profile_evidence:structuredClone(c.profile_evidence),
      expected_turns:c.turns.length,session_opened:false,status:'running',failure:null,turns:[],summary:null,session_terminal:null};
    observations.cases.push(result);let session;
    try {
      if(signal?.aborted)throw new Error('RUN_ABORTED');
      session=await openSession({profile,env,initialProfile:c.initial_profile,caseId:c.id,signal,providerKind,providerFactory,turnTimeoutMs,protocolProbe});result.session_opened=true;
      for(const t of c.turns) {
        const audio=inputs.get(`${c.id}/${t.turn}`);
        onProgress({case_id:c.id,turn:t.turn,state:'collecting'});
        try{result.turns.push(await session.turn(t,audio));}
        catch(error){result.turns.push({...session.snapshotTurn(t,audio),state:'partial',failure:/^[A-Z_]{1,80}$/.test(error.message)?error.message:'TURN_FAILED'});throw error;}
        await checkpoint(observations,report());
        onProgress({case_id:c.id,turn:t.turn,state:'collected'});
      }
      const final=await session.finish();result.summary=final.summary;result.session_terminal=final.session_terminal;result.collection_evidence=final.collection_evidence??null;result.memory_audit=final.memory_audit??null;
      if(final.failure||final.session_terminal!=='session.closed'||!final.summary)throw new Error(final.failure??'EVAL_SUMMARY_MISSING');
      result.status='collected';
    }catch(error){
      result.status='failed';result.failure=/^[A-Z_]{1,80}$/.test(error.message)?error.message:'CASE_FAILED';
      if(session){try{const final=await session.finish();result.summary=final.summary;result.session_terminal=final.session_terminal;result.collection_evidence=final.collection_evidence??null;result.memory_audit=final.memory_audit??null;}catch{}}
    }
    finally{await session?.close();}
    await checkpoint(observations,report());
    if(signal?.aborted)break;
  }
  return {observations,report:report()};
}
export async function writeRunCheckpoint(directory,observations,report) {
  // CLI creates a fresh private directory; no existing run or dataset is replaced.
  await atomicPrivateJson(join(directory,'observations.json'),observations);
  await atomicPrivateJson(join(directory,'report.json'),report);
}
