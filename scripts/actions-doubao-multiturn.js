import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { boundedJson,DEFAULT_PREPARED_DATASET } from '../apps/eval-runner/src/multiturn-plan.js';
import { privateRunDirectory } from '../apps/eval-runner/src/multiturn.js';
import { atomicPrivateJson } from '../apps/eval-runner/src/private-artifacts.js';
import { runActionsTrial } from '../apps/eval-runner/src/actions-multiturn.js';

const controller=new AbortController(),abort=()=>controller.abort();
process.once('SIGINT',abort);process.once('SIGTERM',abort);
let report,directory;
try {
  if(process.argv.length!==2)throw new Error('INVALID_ARGUMENTS');
  if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()||
    execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==process.env.GITHUB_SHA)throw new Error('INVALID_CANDIDATE_REVISION');
  const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-connect.profile.json',import.meta.url),'utf8'));
  const request=JSON.parse(await readFile(new URL('../.github/live/doubao-multiturn-request.json',import.meta.url),'utf8'));
  const {data,sha256:datasetSha256}=await boundedJson(DEFAULT_PREPARED_DATASET);
  directory=await privateRunDirectory('.local/doubao-multiturn');
  report=await runActionsTrial({profile,request,data,datasetSha256,env:process.env,signal:controller.signal,directory,
    onProgress:row=>console.log(JSON.stringify(row))});
}catch(error){report={version:1,kind:'ask-kai-actions-multiturn-trial',status:'failed',
  failure:/^[A-Z_]{1,80}$/.test(error.message)?error.message:'MULTITURN_TRIAL_FAILED',
  content_scored:false,judge_calls:0,real_experience_accepted:false,web_profile_enabled:false};}
finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
if(directory)await atomicPrivateJson(directory+'/trial-report.json',report);
console.log(JSON.stringify(report,null,2));
if(report.status!=='observations_collected')process.exitCode=1;
