import test from 'node:test';import assert from 'node:assert/strict';
import {deepFixture,syntheticReportEnv} from './helpers/deep-analysis.js';
import {runClaimedAnalysis} from '../apps/learning-analysis-worker/src/run-analysis.js';
import {ConversationReportAnalyzer} from '../packages/teacher-assistant/deep-analysis/semantic.js';
import {syntheticSemanticTransport} from './helpers/semantic-analysis.js';
import {normalizeAssessment,audioEligibility,verifiedAudioReference} from '../packages/provider-tencent-soe/assessment.js';
import {pcmQuality,precheckAudioUnit,audioAsrDecision} from '../packages/teacher-assistant/deep-analysis/audio-verification.js';
import {NOTICE_VERSION} from '../packages/teacher-assistant/teaching-record/policy.js';
import {encodeCaptureFrame,decodeCaptureFrame} from '../packages/teacher-assistant/teaching-record/capture-protocol.js';
import {AudioCandidateSegmenter} from '../packages/teacher-assistant/teaching-record/audio-segmenter.js';
const env={...syntheticReportEnv,ASK_KAI_TA_AUDIO_ASSESSMENT_VALIDATED:'0',ASK_KAI_TA_AUDIO_REVIEW_ENABLED:'1',ASK_KAI_TA_AUDIO_VERIFY_PROVIDER:'tencent_asr'};
export function testPCM(){const b=Buffer.alloc(32000);for(let i=3200;i<12800;i++)b.writeInt16LE(Math.round(3000*Math.sin(i*.12)),i*2);return b;}
const pcm=testPCM(),capture={protocol:'homework-mic-v1',frames:50,aec:true,playback_overlap:false,playback_known:true,continuous:true};
const asr=(text='我看到一只黄色的蝴蝶它停在叶子上')=>({schema_version:'audio-asr-v1',provider:'tencent_asr',engine:'synthetic',identity_verified:false,sentences:[{text,start_ms:200,end_ms:800,speaker_id:0,words:[{text,start_ms:200,end_ms:800}]}]});
const fixture=(t,options={})=>deepFixture(t,{env,audioPCM:pcm,audioCapture:capture,...options});
const sourceRef=j=>({job_id:j.job_id,lease_id:j.lease_id});
const view=f=>f.service.call('submission',f.learner,{submission_id:f.submission.id});
const measured=source=>normalizeAssessment({PronAccuracy:70,PronFluency:.8,Words:[{Word:'蝴蝶',MemBeginTime:200,MemEndTime:500,PronAccuracy:70,Tone:{Valid:true,RefTone:2,HypothesisTone:3},PhoneInfos:[]}]},{segment:source.segment,mode:source.mode,reference:source.reference});
async function run(f,{asrPort,audioPort,onText=()=>{}}={}){const job=f.service.analysisDelegation.claim();assert.equal(job.state,'claimed');await runClaimedAnalysis({job,call:f.call,textAnalyzer:new ConversationReportAnalyzer({transport:syntheticSemanticTransport(v=>{onText();return v;})}),asrPort,audioPort:audioPort??{assess:async(source,{beforeSend})=>{await beforeSend();return measured(source);}}});return job;}
const ports=()=>({submitted:0,polled:0,provider:'synthetic',async submit(_pcm,{beforeSend}){await beforeSend();this.submitted++;return {task_id:'1234567890123456789'};},async poll(id){assert.equal(id,'1234567890123456789');this.polled++;return {state:'complete',result:asr()};}});

