import {HomeworkService} from '../../apps/hskai-mock/src/teacher-assistant/service.js';
import {reportConfiguration} from '../../packages/teacher-assistant/deep-analysis/config.js';
import {TranscriptRecorder} from '../../packages/teacher-assistant/teaching-record/transcript-recorder.js';
import {NOTICE_VERSION} from '../../packages/teacher-assistant/teaching-record/policy.js';
import {EvidenceRecorder} from '../../packages/teacher-assistant/evidence.js';
export const syntheticReportEnv={ASK_KAI_TA_REPORT_TEXT_PROVIDER:'minimax',ASK_KAI_PRONUNCIATION_PROVIDER:'tencent_soe_v2',ASK_KAI_TA_REPORT_EXTERNAL_REVIEWED:'1',ASK_KAI_TA_AUDIO_ASSESSMENT_VALIDATED:'1',MINIMAX_API_KEY:'synthetic-not-a-real-key',TENCENT_SOE_APP_ID:'1234',TENCENT_SOE_SECRET_ID:'synthetic-id',TENCENT_SOE_SECRET_KEY:'synthetic-key'};
export async function deepFixture(t,{env=syntheticReportEnv,verifiedAudio=false,verifiedReference=null,audio=true,audioSegments=1,rounds=1,now,path}={}){
  const service=new HomeworkService({analysisConfig:reportConfiguration(env),experimentalAudio:true,now,path});t.after(()=>service.close());const call=(op,token,input)=>{if(now&&op==='record_append')input={...input,events:input.events.map(e=>({...e,received_at:service.now()}))};return service.call(op,token,input);},teacher=(await call('login',null,{actor_id:'mock-teacher-lin'})).token,learner=(await call('login',null,{actor_id:'mock-maya-hsk3'})).token;
  const plan=await call('preview',teacher,{topic:'dining',learner_id:'mock-maya-hsk3'}),pub=await call('publish',teacher,{topic:'dining',learner_id:plan.learner_id,plan_hash:plan.hash,due_at:new Date(Date.now()+86400000).toISOString(),timezone:'Asia/Shanghai',idempotency_key:'deep-synthetic-publish'}),p=await call('prepare',learner,{assignment_id:pub.assignment_id}),scope={attempt_id:p.attempt.id,session_id:'synthetic-deep-session'};
  await call('recording_choice_update',learner,{attempt_id:p.attempt.id,notice_version:NOTICE_VERSION,expected_revision:0,text:true,audio});await call('bind_session',learner,scope);
  const recorder=new TranscriptRecorder({port:{call},token:learner,attemptId:p.attempt.id,sessionId:scope.session_id});await recorder.open();
  const events=[];for(let i=0;i<rounds;i++){
    for(const [type,name,text] of [['response.started','start',''],['response.text.delta','question','这只蝴蝶是什么颜色的？'],['response.done','done','']])recorder.forward({type:'event',event:{type,event_id:`deep-${i}-${name}`,session_id:scope.session_id,turn_id:`synthetic-opening-${i}`,response_id:`synthetic-reply-${i}`,payload:{text}}});
    const event={type:'user.final',event_id:`deep-user-${i}`,session_id:scope.session_id,turn_id:`synthetic-answer-${i}`,payload:{text:'我看到一只黄色的蝴蝶，它停在叶子上。'}};events.push(event);recorder.input(event);
  }await recorder.seal('student_end');
  const pcm=Buffer.alloc(3200,100);let saved;
  const savedSegments=[];if(audio){for(let i=0;i<audioSegments;i++){saved=await call('audio_append',learner,{...scope,stream_id:'synthetic-stream',sample_start:i*1600,sample_end:(i+1)*1600,pcm_base64:pcm.toString('base64')});savedSegments.push(saved);
    if(verifiedAudio){const segment=service.repo.get('audio_segments',saved.segment_id);service.repo.put('audio_segments',{...segment,speaker:'learner_verified',alignment:verifiedReference?{basis:'author_verified',reference_text_verified:true,reference:verifiedReference}:null,quality:{noise:'not_detected',clipping:'not_detected',missing_frames:'not_detected',overlap:'not_detected'}});}
    }await call('audio_seal',learner,scope);
  }
  const ledger=new EvidenceRecorder({attemptId:p.attempt.id,sessionId:scope.session_id,planHash:p.plan.hash,plan:p.plan});events.forEach(event=>ledger.input(event));await call('finalize',learner,{attempt_id:p.attempt.id,evidence:ledger.finalize({providerKind:'test',ready:true})});const attempt=await call('attempt',learner,{attempt_id:p.attempt.id}),submission=await call('submit',learner,{attempt_id:attempt.id,expected_version:attempt.version,idempotency_key:'deep-synthetic-submit'});
  return {service,learner,teacher,scope,attempt,submission,pcm,saved:savedSegments[0],savedSegments,plan:p.plan,call:async(op,input)=>service.analysisDelegation.call(op,input)};
}
