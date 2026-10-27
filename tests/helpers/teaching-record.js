import {RECORD_VERSION,recordHash,sealRecord} from '../../packages/teacher-assistant/teaching-record/contracts.js';

// Authored synthetic records only. No learner or provider material belongs in fixtures.
export const recordScope={learner_id:'synthetic-learner',assignment_id:'synthetic-assignment',attempt_id:'synthetic-attempt',session_id:'synthetic-session',plan_hash:recordHash({topic:'昆虫',source:'authored_synthetic'}),auth_epoch:1,deletion_epoch:1,consent_revision:1};
export function syntheticRecord({rounds=1,interrupted=false,missing=false,legacy=false,audio=false}={}){
  const transcript=[];
  if(!legacy)for(let i=0;i<rounds;i++){
    transcript.push({id:`kai-${i}`,sequence:i*2,role:'kai',turn_id:`turn-${i}`,response_id:`response-${i}`,event_ids:[`kai-event-${i}`],text:'这只蝴蝶是什么颜色的？',kind:'content',status:interrupted&&i===rounds-1?'interrupted':'completed',received_at:1000+i*10,speaking_time:null,uncertainty:'unknown',source:'forwarded_safe_text'});
    transcript.push({id:`learner-${i}`,sequence:i*2+1,role:'learner',turn_id:`turn-${i}`,response_id:null,event_ids:[`user-event-${i}`],text:'我看到一只黄色的蝴蝶🦋，它停在叶子上。',kind:'content',status:'final',received_at:1001+i*10,speaking_time:null,uncertainty:'asr_uncertain',source:'accepted_user_final'});
  }
  const body={schema_version:RECORD_VERSION,scope:recordScope,version:1,created_at:1000,sealed_at:1000+rounds*10,
    retention:{policy_version:'deep-report-retention-v1',text_expires_at:604801000,audio_expires_at:604801000},transcript,audio:[],
    transcript_manifest:{accepted_learner_finals:legacy?null:rounds+(missing?1:0),persisted_learner_finals:legacy?0:rounds,forwarded_kai_responses:legacy?null:rounds,persisted_kai_responses:legacy?0:rounds,analyzable_segments:transcript.length,gaps:missing||legacy?[{after_sequence:null,before_sequence:null,reason:legacy?'legacy_unavailable':'write_failed'}]:[],late_events:0,uncertain_segments:transcript.length,state:legacy?'unavailable':missing||interrupted?'partial':'complete',seal_reason:legacy?'legacy_unavailable':'ended'},
    audio_manifest:{state:'unavailable',captured_samples:null,persisted_samples:0,reason:legacy?'legacy_unavailable':'not_enabled'}};
  if(audio){body.audio=[{id:'audio-0',blob_id:'synthetic-only-no-file',sha256:recordHash({synthetic_silence:true}),stream_id:'capture-0',sample_start:0,sample_end:16000,sample_rate:16000,channels:1,encoding:'pcm_s16le',speaker:'learner_verified',turn_id:'turn-0',quality:{noise:'unknown',clipping:'unknown',missing_frames:'unknown',overlap:'unknown'},alignment:null,created_at:1000,expires_at:604801000,consent_revision:1}];body.audio_manifest={state:'available',captured_samples:16000,persisted_samples:16000,reason:'captured'};}
  return sealRecord(body);
}
export function textRef(record,sourceId){const s=record.transcript.find(s=>s.id===sourceId);return {snapshot_hash:record.snapshot_hash,type:'text',source_id:s.id,start:0,end:s.text.length,quote:s.text};}
export function candidate(record,dimension='oral_expression'){
  return {schema_version:'analysis-candidate-v1',id:'synthetic-candidate',snapshot_hash:record.snapshot_hash,dimension,status:'review_required',observation:'学生描述了颜色和位置。',explanation:'作者编写的契约测试候选，不是模型或声学验证结果。',support:'unknown',uncertainty:'识别文本待核对。',suggestion:'尝试补充一个细节。',evidence_refs:[textRef(record,'learner-0')],analyzer_version:'authored-synthetic-v1'};
}
