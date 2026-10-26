import {configuredHomeworkPlanSource} from '../../../../packages/teacher-assistant/ai-plan-source.js';
import {createServer} from 'node:http';import {timingSafeEqual} from 'node:crypto';
import {HomeworkService} from './service.js';import {readJson,json,errorStatus} from '../../../../packages/teacher-assistant/http.js';
process.once('message',({path,secret,textEnv={}})=>{
  let service;try{service=new HomeworkService({path,aiPlanSource:configuredHomeworkPlanSource(textEnv)});}catch(error){process.send?.({error:['MINIMAX_PLANNER_CONFIG_REQUIRED','INVALID_TA_TEXT_PROVIDER'].includes(error.message)?error.message:'HOMEWORK_DATABASE_UNAVAILABLE'});process.exit(1);}
  const server=createServer(async(req,res)=>{try{const auth=req.headers.authorization??'',expected=`Bearer ${secret}`;if(auth.length!==expected.length||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected))){json(res,401,{error:'UNAUTHORIZED'});return;}if(req.method!=='POST'||req.url!=='/homework'){json(res,404,{error:'NOT_FOUND'});return;}const {op,token,input}=await readJson(req);const result=await service.call(op,token,input);json(res,200,result);}catch(e){json(res,errorStatus(e.message),{error:/^[A-Z_]+$/.test(e.message)?e.message:'HOMEWORK_SERVICE_ERROR'});}});
  server.listen(0,'127.0.0.1',()=>process.send?.({port:server.address().port}));server.on('error',()=>process.exit(1));
  const timer=setInterval(()=>{void service.preparations.run().catch(()=>console.error('HOMEWORK_PREPARATION_WORKER_FAILED'));void service.runReports().catch(()=>console.error('HOMEWORK_REPORT_WORKER_FAILED'));},250);timer.unref();
  const stop=()=>{clearInterval(timer);server.close(()=>{service.close();process.exit(0);});server.closeAllConnections();};process.on('disconnect',stop);process.once('SIGTERM',stop);
});