test('capture protocol preserves exact PCM and rejects malformed metadata',()=>{
 const frame=Buffer.alloc(640,8),encoded=encodeCaptureFrame(frame,{sequence:7,sampleStart:2240,aec:true,playback:false}),decoded=decodeCaptureFrame(encoded);assert.deepEqual(Buffer.from(decoded.pcm),frame);assert.equal(decoded.metadata.sample_start,2240);assert.equal(decoded.metadata.playback,'inactive');
 for(const index of [0,4,5,7,16,20]){const bad=encoded.slice();bad[index]=255;assert.throws(()=>decodeCaptureFrame(bad),/INVALID_CAPTURE_FRAME/);}assert.throws(()=>decodeCaptureFrame(frame),/INVALID_CAPTURE_FRAME/);
});
test('capture gaps are explicit, pre-roll is retained, and long storage chunks remain contiguous',()=>{
 const segmenter=new AudioCandidateSegmenter({preRollFrames:10,tailFrames:20}),frames=[];let position=0;const push=(n,sound)=>{for(let i=0;i<n;i++){const b=Buffer.alloc(640);if(sound)b.fill(10);frames.push(...segmenter.push(b,{playback:'inactive',capture:{sample_start:position,aec:true}}));position+=320;}};
 push(10,false);push(270,true);push(20,false);assert.equal(frames.length,2);assert.equal(frames[0].sample_start,0);assert.equal(frames[0].boundary_reason,'capacity');assert.equal(frames[0].sample_end,frames[1].sample_start);assert.equal(frames[1].boundary_reason,'silence');assert.equal(frames[0].capture.aec,true);
 push(10,true);position+=320;push(1,true);assert.equal(frames.at(-1).boundary_reason,'capture_gap');assert.equal(frames.at(-1).capture.continuous,false);
});
test('measured prechecks exclude echo, clipping, noise, unknown capture and incomplete units without claiming identity',()=>{
 const unit={sample_start:0,sample_end:16000,capture,boundary_reason:'silence'};assert.equal(precheckAudioUnit(unit,pcm).state,'ready');assert.equal(precheckAudioUnit(unit,pcm).identity_verified,false);assert.ok(pcmQuality(pcm).estimated_snr_db>=12);
 for(const [change,reason] of [[{capture:null},'capture_unverified'],[{capture:{...capture,playback_overlap:true}},'playback_overlap'],[{capture:{...capture,aec:false}},'echo_control_unavailable'],[{capture:{...capture,continuous:false}},'capture_gap'],[{boundary_reason:'capacity'},'incomplete_utterance']])assert.equal(precheckAudioUnit({...unit,...change},pcm).reason,reason);
 const clipped=Buffer.from(pcm);clipped.writeInt16LE(32767,0);assert.equal(precheckAudioUnit(unit,clipped).reason,'clipping');assert.equal(precheckAudioUnit(unit,Buffer.alloc(pcm.length,50)).reason,'noise_or_uncertain_quality');assert.equal(precheckAudioUnit(unit,Buffer.alloc(pcm.length)).reason,'insufficient_speech');
 assert.equal(audioEligibility({...unit,speaker:'learner_channel'}).eligible,false);
});
test('independent ASR reference is a machine candidate; multiple speakers and unsupported language are excluded',()=>{
 const unit={sample_start:0,sample_end:16000},result=audioAsrDecision(unit,asr(),{learnerTexts:['我看到一只黄色的蝴蝶，它停在叶子上。']});assert.equal(result.reference.basis,'auto_aligned');assert.equal(result.reference.verified,false);assert.equal(result.reference.review_required,true);
 assert.equal(audioAsrDecision(unit,asr(),{learnerTexts:['另一个句子']}).reference,null);assert.equal(audioAsrDecision(unit,asr('hello there')).reason,'language_not_supported');const multi=asr();multi.sentences.push({...multi.sentences[0],start_ms:810,end_ms:900,speaker_id:1,words:[]});assert.equal(audioAsrDecision(unit,multi).reason,'multiple_speakers');
 const invalid=asr();invalid.sentences[0].end_ms=5000;assert.throws(()=>audioAsrDecision(unit,invalid),/INVALID_AUDIO_ASR/);
});
test('automatic ASR defers durably, resumes task IDs and completes pronunciation with zero teacher clicks',async t=>{
 let offset=0,textCalls=0,soeCalls=0;const f=await fixture(t,{now:()=>Date.now()+offset}),asrPort=ports(),original=f.service.repo.get('audio_segments',f.saved.segment_id),manifest=f.service.repo.get('audio_manifests',f.attempt.id);
 const audioPort={assess:async(source,{beforeSend})=>{await beforeSend();soeCalls++;assert.equal(source.segment.speaker,'learner_channel');assert.equal(source.segment.quality.noise,'unknown');assert.equal(source.mode,1);assert.equal(verifiedAudioReference(source.segment).basis,'auto_aligned');return measured(source);}};
 await run(f,{asrPort,audioPort,onText:()=>textCalls++});assert.equal(asrPort.submitted,1);assert.equal(soeCalls,0);const waiting=await view(f);assert.equal(waiting.report_state,'pending');assert.equal(waiting.deep_analysis.stages.audio.review_required,false);assert.equal(waiting.deep_analysis.stages.audio.verification_summary.state,'running');assert.equal(waiting.report,null);assert.equal(f.service.analysisDelegation.claim().state,'empty');
 offset+=3000;await run(f,{asrPort,audioPort,onText:()=>textCalls++});const done=await view(f);assert.equal(done.report_state,'complete');assert.equal(textCalls,1);assert.equal(asrPort.submitted,1);assert.equal(asrPort.polled,1);assert.equal(soeCalls,1);assert.equal(done.deep_analysis.stages.audio.verification_summary.eligible,1);assert.equal(done.deep_analysis.stages.audio.result.clips[0].source_basis,'automatic_mic_checks');assert.equal(done.deep_analysis.stages.audio.result.clips[0].reference_basis,'auto_aligned');assert.deepEqual(f.service.repo.get('audio_segments',original.id),original);assert.deepEqual(f.service.repo.get('audio_manifests',f.attempt.id),manifest);
 const preview=await f.service.call('audio_preview',f.learner,{submission_id:f.submission.id,segment_id:done.deep_analysis.stages.audio.result.clips[0].segment_id});assert.equal(preview.pcm_base64,pcm.toString('base64'));
});
test('continuous capacity chunks form one natural unit; unknown legacy audio never goes to ASR',async t=>{
 const f=await fixture(t,{audioSegments:2,boundaryReasons:['capacity','silence']}),job=f.service.analysisDelegation.claim(),prepared=await f.call('auto_audio_prepare',sourceRef(job));assert.equal(prepared.units.length,1);const audio=await f.call('read_audio',{...sourceRef(job),segment_id:prepared.units[0].id});assert.equal(Buffer.from(audio.pcm_base64,'base64').length,pcm.length*2);assert.equal(audio.segment.source_refs.length,2);
 const legacy=await fixture(t,{audioCapture:null}),port=ports();await run(legacy,{asrPort:port});assert.equal(port.submitted,0);const v=await view(legacy);assert.equal(v.report_state,'complete');assert.equal(v.deep_analysis.stages.audio.verification_summary.reasons.capture_unverified,1);assert.equal(v.deep_analysis.stages.audio.review_required,false);
});
test('ASR provisioning failure finishes a limited report instead of requiring teacher approval',async t=>{
 const f=await fixture(t);await run(f,{asrPort:{async submit(_,{beforeSend}){await beforeSend();throw new Error('TENCENT_ASR_NOT_ENABLED');}}});const v=await view(f);assert.equal(v.report_state,'complete');assert.equal(v.deep_analysis.stages.audio.reason,'asr_not_enabled');assert.equal(v.deep_analysis.stages.audio.review_required,false);assert.equal(v.deep_analysis.stages.audio.verification_summary.failed,1);
});
test('withdrawal deletes automatic records and rejects late ASR results',async t=>{
 let offset=0;const f=await fixture(t,{now:()=>Date.now()+offset});await run(f,{asrPort:ports()});offset+=3000;const job=f.service.analysisDelegation.claim(),ref=sourceRef(job),unit=f.service.repo.all('audio_units')[0];
 await f.service.call('recording_choice_update',f.learner,{attempt_id:f.attempt.id,notice_version:NOTICE_VERSION,expected_revision:1,text:true,audio:false});assert.equal(f.service.repo.all('audio_auto_checks').length,0);assert.equal(f.service.repo.all('audio_units').length,0);await assert.rejects(f.call('auto_audio_update',{...ref,unit_id:unit.id,action:'recognized',task_id:'1234567890123456789',result:asr()}),/AUTHORIZ/);
});
test('unknown upload outcome is never automatically uploaded again after lease recovery',async t=>{
 let offset=0;const f=await fixture(t,{now:()=>Date.now()+offset}),j=f.service.analysisDelegation.claim(),ref=sourceRef(j),state=await f.call('auto_audio_prepare',ref);await f.call('auto_audio_update',{...ref,unit_id:state.units[0].id,action:'begin'});offset+=31000;const next=f.service.analysisDelegation.claim(),prepared=await f.call('auto_audio_prepare',sourceRef(next));assert.equal(prepared.units[0].state,'failed');assert.equal(prepared.units[0].reason,'external_outcome_unknown');
});
test('waiting ASR reaches an authoritative deadline and does not keep the report pending forever',async t=>{
 let offset=0;const f=await fixture(t,{now:()=>Date.now()+offset});await run(f,{asrPort:ports()});offset+=601000;await run(f,{asrPort:{poll(){throw new Error('must not poll expired task');}}});const v=await view(f);assert.equal(v.report_state,'complete');assert.equal(v.deep_analysis.stages.audio.verification_summary.reasons.asr_timeout,1);
});
test('old notices do not gain the new ASR processing purpose from configuration alone',async t=>{
 const f=await fixture(t),choice=f.service.repo.get('recording_choices',f.attempt.id);f.service.repo.put('recording_choices',{...choice,notice_version:'deep-report-notice-v6',audio:{...choice.audio,verification_processing:undefined}});const port=ports();await run(f,{asrPort:port});assert.equal(port.submitted,0);assert.equal((await view(f)).deep_analysis.stages.audio.state,'not_authorized');
});

