import {createTeacherApp} from './server.js';import {startHomeworkBackend} from '../../../packages/hskai-bridge/homework-port.js';
import {loadProfile} from '../../../packages/provider-doubao/probe.js';import {createDoubaoProvider,validateDoubaoRealtimeProfile} from '../../../packages/provider-doubao/seeduplex.js';
let backend;
try{
  const profilePath=process.env.ASK_KAI_TA_VOICE_PROFILE??process.env.DOUBAO_REALTIME_PROFILE;
  const provider=process.env.ASK_KAI_TA_PROVIDER??(profilePath?'doubao':'none');if(!['none','doubao'].includes(provider))throw new Error('INVALID_TA_PROVIDER');
  const profile=provider==='doubao'?validateDoubaoRealtimeProfile(await loadProfile(profilePath)):null;if(profile)createDoubaoProvider({profile});
  const rawPort=process.env.ASK_KAI_TA_PORT??'4330';if(!/^\d+$/.test(rawPort)||Number(rawPort)<1||Number(rawPort)>65535)throw new Error('INVALID_TA_PORT');
  backend=await startHomeworkBackend({path:process.env.ASK_KAI_TA_DATABASE??'.local/teacher-assistant/homework.sqlite',recordingEnv:Object.fromEntries(['ASK_KAI_TA_TEXT_RETENTION_DAYS','ASK_KAI_TA_AUDIO_RETENTION_DAYS'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]])),textEnv:Object.fromEntries(['ASK_KAI_TA_TEXT_PROVIDER','MINIMAX_API_KEY','MINIMAX_BASE_URL','MINIMAX_PLANNER_MODEL'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))});
  const server=createTeacherApp({port:backend.port,cookieName:process.env.ASK_KAI_TA_COOKIE_NAME??'ask_kai_ta_session',providerFactory:profile?ticket=>createDoubaoProvider({profile,speechPace:ticket.speech_pace}):undefined});
  server.listen(Number(rawPort),'127.0.0.1',()=>console.log(`Teacher Assistant: http://127.0.0.1:${rawPort} (Mock HSKai; preset and AI draft sources labeled separately; ${profile?'voice configured, readiness per session':'voice not configured'})`));
  server.on('error',()=>{console.error('TA_START_FAILED');server.stopRealtime();void backend.close();process.exitCode=1;});
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.stopRealtime();server.close();server.closeAllConnections();void backend.close();});
}catch(e){await backend?.close();console.error(/^[A-Z_]+$/.test(e.message)?e.message:'TA_CONFIGURATION_ERROR');process.exitCode=1;}
