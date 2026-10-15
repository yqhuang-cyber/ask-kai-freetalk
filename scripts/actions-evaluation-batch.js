import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BASELINE_PATH,verifyEvaluationBaseline,planEvaluationBatches } from '../apps/eval-runner/src/eval-baseline.js';
import { DEFAULT_PREPARED_DATASET,sha256,selectCases } from '../apps/eval-runner/src/multiturn-plan.js';
import { privateRunDirectory } from '../apps/eval-runner/src/multiturn.js';
import { atomicPrivateJson } from '../apps/eval-runner/src/private-artifacts.js';
import { validateBatchRequest,runEvaluationBatch } from '../apps/eval-runner/src/evaluation-batch.js';
const aborter=new AbortController(),abort=()=>aborter.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
let directory;
try {
  const args=process.argv.slice(2);if(args.length!==1||!/^batch-0[1-8]$/.test(args[0]))throw new Error('INVALID_BATCH_ARGUMENT');
  if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==process.env.GITHUB_SHA)throw new Error('INVALID_CANDIDATE_REVISION');
  const dataBytes=await readFile(DEFAULT_PREPARED_DATASET),profileBytes=await readFile('docs/protocol/seeduplex-connect.profile.json'),data=JSON.parse(dataBytes),profile=JSON.parse(profileBytes);
  const baseline=JSON.parse(await readFile(BASELINE_PATH)),request=JSON.parse(await readFile('.github/live/evaluation-batch-request.json'));
  const baselineInfo=await verifyEvaluationBaseline({baseline,dataBytes,profileBytes});
  validateBatchRequest(request,{baseline,data,dataSha:sha256(dataBytes),profileBytes,env:process.env});
  const plan=planEvaluationBatches(data,{batchCount:request.batch_count,caseIds:request.case_ids}),batch=plan.find(b=>b.id===args[0]);
  if(!batch){console.log(JSON.stringify({status:'empty_batch',batch_id:args[0]}));}
  else {
    directory=await privateRunDirectory('.local/evaluation-batch');
    await atomicPrivateJson(join(directory,'batch-request.json'),{...request,batch_id:batch.id,case_ids:batch.case_ids,...baselineInfo,runner_revision:process.env.GITHUB_SHA});
    const result=await runEvaluationBatch({data,dataSha:sha256(dataBytes),cases:selectCases(data,{includeLanguage:true,limit:100,caseIds:batch.case_ids}),profile,env:process.env,
      directory,baselineInfo,signal:AbortSignal.any([aborter.signal,AbortSignal.timeout(request.duration_ms)]),onProgress:row=>console.log(JSON.stringify(row))});
    const configured=!!(process.env.EVAL_JUDGE_API_KEY&&process.env.EVAL_JUDGE_BASE_URL&&process.env.EVAL_JUDGE_MODEL&&process.env.EVAL_JUDGE_VERSION);
    console.log(JSON.stringify({...result.report,external_judge_configured:configured}));
    if(configured){const {configuredRecordedJudge,runRecordedJudge}=await import('../apps/eval-runner/src/recorded-judge.js');const scored=await runRecordedJudge(result.bundle,configuredRecordedJudge(),{judgeVersion:process.env.EVAL_JUDGE_VERSION,checkpoint:j=>atomicPrivateJson(join(directory,'judgements.json'),j)});await atomicPrivateJson(join(directory,'score-report.json'),scored.report);}
    if(result.report.status!=='observations_collected')process.exitCode=1;
  }
}catch(error){const failure=/^[A-Z_]{1,80}$/.test(error.message)?error.message:'EVALUATION_BATCH_FAILED';if(directory)await atomicPrivateJson(join(directory,'batch-failure.json'),{failure,content_scored:false});console.error(failure);process.exitCode=1;}
finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
