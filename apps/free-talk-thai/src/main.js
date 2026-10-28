import {readConfig} from '../../realtime-gateway/src/config.js';
import {startMockBackend} from '../../hskai-mock/src/backend.js';
import {loadProfile} from '../../../packages/provider-doubao/probe.js';
import {createDoubaoProvider,validateDoubaoRealtimeProfile} from '../../../packages/provider-doubao/seeduplex.js';
import {configuredThaiPlanner} from '../../../packages/free-talk-thai/planner.js';
import {createThaiApp} from './server.js';
let backend;
try{
  const config=readConfig({...process.env,ASK_KAI_BACKEND:'mock',ASK_KAI_PORT:process.env.ASK_KAI_THAI_PORT??'4311',ASK_KAI_PROVIDER:process.env.ASK_KAI_THAI_PROVIDER??process.env.ASK_KAI_PROVIDER??'replay',ASK_KAI_SLIDES_CONTROL:'false',ASK_KAI_SLIDES_DEMO_HISTORY:'false'});
  const profile=config.provider==='doubao'?validateDoubaoRealtimeProfile(await loadProfile(config.profilePath)):null;
  if(profile)createDoubaoProvider({profile});
  backend=await startMockBackend();const server=createThaiApp({backend,planner:configuredThaiPlanner(),providerFactory:profile?ticket=>createDoubaoProvider({profile,speechPace:ticket.speech_pace}):undefined});
  server.listen(config.port,config.host,()=>console.log(`Free Talk 中泰实验版: http://${config.host==='::1'?'[::1]':config.host}:${config.port} (independent Mock HSKai; ${profile?'voice configured, readiness per session':'voice disconnected'}; Thai quality not accepted)`));
  server.on('error',()=>{console.error('THAI_START_FAILED');server.stopRealtime();void backend.close();process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.stopRealtime();server.close();server.closeAllConnections();void backend.close();});
}catch{await backend?.close();console.error('THAI_CONFIGURATION_ERROR');process.exitCode=1;}
