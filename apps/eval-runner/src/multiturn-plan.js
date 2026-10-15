import { readFile,realpath,stat } from 'node:fs/promises';
import { resolve,dirname,relative,isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { checkPreparedDataset } from './prepared-dataset.js';
import { validateMemoryRecord } from '../../../packages/hskai-bridge/identity.js';

export const DEFAULT_PREPARED_DATASET='docs/eval-datasets/freechat-v3.1/ask-kai-freechat-eval-v3.1.json';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function boundedJson(path,maxBytes=16000000) {
  if((await stat(path)).size>maxBytes)throw new Error('EVAL_FILE_TOO_LARGE');
  const bytes=await readFile(path);if(bytes.length>maxBytes)throw new Error('EVAL_FILE_TOO_LARGE');
  return {data:JSON.parse(bytes.toString('utf8')),sha256:sha256(bytes)};
}

// Explicit allowlist: references, expected modes, goals and future inputs never
// enter a provider request. Free-chat soft goals remain reviewer data only.
export function selectCases(data,{caseIds=[],limit=1,includeLanguage=false}={}) {
  checkPreparedDataset(data);
  if(!Array.isArray(caseIds)||new Set(caseIds).size!==caseIds.length||!Number.isSafeInteger(limit)||limit<1||limit>100||typeof includeLanguage!=='boolean')throw new Error('INVALID_RUN_SELECTION');
  const all=[...data.cases,...(includeLanguage?data.language_scenarios??[]:[])];
  if(caseIds.some(id=>!all.some(c=>c.id===id)))throw new Error('UNKNOWN_RUN_CASE');
  const selected=(caseIds.length?all.filter(c=>caseIds.includes(c.id)):all).slice(0,limit);
  if(caseIds.length>limit)throw new Error('CASE_LIMIT_TOO_SMALL');
  return selected.map(c=>({id:c.id,entry:c.entry,kind:c.initial_profile?'language_scenario':'original_case',
    initial_profile:structuredClone(c.initial_profile??c.initial_state.profile),
    profile_evidence:structuredClone(c.profile_evidence??c.initial_state.profile_evidence),
    turns:c.turns.map(t=>({turn:t.turn,text:t.input.text,dependency:structuredClone(t.context_dependency??{type:'none',source_turns:[]})}))}));
}
export function profileMemory(profile,now=Date.now()) {
  const values=[['support_language',profile.support_language],['chinese_comprehension',profile.chinese_comprehension],['known_expressions',profile.known_expressions]];
  return values.filter(([field,value])=>field==='known_expressions'?value?.length:field==='chinese_comprehension'?value!=='unknown':true)
    .map(([field,value])=>validateMemoryRecord({field,value,source:'authorized_hskai_profile',updated_at:new Date(now).toISOString(),expires_at:new Date(now+86400000).toISOString()},now));
}
export async function readAudioManifest(path,cases,{datasetSha256,maxAudioMs=30000}={}) {
  const {data,sha256:hash}=await boundedJson(path,1000000);
  if(data?.version!==1||data.kind!=='ask-kai-eval-input-audio'||data.dataset_sha256!==datasetSha256||data.format!=='pcm_s16le'||data.sample_rate!==16000||data.channels!==1||!Array.isArray(data.entries)||data.entries.length>1000)throw new Error('INVALID_AUDIO_MANIFEST');
  const root=await realpath(dirname(resolve(path))),indexed=new Map();
  for(const item of data.entries) {
    const key=`${item.case_id}/${item.turn}`;
    if(indexed.has(key)||!/^ask-kai-(?:v2-\d{3}|language-\d{2})$/.test(item.case_id??'')||!Number.isSafeInteger(item.turn)||item.turn<1||!['authored_tts','approved_recording','synthetic_fixture'].includes(item.source)||!Number.isSafeInteger(item.bytes)||item.bytes<640||item.bytes>16000*2*maxAudioMs/1000||item.bytes%2||!/^[a-f0-9]{64}$/.test(item.sha256??'')||!/^[a-f0-9]{64}$/.test(item.script_sha256??'')||typeof item.path!=='string'||isAbsolute(item.path)||item.path.split(/[\\/]/).includes('..'))throw new Error('INVALID_AUDIO_ENTRY');
    indexed.set(key,item);
  }
  const inputs=new Map();
  for(const c of cases)for(const t of c.turns) {
    const key=`${c.id}/${t.turn}`,item=indexed.get(key);
    if(!item)throw new Error('MISSING_TURN_AUDIO');
    if(item.script_sha256!==sha256(Buffer.from(t.text)))throw new Error('AUDIO_SCRIPT_MISMATCH');
    const file=await realpath(resolve(root,item.path)),rel=relative(root,file);
    if(rel.startsWith('..')||isAbsolute(rel))throw new Error('AUDIO_OUTSIDE_MANIFEST_ROOT');
    if((await stat(file)).size!==item.bytes)throw new Error('AUDIO_SIZE_MISMATCH');
    const bytes=await readFile(file);
    if(bytes.length!==item.bytes||sha256(bytes)!==item.sha256)throw new Error('AUDIO_HASH_MISMATCH');
    let nonzero=false;for(let i=0;i<bytes.length;i+=2)if(bytes.readInt16LE(i)!==0){nonzero=true;break;}
    if(!nonzero)throw new Error('SILENT_TURN_AUDIO');
    inputs.set(key,{bytes,source:item.source,sha256:item.sha256,duration_ms:bytes.length/32});
  }
  return {inputs,manifest_sha256:hash};
}
export const comparableText=text=>text.normalize('NFKC').toLocaleLowerCase('en').replace(/[\p{P}\p{Z}\s]/gu,'');