test('automatic retry preserves successful recognition and pronunciation instead of reuploading every unit',async t=>{
 let offset=0,submitted=0,soe=0,fail=true;const f=await fixture(t,{audioSegments:2,now:()=>Date.now()+offset});
 const asrPort={async submit(_,{beforeSend}){await beforeSend();submitted++;return {task_id:String(submitted)};},async poll(task){if(task==='2'&&fail)throw new Error('TENCENT_ASR_TASK_FAILED');return {state:'complete',result:asr()};}},audioPort={async assess(source,{beforeSend}){await beforeSend();soe++;return measured(source);}};
 await run(f,{asrPort,audioPort});offset+=3000;await run(f,{asrPort,audioPort});assert.equal(submitted,2);assert.equal(soe,1);assert.equal((await view(f)).deep_analysis.retryable,true);
 await f.service.call('retry_report',f.teacher,{submission_id:f.submission.id});fail=false;await run(f,{asrPort,audioPort});offset+=3000;await run(f,{asrPort,audioPort});assert.equal(submitted,3);assert.equal(soe,2);assert.equal((await view(f)).deep_analysis.stages.audio.result.assessed_segments,2);
});
test('tampered derived capture cannot bypass original source hashes',async t=>{
 const f=await fixture(t),job=f.service.analysisDelegation.claim(),ref=sourceRef(job),prepared=await f.call('auto_audio_prepare',ref),unit=f.service.repo.get('audio_units',prepared.units[0].id);f.service.repo.put('audio_units',{...unit,capture:{...unit.capture,aec:false}});await assert.rejects(f.call('read_audio',{...ref,segment_id:unit.id}),/SOURCE_CHANGED/);
});
test('ASR admissions remain free-speech mode without independent matching live transcript',async t=>{
 let offset=0;const f=await fixture(t,{now:()=>Date.now()+offset}),port=ports();port.poll=async()=>({state:'complete',result:asr('我要一碗面条不要辣')});await run(f,{asrPort:port});offset+=3000;let mode;await run(f,{asrPort:port,audioPort:{async assess(source,{beforeSend}){await beforeSend();mode=source.mode;return measured(source);}}});assert.equal(mode,3);const v=await view(f);assert.equal(v.deep_analysis.stages.audio.result.clips[0].reference_text,null);assert.equal(v.deep_analysis.stages.audio.result.dimensions.tone,'unavailable');
});

