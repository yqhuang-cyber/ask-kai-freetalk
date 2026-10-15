import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BASELINE_PATH } from '../apps/eval-runner/src/eval-baseline.js';
import { createEvaluationCandidate,verifyEvaluationCandidate,compareAgentReports } from '../apps/eval-runner/src/eval-candidate.js';
import { DEFAULT_PREPARED_DATASET,boundedJson } from '../apps/eval-runner/src/multiturn-plan.js';
import { privateRunDirectory } from '../apps/eval-runner/src/multiturn.js';
import { atomicPrivateJson } from '../apps/eval-runner/src/private-artifacts.js';
try {
  const [command,...args]=process.argv.slice(2),opt={};
  for(let i=0;i<args.length;i++)if(['--manifest','--agent-revision','--parent-revision','--allow','--before','--after','--out'].includes(args[i])&&opt[args[i]]===undefined&&args[i+1]&&!args[i+1].startsWith('--'))opt[args[i]]=args[++i];else throw new Error('INVALID_ARGUMENTS');
  if(command==='compare') {
    if(!opt['--before']||!opt['--after'])throw new Error('COMPARISON_INPUTS_REQUIRED');
    const before=(await boundedJson(opt['--before'])).data,after=(await boundedJson(opt['--after'])).data;
    const result=compareAgentReports(before,after),dir=await privateRunDirectory(opt['--out']);await atomicPrivateJson(join(dir,'comparison.json'),result);
    console.log(JSON.stringify({status:'compared',...result.counts,human_review_approved:false}));
  }else {
    const baseline=JSON.parse(await readFile(BASELINE_PATH)),inputs={baseline,dataBytes:await readFile(DEFAULT_PREPARED_DATASET),profileBytes:await readFile('docs/protocol/seeduplex-connect.profile.json')};
    if(command==='freeze') {
      if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('CANDIDATE_WORKTREE_NOT_CLEAN');
      const candidate=await createEvaluationCandidate({...inputs,agentRevision:opt['--agent-revision']??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),parentRevision:opt['--parent-revision']??baseline.agent_revision,allowedRuntimeChanges:opt['--allow']?.split(',')??[]});
      const dir=await privateRunDirectory(opt['--out']);await atomicPrivateJson(join(dir,'candidate.json'),candidate);console.log(JSON.stringify({status:'candidate_frozen',agent_revision:candidate.agent_revision,runtime_digest:candidate.runtime_digest,changed_files:candidate.allowed_runtime_changes,live_calls:0}));
    }else if(command==='verify'&&opt['--manifest']) {
      const candidate=(await boundedJson(opt['--manifest'])).data;console.log(JSON.stringify(await verifyEvaluationCandidate({...inputs,candidate})));
    }else throw new Error('INVALID_CANDIDATE_COMMAND');
  }
}catch(error){console.error(/^[A-Z_]{1,80}$/.test(error.message)?error.message:'CANDIDATE_EVALUATION_FAILED');process.exitCode=1;}
