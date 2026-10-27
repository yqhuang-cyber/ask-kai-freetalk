import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';
import {attachRealtime} from '../../realtime-gateway/src/realtime.js';
import {HomeworkConversationController} from '../../../packages/teacher-assistant/controller.js';
import {TranscriptRecorder} from '../../../packages/teacher-assistant/teaching-record/transcript-recorder.js';
import {AudioRecorder} from '../../../packages/teacher-assistant/teaching-record/audio-recorder.js';
import {NOTICE_VERSION} from '../../../packages/teacher-assistant/teaching-record/policy.js';
import {readJson,json,errorStatus} from '../../../packages/teacher-assistant/http.js';import {requireThat} from '../../../packages/teacher-assistant/contracts.js';
const publicRoot=new URL('../public/',import.meta.url),shared=new URL('../../realtime-gateway/public/',import.meta.url);
const sharedNames=['audio.js','capture-worklet.js','diagnostics.js','presentation.js','caption-phrases.js','closing-playback.js','speech-playback.js','voice-readiness.js','caption-annotations.js','caption-settings.js'];
const browserOps=new Set(['recording_notice','recording_choice','recording_choice_update','recording_audio_delete','record_read','me','preview','publish','list','attempt','submit','submission','retry_report','delete_my_data','planning_config','draft_create','draft_read','draft_edit','draft_cancel','draft_retry','draft_list']);
export function createTeacherApp({port,providerFactory,providerKind='doubao',readyTimeoutMs=8000,cookieName='ask_kai_ta_session',transcriptEnabled=false,audioEnabled=false}={}){
  requireThat(/^ask_kai_ta_[a-z0-9_]{1,40}$/.test(cookieName),'INVALID_COOKIE_NAME');
  const server=createServer(async(req,res)=>{
    try{
      const host=req.headers.host??'';requireThat(/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host),'FORBIDDEN');
      const origin=`http://${host}`,url=new URL(req.url,origin);requireThat(!['cross-site','same-site'].includes(req.headers['sec-fetch-site']),'FORBIDDEN');
      if(url.pathname==='/api/ta/config'&&req.method==='GET'){json(res,200,{business_source:'mock_hskai',plan_source:'per_published_plan',default_plan_source:'authored_fixture',voice_configured:!!providerFactory,voice_source:providerKind==='doubao'?'doubao':'synthetic',scenario:'teacher_homework',grades:false});return;}
      if(url.pathname.startsWith('/api/ta/')){
        requireThat(req.method==='POST'&&req.headers.origin===origin,'FORBIDDEN');const input=await readJson(req),op=url.pathname.slice('/api/ta/'.length),token=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        const cookie=value=>`${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api/ta; Max-Age=${value?3600:0}`;
        if(op==='login'){
          if(token){try{const me=await port.call('me',token);if(me.actor.role==='learner')realtime.revoke({owner_id:'mock-homework-owner',learner_id:me.actor.id});await port.call('logout',token);}catch{/* expired mock session */}}
          const result=await port.call('login',null,input);json(res,200,{actor:result.actor},{'set-cookie':cookie(result.token)});return;
        }
        if(op==='logout'){const me=await port.call('me',token);if(me.actor.role==='learner')realtime.revoke({owner_id:'mock-homework-owner',learner_id:me.actor.id});await port.call('logout',token);json(res,200,{ok:true},{'set-cookie':cookie('')});return;}
        if(op==='prepare'){
          requireThat(!!providerFactory,'VOICE_NOT_CONFIGURED');const recording=input.recording_text===true,recordingAudio=input.recording_audio===true;if(recording)requireThat(transcriptEnabled,'RECORD_NOT_ENABLED');if(recordingAudio)requireThat(audioEnabled,'RECORD_NOT_ENABLED');if(recording||recordingAudio)requireThat(input.recording_notice_version===NOTICE_VERSION,'RECORD_NOTICE_CHANGED');const prepared=await port.call('prepare',token,input);
          if(recording||recordingAudio)await port.call('recording_choice_update',token,{attempt_id:prepared.attempt.id,notice_version:NOTICE_VERSION,expected_revision:0,text:recording,audio:recordingAudio});
          const homework={attempt_id:prepared.attempt.id,plan:prepared.plan,token,recording,recordingAudio};const ticket=await realtime.create({origin,mode:'teacher_homework',identity:prepared.identity,speechPace:'slow',homework});
          json(res,200,{...ticket,attempt_id:prepared.attempt.id,plan_hash:prepared.plan.hash,plan_source:prepared.plan.source,recording_state:recording?(homework.recorder?'enabled':'failed'):'not_selected',audio_recording_state:recordingAudio?(homework.audioRecorder?'enabled':'failed'):'not_selected'});return;
        }
        requireThat(browserOps.has(op),'NOT_FOUND');const result=await port.call(op,token,input);if(op==='recording_choice_update')realtime.stopHomeworkRecording(input.attempt_id,{text:!result.text.allowed,audio:!result.audio.allowed});if(op==='recording_notice'){result.capabilities.text_collection=transcriptEnabled;result.capabilities.audio_collection=audioEnabled;if(audioEnabled){if(!result.capabilities.text_analysis&&result.capabilities.pronunciation_analysis)result.current='你可以选择保存测试录音；明确提交后，仅确认来源与质量的学生片段交给腾讯智聆评测。';else if(!result.capabilities.text_analysis)result.current='你可以分别选择保存对话文本和测试录音；发音分析尚未开启。';result.audio.purpose=result.capabilities.pronunciation_analysis?'仅将声音来源和质量已确认的学生片段交腾讯评测；结果需要核对。测试录音可能含背景声和 Kai 回声，来源或质量无法确认的片段不会送评。':'测试录音会保存检测到的声音片段，可能包含背景声或 Kai 的回声，当前不会自动评判发音。';result.choice='文本和测试录音可以分别选择、撤回；不影响继续练习或已有提交。';result.deletion='撤回或到期后删除对应文本、测试录音及其深入分析。已有练习记录和规则反馈仍按原设置保留；供应商侧处理不等于本地删除。';}else if(!transcriptEnabled)result.current='完整对话文本记录和发音分析正在准备中。';}json(res,200,result);return;
      }
      requireThat(req.method==='GET','NOT_FOUND');
      const vendors={'/vendor/pinyin-pro.js':'node_modules/pinyin-pro/dist/index.js','/vendor/pinyin-traditional.js':'node_modules/@pinyin-pro/data/dist/traditional.mjs'};
      if(vendors[url.pathname]){const data=await readFile(new URL('../../../'+vendors[url.pathname],import.meta.url));res.writeHead(200,{'content-type':'text/javascript','cache-control':'no-store'});res.end(data);return;}const name=url.pathname==='/'?'index.html':url.pathname.slice(1);const isShared=sharedNames.includes(name);requireThat(isShared||['index.html','app.js','style.css','teacher-planning.js'].includes(name),'NOT_FOUND');
      const data=await readFile(new URL(name,isShared?shared:publicRoot));res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; worker-src 'self'; object-src 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(data);
    }catch(e){json(res,e.message==='HOMEWORK_SERVICE_UNAVAILABLE'?503:errorStatus(e.message),{error:/^[A-Z_]+$/.test(e.message)?e.message:'TEACHER_APP_ERROR'});}
  });
  const realtime=attachRealtime(server,{providerFactory,providerKind,businessSource:'mock_hskai',readyTimeoutMs,websocketPath:'/api/ta/realtime',protocol:'ask-kai.homework.v1',
    conversationFactory:ticket=>new HomeworkConversationController({sessionId:ticket.session_id,homework:ticket.homework,speechPace:ticket.speech_pace,memory:ticket.identity.memory,transcriptRecorder:ticket.homework.recorder,audioRecorder:ticket.homework.audioRecorder}),
    sessionLifecycle:{
      open:async ticket=>{await port.call('bind_session',ticket.homework.token,{attempt_id:ticket.homework.attempt_id,session_id:ticket.session_id});if(ticket.homework.recording){const recorder=new TranscriptRecorder({port,token:ticket.homework.token,attemptId:ticket.homework.attempt_id,sessionId:ticket.session_id});try{await recorder.open();ticket.homework.recorder=recorder;}catch{/* Conversation can continue; UI reports recording failure. */}}if(ticket.homework.recordingAudio){try{await port.call('audio_authorize',ticket.homework.token,{attempt_id:ticket.homework.attempt_id,session_id:ticket.session_id});ticket.homework.audioRecorder=new AudioRecorder({port,token:ticket.homework.token,attemptId:ticket.homework.attempt_id,sessionId:ticket.session_id});}catch{/* Report failure without interrupting live conversation. */}}},
      authorize:async ticket=>{const result=await port.call('authorize_attempt',ticket.homework.token,{attempt_id:ticket.homework.attempt_id,session_id:ticket.session_id});if(result.recording){if(!result.recording.text)ticket.homework.recorder?.stopLocal();if(!result.recording.audio)ticket.homework.audioRecorder?.stopLocal();}return result;},
      finalize:async({ticket,controller,reason})=>{const restricted=['authorization_revoked','safety_restricted'].includes(reason),finish=async recorder=>{if(!recorder)return null;try{return restricted?await recorder.discard():await recorder.seal(reason);}catch{return {state:'failed'};}};if(!restricted)await port.call('begin_finalize',ticket.homework.token,{attempt_id:ticket.homework.attempt_id,session_id:ticket.session_id});const [recording,audio_recording]=await Promise.all([finish(ticket.homework.recorder),finish(ticket.homework.audioRecorder)]);const receipt=await port.call('finalize',ticket.homework.token,{attempt_id:ticket.homework.attempt_id,evidence:controller.evidence});return {...receipt,recording,audio_recording};}
    }});
  server.stopRealtime=()=>realtime.close();return server;
}
