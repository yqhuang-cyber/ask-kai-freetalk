import {createHash} from 'node:crypto';
import {requireThat,id} from '../contracts.js';

export const RECORD_VERSION='teaching-record-v1';
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const oneOf=(value,values)=>values.includes(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
function fields(value,required,optional=[]){requireThat(plain(value)&&required.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>[...required,...optional].includes(k)),'INVALID_RECORD_FIELDS');}
function count(value){requireThat(integer(value),'INVALID_RECORD_COUNT');}
function time(value){requireThat(integer(value),'INVALID_RECORD_TIME');}
function label(value){requireThat(typeof value==='string'&&value.length>0&&value.length<=128,'INVALID_RECORD_LABEL');}
function unique(items){requireThat(new Set(items).size===items.length,'DUPLICATE_RECORD_SOURCE');}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
export const recordHash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function validScope(scope){
  fields(scope,['learner_id','assignment_id','attempt_id','session_id','plan_hash','auth_epoch','deletion_epoch','consent_revision']);
  for(const k of ['learner_id','assignment_id','attempt_id','session_id'])id(scope[k]);
  requireThat(hex(scope.plan_hash),'INVALID_RECORD_PLAN');
  for(const k of ['auth_epoch','deletion_epoch','consent_revision'])requireThat(integer(scope[k])&&scope[k]>0,'INVALID_RECORD_EPOCH');
  return scope;
}
function validTranscript(segment){
  fields(segment,['id','sequence','role','turn_id','response_id','event_ids','text','kind','status','received_at','speaking_time','uncertainty','source']);
  id(segment.id);id(segment.turn_id);count(segment.sequence);time(segment.received_at);
  requireThat(Array.isArray(segment.event_ids)&&segment.event_ids.length>0,'INVALID_RECORD_EVENTS');segment.event_ids.forEach(id);unique(segment.event_ids);
  requireThat(typeof segment.text==='string'&&segment.text.length>0&&segment.text.length<=65536,'INVALID_RECORD_TEXT');
  requireThat(oneOf(segment.role,['learner','kai'])&&oneOf(segment.kind,['content','control'])&&oneOf(segment.uncertainty,['unknown','asr_uncertain','none_reported']),'INVALID_TRANSCRIPT');
  // Only an adapter with independently verified timing may introduce a future timed version.
  requireThat(segment.speaking_time===null,'UNVERIFIED_SPEAKING_TIME');
  if(segment.role==='learner')requireThat(segment.source==='accepted_user_final'&&segment.response_id===null&&segment.status==='final','INVALID_LEARNER_SOURCE');
  else {id(segment.response_id);requireThat(segment.source==='forwarded_safe_text'&&oneOf(segment.status,['completed','cancelled','interrupted','incomplete']),'INVALID_KAI_SOURCE');}
}
function validAudio(audio,record){
  fields(audio,['id','blob_id','sha256','stream_id','sample_start','sample_end','sample_rate','channels','encoding','speaker','turn_id','quality','alignment','created_at','expires_at','consent_revision']);
  for(const k of ['id','blob_id','stream_id'])id(audio[k]);
  requireThat(hex(audio.sha256),'INVALID_AUDIO_HASH');
  requireThat(integer(audio.sample_start)&&integer(audio.sample_end)&&audio.sample_end>audio.sample_start,'INVALID_AUDIO_RANGE');
  requireThat(audio.sample_rate===16000&&audio.channels===1&&audio.encoding==='pcm_s16le','UNSUPPORTED_RECORD_AUDIO');
  requireThat(oneOf(audio.speaker,['learner_verified','unknown']),'INVALID_AUDIO_SPEAKER');if(audio.turn_id!==null)id(audio.turn_id);
  fields(audio.quality,['noise','clipping','missing_frames','overlap']);
  requireThat(Object.values(audio.quality).every(v=>oneOf(v,['unknown','detected','not_detected'])),'INVALID_AUDIO_QUALITY');
  time(audio.created_at);time(audio.expires_at);
  requireThat(audio.created_at>=record.created_at&&audio.created_at<=record.sealed_at&&audio.expires_at<=record.retention.audio_expires_at&&audio.expires_at>audio.created_at&&audio.consent_revision===record.scope.consent_revision,'INVALID_AUDIO_LIFETIME');
  if(audio.alignment!==null){
    fields(audio.alignment,['segment_id','text_start','text_end','version','confidence','basis']);label(audio.alignment.version);
    const s=record.transcript.find(s=>s.id===audio.alignment.segment_id);
    requireThat(s?.role==='learner'&&s.turn_id===audio.turn_id&&audio.speaker==='learner_verified','AUDIO_ALIGNMENT_OWNER');
    textRange(s,audio.alignment.text_start,audio.alignment.text_end);
    requireThat(Number.isFinite(audio.alignment.confidence)&&audio.alignment.confidence>=0&&audio.alignment.confidence<=1&&oneOf(audio.alignment.basis,['author_verified','aligner_candidate']),'INVALID_AUDIO_ALIGNMENT');
  }
}
function textRange(segment,start,end){requireThat(segment&&integer(start)&&integer(end)&&end>start&&end<=segment.text.length,'INVALID_TEXT_RANGE');
  // Ranges are UTF-16 offsets; never permit splitting an emoji/surrogate pair.
  for(const n of [start,end])requireThat(!(n>0&&n<segment.text.length&&/[\uD800-\uDBFF]/.test(segment.text[n-1])&&/[\uDC00-\uDFFF]/.test(segment.text[n])),'INVALID_TEXT_RANGE');
}
function manifest(record){
  const m=record.transcript_manifest;
  fields(m,['accepted_learner_finals','persisted_learner_finals','forwarded_kai_responses','persisted_kai_responses','analyzable_segments','gaps','late_events','uncertain_segments','state','seal_reason']);
  for(const k of ['accepted_learner_finals','forwarded_kai_responses'])requireThat(m[k]===null||integer(m[k]),'INVALID_RECORD_COUNT');
  for(const k of ['persisted_learner_finals','persisted_kai_responses','analyzable_segments','late_events','uncertain_segments'])count(m[k]);
  const learners=record.transcript.filter(s=>s.role==='learner'),kai=record.transcript.filter(s=>s.role==='kai');
  requireThat(m.persisted_learner_finals===learners.length&&m.persisted_kai_responses===kai.length&&m.analyzable_segments===record.transcript.filter(s=>s.kind==='content').length&&m.uncertain_segments===record.transcript.filter(s=>s.uncertainty!=='none_reported').length,'MANIFEST_COUNT_MISMATCH');
  requireThat((m.accepted_learner_finals===null||m.accepted_learner_finals>=learners.length)&&(m.forwarded_kai_responses===null||m.forwarded_kai_responses>=kai.length),'MANIFEST_COUNT_MISMATCH');
  requireThat(Array.isArray(m.gaps)&&oneOf(m.state,['complete','partial','unavailable'])&&oneOf(m.seal_reason,['ended','disconnected','flush_timeout','revoked','legacy_unavailable']),'INVALID_TRANSCRIPT_MANIFEST');
  for(const gap of m.gaps){fields(gap,['after_sequence','before_sequence','reason']);requireThat(gap.after_sequence===null||integer(gap.after_sequence),'INVALID_RECORD_GAP');requireThat(gap.before_sequence===null||integer(gap.before_sequence),'INVALID_RECORD_GAP');requireThat(gap.after_sequence===null||gap.before_sequence===null||gap.before_sequence>gap.after_sequence,'INVALID_RECORD_GAP');requireThat(oneOf(gap.reason,['overflow','write_failed','truncated','disconnected','unauthorized','legacy_unavailable','unknown']),'INVALID_RECORD_GAP');}
  if(m.state==='complete')requireThat(m.accepted_learner_finals!==null&&m.forwarded_kai_responses!==null&&m.accepted_learner_finals===learners.length&&m.forwarded_kai_responses===kai.length&&!m.gaps.length&&kai.every(s=>s.status==='completed')&&m.seal_reason==='ended','FALSE_COMPLETE_MANIFEST');
  if(m.state==='unavailable')requireThat(!record.transcript.length&&m.gaps.length>0,'INVALID_UNAVAILABLE_MANIFEST');
  const a=record.audio_manifest;fields(a,['state','captured_samples','persisted_samples','reason']);
  requireThat(oneOf(a.state,['available','partial','unavailable'])&&(a.captured_samples===null||integer(a.captured_samples))&&integer(a.persisted_samples)&&oneOf(a.reason,['captured','not_authorized','not_enabled','quality_insufficient','missing','legacy_unavailable']),'INVALID_AUDIO_MANIFEST');
  const total=record.audio.reduce((n,s)=>n+s.sample_end-s.sample_start,0);
  requireThat(total===a.persisted_samples&&(a.captured_samples===null||a.captured_samples>=total),'AUDIO_MANIFEST_COUNT_MISMATCH');
  if(a.state==='available')requireThat(total>0&&a.captured_samples===total&&a.reason==='captured','FALSE_COMPLETE_AUDIO');
  if(a.state==='unavailable')requireThat(total===0&&a.reason!=='captured','INVALID_AUDIO_MANIFEST');
}
export function validateRecord(record,expectedScope=record?.scope){
  fields(record,['schema_version','scope','version','created_at','sealed_at','retention','transcript','audio','transcript_manifest','audio_manifest','snapshot_hash']);
  requireThat(record.schema_version===RECORD_VERSION&&integer(record.version)&&record.version>0,'INVALID_RECORD_VERSION');validScope(record.scope);validScope(expectedScope);
  requireThat(recordHash(record.scope)===recordHash(expectedScope),'RECORD_SCOPE_MISMATCH');time(record.created_at);time(record.sealed_at);requireThat(record.sealed_at>=record.created_at,'INVALID_RECORD_TIME');
  fields(record.retention,['policy_version','text_expires_at','audio_expires_at']);label(record.retention.policy_version);
  for(const k of ['text_expires_at','audio_expires_at']){time(record.retention[k]);requireThat(record.retention[k]>record.created_at,'INVALID_RECORD_RETENTION');}
  requireThat(Array.isArray(record.transcript)&&Array.isArray(record.audio)&&record.transcript.length<=20000&&record.audio.length<=20000,'INVALID_RECORD_SEGMENTS');
  record.transcript.forEach(validTranscript);unique(record.transcript.map(s=>s.id));unique(record.transcript.map(s=>s.sequence));unique(record.transcript.flatMap(s=>s.event_ids));unique(record.transcript.filter(s=>s.role==='learner').map(s=>s.turn_id));unique(record.transcript.filter(s=>s.role==='kai').map(s=>s.response_id));
  record.transcript.forEach((s,i)=>requireThat(s.received_at>=record.created_at&&s.received_at<=record.sealed_at&&(!i||record.transcript[i-1].sequence<s.sequence),'INVALID_TRANSCRIPT_ORDER'));
  unique(record.audio.map(s=>s.id));record.audio.forEach(a=>validAudio(a,record));
  const streams=new Map();for(const a of record.audio){const end=streams.get(a.stream_id)??0;requireThat(a.sample_start>=end,'OVERLAPPING_AUDIO_RANGE');streams.set(a.stream_id,a.sample_end);}
  manifest(record);
  const {snapshot_hash,...body}=record;requireThat(hex(snapshot_hash)&&recordHash(body)===snapshot_hash,'RECORD_HASH_MISMATCH');return record;
}
export function sealRecord(body){const snapshot=structuredClone(body);snapshot.snapshot_hash=recordHash(snapshot);validateRecord(snapshot);return snapshot;}

