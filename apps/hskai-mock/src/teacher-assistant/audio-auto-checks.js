import {createHash} from 'node:crypto';
import {requireThat} from '../../../../packages/teacher-assistant/contracts.js';
import {recordHash} from '../../../../packages/teacher-assistant/teaching-record/contracts.js';
import {audioMetadataHash} from '../../../../packages/teacher-assistant/deep-analysis/audio-source.js';
import {AUDIO_CHECK_VERSION,precheckAudioUnit,audioAsrDecision} from '../../../../packages/teacher-assistant/deep-analysis/audio-verification.js';
import {safeAnalysisText} from '../../../../packages/teacher-assistant/deep-analysis/semantic.js';
export class AudioAutoChecks {
  constructor(service){this.service=service;}
  enabled(job){return job?.deep?.stages.audio.verification_mode==='automatic';}
  scope(input){const s=this.service,job=s.analysisDelegation.leased(input);requireThat(this.enabled(job),'AUTO_AUDIO_NOT_ENABLED');const source=s.analysisDelegation.deep.sourcePermission(job,'audio','provider_call');requireThat(source.choice_version==='deep-report-notice-v7','RECORD_PURPOSE_NOT_AUTHORIZED');return {job,...source};}
  units(source){return this.service.repo.all('audio_units').filter(u=>u.attempt_id===source.attempt.id&&u.manifest_hash===source.manifest.manifest_hash).sort((a,b)=>a.stream_id.localeCompare(b.stream_id)||a.sample_start-b.sample_start).map(unit=>{const {id,unit_hash,...body}=unit;requireThat(recordHash(body)===unit_hash&&id==='unit-'+unit_hash.slice(0,32),'SOURCE_CHANGED');return unit;});}
  build(source){
    const s=this.service,existing=this.units(source);if(existing.length)return existing;
    const segments=source.manifest.segment_refs.map(ref=>{const segment=s.repo.get('audio_segments',ref.id);requireThat(segment&&audioMetadataHash(segment)===ref.metadata_hash,'SOURCE_CHANGED');return segment;});
    const groups=[];for(const segment of segments){const prior=groups.at(-1),last=prior?.at(-1);if(last&&last.boundary_reason==='capacity'&&segment.stream_id===last.stream_id&&segment.sample_start===last.sample_end&&segment.sample_end-prior[0].sample_start<=16000*30)prior.push(segment);else groups.push([segment]);}
    for(const group of groups){
      const first=group[0],last=group.at(-1),source_refs=group.map(segment=>({id:segment.id,sha256:segment.sha256,metadata_hash:audioMetadataHash(segment)}));
      const pcm=Buffer.concat(group.map(segment=>s.audioStore.verifiedBytes(segment))),sha256=createHash('sha256').update(pcm).digest('hex');
      const capture=group.every(g=>g.capture)?{protocol:'homework-mic-v1',frames:group.reduce((n,g)=>n+g.capture.frames,0),aec:group.every(g=>g.capture.aec),playback_overlap:group.some(g=>g.capture.playback_overlap),playback_known:group.every(g=>g.capture.playback_known),continuous:group.every(g=>g.capture.continuous)}:null;
      const {blob_id:ignored,id:original_segment_id,...base}=first,previous=segments[segments.indexOf(first)-1],body={...base,original_segment_id,starts_after_capacity:!!(previous?.boundary_reason==='capacity'&&previous.stream_id===first.stream_id&&previous.sample_end===first.sample_start),manifest_hash:source.manifest.manifest_hash,source_refs,sha256,sample_end:last.sample_end,capture,boundary_reason:last.boundary_reason,expires_at:Math.min(...group.map(g=>g.expires_at)),speaker:'unknown',alignment:null};
      const unit_hash=recordHash(body),unit={...body,id:'unit-'+unit_hash.slice(0,32),unit_hash};s.repo.put('audio_units',unit);
    }
    return this.units(source);
  }
  bytes(unit){const {id:unitId,unit_hash,...body}=unit;requireThat(recordHash(body)===unit_hash&&unitId==='unit-'+unit_hash.slice(0,32),'SOURCE_CHANGED');const s=this.service;requireThat(Array.isArray(unit.source_refs)&&unit.source_refs.length>0&&unit.sample_end-unit.sample_start<=16000*30,'SOURCE_CHANGED');let expected=unit.sample_start;const parts=unit.source_refs.map(ref=>{const segment=s.repo.get('audio_segments',ref.id);requireThat(segment&&segment.attempt_id===unit.attempt_id&&segment.stream_id===unit.stream_id&&segment.sha256===ref.sha256&&audioMetadataHash(segment)===ref.metadata_hash,'SOURCE_CHANGED');requireThat(segment.sample_start===expected&&segment.sample_end<=unit.sample_end,'SOURCE_CHANGED');expected=segment.sample_end;return s.audioStore.verifiedBytes(segment);}),pcm=Buffer.concat(parts);requireThat(pcm.length===(unit.sample_end-unit.sample_start)*2&&createHash('sha256').update(pcm).digest('hex')===unit.sha256,'SOURCE_CHANGED');return pcm;}
  humanSource(unit){
    const s=this.service,sources=unit.source_refs.map(ref=>s.audioReviews.assessmentSource(s.repo.get('audio_segments',ref.id)));
    if(!sources.every(source=>source.source_review_hash&&source.speaker==='learner_verified'&&Object.values(source.quality).every(v=>v==='not_detected')))return null;
    return {...unit,speaker:'learner_verified',quality:sources[0].quality,source_review_hash:sources.length===1?sources[0].source_review_hash:recordHash(sources.map(r=>r.source_review_hash)),alignment:sources.length===1?sources[0].alignment:null};
  }
  prepare(input){return this.service.repo.transaction(()=>{
    const s=this.service,source=this.scope(input),units=this.build(source),selected=new Set(units.length<=12?units.map(u=>u.id):Array.from({length:12},(_,i)=>units[Math.floor(i*(units.length-1)/11)].id));
    for(const unit of units){
      const old=s.repo.get('audio_auto_checks',unit.id);
      if(old?.source_hash===unit.unit_hash&&old.authorization_hash===source.authorization_hash&&(old.stage_version===source.job.deep.stages.audio.version||['eligible','excluded'].includes(old.state))){
        if(['ready','waiting'].includes(old.state)&&s.now()>=old.deadline_at)s.repo.put('audio_auto_checks',{...old,state:'failed',reason:'asr_timeout',finished_at:s.now()});
        else if(old.state==='submitting'&&old.lease_id!==input.lease_id)s.repo.put('audio_auto_checks',{...old,state:'failed',reason:'external_outcome_unknown',finished_at:s.now()});
        continue;
      }
      const check=precheckAudioUnit(unit,this.bytes(unit));const reviews=unit.source_refs.map(ref=>({review:s.repo.get('audio_reviews',ref.id),segment:s.repo.get('audio_segments',ref.id)})).filter(r=>s.audioReviews.valid(r.review,r.segment));if(reviews.some(({review})=>review.speaker==='other'||Object.values(review.quality).includes('detected'))){check.state='excluded';check.reason='teacher_excluded';}else if(reviews.some(({review})=>review.speaker!=='learner_verified'||Object.values(review.quality).includes('unknown'))){check.state='excluded';check.reason='teacher_inconclusive';}if(this.humanSource(unit)&&['capture_unverified','echo_control_unavailable','noise_or_uncertain_quality'].includes(check.reason)){check.state='ready';check.reason=null;check.source_basis='teacher_listening_declaration';}s.repo.put('audio_auto_checks',{id:unit.id,attempt_id:unit.attempt_id,source_hash:unit.unit_hash,authorization_hash:source.authorization_hash,stage_version:source.job.deep.stages.audio.version,version:AUDIO_CHECK_VERSION,state:selected.has(unit.id)?check.state:'excluded',reason:selected.has(unit.id)?check.reason:'budget_limit',metrics:check.metrics,source_basis:check.source_basis,identity_verified:false,created_at:s.now(),expires_at:unit.expires_at,deadline_at:s.now()+600000});
    }
    const latest=s.repo.get('jobs',source.job.id),stage=latest.deep.stages.audio;s.analysisDelegation.deep.save(latest,'audio',{...stage,state:'running',authorization_hash:source.authorization_hash,started_at:stage.started_at??s.now(),updated_at:s.now()});this.summary(source.job);return this.state(source);
  });}
  state(source){return {state:'available',manifest_hash:source.manifest.manifest_hash,units:this.units(source).map(unit=>{const check=this.service.repo.get('audio_auto_checks',unit.id);return {id:unit.id,sha256:unit.sha256,sample_start:unit.sample_start,sample_end:unit.sample_end,state:check?.state??'excluded',reason:check?.reason??'source_unavailable',task_id:check?.task_id??null,poll_ready:!check?.next_poll_at||check.next_poll_at<=this.service.now(),deadline_at:check?.deadline_at??null};})};}
  read(unit,source){
    requireThat(unit&&unit.attempt_id===source.attempt.id&&unit.manifest_hash===source.manifest.manifest_hash&&this.service.now()<unit.expires_at,'SOURCE_CHANGED');
    const segment=this.assessmentSource(unit,source),pcm=this.bytes(unit).subarray((segment.sample_start-unit.sample_start)*2,(segment.sample_end-unit.sample_start)*2);return {state:'available',segment,pcm_base64:pcm.toString('base64')};
  }
  previewBytes(unit){
    const bytes=this.bytes(unit),check=this.service.repo.get('audio_auto_checks',unit.id);
    if(check?.state!=='eligible'||check.source_hash!==unit.unit_hash||this.service.now()>=check.expires_at||this.humanSource(unit))return bytes;
    const {verification_hash,...body}=check;requireThat(verification_hash===recordHash(body),'SOURCE_CHANGED');
    return check.assessment_window?bytes.subarray(check.assessment_window.start_sample*2,check.assessment_window.end_sample*2):bytes;
  }
  assessmentSource(unit,source){
    const s=this.service,check=s.repo.get('audio_auto_checks',unit.id);if(!check||check.state!=='eligible'||check.source_hash!==unit.unit_hash||check.authorization_hash!==source.authorization_hash||s.now()>=check.expires_at)return unit;
    // Explicit human findings can exclude an automatically selected unit.
    for(const ref of unit.source_refs){const segment=s.repo.get('audio_segments',ref.id),review=s.repo.get('audio_reviews',ref.id);if(s.audioReviews.valid(review,segment)&&(review.speaker!=='learner_verified'||Object.values(review.quality).some(v=>v==='detected')))return unit;}
    const {verification_hash:ignored,...body}=check;requireThat(check.verification_hash===recordHash(body),'SOURCE_CHANGED');
    const human=this.humanSource(unit);if(human)return human;
    const window=check.assessment_window,selected=window?{...unit,sample_start:unit.sample_start+window.start_sample,sample_end:unit.sample_start+window.end_sample,sha256:createHash('sha256').update(this.bytes(unit).subarray(window.start_sample*2,window.end_sample*2)).digest('hex')}:unit;
    return {...selected,speaker:'learner_channel',source_verification_hash:check.verification_hash,auto_verification:{admission:'eligible',version:AUDIO_CHECK_VERSION,source_basis:'authorized_mic_channel',identity_verified:false,quality_guaranteed:false},alignment:check.reference?{basis:'auto_aligned',reference_text_verified:false,reference:{...check.reference,verification_hash:check.verification_hash}}:null};
  }
  update(input){return this.service.repo.transaction(()=>{
    const s=this.service,source=this.scope(input),unit=this.units(source).find(u=>u.id===input.unit_id),old=unit&&s.repo.get('audio_auto_checks',unit.id);requireThat(old&&old.source_hash===unit.unit_hash&&old.authorization_hash===source.authorization_hash&&old.stage_version===source.job.deep.stages.audio.version,'SOURCE_CHANGED');
    let next;
    if(input.action==='authorize'){requireThat(['submitting','waiting'].includes(old.state)&&(old.state!=='submitting'||old.lease_id===input.lease_id),'AUTO_AUDIO_NOT_READY');requireThat(s.now()<old.deadline_at,'AUDIO_ASR_TIMEOUT');return {state:old.state};
    }else if(input.action==='begin'){
      requireThat(old.state==='ready','AUTO_AUDIO_NOT_READY');requireThat(s.now()<old.deadline_at,'AUDIO_ASR_TIMEOUT');next={...old,state:'submitting',lease_id:input.lease_id};
    }else if(input.action==='submitted'){
      requireThat(old.state==='submitting'&&old.lease_id===input.lease_id&&typeof input.task_id==='string'&&/^\d{1,20}$/.test(input.task_id),'INVALID_ASR_TASK');next={...old,state:'waiting',task_id:input.task_id};
    }else if(input.action==='recognized'){
      requireThat(old.state==='waiting'&&input.task_id===old.task_id,'INVALID_ASR_TASK');requireThat(s.now()<old.deadline_at,'AUDIO_ASR_TIMEOUT');
      requireThat(input.result?.sentences?.every(sentence=>safeAnalysisText(sentence.text)&&sentence.words.every(w=>safeAnalysisText(w.text))),'ANALYSIS_RESTRICTED_CONTENT');
      let snapshot;try{snapshot=s.transcriptStore.read(source.learner,{attempt_id:unit.attempt_id});}catch{/* Audio-only permission never reads revoked text. */}
      const decision=audioAsrDecision(unit,input.result,{learnerTexts:snapshot?.transcript.filter(t=>t.role==='learner'&&t.kind==='content').map(t=>t.text)??[]});
      next={...old,state:decision.state,reason:decision.reason,asr:input.result,reference:decision.reference,assessment_window:decision.assessment_window??null,recognized_sentences:decision.recognized_sentences??0,limitations:decision.limitations??[],finished_at:s.now()};
      next.verification_hash=recordHash(next);
    }else if(input.action==='polled'){
      requireThat(old.state==='waiting'&&input.task_id===old.task_id,'INVALID_ASR_TASK');requireThat(s.now()<old.deadline_at,'AUDIO_ASR_TIMEOUT');next={...old,poll_failures:0,next_poll_at:s.now()+2000};
    }else if(input.action==='poll_failed'){
      requireThat(old.state==='waiting'&&['asr_failed','asr_timeout'].includes(input.reason),'INVALID_ASR_FAILURE');const failures=(old.poll_failures??0)+1;next={...old,poll_failures:failures,state:failures<3?'waiting':'failed',reason:failures<3?null:input.reason,next_poll_at:s.now()+Math.min(30000,2000*2**failures),...(failures>=3?{finished_at:s.now()}:{})};
    }else if(input.action==='failed'){
      requireThat(['submitting','waiting'].includes(old.state)&&['asr_not_enabled','asr_failed','asr_timeout','external_outcome_unknown','restricted_content'].includes(input.reason),'INVALID_ASR_FAILURE');next={...old,state:'failed',reason:input.reason,finished_at:s.now()};
    }else throw new Error('INVALID_AUTO_AUDIO_ACTION');
    s.repo.put('audio_auto_checks',next);this.summary(source.job);return {state:next.state};
  });}
  summary(job){
    const s=this.service,source=s.analysisDelegation.source(job),units=this.units({...source,manifest:s.audioStore.manifest(s.repo.get('actors',source.attempt.learner_id),{attempt_id:source.attempt.id})}),ids=new Set(units.map(u=>u.id)),rows=s.repo.all('audio_auto_checks').filter(r=>ids.has(r.id)),terminal=rows.every(r=>['eligible','excluded','failed'].includes(r.state));
    const summary={state:terminal?'complete':'running',total:rows.length,eligible:rows.filter(r=>r.state==='eligible').length,excluded:rows.filter(r=>r.state==='excluded').length,failed:rows.filter(r=>r.state==='failed').length,reasons:Object.fromEntries([...new Set(rows.map(r=>r.reason).filter(Boolean))].map(reason=>[reason,rows.filter(r=>r.reason===reason).length])),identity_verified:false,quality_validated:false,selection_policy:'one_sentence_per_unit_up_to_12',unselected_sentences:rows.reduce((n,r)=>n+Math.max(0,(r.recognized_sentences??0)-1),0),checked:rows.filter(r=>['eligible','excluded','failed'].includes(r.state)).length,duration_ms:units.reduce((n,u)=>n+(u.sample_end-u.sample_start)/16,0),samples:rows.filter(r=>r.reason&&r.reason!=='budget_limit').slice(0,6).map(r=>({segment_id:r.id,reason:r.reason,duration_ms:(units.find(u=>u.id===r.id).sample_end-units.find(u=>u.id===r.id).sample_start)/16}))};
    const latest=s.repo.get('jobs',job.id),stage=latest.deep.stages.audio;s.analysisDelegation.deep.save(latest,'audio',{...stage,verification_summary:summary});return summary;
  }
  defer(input){const s=this.service;return s.repo.transaction(()=>{const source=this.scope(input),state=this.state(source);requireThat(state.units.some(u=>['ready','waiting','submitting'].includes(u.state)),'AUTO_AUDIO_NOT_WAITING');const job=s.repo.get('jobs',source.job.id);s.repo.put('jobs',{...job,state:'pending',lease_id:null,lease_until:null,available_at:Math.min(...this.units(source).map(unit=>s.repo.get('audio_auto_checks',unit.id)).filter(check=>['ready','waiting','submitting'].includes(check.state)).map(check=>Math.max(s.now()+2000,check.next_poll_at??0)))});return {state:'deferred'};});}
  eraseTextReferences(attemptId){const s=this.service;let affected=false;for(const row of s.repo.all('audio_auto_checks'))if(row.attempt_id===attemptId&&row.reference){affected=true;s.repo.remove('audio_auto_checks',row.id);}if(affected)s.analysisDelegation.deep.eraseBranch(attemptId,'audio');}
  eraseAttempt(attemptId){for(const table of ['audio_units','audio_auto_checks'])for(const row of this.service.repo.all(table))if(row.attempt_id===attemptId)this.service.repo.remove(table,row.id);}
  call(op,input){return op==='auto_audio_prepare'?this.prepare(input):op==='auto_audio_update'?this.update(input):op==='auto_audio_defer'?this.defer(input):(()=>{throw new Error('NOT_FOUND');})();}
}
