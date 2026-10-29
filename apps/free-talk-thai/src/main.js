import {readConfig} from '../../realtime-gateway/src/config.js';
import {startMockBackend} from '../../hskai-mock/src/backend.js';
import {loadProfile} from '../../../packages/provider-doubao/probe.js';
import {createDoubaoProvider,validateDoubaoRealtimeProfile} from '../../../packages/provider-doubao/seeduplex.js';
import {configuredThaiPlanner} from '../../../packages/free-talk-thai/planner.js';
import {createThaiApp} from './server.js';
import {readFile} from 'node:fs/promises';
import {ThaiInputBridge} from './input-bridge.js';
import {DoubaoThaiAsr} from '../../../packages/provider-doubao/asr.js';
import {createHash} from 'node:crypto';
import {BRIDGE_TRIGGER} from './input-policy.js';
let backend;
try{
  const config=readConfig({...process.env,DOUBAO_REALTIME_PROFILE:process.env.ASK_KAI_THAI_REALTIME_PROFILE??process.env.DOUBAO_REALTIME_PROFILE,ASK_KAI_BACKEND:'mock',ASK_KAI_PORT:process.env.ASK_KAI_THAI_PORT??'4311',ASK_KAI_PROVIDER:process.env.ASK_KAI_THAI_PROVIDER??process.env.ASK_KAI_PROVIDER??'replay',ASK_KAI_SLIDES_CONTROL:'false',ASK_KAI_SLIDES_DEMO_HISTORY:'false'});
  const profile=config.provider==='doubao'?validateDoubaoRealtimeProfile(await loadProfile(config.profilePath)):null;
  if(profile)createDoubaoProvider({profile});
  const inputMode=process.env.ASK_KAI_THAI_INPUT_MODE??(process.env.DOUBAO_ASR_API_KEY?'manual':'native');
  if(!['manual','native'].includes(inputMode))throw Error('INVALID_THAI_INPUT_MODE');
  const inputBridge=!!profile&&inputMode==='manual',asr=inputBridge?new DoubaoThaiAsr():null;
  const triggerPcm=inputBridge?await readFile(new URL('../assets/trigger.pcm',import.meta.url)):null;
  if(inputBridge){const manifest=JSON.parse(await readFile(new URL('../assets/trigger.json',import.meta.url),'utf8'));if(manifest.text!==BRIDGE_TRIGGER||manifest.sha256!==createHash('sha256').update(triggerPcm).digest('hex')||triggerPcm.length>64000||triggerPcm.length%2||manifest.sample_rate!==16000||manifest.channels!==1)throw Error('INVALID_TRIGGER_ASSET');}
  backend=await startMockBackend();const server=createThaiApp({backend,planner:configuredThaiPlanner(),inputBridge,providerFactory:profile?ticket=>inputBridge?new ThaiInputBridge({profile,speechPace:ticket.speech_pace,inputMode:ticket.input_mode??'zh',triggerPcm,asr}):createDoubaoProvider({profile,speechPace:ticket.speech_pace}):undefined});
  server.listen(config.port,config.host,()=>console.log(`Free Talk 中泰实验版: http://${config.host==='::1'?'[::1]':config.host}:${config.port} (independent Mock HSKai; ${profile?'voice configured, readiness per session':'voice disconnected'}; Thai quality not accepted)`));
  server.on('error',()=>{console.error('THAI_START_FAILED');server.stopRealtime();void backend.close();process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.stopRealtime();server.close();server.closeAllConnections();void backend.close();});
}catch{await backend?.close();console.error('THAI_CONFIGURATION_ERROR');process.exitCode=1;}
