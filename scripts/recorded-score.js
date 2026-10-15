import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boundedJson,DEFAULT_PREPARED_DATASET } from '../apps/eval-runner/src/multiturn-plan.js';
import { adaptRecordedObservations,reviewTemplate,evaluateRecorded } from '../apps/eval-runner/src/recorded-scoring.js';
import { privateRunDirectory } from '../apps/eval-runner/src/multiturn.js';
import { atomicPrivateJson } from '../apps/eval-runner/src/private-artifacts.js';
try {
  const args=process.argv.slice(2),opts={};
  for(let i=0;i<args.length;i++){const a=args[i];if(a==='--live-judge')opts.live=true;else if(['--observations','--judgements','--out','--cases'].includes(a)&&args[i+1]&&!args[i+1].startsWith('--'))opts[a.slice(2)]=args[++i];else throw new Error('INVALID_ARGUMENTS');}
  if(!opts.observations||opts.live&&opts.judgements)throw new Error('OBSERVATIONS_REQUIRED');
  const {data,sha256:datasetSha256}=await boundedJson(DEFAULT_PREPARED_DATASET);
  const observations=[];for(const path of opts.observations.split(','))observations.push((await boundedJson(path)).data);
  const bundle=adaptRecordedObservations(data,observations,{datasetSha256,caseIds:opts.cases?.split(',')??[]});
  const directory=await privateRunDirectory(opts.out);await atomicPrivateJson(join(directory,'scoring-input.json'),bundle);
  let judgements=opts.judgements?(await boundedJson(opts.judgements)).data:reviewTemplate(bundle);
  if(opts.live){const {configuredRecordedJudge,runRecordedJudge}=await import('../apps/eval-runner/src/recorded-judge.js');const result=await runRecordedJudge(bundle,configuredRecordedJudge(),{judgeVersion:process.env.EVAL_JUDGE_VERSION,checkpoint:j=>atomicPrivateJson(join(directory,'judgements.json'),j)});judgements=result.judgements;}
  await atomicPrivateJson(join(directory,'judgements.json'),judgements);
  const report=evaluateRecorded(bundle,judgements);await atomicPrivateJson(join(directory,'score-report.json'),report);
  console.log(JSON.stringify({status:report.complete_scoring?'scored':'review_pending',coverage:report.coverage,content_scored:report.content_scored,real_experience_accepted:false}));
}catch(error){console.error(/^[A-Z_]{1,80}$/.test(error.message)?error.message:'RECORDED_SCORING_FAILED');process.exitCode=1;}
