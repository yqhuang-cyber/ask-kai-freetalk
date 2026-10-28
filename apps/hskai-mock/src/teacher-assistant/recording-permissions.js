import {requireThat} from '../../../../packages/teacher-assistant/contracts.js';
import {recordingPolicy,recordingNotice,newRecordingChoice,updateRecordingChoice,expireRecordingChoice,authorizeRecording,NOTICE_VERSION} from '../../../../packages/teacher-assistant/teaching-record/policy.js';
import {processingPurpose} from '../../../../packages/teacher-assistant/deep-analysis/config.js';

// Independent choices retain their disclosed purpose; configuration never upgrades old grants.
export class RecordingPermissions {
  constructor(service,policy=recordingPolicy()){this.service=service;this.policy=recordingPolicy({textDays:policy.text_days,audioDays:policy.audio_days});}
  handles(op){return ['recording_notice','recording_choice','recording_choice_update','recording_audio_delete','turn_planning_authorize'].includes(op);}
  call(op,actor,input){
    const s=this.service;s.role(actor,'learner');
    if(op==='turn_planning_authorize'){
      const attempt=s.attempt(actor,input.attempt_id),choice=s.repo.get('recording_choices',attempt.id);s.verifyEpoch(attempt);s.writable(s.assignment(actor,attempt.assignment_id));
      requireThat(attempt.state==='active'&&attempt.session_id===input.session_id&&attempt.lease_until>s.now()&&attempt.finalization_started_at===undefined,'ATTEMPT_NOT_ACTIVE');
      requireThat(choice?.notice_version===NOTICE_VERSION&&choice.text.processing==='minimax','RECORD_NOT_AUTHORIZED');
      const notice=this.call('recording_notice',actor,{});
      authorizeRecording(choice,{context:s.transcriptStore.context(actor,attempt),revision:choice.revision,kind:'text',operation:'provider_call',now:s.now(),capabilities:notice.capabilities});
      const grant={grant_revision:choice.text.grant_revision,expires_at:choice.text.expires_at,plan_hash:attempt.plan_hash,notice_version:choice.notice_version};
      if(input.expected_grant)requireThat(JSON.stringify(input.expected_grant)===JSON.stringify(grant),'RECORD_AUTHORIZATION_CHANGED');
      return grant;
    }
    if(op==='recording_notice'){
      const notice=recordingNotice(this.policy),text=processingPurpose(s.analysisConfig,'text')==='minimax',audio=processingPurpose(s.analysisConfig,'audio')==='tencent_soe_v2';
      notice.capabilities.text_analysis=text;notice.capabilities.pronunciation_analysis=audio;notice.capabilities.audio_review_required=audio&&!s.analysisConfig.audio.validated&&!s.analysisConfig.audio.autoVerification;notice.capabilities.external_processing_reviewed=!!s.analysisConfig?.text.reviewed;
      if(text){notice.current='练习时会将必要对话文本交给 MiniMax 判断目标进展；提交后由 MiniMax 分析这次练习的理解与表达。识别和分析都可能出错。';notice.text.purpose='保存识别文本和 Kai 实际回复，用于练习中的目标引导及提交后的理解与表达报告。';notice.text.recipient='本地学习记录服务与 MiniMax 文本服务；会中只发送必要的近期上下文和目标证据，提交后异步生成报告。';notice.choice='文本和测试录音分别选择、撤回；不影响继续练习或已有提交。';notice.deletion='撤回或到期后删除对应完整文本和由它生成的深入分析。已有练习事实与规则反馈按原设置保留；供应商侧处理不等于本地删除。';}
      if(audio&&s.analysisConfig.audio.autoVerification){notice.capabilities.audio_auto_verification=true;notice.audio.purpose='提交后自动检查录音质量，并通过腾讯离线语音识别核对语音内容与可用性；可用片段交腾讯智聆评测发音、声调与语流。自动核验可能出错，不是声纹身份认证。';notice.audio.recipient='本地学习记录服务、腾讯云录音文件识别与腾讯智聆新版服务；在后台异步处理。';}
      else if(audio)notice.audio.recipient='本地学习记录服务；明确提交且确认声音来源与质量后，获准片段将发送腾讯智聆新版服务。';
      return notice;
    }
    if(op==='recording_audio_delete'){const attempt=s.attempt(actor,input.attempt_id);s.verifyEpoch(attempt);const choice=s.repo.get('recording_choices',attempt.id);requireThat(choice&&!choice.audio.allowed,'RECORD_NOT_AUTHORIZED');return s.audioStore?.eraseAttempt(attempt.id)??{state:'deleted'};}
    let eraseAudio=false;const result=s.repo.transaction(()=>{
      const attempt=s.attempt(actor,input.attempt_id);s.verifyEpoch(attempt);
      // Teachers and other learners cannot read or alter another learner's choice.
      requireThat(attempt.learner_id===actor.id,'FORBIDDEN');
      const original=s.repo.get('recording_choices',attempt.id)??newRecordingChoice(attempt,this.policy,attempt.created_at);
      let choice=expireRecordingChoice(original,s.now());
      if(op==='recording_choice_update'){
        if(input.audio&&!choice.audio.allowed)requireThat(!s.repo.all('audio_segments').some(r=>r.attempt_id===attempt.id),'AUDIO_DELETION_PENDING');
        const previous=choice;choice=updateRecordingChoice(choice,input,{learner_id:actor.id,attempt_id:attempt.id,auth_epoch:actor.auth_epoch,deletion_epoch:actor.deletion_epoch},s.now());
        for(const kind of ['text','audio'])if(!previous[kind].allowed&&choice[kind].allowed){choice[kind].processing=processingPurpose(s.analysisConfig,kind);if(kind==='audio'&&choice.notice_version===NOTICE_VERSION&&s.analysisConfig.audio.autoVerification)choice.audio.verification_processing='tencent_asr';}
        if(previous.text.allowed&&!choice.text.allowed&&s.repo.get('deep_records',attempt.id))s.transcriptStore.eraseAttempt(attempt.id);
        eraseAudio=previous.audio.allowed&&!choice.audio.allowed;
      }
      if(op==='recording_choice_update'||JSON.stringify(choice)!==JSON.stringify(original))s.repo.put('recording_choices',choice);
      return {...choice,source:'mock_hskai',collection_enabled:true,audio_collection_enabled:false,analysis_enabled:false};
    });
    if(eraseAudio)result.audio_deletion=s.audioStore?.eraseAttempt(input.attempt_id).state??'deleted';return result;
  }
  expire(){for(const choice of this.service.repo.all('recording_choices')){const next=expireRecordingChoice(choice,this.service.now());if(JSON.stringify(next)!==JSON.stringify(choice))this.service.repo.put('recording_choices',next);}}
  eraseLearner(learnerId){for(const row of this.service.repo.all('recording_choices'))if(row.learner_id===learnerId)this.service.repo.remove('recording_choices',row.id);}
}
