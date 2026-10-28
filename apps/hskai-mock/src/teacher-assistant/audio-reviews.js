import {requireThat,id} from '../../../../packages/teacher-assistant/contracts.js';
import {recordHash} from '../../../../packages/teacher-assistant/teaching-record/contracts.js';
import {audioMetadataHash} from '../../../../packages/teacher-assistant/deep-analysis/audio-source.js';
import {audioEligibility} from '../../../../packages/provider-tencent-soe/assessment.js';
import {safeAnalysisText} from '../../../../packages/teacher-assistant/deep-analysis/semantic.js';
import {processingPurpose} from '../../../../packages/teacher-assistant/deep-analysis/config.js';
const dimensions=['noise','clipping','missing_frames','overlap'];
const fields=(value,names)=>value&&Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key));

// Listening declarations are separate, versioned evidence. They never rewrite
// sealed microphone metadata or claim an automatic speaker/acoustic validator.
export class AudioReviews {
  constructor(service){this.service=service;}
  context(actor,submissionId){
    const s=this.service,submission=s.repo.get('submissions',id(submissionId));requireThat(submission,'NOT_FOUND');
    const attempt=s.attempt(actor,submission.attempt_id);s.verifyEpoch(attempt);requireThat(s.audioStore,'RECORD_NOT_ENABLED');
    const manifest=s.audioStore.manifest(actor,{attempt_id:attempt.id});requireThat(manifest.manifest_hash===submission.audio_manifest_hash,'SOURCE_CHANGED');
    return {submission,attempt,manifest};
  }
  valid(review,segment){
    if(!review)return false;const s=this.service,{id:ignored,review_hash,...body}=review;
    if(recordHash(body)!==review_hash||review.source_metadata_hash!==audioMetadataHash(segment)||review.audio_sha256!==segment.sha256||review.attempt_id!==segment.attempt_id||review.learner_id!==segment.learner_id||s.now()>=review.expires_at)return false;
    const reviewer=s.repo.get('actors',review.reviewer_id);
    if(!reviewer?.active||reviewer.auth_epoch!==review.reviewer_auth_epoch||reviewer.deletion_epoch!==review.reviewer_deletion_epoch)return false;
    try{s.role(reviewer,'teacher');s.assignment(reviewer,segment.assignment_id);return true;}catch{return false;}
  }
  assessmentSource(segment){
    const review=this.service.repo.get('audio_reviews',segment.id);if(!this.valid(review,segment))return segment;
    const reference=review.reference_text?{text:review.reference_text,verified:true,basis:'teacher_reviewed',version:'audio-review-reference-v1',review_hash:review.review_hash}:null;
    return {...segment,speaker:review.speaker,quality:review.quality,source_review_hash:review.review_hash,alignment:reference?{basis:'teacher_reviewed',reference_text_verified:true,reference}:null};
  }
  hasReview(attemptId){const s=this.service;return s.repo.all('audio_reviews').some(r=>r.attempt_id===attemptId&&this.valid(r,s.repo.get('audio_segments',r.id)??{}));}
  digest(attemptId){
    const s=this.service;return recordHash(s.repo.all('audio_reviews').filter(r=>r.attempt_id===attemptId).sort((a,b)=>a.id.localeCompare(b.id)).map(r=>({id:r.id,hash:r.review_hash,valid:this.valid(r,s.repo.get('audio_segments',r.id)??{})})));
  }
  manifest(actor,input){
    const s=this.service,c=this.context(actor,input.submission_id);s.role(actor,'teacher');
    const refs=c.manifest.segment_refs,offset=input.offset??0;requireThat(Number.isSafeInteger(offset)&&offset>=0&&offset<=refs.length,'INVALID_AUDIO_REVIEW');
    return {submission_id:c.submission.id,manifest_hash:c.manifest.manifest_hash,total_segments:refs.length,offset,next_offset:offset+12<refs.length?offset+12:null,review_basis:'teacher_listening_declaration',segments:refs.slice(offset,offset+12).map(ref=>{
      const segment=s.repo.get('audio_segments',ref.id);requireThat(segment&&audioMetadataHash(segment)===ref.metadata_hash,'SOURCE_CHANGED');const review=s.repo.get('audio_reviews',ref.id),valid=this.valid(review,segment);
      return {id:ref.id,source_metadata_hash:ref.metadata_hash,duration_ms:(segment.sample_end-segment.sample_start)/16,revision:review?.revision??0,review:valid?{speaker:review.speaker,quality:review.quality,reference_text:review.reference_text}:null,eligible:audioEligibility(this.assessmentSource(segment)).eligible};
    })};
  }
  preview(actor,input){
    const s=this.service,c=this.context(actor,input.submission_id);if(input.segment_id?.startsWith('unit-')){const unit=s.repo.get('audio_units',input.segment_id);requireThat(unit&&unit.attempt_id===c.attempt.id&&unit.manifest_hash===c.manifest.manifest_hash&&s.now()<unit.expires_at,'NOT_FOUND');const pcm=s.audioAutoChecks.previewBytes(unit);return {segment_id:unit.id,source_metadata_hash:unit.unit_hash,sample_rate:16000,channels:1,encoding:'pcm_s16le',pcm_base64:pcm.toString('base64')};}const ref=c.manifest.segment_refs.find(r=>r.id===input.segment_id);requireThat(ref,'NOT_FOUND');
    const {segment,pcm_base64}=s.audioStore.read(actor,{attempt_id:c.attempt.id,segment_id:ref.id});requireThat(audioMetadataHash(segment)===ref.metadata_hash,'SOURCE_CHANGED');
    return {segment_id:segment.id,source_metadata_hash:ref.metadata_hash,sample_rate:16000,channels:1,encoding:'pcm_s16le',pcm_base64};
  }
  save(actor,input){
    const s=this.service;s.role(actor,'teacher');requireThat(fields(input,['submission_id','manifest_hash','decisions'])&&Array.isArray(input.decisions)&&input.decisions.length>0&&input.decisions.length<=12,'INVALID_AUDIO_REVIEW');
    return s.repo.transaction(()=>{
      const c=this.context(actor,input.submission_id),job=s.repo.get('jobs',c.submission.id);requireThat(c.manifest.manifest_hash===input.manifest_hash,'SOURCE_CHANGED');requireThat(job?.deep&&!['pending','running'].includes(job.state),'REPORT_ANALYSIS_ACTIVE');
      const seen=new Set();for(const decision of input.decisions){
        requireThat(fields(decision,['segment_id','source_metadata_hash','expected_revision','speaker','quality','reference_text'])&&!seen.has(decision.segment_id),'INVALID_AUDIO_REVIEW');seen.add(decision.segment_id);
        const ref=c.manifest.segment_refs.find(r=>r.id===decision.segment_id);requireThat(ref&&ref.metadata_hash===decision.source_metadata_hash,'SOURCE_CHANGED');
        const {segment}=s.audioStore.read(actor,{attempt_id:c.attempt.id,segment_id:ref.id});requireThat(audioMetadataHash(segment)===ref.metadata_hash,'SOURCE_CHANGED');
        const previous=s.repo.get('audio_reviews',segment.id);requireThat(Number.isSafeInteger(decision.expected_revision)&&decision.expected_revision===(previous?.revision??0),'VERSION_CONFLICT');
        requireThat(['learner_verified','other','unknown'].includes(decision.speaker)&&fields(decision.quality,dimensions)&&dimensions.every(k=>['detected','not_detected','unknown'].includes(decision.quality[k])),'INVALID_AUDIO_REVIEW');
        requireThat(dimensions.every(k=>segment.quality[k]!=='detected'||decision.quality[k]!=='not_detected'),'AUDIO_REVIEW_CONTRADICTS_MEASUREMENT');
        const text=decision.reference_text;requireThat(text===null||typeof text==='string'&&text.trim()===text&&safeAnalysisText(text)&&[...text].length>0&&[...text].length<=30&&!/[\u0000-\u001f]/u.test(text),'INVALID_AUDIO_REFERENCE');
        if(text!==null)requireThat(audioEligibility({...segment,speaker:decision.speaker,quality:decision.quality}).eligible,'AUDIO_NOT_ELIGIBLE');
        const body={schema_version:'audio-source-review-v1',submission_id:c.submission.id,attempt_id:c.attempt.id,learner_id:c.attempt.learner_id,manifest_hash:c.manifest.manifest_hash,source_metadata_hash:ref.metadata_hash,audio_sha256:segment.sha256,revision:(previous?.revision??0)+1,reviewer_id:actor.id,reviewer_auth_epoch:actor.auth_epoch,reviewer_deletion_epoch:actor.deletion_epoch,review_basis:'teacher_listening_declaration',speaker:decision.speaker,quality:decision.quality,reference_text:text,reviewed_at:s.now(),expires_at:segment.expires_at};
        s.repo.put('audio_reviews',{id:segment.id,...body,review_hash:recordHash(body)});
      }
      const choice=s.repo.get('recording_choices',c.attempt.id),canAssess=choice?.audio.processing==='tencent_soe_v2'&&processingPurpose(s.analysisConfig,'audio')==='tencent_soe_v2'&&job.deep.stages.audio.provider==='tencent_soe_v2';
      // A new source review invalidates only audio results, not successful text windows.
      const deep=structuredClone(job.deep);deep.generation++;const stage=deep.stages.audio;Object.assign(stage,{state:canAssess?'pending':'unavailable',reason:canAssess?null:'not_authorized',result:null,authorization_hash:null,call_id:null,calls:0,external_started:false,progress:null,started_at:null,updated_at:null,finished_at:null,version:stage.version+1});
      s.repo.put('jobs',{...job,deep,state:canAssess?'pending':job.state,external_started:false,lease_id:null,lease_until:null});return {state:canAssess?'pending':'reviewed_local_only',reviewed:seen.size};
    });
  }
  eraseAttempt(attemptId){for(const review of this.service.repo.all('audio_reviews'))if(review.attempt_id===attemptId)this.service.repo.remove('audio_reviews',review.id);}
}
