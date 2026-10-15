import { join } from 'node:path';
import { preflight } from '../../../packages/provider-doubao/probe.js';
import { SeeduplexProvider,validateSeeduplexProfile } from '../../../packages/provider-doubao/seeduplex.js';
import { selectCases,readAudioManifest,sha256 } from './multiturn-plan.js';
import { prepareInputAudio,synthesizeInput } from './input-audio.js';
import { runMultiturn,writeRunCheckpoint } from './multiturn.js';

const diagnosticKeys=new Set(['type','event_id','session','id','item_id','question_id','response_id','delta','transcript','text','results','asr','content_index','response','error','code','status_code','start','end','is_interim','words','word','duration','confidence','audio_info','audio','utterances']);
const protocolCodes=new Set(['INVALID_PROVIDER_EVENT','INVALID_PROVIDER_ID','INVALID_PROVIDER_TEXT','PROVIDER_ASR_FAILED',
  'PROVIDER_REPORTED_ERROR','FOREIGN_PROVIDER_TURN','UNBOUND_PROVIDER_RESPONSE','UNBOUND_AUDIO_STREAM','AMBIGUOUS_AUDIO_STREAM',
  'PROVIDER_TEXT_LIMIT','PROVIDER_TEXT_REWRITE','INVALID_PROVIDER_AUDIO','OVERLAPPING_PROVIDER_RESPONSE','UNBOUND_CONTEXT_ACK','UNBOUND_CANCEL_ACK','PROVIDER_ASR_TEXT_CONFLICT']);
function shape(value,depth=0) {
  if(value===null)return {type:'null'};
  if(typeof value==='string')return {type:'string',length:value.length};
  if(Array.isArray(value))return {type:'array',length:value.length,...(depth<3&&value.length?{first:shape(value[0],depth+1)}:{})};
  if(typeof value==='object')return {type:'object',fields:depth<3?Object.fromEntries(Object.keys(value).filter(k=>diagnosticKeys.has(k)).slice(0,24).map(k=>[k,shape(value[k],depth+1)])):undefined};
  return {type:typeof value};
}
// Capture field types/lengths and per-session ID aliases only. No wire payload,
// strings, transcripts, keys, session identifiers or PCM are retained.
export function trialProviderFactory({profile,env,onDiagnostic=()=>{},socketFactory}) {
  return ticket=>{
    const provider=new SeeduplexProvider({profile,env,protocolProbe:true,speechPace:ticket.speech_pace,...(socketFactory?{socketFactory}:{})});
    return observeTrialProvider(provider,{profile,onDiagnostic});
  };
}
export function observeTrialProvider(provider,{profile,onDiagnostic=()=>{}}) {
    const receive=provider.receive.bind(provider),aliases=new Map(),asrSnapshots=new Map();
    const record=row=>{try{onDiagnostic(row);}catch{}};
    const alias=value=>{if(typeof value!=='string'||!value||value.length>120)return null;if(!aliases.has(value))aliases.set(value,`id-${aliases.size+1}`);return aliases.get(value);};
    provider.receive=raw=>{
      const type=profile.observed_event_types.includes(raw?.type)?raw.type:'other';
      const row={type,shape:shape(raw),item_id:alias(raw?.item_id),question_id:alias(raw?.question_id),response_id:alias(raw?.response_id)};
      const codes=[raw?.code,raw?.status_code,raw?.error?.code].filter(v=>Number.isSafeInteger(v)&&v>=0||typeof v==='string'&&/^\d{1,12}$/.test(v));
      if(codes.length)row.service_status_codes=codes.map(Number);
      if(type==='conversation.item.input_audio_transcription.delta'&&row.item_id&&typeof raw.delta==='string') {
        const prior=asrSnapshots.get(row.item_id);let common=0;
        if(prior!==undefined)while(common<Math.min(prior.length,raw.delta.length)&&prior[common]===raw.delta[common])common++;
        row.partial_relation=prior===undefined?'first':raw.delta===prior?'identical':raw.delta.startsWith(prior)?'extends':prior.startsWith(raw.delta)?'shortens':common?'revises':'unrelated';
        row.shared_prefix_chars=common;asrSnapshots.set(row.item_id,raw.delta);
      }
      if(type==='conversation.item.input_audio_transcription.completed')asrSnapshots.delete(row.item_id);
      try{receive(raw);if(type!=='response.output_audio.delta')record(row);}
      catch(error){record({...row,failure:protocolCodes.has(error.message)?error.message:'PROVIDER_PROTOCOL_ERROR'});throw error;}
    };
    return provider;
}

