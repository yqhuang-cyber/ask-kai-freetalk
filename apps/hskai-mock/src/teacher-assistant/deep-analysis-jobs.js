import {randomUUID} from 'node:crypto';
import {requireThat} from '../../../../packages/teacher-assistant/contracts.js';
import {recordHash} from '../../../../packages/teacher-assistant/teaching-record/contracts.js';
import {authorizeRecording,NOTICE_VERSION} from '../../../../packages/teacher-assistant/teaching-record/policy.js';
import {processingPurpose,DEEP_VERSION} from '../../../../packages/teacher-assistant/deep-analysis/config.js';
import {validateSemanticResult,safeAnalysisText} from '../../../../packages/teacher-assistant/deep-analysis/semantic.js';
import {audioEligibility,validateAudioAssessment} from '../../../../packages/provider-tencent-soe/assessment.js';
const branches=['text','audio'];
const reasons=['not_configured','not_enabled','not_authorized','source_unavailable','no_eligible_audio','restricted_content','deadline','provider_failed','output_rejected','external_outcome_unknown'];
export class DeepAnalysisJobs{
  constructor(service,delegation){this.service=service;this.delegation=delegation;}
  create(){const config=this.service.analysisConfig;if(!config.enabled)return undefined;
    return {version:DEEP_VERSION,generation:1,stages:Object.fromEntries(branches.map(kind=>[kind,{state:config[kind].provider==='none'?'disabled':'pending',reason:null,provider:config[kind].provider,model:kind==='text'?config[kind].model:null,version:1,calls:0,external_started:false,result:null}]))};}
  stage(job,kind){requireThat(branches.includes(kind)&&job.deep?.version===DEEP_VERSION,'INVALID_ANALYSIS_BRANCH');return job.deep.stages[kind];}
  save(job,kind,stage){const deep={...job.deep,stages:{...job.deep.stages,[kind]:stage}};return this.service.repo.put('jobs',{...job,deep,external_started:Object.values(deep.stages).some(s=>s.external_started)});}
  sourcePermission(job,kind,operation){
    const s=this.service,source=this.delegation.source(job),stage=this.stage(job,kind),choice=s.repo.get('recording_choices',source.attempt.id),config=s.analysisConfig;
    requireThat(config[kind].provider===stage.provider&&stage.provider!=='none','RECORD_ANALYSIS_NOT_ENABLED');
    requireThat(choice?.[kind].processing===stage.provider&&processingPurpose(config,kind)===stage.provider,'RECORD_PURPOSE_NOT_AUTHORIZED');
    authorizeRecording(choice,{context:{learner_id:source.attempt.learner_id,attempt_id:source.attempt.id,auth_epoch:source.attempt.auth_epoch,deletion_epoch:source.attempt.deletion_epoch},revision:choice.revision,kind,operation,now:s.now(),noticeVersion:NOTICE_VERSION,capabilities:{text_collection:true,audio_collection:!!s.audioStore?.enabled,text_analysis:config.text.configured&&config.text.reviewed,pronunciation_analysis:config.audio.configured&&config.audio.reviewed&&config.audio.validated,external_processing_reviewed:config[kind].reviewed}});
    const learner=s.repo.get('actors',source.attempt.learner_id);let snapshot,manifest;
    if(kind==='text'){snapshot=s.transcriptStore.read(learner,{attempt_id:source.attempt.id});requireThat(snapshot.snapshot_hash===source.submission.transcript_hash&&snapshot.snapshot_hash===job.transcript_hash,'SOURCE_CHANGED');requireThat(snapshot.transcript.every(row=>safeAnalysisText(row.text)),'ANALYSIS_RESTRICTED_CONTENT');}
    else {manifest=s.audioStore.manifest(learner,{attempt_id:source.attempt.id});requireThat(manifest.segment_refs.every(ref=>typeof ref.metadata_hash==='string'),'AUDIO_METADATA_UNSEALED');requireThat(manifest.manifest_hash===source.submission.audio_manifest_hash&&manifest.manifest_hash===job.audio_manifest_hash,'SOURCE_CHANGED');}
    return {...source,learner,snapshot,manifest,authorization_hash:recordHash({learner_id:source.attempt.learner_id,attempt_id:source.attempt.id,auth_epoch:choice.auth_epoch,deletion_epoch:choice.deletion_epoch,kind,grant_revision:choice[kind].grant_revision,processing:choice[kind].processing,notice:choice.notice_version,expires_at:choice[kind].expires_at})};
  }
  authorize(input){const s=this.service;return s.repo.transaction(()=>{
    const job=this.delegation.leased(input),stage=this.stage(job,input.branch);requireThat(['pending','running'].includes(stage.state),'STAGE_NOT_ACTIVE');
    const source=this.sourcePermission(job,input.branch,'provider_call');requireThat(stage.calls<24,'STAGE_CALL_LIMIT');
    if(input.branch==='audio'){const audio=this.delegation.readAudio(input,{transaction:false});requireThat(audio.state==='available'&&audioEligibility(audio.segment).eligible,'AUDIO_NOT_ELIGIBLE');}
    const call_id=randomUUID();this.save(job,input.branch,{...stage,state:'running',reason:null,calls:stage.calls+1,call_id,external_started:true,authorization_hash:source.authorization_hash});return {call_id,authorization_hash:source.authorization_hash};
  });}
  commit(input){const s=this.service;return s.repo.transaction(()=>{
    const job=this.delegation.leased(input),stage=this.stage(job,input.branch);requireThat(stage.state==='running'&&stage.call_id===input.call_id,'STAGE_NOT_ACTIVE');
    const source=this.sourcePermission(job,input.branch,'commit');requireThat(source.authorization_hash===stage.authorization_hash,'RECORD_AUTHORIZATION_CHANGED');let state;
    if(input.branch==='text'){
      validateSemanticResult(input.result,source.snapshot,{provider:stage.provider,model:stage.model});const c=input.result.coverage;
      state=!c.windows.some(w=>w.state==='complete')?'failed':c.windows.every(w=>w.state==='complete')&&!c.unprocessed_windows&&c.source_state==='complete'?'complete':'partial';
    }else{
      const r=input.result,refs=source.manifest.segment_refs;
      requireThat(r&&Object.keys(r).every(k=>['schema_version','manifest_hash','assessments','skipped'].includes(k))&&r.schema_version==='audio-branch-v1'&&r.manifest_hash===source.manifest.manifest_hash&&Array.isArray(r.assessments)&&r.assessments.length<=12&&Array.isArray(r.skipped),'INVALID_AUDIO_BRANCH');
      const ids=[...r.assessments.map(a=>a.audio.id),...r.skipped.map(a=>a.id)];requireThat(ids.length===refs.length&&new Set(ids).size===ids.length&&ids.every(id=>refs.some(ref=>ref.id===id)),'AUDIO_COVERAGE_MISMATCH');
      for(const skipped of r.skipped)requireThat(Object.keys(skipped).length===2&&['speaker_unverified','quality_unverified','input_unavailable','budget_limit','provider_failed'].includes(skipped.reason),'INVALID_AUDIO_BRANCH');
      for(const assessment of r.assessments){const audio=this.delegation.readAudio({...input,segment_id:assessment.audio.id},{transaction:false});validateAudioAssessment(assessment,audio.segment);requireThat(assessment.words.every(word=>safeAnalysisText(word.word)),'ANALYSIS_RESTRICTED_CONTENT');}
      state=r.skipped.some(row=>row.reason==='provider_failed')?'failed':r.assessments.length?(r.skipped.length||source.manifest.queue_incomplete||source.manifest.missing_segments||source.manifest.state!=='available'?'partial':'complete'):'unavailable';
    }
    this.save(job,input.branch,{...stage,state,reason:state==='failed'?(input.branch==='text'?'output_rejected':'provider_failed'):state==='unavailable'?'no_eligible_audio':null,external_started:false,result:input.result});return {state};
  });}
  skip(input){const s=this.service;return s.repo.transaction(()=>{const job=this.delegation.leased(input),stage=this.stage(job,input.branch);if(stage.state==='not_authorized')return {state:'not_authorized'};requireThat(!['complete','partial'].includes(stage.state),'STAGE_ALREADY_COMPLETE');requireThat(reasons.includes(input.reason),'INVALID_STAGE_REASON');
    const state=['deadline','provider_failed','output_rejected','external_outcome_unknown'].includes(input.reason)?'failed':['not_authorized'].includes(input.reason)?'not_authorized':'unavailable';
    this.save(job,input.branch,{...stage,state,reason:input.reason,external_started:false,result:state==='failed'?stage.result:null});return {state};});}
  eraseBranch(attemptId,kind){const s=this.service;for(const job of s.repo.all('jobs'))if(job.deep&&s.repo.get('submissions',job.submission_id)?.attempt_id===attemptId){const stage=this.stage(job,kind);this.save(job,kind,{...stage,state:'not_authorized',reason:'not_authorized',external_started:false,result:null,authorization_hash:null,call_id:null});}}
  recover(job){if(!job.deep)return job;const deep=structuredClone(job.deep);for(const kind of branches){const stage=deep.stages[kind];if(stage.state==='running'){stage.state=stage.external_started?'failed':'pending';stage.reason=stage.external_started?'external_outcome_unknown':null;stage.external_started=false;}}
    return {...job,deep,external_started:false};}
  retryableStage(stage){return stage.state==='failed'||stage.state==='partial'&&stage.provider==='minimax'&&stage.result?.coverage.windows.some(w=>w.state==='failed');}
  retryable(job){if(['pending','running'].includes(job.state))return false;return job.state==='failed'||!!job.deep&&Object.values(job.deep.stages).some(stage=>this.retryableStage(stage));}
  retry(job){if(!job.deep)return job;const deep=structuredClone(job.deep);deep.generation++;for(const [kind,stage] of Object.entries(deep.stages))if(this.retryableStage(stage)){stage.state='pending';stage.reason=null;stage.version++;stage.calls=0;stage.external_started=false;stage.call_id=null;}
    return {...job,deep,external_started:false,lease_id:null,lease_until:null};}
  resume(input){const s=this.service;return s.repo.transaction(()=>{const job=this.delegation.leased(input),stage=this.stage(job,input.branch);if(!stage.result)return {state:'unavailable'};const source=this.sourcePermission(job,input.branch,'commit');requireThat(stage.authorization_hash===source.authorization_hash,'RECORD_AUTHORIZATION_CHANGED');return {state:'available',result:stage.result};});}
  view(job,role){if(!job?.deep)return undefined;const stages={};
    for(const kind of branches){const stage=this.stage(job,kind);let state=stage.state,reason=stage.reason,result=stage.result;
      if(result)try{const source=this.sourcePermission(job,kind,'commit');requireThat(source.authorization_hash===stage.authorization_hash,'RECORD_AUTHORIZATION_CHANGED');}catch{state='not_authorized';reason='source_unavailable';result=null;}
      const base={state,reason,version:stage.version,provider:stage.provider};
      if(result&&kind==='text')base.result={...result,candidates:result.candidates.map(c=>role==='teacher'?c:{dimension:c.dimension,status:c.status,observation:c.observation,explanation:c.explanation,uncertainty:c.uncertainty,suggestion:c.suggestion,evidence_refs:c.evidence_refs.map(({quote})=>({quote}))})};
      if(result&&kind==='audio')base.result=role==='teacher'?result:{assessed_segments:result.assessments.length,unassessed_segments:result.skipped.length,status:'review_required'};
      stages[kind]=base;
    }
    const states=Object.values(stages).map(s=>s.state),state=states.every(s=>s==='complete')?'complete':states.some(s=>['complete','partial'].includes(s))?'partial':states.some(s=>['pending','running'].includes(s))?'processing':states.some(s=>s==='failed')?'failed':'unavailable';
    return {version:job.deep.version,generation:job.deep.generation,state,processing:['pending','running'].includes(job.state),retryable:this.retryable(job),stages,grade:null,mastery:'unassessed'};
  }
  call(op,input){if(op==='stage_resume')return this.resume(input);if(op==='stage_authorize')return this.authorize(input);if(op==='stage_commit')return this.commit(input);if(op==='stage_skip')return this.skip(input);throw new Error('NOT_FOUND');}
}
