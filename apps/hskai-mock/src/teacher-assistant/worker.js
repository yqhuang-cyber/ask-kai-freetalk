import {configuredHomeworkPlanSource} from '../../../../packages/teacher-assistant/ai-plan-source.js';
import {createServer} from 'node:http';import {timingSafeEqual} from 'node:crypto';
import {HomeworkService} from './service.js';import {readJson,json,errorStatus} from '../../../../packages/teacher-assistant/http.js';
import {configuredRecordingPolicy} from '../../../../packages/teacher-assistant/teaching-record/policy.js';
process.once('message',({path,secret,analysisSecret,textEnv={},recordingEnv={},experimentalAudio=false,analysisConfig})=>{
  let service;try{service=new HomeworkService({path,aiPlanSource:configuredHomeworkPlanSource(textEnv),recordingPolicy:configuredRecordingPolicy(recordingEnv),experimentalAudio,analysisConfig});}catch(error){process.send?.({error:['MINIMAX_PLANNER_CONFIG_REQUIRED','INVALID_TA_TEXT_PROVIDER','INVALID_RECORD_RETENTION'].includes(error.message)?error.message:'HOMEWORK_DATABASE_UNAVAILABLE'});process.exit(1);}
  const server=createServer(async(req,res)=>{try{const analysis=req.url==='/analysis',auth=req.headers.authorization??'',expected=`Bearer ${analysis?analysisSecret:secret}`;if(auth.length!==expected.length||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected))){json(res,401,{error:'UNAUTHORIZED'});return;}if(req.method!=='POST'||!['/homework','/analysis'].includes(req.url)){json(res,404,{error:'NOT_FOUND'});return;}const {op,token,input}=await readJson(req,262144);const result=analysis?service.analysisDelegation.call(op,input):await service.call(op,token,input);json(res,200,result);}catch(e){json(res,errorStatus(e.message),{error:/^[A-Z_]+$/.test(e.message)?e.message:'HOMEWORK_SERVICE_ERROR'});}});
  server.listen(0,'127.0.0.1',()=>process.send?.({port:server.address().port}));server.on('error',()=>process.exit(1));
  const timer=setInterval(()=>{void service.preparations.run().catch(()=>console.error('HOMEWORK_PREPARATION_WORKER_FAILED'));},250);timer.unref();
  const expire=()=>{try{service.recordingPermissions.expire();service.transcriptStore.expire();service.audioStore?.expire();}catch{console.error('HOMEWORK_RECORDING_EXPIRY_FAILED');}};expire();
  const expiryTimer=setInterval(expire,60000);expiryTimer.unref();
  const stop=()=>{clearInterval(expiryTimer);clearInterval(timer);server.close(()=>{service.close();process.exit(0);});server.closeAllConnections();};process.on('disconnect',stop);process.once('SIGTERM',stop);
});
