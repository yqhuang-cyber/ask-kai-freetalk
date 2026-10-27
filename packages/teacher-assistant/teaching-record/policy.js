import {requireThat} from '../contracts.js';
import {recordHash} from './contracts.js';

export const NOTICE_VERSION='deep-report-notice-v4';
export const POLICY_VERSION='deep-report-retention-v1';
const DAY=86400000;
export function recordingPolicy({textDays=7,audioDays=7}={}){
  for(const n of [textDays,audioDays])requireThat(Number.isSafeInteger(n)&&n>=1&&n<=30,'INVALID_RECORD_RETENTION');
  return {version:POLICY_VERSION,text_days:textDays,audio_days:audioDays};
}
export function configuredRecordingPolicy(env={}){
  const days=key=>{const raw=env[key]??'7';requireThat(typeof raw==='string'&&/^\d+$/.test(raw),'INVALID_RECORD_RETENTION');return Number(raw);};
  return recordingPolicy({textDays:days('ASK_KAI_TA_TEXT_RETENTION_DAYS'),audioDays:days('ASK_KAI_TA_AUDIO_RETENTION_DAYS')});
}
export function recordingNotice(policy=recordingPolicy()){
  return {version:NOTICE_VERSION,policy,source:'mock_hskai',
    title:'对话记录与发音分析',
    current:'你可以选择保存这次练习的对话识别文本。发音录音和深入分析仍在准备中。',
    text:{purpose:'保存你的识别文本和 Kai 的实际回复，用于分析这次对话的理解与表达。识别文本可能有错。',recipient:'本地学习记录服务；文本分析拟使用 MiniMax，启用前会再次说明。',retention_days:policy.text_days},
    audio:{purpose:'仅保存这次发音评测需要的学生语音片段，用于分析发音、声调与语流。',recipient:'本地学习记录服务；发音评测拟使用腾讯智聆，启用前会再次说明。',retention_days:policy.audio_days},
    choice:'文本记录由你选择，可以撤回；不影响继续练习或已有提交。音频记录启用前会再次征求你的选择。',
    deletion:'撤回或到期后删除这次保存的完整对话文本。现有练习记录和规则反馈仍按原设置保留。',
    capabilities:{text_collection:true,audio_collection:false,text_analysis:false,pronunciation_analysis:false,external_processing_reviewed:false}};
}
function owner(choice,context){
  requireThat(choice.learner_id===context.learner_id&&choice.attempt_id===context.attempt_id&&choice.auth_epoch===context.auth_epoch&&choice.deletion_epoch===context.deletion_epoch,'RECORD_AUTHORIZATION_REVOKED');
}
export function newRecordingChoice(attempt,policy,now){
  return {id:attempt.id,learner_id:attempt.learner_id,attempt_id:attempt.id,auth_epoch:attempt.auth_epoch,deletion_epoch:attempt.deletion_epoch,revision:0,notice_version:NOTICE_VERSION,policy:structuredClone(policy),created_at:now,
    text:{allowed:false,state:'not_selected',grant_revision:0,processing:'local-only',expires_at:now+policy.text_days*DAY},audio:{allowed:false,state:'not_selected',grant_revision:0,processing:'local-only',expires_at:now+policy.audio_days*DAY},updated_at:now};
}
export function updateRecordingChoice(choice,input,context,now){
  owner(choice,context);requireThat(input.notice_version===NOTICE_VERSION&&choice.notice_version===NOTICE_VERSION,'RECORD_NOTICE_CHANGED');
  requireThat(Number.isSafeInteger(input.expected_revision)&&input.expected_revision===choice.revision,'VERSION_CONFLICT');
  requireThat(typeof input.text==='boolean'&&typeof input.audio==='boolean'&&Object.keys(input).every(k=>['attempt_id','notice_version','expected_revision','text','audio'].includes(k)),'INVALID_RECORD_CHOICE');
  const next=structuredClone(choice);next.revision++;next.updated_at=now;
  for(const kind of ['text','audio']){
    const branch=next[kind];requireThat(!input[kind]||now<branch.expires_at,'RECORD_EXPIRED');
    if(branch.allowed!==input[kind])branch.grant_revision=(branch.grant_revision??0)+1;
    branch.allowed=input[kind];branch.state=input[kind]?'selected':choice[kind].allowed?'revoked':choice[kind].state==='expired'?'expired':'declined';
  }
  return next;
}
export function expireRecordingChoice(choice,now){
  const next=structuredClone(choice);let changed=false,invalidated=false;
  for(const kind of ['text','audio'])if(now>=next[kind].expires_at&&next[kind].state!=='expired'){invalidated||=next[kind].allowed;if(next[kind].allowed)next[kind].grant_revision=(next[kind].grant_revision??0)+1;next[kind].allowed=false;next[kind].state='expired';changed=true;}
  if(changed){if(invalidated)next.revision++;next.updated_at=now;}return next;
}
// Re-read the authoritative choice at every read, external call and result commit.
// A frozen choice in a job is never a source of current permission.
export function authorizeRecording(choice,{context,revision,kind,operation,now,noticeVersion=NOTICE_VERSION,capabilities=recordingNotice().capabilities}){
  requireThat(choice,'RECORD_NOT_AUTHORIZED');owner(choice,context);
  requireThat(['text','audio'].includes(kind)&&['collect','read','provider_call','commit'].includes(operation),'INVALID_RECORD_OPERATION');
  requireThat(choice.notice_version===noticeVersion&&noticeVersion===NOTICE_VERSION,'RECORD_NOTICE_CHANGED');
  requireThat(choice.revision===revision,'RECORD_AUTHORIZATION_CHANGED');
  requireThat(choice[kind].allowed&&choice[kind].state==='selected','RECORD_NOT_AUTHORIZED');
  requireThat(now<choice[kind].expires_at,'RECORD_EXPIRED');
  requireThat(capabilities[kind==='text'?'text_collection':'audio_collection'],'RECORD_NOT_ENABLED');
  if(operation==='provider_call'||operation==='commit')requireThat(capabilities[kind==='text'?'text_analysis':'pronunciation_analysis']&&capabilities.external_processing_reviewed,'RECORD_ANALYSIS_NOT_ENABLED');
  return {revision:choice.revision,expires_at:choice[kind].expires_at,authorization_hash:recordHash({learner_id:choice.learner_id,attempt_id:choice.attempt_id,auth_epoch:choice.auth_epoch,deletion_epoch:choice.deletion_epoch,revision:choice.revision,kind,notice_version:choice.notice_version})};
}
