import { readFile } from 'node:fs/promises';
import { evaluateContent,runJudge } from '../apps/eval-runner/src/content.js';
import { exportLangfuseScores } from '../apps/eval-runner/src/langfuse.js';
try {
  const args=process.argv.slice(2),demo=args[0]==='--demo',upload=args.includes('--langfuse'),live=args.includes('--live-judge');
  if(demo && live)throw new Error('DEMO_MUST_REMAIN_OFFLINE');
  if(!demo && (!args[0] || (!live && !args[1])))throw new Error('EVAL_INPUTS_REQUIRED');
  const load=async path=>{const bytes=await readFile(path);if(bytes.length>2000000)throw new Error('EVAL_INPUT_TOO_LARGE');return JSON.parse(bytes);};
  const dataset=await load(demo?new URL('../tests/fixtures/content-cases.json',import.meta.url):args[0]);
  let report;
  if(live) {
    const {configuredLangChainJudge}=await import('../apps/eval-runner/src/langchain-judge.js');
    report=await runJudge(dataset,configuredLangChainJudge(),{judgeVersion:process.env.EVAL_JUDGE_VERSION});
  } else {
    const judgements=await load(demo?new URL('../tests/fixtures/content-judgements.json',import.meta.url):args[1]);
    report=evaluateContent(dataset,judgements);
  }
  console.log(JSON.stringify(report,null,2));
  if(upload) {
    const traceIds=await load(process.env.LANGFUSE_TRACE_MAP);
    const result=await exportLangfuseScores({report,baseUrl:process.env.LANGFUSE_BASE_URL,publicKey:process.env.LANGFUSE_PUBLIC_KEY,secretKey:process.env.LANGFUSE_SECRET_KEY,runId:process.env.EVAL_RUN_ID,traceIds});
    console.log(JSON.stringify(result));
  }
  if(report.blocked || report.needs_review)process.exitCode=1;
}catch{console.error('CONTENT_EVAL_FAILED');process.exitCode=1;}
