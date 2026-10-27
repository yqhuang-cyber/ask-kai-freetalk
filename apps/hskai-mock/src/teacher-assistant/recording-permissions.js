import {requireThat} from '../../../../packages/teacher-assistant/contracts.js';
import {recordingPolicy,recordingNotice,newRecordingChoice,updateRecordingChoice,expireRecordingChoice} from '../../../../packages/teacher-assistant/teaching-record/policy.js';

// Stage A owns choices only. No transcript, audio or cloud transfer is enabled here.
export class RecordingPermissions {
  constructor(service,policy=recordingPolicy()){this.service=service;this.policy=recordingPolicy({textDays:policy.text_days,audioDays:policy.audio_days});}
  handles(op){return ['recording_notice','recording_choice','recording_choice_update'].includes(op);}
  call(op,actor,input){
    const s=this.service;s.role(actor,'learner');
    if(op==='recording_notice')return recordingNotice(this.policy);
    return s.repo.transaction(()=>{
      const attempt=s.attempt(actor,input.attempt_id);s.verifyEpoch(attempt);
      // Teachers and other learners cannot read or alter another learner's choice.
      requireThat(attempt.learner_id===actor.id,'FORBIDDEN');
      const original=s.repo.get('recording_choices',attempt.id)??newRecordingChoice(attempt,this.policy,attempt.created_at);
      let choice=expireRecordingChoice(original,s.now());
      if(op==='recording_choice_update')choice=updateRecordingChoice(choice,input,{learner_id:actor.id,attempt_id:attempt.id,auth_epoch:actor.auth_epoch,deletion_epoch:actor.deletion_epoch},s.now());
      if(op==='recording_choice_update'||choice.revision!==original.revision)s.repo.put('recording_choices',choice);
      return {...choice,source:'mock_hskai',collection_enabled:false,analysis_enabled:false};
    });
  }
  expire(){for(const choice of this.service.repo.all('recording_choices')){const next=expireRecordingChoice(choice,this.service.now());if(next.revision!==choice.revision)this.service.repo.put('recording_choices',next);}}
  eraseLearner(learnerId){for(const row of this.service.repo.all('recording_choices'))if(row.learner_id===learnerId)this.service.repo.remove('recording_choices',row.id);}
}
