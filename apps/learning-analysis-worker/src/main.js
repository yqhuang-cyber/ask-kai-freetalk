import {TencentRecordingASR} from '../../../packages/provider-tencent-asr/recording.js';
import {runClaimedAnalysis} from './run-analysis.js';
import {ConversationReportAnalyzer,MiniMaxReportTransport} from '../../../packages/teacher-assistant/deep-analysis/semantic.js';
import {TencentAudioAssessmentPort} from '../../../packages/provider-tencent-soe/assessment.js';
import {reportConfiguration} from '../../../packages/teacher-assistant/deep-analysis/config.js';
// Only this process receives report provider credentials. M4 remains the sole writer.
process.once('message',({endpoint,secret,analysisEnv={}})=>{
  let stopping=false,timer,active;const config=reportConfiguration(analysisEnv);
  const textAnalyzer=new ConversationReportAnalyzer({transport:config.text.provider==='minimax'&&config.text.configured?new MiniMaxReportTransport({apiKey:analysisEnv.MINIMAX_API_KEY,baseURL:analysisEnv.MINIMAX_BASE_URL,model:config.text.model}):undefined});
  const audioPort=config.audio.provider==='tencent_soe_v2'&&config.audio.configured?new TencentAudioAssessmentPort({appId:analysisEnv.TENCENT_SOE_APP_ID,secretId:analysisEnv.TENCENT_SOE_SECRET_ID,secretKey:analysisEnv.TENCENT_SOE_SECRET_KEY}):undefined;
  const asrPort=config.audio.autoVerification&&config.audio.verificationConfigured?new TencentRecordingASR({secretId:analysisEnv.TENCENT_ASR_SECRET_ID??analysisEnv.TENCENT_SOE_SECRET_ID,secretKey:analysisEnv.TENCENT_ASR_SECRET_KEY??analysisEnv.TENCENT_SOE_SECRET_KEY,engine:analysisEnv.TENCENT_ASR_ENGINE??'16k_zh_en',region:analysisEnv.TENCENT_ASR_REGION??'ap-shanghai'}):undefined;
  const call=async(op,input={})=>{const response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({op,input}),signal:AbortSignal.timeout(5000)});const result=await response.json();if(!response.ok)throw new Error(/^[A-Z_]+$/.test(result.error)?result.error:'ANALYSIS_API_ERROR');return result;};
  const poll=async()=>{if(stopping)return;try{const job=await call('claim');if(job.state==='claimed'){active=new AbortController();try{await runClaimedAnalysis({job,call,textAnalyzer,audioPort,asrPort,signal:active.signal});}catch{try{await call('fail',{job_id:job.job_id,lease_id:job.lease_id});}catch{/* Lease or authorization no longer valid. */}}finally{active=null;}}}catch{/* No provider responses or learner content in logs. */}finally{if(!stopping)timer=setTimeout(poll,300);}};
  const stop=()=>{stopping=true;clearTimeout(timer);active?.abort();process.exit(0);};process.once('disconnect',stop);process.once('SIGTERM',stop);process.send?.({ready:true});void poll();
});
