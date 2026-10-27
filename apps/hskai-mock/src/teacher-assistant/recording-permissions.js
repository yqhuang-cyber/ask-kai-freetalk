import {requireThat} from '../../../../packages/teacher-assistant/contracts.js';
import {recordingPolicy,recordingNotice,newRecordingChoice,updateRecordingChoice,expireRecordingChoice} from '../../../../packages/teacher-assistant/teaching-record/policy.js';
import {processingPurpose} from '../../../../packages/teacher-assistant/deep-analysis/config.js';

// Choices are independent; external processing remains disabled.
export class RecordingPermissions {
  constructor(service,policy=recordingPolicy()){this.service=service;this.policy=recordingPolicy({textDays:policy.text_days,audioDays:policy.audio_days});}
  handles(op){return ['recording_notice','recording_choice','recording_choice_update','recording_audio_delete'].includes(op);}
  call(op,actor,input){
    const s=this.service;s.role(actor,'learner');
    if(op==='recording_notice'){
      const notice=recordingNotice(this.policy),text=processingPurpose(s.analysisConfig,'text')==='minimax',audio=processingPurpose(s.analysisConfig,'audio')==='tencent_soe_v2';
      notice.capabilities.text_analysis=text;notice.capabilities.pronunciation_analysis=audio;notice.capabilities.external_processing_reviewed=!!s.analysisConfig?.text.reviewed;
      if(text){notice.current='你可以选择保存对话文本，并在提交后交给 MiniMax 分析这次练习的理解与表达。识别和分析都可能出错。';notice.text.recipient='本地学习记录服务；明确提交后，获准文本将发送给 MiniMax 文本服务，用于本次报告。';notice.choice='文本和测试录音分别选择、撤回；不影响继续练习或已有提交。';notice.deletion='撤回或到期后删除对应完整文本和由它生成的深入分析。已有练习事实与规则反馈按原设置保留；供应商侧处理不等于本地删除。';}
      if(audio)notice.audio.recipient='本地学习记录服务；明确提交且确认声音来源与质量后，获准片段将发送腾讯智聆新版服务。';
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
        for(const kind of ['text','audio'])if(!previous[kind].allowed&&choice[kind].allowed)choice[kind].processing=processingPurpose(s.analysisConfig,kind);
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
