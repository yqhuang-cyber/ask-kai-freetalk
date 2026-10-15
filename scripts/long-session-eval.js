import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluateLongSession } from '../apps/eval-runner/src/long-session.js';
const bytes=await readFile('docs/eval-datasets/agent-long-session-v2/cases.json'),dataset=JSON.parse(bytes),cases=[];
for(const c of dataset.cases)cases.push(await evaluateLongSession(c));
const report={version:'agent-long-session-eval-v2',dataset_sha256:createHash('sha256').update(bytes).digest('hex'),synthetic_inputs:true,synthetic_output_events:true,real_provider_connected:false,model_calls_enabled:false,cases,denominators:{sessions:cases.length,turns:cases.reduce((n,c)=>n+c.turns.length,0),passed_turns:cases.reduce((n,c)=>n+c.turns.filter(t=>t.passed).length,0)},semantic_quality_accepted:false};
console.log(JSON.stringify(report,null,2));if(report.denominators.turns!==report.denominators.passed_turns)process.exitCode=1;