test('transient ASR query failures use bounded backoff without uploading audio again',async t=>{
 let offset=0,polls=0;const f=await fixture(t,{now:()=>Date.now()+offset}),port=ports();port.poll=async()=>{polls++;throw new Error('TENCENT_ASR_UNAVAILABLE');};await run(f,{asrPort:port});offset+=3000;await run(f,{asrPort:port});assert.equal(f.service.repo.all('audio_auto_checks')[0].poll_failures,1);assert.equal((await view(f)).report_state,'pending');offset+=3000;assert.equal(f.service.analysisDelegation.claim().state,'empty');offset+=2000;await run(f,{asrPort:port});offset+=9000;await run(f,{asrPort:port});const v=await view(f);assert.equal(port.submitted,1);assert.equal(polls,3);assert.equal(v.report_state,'complete');assert.equal(v.deep_analysis.stages.audio.verification_summary.failed,1);
});
test('expiration clears audio units, ASR text and task references, and hides summary before the sweep',async t=>{
 let offset=0;const f=await fixture(t,{now:()=>Date.now()+offset});await run(f,{asrPort:ports()});offset+=8*86400000;f.learner=(await f.service.call('login',null,{actor_id:'mock-maya-hsk3'})).token;const before=await view(f);assert.equal(before.deep_analysis.stages.audio.verification_summary,null);f.service.audioStore.expire();assert.equal(f.service.repo.all('audio_auto_checks').length,0);assert.equal(f.service.repo.all('audio_units').length,0);
});
test('text withdrawal erases machine references and their pronunciation derivatives',async t=>{
 let offset=0;const f=await fixture(t,{now:()=>Date.now()+offset}),port=ports();await run(f,{asrPort:port});offset+=3000;await run(f,{asrPort:port});assert.ok(f.service.repo.all('audio_auto_checks')[0].reference);await f.service.call('recording_choice_update',f.learner,{attempt_id:f.attempt.id,notice_version:NOTICE_VERSION,expected_revision:1,text:false,audio:true});assert.equal(f.service.repo.all('audio_auto_checks').some(row=>row.reference),false);assert.equal(f.service.repo.get('jobs',f.submission.id).deep.stages.audio.result,null);
});