export function validateEvidenceRef(record,ref){
  fields(ref,['snapshot_hash','type','source_id','start','end','quote']);requireThat(ref.snapshot_hash===record.snapshot_hash,'REFERENCE_SNAPSHOT_MISMATCH');
  if(ref.type==='text'){const s=record.transcript.find(s=>s.id===ref.source_id);textRange(s,ref.start,ref.end);requireThat(ref.quote===s.text.slice(ref.start,ref.end),'REFERENCE_QUOTE_MISMATCH');return s;}
  requireThat(ref.type==='audio','INVALID_REFERENCE_TYPE');const a=record.audio.find(a=>a.id===ref.source_id);
  requireThat(a&&integer(ref.start)&&integer(ref.end)&&ref.start>=a.sample_start&&ref.end>ref.start&&ref.end<=a.sample_end&&ref.quote===null,'INVALID_AUDIO_REFERENCE');return a;
}
// These are structural source contracts, not an assertion that a model diagnosis is true.
export function validateAnalysisCandidate(candidate,record){
  fields(candidate,['schema_version','id','snapshot_hash','dimension','status','observation','explanation','support','uncertainty','suggestion','evidence_refs','analyzer_version']);
  requireThat(candidate.schema_version==='analysis-candidate-v1'&&candidate.snapshot_hash===record.snapshot_hash,'CANDIDATE_SOURCE_MISMATCH');id(candidate.id);label(candidate.analyzer_version);
  requireThat(oneOf(candidate.dimension,['context_understanding','oral_expression','pronunciation','tone','fluency'])&&oneOf(candidate.status,['observed','review_required','insufficient_evidence']),'INVALID_ANALYSIS_CANDIDATE');
  requireThat(candidate.support==='unknown','UNVERIFIED_SUPPORT_ATTRIBUTION');
  for(const k of ['observation','explanation','uncertainty','suggestion'])requireThat(typeof candidate[k]==='string'&&candidate[k].length<=4000,'INVALID_ANALYSIS_TEXT');
  requireThat(Array.isArray(candidate.evidence_refs)&&candidate.evidence_refs.length<=32,'INVALID_ANALYSIS_REFS');const sources=candidate.evidence_refs.map(ref=>validateEvidenceRef(record,ref));
  if(candidate.status!=='insufficient_evidence'){
    requireThat(sources.length>0,'ANALYSIS_EVIDENCE_REQUIRED');
    if(['pronunciation','tone','fluency'].includes(candidate.dimension))requireThat(sources.some(s=>s.speaker==='learner_verified'),'ACOUSTIC_EVIDENCE_REQUIRED');
    else requireThat(sources.some(s=>s.role==='learner'&&s.kind==='content'),'LEARNER_EVIDENCE_REQUIRED');
    if(candidate.dimension==='context_understanding')requireThat(sources.some(s=>s.role==='kai'&&s.kind==='content'),'QUESTION_CONTEXT_REQUIRED');
  }
  return candidate;
}
export function validateAnalysisResult(result,record){
  fields(result,['schema_version','snapshot_hash','scope','version','state','text_state','audio_state','candidates','grade','mastery','analyzer_version']);
  requireThat(result.schema_version==='analysis-result-v1'&&result.snapshot_hash===record.snapshot_hash&&recordHash(result.scope)===recordHash(record.scope),'RESULT_SOURCE_MISMATCH');
  requireThat(integer(result.version)&&result.version>0&&result.grade===null&&result.mastery==='unassessed','INVALID_ANALYSIS_RESULT');label(result.analyzer_version);
  const states=['complete','failed','not_authorized','unavailable'];requireThat(states.includes(result.text_state)&&states.includes(result.audio_state)&&oneOf(result.state,['complete','partial','unavailable']),'INVALID_ANALYSIS_STATE');
  requireThat(Array.isArray(result.candidates)&&result.candidates.length<=100,'INVALID_ANALYSIS_RESULT');unique(result.candidates.map(c=>c.id));result.candidates.forEach(c=>validateAnalysisCandidate(c,record));
  for(const c of result.candidates)if(c.status!=='insufficient_evidence')requireThat((['pronunciation','tone','fluency'].includes(c.dimension)?result.audio_state:result.text_state)==='complete','RESULT_BRANCH_MISMATCH');
  const aggregate=result.text_state==='complete'&&result.audio_state==='complete'?'complete':result.text_state==='complete'||result.audio_state==='complete'?'partial':'unavailable';
  requireThat(result.state===aggregate,'FALSE_COMPLETE_ANALYSIS');return result;
}
