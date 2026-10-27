import {requireThat} from '../../../../packages/teacher-assistant/contracts.js';
import {recordingPolicy,recordingNotice,newRecordingChoice,updateRecordingChoice,expireRecordingChoice} from '../../../../packages/teacher-assistant/teaching-record/policy.js';

// Choices are independent; external processing remains disabled.
export class RecordingPermissions {
  constructor(service,policy=recordingPolicy()){this.service=service;this.policy=recordingPolicy({textDays:policy.text_days,audioDays:policy.audio_days});}
  handles(op){return ['recording_notice','recording_choice','recording_choice_update','recording_audio_delete'].includes(op);}
  call(op,actor,input){
    const s=this.service;s.role(actor,'learner');
    if(op==='recording_notice')return recordingNotice(this.policy);
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
