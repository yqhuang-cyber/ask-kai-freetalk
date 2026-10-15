import { join } from 'node:path';
import { boundedJson } from '../apps/eval-runner/src/multiturn-plan.js';
import { privateRunDirectory } from '../apps/eval-runner/src/multiturn.js';
import { atomicPrivateJson } from '../apps/eval-runner/src/private-artifacts.js';
import { compareRecordedReviews } from '../apps/eval-runner/src/review-comparison.js';
try {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++)if(['--input','--before','--after','--out'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'))options[args[i].slice(2)]=args[++i];else throw new Error('INVALID_ARGUMENTS');
  if(!options.input||!options.before||!options.after)throw new Error('REVIEW_INPUTS_REQUIRED');
  const [input,before,after]=await Promise.all([boundedJson(options.input),boundedJson(options.before),boundedJson(options.after)]);
  const result=compareRecordedReviews(input.data,before.data,after.data),directory=await privateRunDirectory(options.out);
  for(const [name,data]of [['comparison.json',result.comparison],['before-report.json',result.before_report],['after-report.json',result.after_report]])await atomicPrivateJson(join(directory,name),data);
  console.log(JSON.stringify({changed_units:result.comparison.changed_units,coverage:result.after_report.coverage,observations_changed:false,agent_changed:false,human_review_approved:false}));
}catch(error){console.error(/^[A-Z_]{1,80}$/.test(error.message)?error.message:'REVIEW_COMPARISON_FAILED');process.exitCode=1;}
