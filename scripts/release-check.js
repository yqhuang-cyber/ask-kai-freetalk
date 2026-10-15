import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { releaseStatus } from '../packages/policy/release.js';
try {
  const args=process.argv.slice(2);
  const load=async path=>{if(!path)return null;const bytes=await readFile(path);if(bytes.length>2000000)throw new Error('OVERSIZED');return JSON.parse(bytes);};
  const evidence=await load(process.env.ASK_KAI_RELEASE_EVIDENCE),report=await load(process.env.ASK_KAI_CONTENT_REPORT);
  const revision=process.env.ASK_KAI_CANDIDATE_REVISION ?? execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const status=releaseStatus(evidence,report,{revision});console.log(JSON.stringify(status,null,2));
  if(args.includes('--require-ready') && !status.ready)process.exitCode=1;
}catch{console.error('RELEASE_CHECK_FAILED');process.exitCode=1;}
