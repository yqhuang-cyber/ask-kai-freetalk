import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {runAdapterProbe} from '../packages/provider-doubao/adapter-probe.js';
const controller=new AbortController(),abort=()=>controller.abort();
process.once('SIGINT',abort);process.once('SIGTERM',abort);
let report;
try{
  if(process.argv.length!==2)throw Error('INVALID_ARGUMENTS');
  const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-connect.profile.json',import.meta.url),'utf8'));
  const request=JSON.parse(await readFile(new URL('../.github/live/doubao-adapter-request.json',import.meta.url),'utf8'));
  report=await runAdapterProbe({profile,request,env:process.env,signal:controller.signal});
}catch{
  report={version:1,kind:'live_doubao_adapter_probe',status:'failed',error:'ADAPTER_PROBE_FAILED',
    microphone_uploaded:false,asr_tested:false,model_content_quality_evaluated:false,
    real_experience_accepted:false,web_profile_enabled:false};
}finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
await mkdir('.local/doubao-adapter',{recursive:true});
await writeFile('.local/doubao-adapter/result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;
