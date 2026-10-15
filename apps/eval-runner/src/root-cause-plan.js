import { join } from 'node:path';
import { readAudioManifest,selectCases,sha256 } from './multiturn-plan.js';

export const ROOT_CAUSE_VERSION='kai-root-cause-v1';
export const ROOT_CASE_IDS=['ask-kai-language-08','ask-kai-v2-040','ask-kai-v2-036','ask-kai-v2-011'];
export const SOURCE_MANIFEST_HASHES={
  'ask-kai-language-08':'bb0bb8615b7977c1ebed136921fbc707658f8e814aef13d0dca97a7c2da0a291',
  'ask-kai-v2-040':'c9dd1bdf5b0b9695a666ff2c9ccbb747b84421f31a464dad123bf3e7006b5c85',
  'ask-kai-v2-036':'9ffa4ae78550ed92431d83e687f4f0d40533d1dab92c6a0b29cd516d763b3031',
  'ask-kai-v2-011':'ef0afff0fe1e9dc3bdd0eaa504d7d98114fd7d017f658f8bea2f7e2e8ac795cd'
};
export function buildRootCausePlan(data) {
  const selected=selectCases(data,{caseIds:ROOT_CASE_IDS,includeLanguage:true,limit:100}),indexed=new Map(selected.map(c=>[c.id,c]));
  const conditions=[
    {condition:'language-chain',case_id:ROOT_CASE_IDS[0],source_turns:[1,2,3,4,4],probe_step:5,family:'language',variable:'actual_prior_session_then_repeat_after_ack'},
    {condition:'language-initial-zh',case_id:ROOT_CASE_IDS[0],source_turns:[4],family:'language',variable:'initial_support_language',support_language:'zh'},
    {condition:'language-initial-bilingual',case_id:ROOT_CASE_IDS[0],source_turns:[4],family:'language',variable:'initial_support_language',support_language:'zh_en'},
    {condition:'split-040-chain',case_id:ROOT_CASE_IDS[1],source_turns:[1,2],family:'segmentation',variable:'prior_session_present'},
    {condition:'split-040-isolated',case_id:ROOT_CASE_IDS[1],source_turns:[2],family:'segmentation',variable:'prior_session_absent'},
    {condition:'spill-036-chain',case_id:ROOT_CASE_IDS[2],source_turns:[1,2,3],family:'segmentation',variable:'same_pcm_replication'},
    {condition:'hmm-011-chain',case_id:ROOT_CASE_IDS[3],source_turns:[1,2,3,4,5,6],family:'short_input',variable:'prior_session_present'},
    {condition:'hmm-011-isolated',case_id:ROOT_CASE_IDS[3],source_turns:[6],family:'short_input',variable:'prior_session_absent'}
  ];
  const trials=[];
  for(const repetition of [1,2])for(const spec of repetition===1?conditions:[...conditions].reverse()) {
    const source=indexed.get(spec.case_id),profile=structuredClone(source.initial_profile);
    if(spec.support_language)profile.support_language=spec.support_language;
    const steps=spec.source_turns.map((turn,i)=>({step:i+1,source_case_id:source.id,source_turn:turn,
      diagnostic_probe:spec.probe_step===i+1,derived_without_prior_history:spec.source_turns.length===1&&turn!==1}));
    const c={...structuredClone(source),initial_profile:profile,turns:steps.map(s=>{
      const t=source.turns.find(t=>t.turn===s.source_turn);
      return {turn:s.step,text:t.text,dependency:s.derived_without_prior_history||s.diagnostic_probe?
        {type:'none',source_turns:[],condition:'Explicit diagnostic derivative; not the original authored evaluation turn.'}:structuredClone(t.dependency)};
    })};
    trials.push({...spec,trial_id:`${spec.condition}-r${repetition}`,repetition,steps,case:c});
  }
  return {version:ROOT_CAUSE_VERSION,kind:'ask-kai-preregistered-root-cause-plan',source_case_ids:ROOT_CASE_IDS,
    trials,trial_count:trials.length,max_input_steps:trials.reduce((n,t)=>n+t.steps.length,0),
    original_scripts_changed:false,derived_probes_scored:false,automatic_retries:0,judge_calls:0,
    limitations:['Two repetitions are diagnostic, not a statistical success rate.',
      'PCM and declared profile are controlled; actual earlier Kai replies can vary in each fresh session.',
      'ACK/generation timing is observed, never experimentally gated in this frozen-Agent phase.',
      'Historical failed PCM was not saved; it cannot be reconstructed from a newer fixture.']};
}

export function validateRootCauseRequest(request,{baseline,data,dataSha,profileBytes,env}) {
  const keys=['version','kind','request_id','agent_revision','dataset_sha256','profile_sha256','plan_version','duration_ms','source_fixture_run','source_fixture_artifact_id','source_manifest_hashes'];
  if(request?.version!==1||request.kind!=='ask_kai_root_cause_diagnostic'||!/^root-cause-\d{4}-\d{2}-\d{2}-\d{2}$/.test(request.request_id??'')||
    request.agent_revision!==baseline.agent_revision||request.dataset_sha256!==dataSha||request.profile_sha256!==sha256(profileBytes)||
    request.plan_version!==ROOT_CAUSE_VERSION||request.duration_ms!==1200000||request.source_fixture_run!==38196302477||request.source_fixture_artifact_id!==11722999569||
    JSON.stringify(request.source_manifest_hashes)!==JSON.stringify(SOURCE_MANIFEST_HASHES)||Object.keys(request).some(k=>!keys.includes(k))||
    env.GITHUB_REF!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??''))throw new Error('INVALID_ROOT_CAUSE_REQUEST');
  return buildRootCausePlan(data);
}

export async function readRootCauseInputs({data,datasetSha256,directory,manifestHashes=SOURCE_MANIFEST_HASHES}) {
  const cases=selectCases(data,{caseIds:ROOT_CASE_IDS,includeLanguage:true,limit:100}),inputs=new Map();
  for(const c of cases) {
    const result=await readAudioManifest(join(directory,c.id,'audio-manifest.json'),[c],{datasetSha256});
    if(result.manifest_sha256!==manifestHashes[c.id])throw new Error('ROOT_FIXTURE_MANIFEST_DRIFT');
    for(const [key,audio] of result.inputs){if(audio.source!=='authored_tts')throw new Error('ROOT_FIXTURE_SOURCE_MISMATCH');inputs.set(key,audio);}
  }
  return inputs;
}

export function trialInputs(trial,sourceInputs) {
  return new Map(trial.steps.map(s=>{
    const audio=sourceInputs.get(`${s.source_case_id}/${s.source_turn}`);if(!audio)throw new Error('ROOT_FIXTURE_MISSING');
    return [`${trial.case_id}/${s.step}`,audio];
  }));
}
