import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BASELINE_PATH,verifyEvaluationBaseline } from '../apps/eval-runner/src/eval-baseline.js';
import { DEFAULT_PREPARED_DATASET,sha256 } from '../apps/eval-runner/src/multiturn-plan.js';
import { privateRunDirectory } from '../apps/eval-runner/src/multiturn.js';
import { atomicPrivateJson } from '../apps/eval-runner/src/private-artifacts.js';
import { runEvaluationBatch } from '../apps/eval-runner/src/evaluation-batch.js';
import { validateDiagnosticRequest,summarizeCollectionEvidence } from '../apps/eval-runner/src/collection-diagnostic.js';

const aborter=new AbortController(),abort=()=>aborter.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
let directory;
try {
  if(process.argv.length!==2||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()||
    execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==process.env.GITHUB_SHA)throw new Error('INVALID_CANDIDATE_REVISION');
  const dataBytes=await readFile(DEFAULT_PREPARED_DATASET),profileBytes=await readFile('docs/protocol/seeduplex-connect.profile.json');
  const data=JSON.parse(dataBytes),profile=JSON.parse(profileBytes),baseline=JSON.parse(await readFile(BASELINE_PATH));
  const request=JSON.parse(await readFile('.github/live/collection-diagnostic-request.json'));
  const baselineInfo=await verifyEvaluationBaseline({baseline,dataBytes,profileBytes});
  const cases=validateDiagnosticRequest(request,{baseline,data,dataSha:sha256(dataBytes),profileBytes,env:process.env});
  directory=await privateRunDirectory('.local/collection-diagnostic');
  await atomicPrivateJson(join(directory,'diagnostic-request.json'),{...request,...baselineInfo,runner_revision:process.env.GITHUB_SHA,
    observation_scope:'task02_independent_diagnostic',historical_baseline_replaced:false,pacing_changed:false});
  const result=await runEvaluationBatch({data,dataSha:sha256(dataBytes),cases,profile,env:process.env,directory,baselineInfo,observationScope:'task02_independent_diagnostic',
    signal:AbortSignal.any([aborter.signal,AbortSignal.timeout(request.duration_ms)]),onProgress:row=>console.log(JSON.stringify(row))});
  result.observations.observation_scope='task02_independent_diagnostic';result.observations.historical_baseline_replaced=false;
  await atomicPrivateJson(join(directory,'observations.json'),result.observations);
  const report=summarizeCollectionEvidence(result.observations);await atomicPrivateJson(join(directory,'diagnostic-report.json'),report);
  console.log(JSON.stringify({status:result.report.status,collected_turns:report.collected_turns,expected_turns:report.expected_turns,
    historical_baseline_replaced:false,agent_changed:false,judge_calls:0}));
  // An incomplete observation is a retained diagnostic outcome, not a workflow
  // infrastructure success masquerading as a completed conversation.
  if(result.report.status!=='observations_collected')process.exitCode=1;
}catch(error){
  const failure=/^[A-Z_]{1,80}$/.test(error.message)?error.message:'COLLECTION_DIAGNOSTIC_FAILED';
  if(directory)await atomicPrivateJson(join(directory,'diagnostic-failure.json'),{failure,content_scored:false});
  console.error(failure);process.exitCode=1;
}finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