test('quiet tails close before Kai playback and known playback is not included as leading pre-roll',()=>{
 const s=new AudioCandidateSegmenter({preRollFrames:10,tailFrames:20}),out=[];let sample=0;const push=(count,voice,playback)=>{for(let i=0;i<count;i++){const b=Buffer.alloc(640);if(voice)b.fill(10);out.push(...s.push(b,{playback,capture:{sample_start:sample,aec:true}}));sample+=320;}};
 push(10,false,'active');push(10,false,'inactive');push(20,true,'inactive');push(4,false,'inactive');push(1,false,'active');assert.equal(out.length,1);assert.equal(out[0].boundary_reason,'silence');assert.equal(out[0].capture.playback_overlap,false);assert.equal(out[0].sample_start,3200);assert.equal(out[0].sample_end,14080);
});
test('multiple ASR sentences select an explicit bounded sentence and expose unassessed coverage',async t=>{
 let offset=0;const f=await fixture(t,{now:()=>Date.now()+offset}),port=ports();port.poll=async()=>({state:'complete',result:{...asr(),sentences:[{text:'我要面条',start_ms:100,end_ms:400,speaker_id:0,words:[]},{text:'不要辣',start_ms:600,end_ms:800,speaker_id:0,words:[]}]}});await run(f,{asrPort:port});offset+=3000;let selected;
 await run(f,{asrPort:port,audioPort:{async assess(source,{beforeSend}){await beforeSend();selected=source;return normalizeAssessment({PronAccuracy:70,Words:[{Word:'面条',MemBeginTime:100,MemEndTime:300,PronAccuracy:70}]},{segment:source.segment,mode:source.mode,reference:source.reference});}}});assert.equal(selected.segment.sample_start,0);assert.equal(selected.segment.sample_end,8000);assert.equal(Buffer.from(selected.pcm_base64,'base64').length,16000);const v=await view(f);assert.equal(v.deep_analysis.stages.audio.verification_summary.unselected_sentences,1);const replay=await f.service.call('audio_preview',f.learner,{submission_id:f.submission.id,segment_id:selected.segment.id});assert.equal(replay.pcm_base64,selected.pcm_base64);
});

test('SOE checkpoints retain completed units through cancellation and explicit retry',async t=>{
 let offset=0,calls=0;const f=await fixture(t,{audioSegments:2,now:()=>Date.now()+offset}),port=ports(),controller=new AbortController();await run(f,{asrPort:port});offset+=3000;const job=f.service.analysisDelegation.claim();
 await assert.rejects(runClaimedAnalysis({job,call:f.call,signal:controller.signal,audioPort:{async assess(source,{beforeSend}){await beforeSend();calls++;if(calls===2){controller.abort();throw Error('TENCENT_TIMEOUT');}return measured(source);}},asrPort:port}));await f.call('fail',sourceRef(job));assert.equal(f.service.repo.get('jobs',f.submission.id).deep.stages.audio.result.assessments.length,1);
 await f.service.call('retry_report',f.teacher,{submission_id:f.submission.id});await run(f,{asrPort:port,audioPort:{async assess(source,{beforeSend}){await beforeSend();calls++;return measured(source);}}});assert.equal(calls,3);assert.equal(port.submitted,2);assert.equal((await view(f)).deep_analysis.stages.audio.result.assessed_segments,2);
});
test('bounded selection covers the session, and double SOE permission checks still permit twelve assessments',async t=>{
 let offset=0,soeCalls=0,textCalls=0;const f=await fixture(t,{audioSegments:13,now:()=>Date.now()+offset}),port=ports(),audioPort={async assess(source,{beforeSend}){await beforeSend();await beforeSend();soeCalls++;return measured(source);}};
 for(let i=0;i<12;i++){await run(f,{asrPort:port,audioPort,onText:()=>textCalls++});if((await view(f)).report_state==='complete')break;offset+=3000;}
 const v=await view(f);assert.equal(v.report_state,'complete');assert.equal(textCalls,1);assert.equal(port.submitted,12);assert.equal(soeCalls,12);assert.equal(v.deep_analysis.stages.audio.result.assessed_segments,12);assert.equal(v.deep_analysis.stages.audio.verification_summary.reasons.budget_limit,1);assert.equal(v.deep_analysis.stages.audio.result.unassessed_segments,1);
});

