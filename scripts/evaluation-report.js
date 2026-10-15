import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boundedJson,DEFAULT_PREPARED_DATASET } from '../apps/eval-runner/src/multiturn-plan.js';
import { privateRunDirectory } from '../apps/eval-runner/src/multiturn.js';
import { atomicPrivateJson } from '../apps/eval-runner/src/private-artifacts.js';
import { fullEvaluationReport } from '../apps/eval-runner/src/evaluation-report.js';
try {
  const args=process.argv.slice(2),opts={};for(let i=0;i<args.length;i++){if(['--observations','--judgements','--out','--replacement-runs'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'))opts[args[i].slice(2)]=args[++i];else throw new Error('INVALID_ARGUMENTS');}
  if(!opts.observations)throw new Error('OBSERVATIONS_REQUIRED');
  const {data,sha256:datasetSha256}=await boundedJson(DEFAULT_PREPARED_DATASET),observations=[];
  for(const path of opts.observations.split(','))observations.push((await boundedJson(path)).data);
  const result=fullEvaluationReport(data,observations,{datasetSha256,judgements:opts.judgements?(await boundedJson(opts.judgements)).data:undefined,
    replacementRunIds:opts['replacement-runs']?.split(',')??[],agentRevision:observations[0].agent_revision,runtimeDigest:observations[0].runtime_digest,verificationKind:observations[0].evaluation_contract_kind==='candidate'?'candidate':'baseline'});
  const directory=await privateRunDirectory(opts.out);for(const [name,value] of [['scoring-input.json',result.bundle],['judgements.json',result.judgements],['score-report.json',result.report]])await atomicPrivateJson(join(directory,name),value);
  await writeFile(join(directory,'report.md'),result.markdown,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({coverage:result.report.coverage,complete_scoring:result.report.complete_scoring,content_scored:result.report.content_scored,real_experience_accepted:false}));
}catch(error){console.error(/^[A-Z_]{1,80}$/.test(error.message)?error.message:'EVALUATION_REPORT_FAILED');process.exitCode=1;}