// Fixed, bounded trial on authored scripts. The same probe-only attestation as
// the live adapter smoke never becomes an ordinary Web/CLI runtime profile.
export function validateActionsTrial({profile,request,data,datasetSha256,env={}}) {
  if(request?.version!==1||request.kind!=='doubao_multiturn_trial'||
    !/^multiturn-\d{4}-\d{2}-\d{2}-\d{2}$/.test(request.request_id??'')||
    request.profile_sha256!==sha256(Buffer.from(JSON.stringify(profile)))||request.dataset_sha256!==datasetSha256||
    request.case_id!=='ask-kai-v2-001'||request.expected_turns!==4||request.duration_ms!==300000||
    Object.keys(request).some(k=>!['version','kind','request_id','profile_sha256','dataset_sha256','case_id','expected_turns','duration_ms'].includes(k))||
    profile.review_scope!=='static_session_connect_only'||profile.realtime?.reviewed!==false||profile.realtime?.ordered_acks_reviewed!==false||
    profile.auth?.env!=='DOUBAO_API_KEY'||env.GITHUB_REF!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??''))throw new Error('INVALID_MULTITURN_TRIAL_REQUEST');
  const cases=selectCases(data,{caseIds:[request.case_id]});
  if(cases.length!==1||cases[0].entry!=='free'||cases[0].turns.length!==request.expected_turns)throw new Error('INVALID_MULTITURN_TRIAL_CASE');
  const scoped=structuredClone(profile);
  scoped.realtime={...scoped.realtime,reviewed:true,ordered_acks_reviewed:true,review_scope:'protocol_smoke'};
  validateSeeduplexProfile(scoped,{protocolProbe:true});
  return {cases,scoped,credentialReady:preflight(profile,env).live_eligible};
}
export async function runActionsTrial({profile,request,data,datasetSha256,env={},signal,directory,
  prepare=prepareInputAudio,collect=runMultiturn,readInputs=readAudioManifest,onProgress=()=>{}}) {
  const {cases,scoped,credentialReady}=validateActionsTrial({profile,request,data,datasetSha256,env});
  const report={version:1,kind:'ask-kai-actions-multiturn-trial',request_id:request.request_id,
    case_id:request.case_id,expected_turns:4,candidate_revision:env.GITHUB_SHA,dataset_sha256:datasetSha256,
    profile_sha256:request.profile_sha256,input_source:'authored_tts',business_source:'mock_hskai',
    protocol_probe:true,runtime_profile_scope:'protocol_smoke',web_profile_enabled:false,
    content_scored:false,judge_calls:0,microphone_uploaded:false,browser_audio_tested:false,real_experience_accepted:false,
    input_audio_prepared_turns:0,status:'running',phase:'preflight',failure:null,
    protocol_diagnostics:[],protocol_diagnostics_truncated:false,provider_protocol_failure:null};
  if(!credentialReady)return {...report,status:'blocked',failure:'SERVER_CREDENTIAL_REQUIRED'};
  const boundedSignal=AbortSignal.any([AbortSignal.timeout(request.duration_ms),...(signal?[signal]:[])]);
  let connection=0;
  const record=row=>{
    if(row.failure)report.provider_protocol_failure=row;
    if(report.protocol_diagnostics.length<256)report.protocol_diagnostics.push(row);
    else report.protocol_diagnostics_truncated=true;
  };
  try {
    if(boundedSignal.aborted)throw new Error('RUN_ABORTED');
    report.phase='prepare_authored_input_audio';
    const manifest=await prepare({cases,datasetSha256,profile:scoped,env,signal:boundedSignal,directory,
      synthesize:args=>synthesizeInput({...args,createProvider:options=>{
        const trialConnection=++connection;
        return observeTrialProvider(new SeeduplexProvider(options),{profile:options.profile,
          onDiagnostic:row=>record({...row,phase:'prepare_authored_input_audio',trial_connection:trialConnection})});
      }}),
      timeoutMs:45000,protocolProbe:true,onProgress:row=>{
        if(row.state==='input_audio_prepared')report.input_audio_prepared_turns++;
        onProgress(row);
      }});
    report.input_audio_prepared_turns=manifest.entries.length;
    const audio=await readInputs(join(directory,'audio-manifest.json'),cases,{datasetSha256});
    report.phase='collect_actual_agent_replies';
    const providerFactory=ticket=>{
      const trialConnection=++connection;
      return trialProviderFactory({profile:scoped,env,onDiagnostic:row=>record({...row,phase:'collect_actual_agent_replies',trial_connection:trialConnection})})(ticket);
    };
    const result=await collect({cases,inputs:audio.inputs,profile:scoped,env,signal:boundedSignal,
      candidateRevision:env.GITHUB_SHA,datasetVersion:data.dataset_version,datasetSha256,manifestSha256:audio.manifest_sha256,
      turnTimeoutMs:45000,protocolProbe:true,providerFactory,onProgress,checkpoint:(o,r)=>writeRunCheckpoint(directory,o,r)});
    report.collection=result.report;report.status=result.report.status;report.phase='finished';
  }catch(error){report.status='failed';report.failure=/^[A-Z_]{1,80}$/.test(error.message)?error.message:'MULTITURN_TRIAL_FAILED';}
  return report;
}