test('durable ASR tasks survive a real SQLite service restart without re-uploading',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{HomeworkService}=await import('../apps/hskai-mock/src/teacher-assistant/service.js'),{reportConfiguration}=await import('../packages/teacher-assistant/deep-analysis/config.js');const dir=mkdtempSync(join(tmpdir(),'kai-auto-restart-'));let offset=0,close,reopened;
 t.after(()=>{reopened?.close();rmSync(dir,{recursive:true,force:true});});const f=await fixture({after:fn=>{close=fn;}},{path:join(dir,'data.sqlite'),now:()=>Date.now()+offset}),port=ports();await run(f,{asrPort:port});close();reopened=new HomeworkService({path:join(dir,'data.sqlite'),experimentalAudio:true,analysisConfig:reportConfiguration(env),now:()=>Date.now()+offset});f.service=reopened;f.call=async(op,input)=>reopened.analysisDelegation.call(op,input);offset+=3000;await run(f,{asrPort:port});assert.equal(port.submitted,1);assert.equal(port.polled,1);assert.equal((await view(f)).report_state,'complete');
});
test('optional teacher corrections are versioned evidence and can enable an uncertain source without changing original audio',async t=>{
 let offset=0,soe=0;const f=await fixture(t,{audioCapture:null,now:()=>Date.now()+offset}),port=ports();await run(f,{asrPort:port});assert.equal(port.submitted,0);const original=f.service.repo.get('audio_segments',f.saved.segment_id),manifest=await f.service.call('audio_review_manifest',f.teacher,{submission_id:f.submission.id}),segment=manifest.segments[0];
 await f.service.call('audio_review',f.teacher,{submission_id:f.submission.id,manifest_hash:manifest.manifest_hash,decisions:[{segment_id:segment.id,source_metadata_hash:segment.source_metadata_hash,expected_revision:0,speaker:'learner_verified',quality:{noise:'not_detected',clipping:'not_detected',missing_frames:'not_detected',overlap:'not_detected'},reference_text:'我看到一只黄色的蝴蝶它停在叶子上'}]});await run(f,{asrPort:port});offset+=3000;await run(f,{asrPort:port,audioPort:{async assess(source,{beforeSend}){await beforeSend();soe++;assert.equal(source.reference.basis,'teacher_reviewed');return measured(source);}}});assert.equal(soe,1);assert.deepEqual(f.service.repo.get('audio_segments',original.id),original);assert.equal((await view(f)).deep_analysis.stages.audio.result.clips[0].source_basis,'teacher_listening_declaration');
});

test('enabling automatic verification releases legacy teacher waits without adding ASR consent to old audio',async t=>{
 const f=await deepFixture(t,{env:{...env,ASK_KAI_TA_AUDIO_VERIFY_PROVIDER:'none'}});await run(f);assert.equal((await view(f)).report_state,'awaiting_audio_review');f.service.analysisConfig.audio.autoVerification=true;const v=await view(f);assert.equal(v.report_state,'complete');assert.equal(v.deep_analysis.stages.audio.review_required,false);assert.equal(f.service.repo.get('recording_choices',f.attempt.id).audio.verification_processing,undefined);assert.equal(v.deep_analysis.stages.audio.verification_mode,undefined);
});

test('authorized playback does not require live provider configuration after analysis is complete',async t=>{
 let offset=0;const f=await fixture(t,{now:()=>Date.now()+offset}),port=ports();await run(f,{asrPort:port});offset+=3000;await run(f,{asrPort:port});const unit=f.service.repo.all('audio_units')[0];f.service.analysisConfig.audio.provider='none';const replay=await f.service.call('audio_preview',f.learner,{submission_id:f.submission.id,segment_id:unit.id});assert.equal(replay.pcm_base64,pcm.toString('base64'));
});
