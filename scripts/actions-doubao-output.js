import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {runOutputProbe} from '../packages/provider-doubao/output-probe.js';
const controller=new AbortController();
const abort=()=>controller.abort();
process.once('SIGINT',abort);process.once('SIGTERM',abort);
let report;
try{
  if(process.argv.length!==2)throw Error('INVALID_ARGUMENTS');
  const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-connect.profile.json',import.meta.url),'utf8'));
  const request=JSON.parse(await readFile(new URL('../.github/live/doubao-output-request.json',import.meta.url),'utf8'));
  report=await runOutputProbe({profile,request,env:process.env,signal:controller.signal});
}catch{
  report={version:1,kind:'live_doubao_output_probe',status:'failed',error:'OUTPUT_PROBE_FAILED',provider_connected:false,
    microphone_uploaded:false,asr_tested:false,model_content_quality_evaluated:false,real_experience_accepted:false};
}finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
await mkdir('.local/doubao-output',{recursive:true});
await writeFile('.local/doubao-output/result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
if(report.status!=='passed')process.exitCode=1;
