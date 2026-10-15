import { readFile } from 'node:fs/promises';
import { evaluateP0,runP0Judge } from '../apps/eval-runner/src/p0.js';
try {
  const args=process.argv.slice(2);
  const load=async path=>{const bytes=await readFile(path);if(bytes.length>2000000)throw new Error('P0_INPUT_TOO_LARGE');return JSON.parse(bytes);};
  if(args.length===1 && args[0]==='--demo') {
    const {p0Demo}=await import('../apps/eval-runner/src/p0-demo.js');const report=await p0Demo();
    console.log(JSON.stringify(report,null,2));if(!report.fixture_regression_passed)process.exitCode=1;
  }else {
    if(args.length!==2 || args[0].startsWith('--') || (args[1].startsWith('--') && args[1]!=='--live-judge'))throw new Error('P0_INPUTS_REQUIRED');
    const dataset=await load(args[0]);let report;
    if(args[1]==='--live-judge') {
      const {configuredLangChainJudge}=await import('../apps/eval-runner/src/langchain-judge.js');
      report=await runP0Judge(dataset,configuredLangChainJudge(process.env,{p0:true}),{judgeVersion:process.env.EVAL_JUDGE_VERSION});
    }else report=evaluateP0(dataset,await load(args[1]));
    console.log(JSON.stringify(report,null,2));
    if(report.blocked || report.needs_review || report.p0.status!=='passed')process.exitCode=1;
  }
}catch{console.error('P0_EVAL_FAILED');process.exitCode=1;}
