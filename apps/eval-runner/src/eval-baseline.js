import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { sha256,selectCases } from './multiturn-plan.js';

export const BASELINE_PATH='docs/eval-baselines/freechat-v3.1-baseline.json';
export async function verifyEvaluationBaseline({baseline,dataBytes,profileBytes,read=readFile,
  files=()=>execFileSync('git',['ls-files','packages','apps/realtime-gateway','apps/hskai-mock'],{encoding:'utf8'}).trim().split('\n')}={}) {
  if(baseline?.kind!=='ask-kai-evaluation-baseline'||baseline.version!==1||!/^[a-f0-9]{40}$/.test(baseline.agent_revision??'')||!baseline.runtime_files||!Object.keys(baseline.runtime_files).length)throw new Error('INVALID_AGENT_BASELINE');
  if(sha256(dataBytes)!==baseline.dataset_sha256||sha256(profileBytes)!==baseline.profile_sha256)throw new Error('EVALUATION_INPUT_DRIFT');
  const actual=files().sort(),expected=Object.keys(baseline.runtime_files).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('AGENT_FILE_SET_DRIFT');
  for(const path of expected)if(sha256(await read(path))!==baseline.runtime_files[path])throw new Error('AGENT_RUNTIME_DRIFT');
  const pkg=JSON.parse(await read('package.json','utf8'));
  if(JSON.stringify(pkg.dependencies)!==JSON.stringify(baseline.dependencies)||sha256(await read('package-lock.json'))!==baseline.lock_sha256)throw new Error('AGENT_DEPENDENCY_DRIFT');
  const profile=JSON.parse(profileBytes),data=JSON.parse(dataBytes);
  if(profile.session_create.session.model!==baseline.model_version||data.dataset_version!==baseline.dataset_version)throw new Error('AGENT_VERSION_DRIFT');
  return {agent_revision:baseline.agent_revision,runtime_digest:sha256(Buffer.from(JSON.stringify(baseline.runtime_files))),baseline_verified:true};
}

export function planEvaluationBatches(data,{batchCount=8,caseIds=[]}={}) {
  if(!Number.isInteger(batchCount)||batchCount<1||batchCount>16)throw new Error('INVALID_BATCH_COUNT');
  const cases=selectCases(data,{includeLanguage:true,limit:100,caseIds});
  const batches=Array.from({length:Math.min(batchCount,cases.length)},(_,i)=>({id:`batch-${String(i+1).padStart(2,'0')}`,case_ids:[],turns:0}));
  // Largest cases first balances time; order within each case remains unchanged.
  for(const c of [...cases].sort((a,b)=>b.turns.length-a.turns.length)) {
    const b=[...batches].sort((a,b)=>a.turns-b.turns||a.id.localeCompare(b.id))[0];b.case_ids.push(c.id);b.turns+=c.turns.length;
  }
  return batches;
}
