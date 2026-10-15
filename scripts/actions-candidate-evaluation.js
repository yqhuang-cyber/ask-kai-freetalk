import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BASELINE_PATH,planEvaluationBatches } from '../apps/eval-runner/src/eval-baseline.js';
import { createEvaluationCandidate,verifyEvaluationCandidate } from '../apps/eval-runner/src/eval-candidate.js';
import { DEFAULT_PREPARED_DATASET,sha256,selectCases } from '../apps/eval-runner/src/multiturn-plan.js';
import { privateRunDirectory } from '../apps/eval-runner/src/multiturn.js';
import { atomicPrivateJson } from '../apps/eval-runner/src/private-artifacts.js';
import { runEvaluationBatch } from '../apps/eval-runner/src/evaluation-batch.js';
const controller=new AbortController();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort());
let directory;
try {
  const [batchId,...extra]=process.argv.slice(2);if(extra.length||!/^batch-0[1-8]$/.test(batchId??''))throw new Error('INVALID_BATCH_ARGUMENT');
  const dirty=execFileSync('git',['status','--porcelain','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  // Only exact runtime restoration from a declared commit is permitted. The
  // candidate byte/file-set verification below still rejects drift.
  if(process.env.GITHUB_REF!=='refs/heads/main'||dirty.some(r=>!/^ [MD] (?:packages|apps\/(?:realtime-gateway|hskai-mock))\//.test(r))||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==process.env.GITHUB_SHA)throw new Error('INVALID_CANDIDATE_REVISION');
  const dataBytes=await readFile(DEFAULT_PREPARED_DATASET),profileBytes=await readFile('docs/protocol/seeduplex-connect.profile.json'),data=JSON.parse(dataBytes),profile=JSON.parse(profileBytes),baseline=JSON.parse(await readFile(BASELINE_PATH));
  const request=JSON.parse(await readFile('.github/live/candidate-evaluation-request.json'));
  const keys=['version','kind','request_id','stage','agent_revision','parent_agent_revision','allowed_runtime_changes','dataset_sha256','profile_sha256','batch_count','duration_ms','case_ids','rerun_of','input_fixture_run'];
  const fixtureRun=request.input_fixture_run??null;
  if(request.version!==1||request.kind!=='ask_kai_candidate_evaluation'||!/^candidate-\d{4}-\d{2}-\d{2}-\d{2}$/.test(request.request_id??'')||!/^05-0[1-9]$/.test(request.stage??'')||request.dataset_sha256!==sha256(dataBytes)||request.profile_sha256!==sha256(profileBytes)||!Number.isSafeInteger(request.batch_count)||request.batch_count<1||request.batch_count>8||request.duration_ms!==1200000||!Array.isArray(request.case_ids)||Object.keys(request).some(k=>!keys.includes(k))||request.rerun_of!==null&&!Number.isSafeInteger(request.rerun_of)||fixtureRun!==null&&(!Number.isSafeInteger(fixtureRun)||fixtureRun<1))throw new Error('INVALID_CANDIDATE_REQUEST');
  const files=()=>execFileSync('git',['ls-tree','-r','--name-only',request.agent_revision,'--','packages','apps/realtime-gateway','apps/hskai-mock'],{encoding:'utf8'}).trim().split('\n');
  const candidate=await createEvaluationCandidate({baseline,agentRevision:request.agent_revision,parentRevision:request.parent_agent_revision,allowedRuntimeChanges:request.allowed_runtime_changes,dataBytes,profileBytes,files});
  const info=await verifyEvaluationCandidate({candidate,baseline,dataBytes,profileBytes,files});
  const batches=planEvaluationBatches(data,{caseIds:request.case_ids,batchCount:request.batch_count}),batch=batches.find(b=>b.id===batchId);
  if(!batch)console.log(JSON.stringify({status:'empty_batch',batch_id:batchId}));
  else {
    directory=await privateRunDirectory('.local/candidate-evaluation');
    await atomicPrivateJson(join(directory,'candidate.json'),candidate);await atomicPrivateJson(join(directory,'request.json'),{...request,...info,runner_revision:process.env.GITHUB_SHA,batch_id:batchId,case_ids:batch.case_ids});
    const result=await runEvaluationBatch({data,dataSha:sha256(dataBytes),cases:selectCases(data,{includeLanguage:true,limit:100,caseIds:batch.case_ids}),profile,env:process.env,directory,baselineInfo:info,observationScope:'candidate_collection',replayInputsRoot:fixtureRun?'.local/candidate-input-fixtures':null,
      signal:AbortSignal.any([controller.signal,AbortSignal.timeout(request.duration_ms)]),onProgress:row=>console.log(JSON.stringify(row))});
    console.log(JSON.stringify(result.report));if(result.report.status!=='observations_collected')process.exitCode=1;
  }
}catch(error){const failure=/^[A-Z_]{1,80}$/.test(error.message)?error.message:'CANDIDATE_COLLECTION_FAILED';if(directory)await atomicPrivateJson(join(directory,'failure.json'),{failure,content_scored:false});console.error(failure);process.exitCode=1;}
