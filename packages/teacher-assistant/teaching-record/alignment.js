import {requireThat,id} from '../contracts.js';
import {recordHash,validateEvidenceRef,validateRecord} from './contracts.js';

// Validates an externally supplied alignment proposal. It does not infer timing
// from ASR arrival, validate the words, identify a speaker, or run an aligner.
export function proposeAudioAlignment({record,expectedScope,audio,proposal}){
  validateRecord(record,expectedScope);
  requireThat(audio&&audio.attempt_id===record.scope.attempt_id&&audio.session_id===record.scope.session_id&&audio.learner_id===record.scope.learner_id&&audio.plan_hash===record.scope.plan_hash&&audio.auth_epoch===record.scope.auth_epoch&&audio.deletion_epoch===record.scope.deletion_epoch,'ALIGNMENT_SCOPE_MISMATCH');
  id(audio.id);requireThat(typeof audio.sha256==='string'&&/^[a-f0-9]{64}$/.test(audio.sha256)&&audio.encoding==='pcm_s16le'&&audio.sample_rate===16000&&Number.isSafeInteger(audio.sample_start)&&Number.isSafeInteger(audio.sample_end)&&audio.sample_start>=0&&audio.sample_end>audio.sample_start,'INVALID_ALIGNMENT_AUDIO');
  requireThat(proposal&&typeof proposal.version==='string'&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(proposal.version)&&Number.isFinite(proposal.confidence)&&proposal.confidence>=0&&proposal.confidence<=1,'INVALID_ALIGNMENT_PROPOSAL');
  requireThat(Number.isSafeInteger(proposal.sample_start)&&Number.isSafeInteger(proposal.sample_end)&&proposal.sample_start>=audio.sample_start&&proposal.sample_end<=audio.sample_end&&proposal.sample_end>proposal.sample_start,'INVALID_ALIGNMENT_RANGE');
  const ref=proposal.text_ref;requireThat(ref?.type==='text','INVALID_ALIGNMENT_REFERENCE');const text=validateEvidenceRef(record,ref);requireThat(text.role==='learner'&&text.kind==='content','INVALID_ALIGNMENT_OWNER');
  const body={schema_version:'audio-alignment-candidate-v1',snapshot_hash:record.snapshot_hash,audio_id:audio.id,audio_sha256:audio.sha256,attempt_id:record.scope.attempt_id,session_id:record.scope.session_id,text_segment_id:ref.source_id,text_start:ref.start,text_end:ref.end,sample_start:proposal.sample_start,sample_end:proposal.sample_end,version:proposal.version,confidence:proposal.confidence,status:'review_required',speaker:audio.speaker==='learner_verified'?'learner_verified':'unknown',reference_text_verified:false};
  return {...body,source_hash:recordHash(body)};
}
