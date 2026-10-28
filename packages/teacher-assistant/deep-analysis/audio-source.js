import {recordHash} from '../teaching-record/contracts.js';
// Freeze speaker, quality and reference admission together with the PCM source.
export function audioMetadataHash(segment){return recordHash(Object.fromEntries(['id','learner_id','assignment_id','attempt_id','session_id','plan_hash','auth_epoch','deletion_epoch','consent_revision','stream_id','sample_start','sample_end','sample_rate','channels','encoding','sha256','speaker','turn_id','alignment','quality','expires_at',...(segment.capture?['capture','boundary_reason']:[])].map(k=>[k,segment[k]??null])));}
