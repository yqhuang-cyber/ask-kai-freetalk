import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadProfile } from '../packages/provider-doubao/probe.js';
import { DEFAULT_PREPARED_DATASET,boundedJson,selectCases,readAudioManifest } from '../apps/eval-runner/src/multiturn-plan.js';
import { runPreflight,privateRunDirectory,runMultiturn,writeRunCheckpoint } from '../apps/eval-runner/src/multiturn.js';
import { prepareInputAudio } from '../apps/eval-runner/src/input-audio.js';

function options(args) {
  const out={};
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(['--live','--prepare-audio','--all','--include-language','--help'].includes(key)){if(out[key])throw new Error('DUPLICATE_OPTION');out[key]=true;}
    else if(['--dataset','--case','--limit','--audio-manifest','--profile','--out','--turn-timeout-ms'].includes(key)){
      if(out[key]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw new Error('INVALID_OPTION');out[key]=args[++i];
    }else throw new Error('UNKNOWN_OPTION');
  }
  if(out['--all']&&(out['--case']||out['--limit']))throw new Error('CONFLICTING_SELECTION');
  if(out['--prepare-audio']&&out['--audio-manifest'])throw new Error('CONFLICTING_AUDIO_OPTIONS');
  return out;
}
const controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort());
try {
  const opt=options(process.argv.slice(2));
  if(opt['--help']) {
    console.log('eval:multiturn [--dataset path] [--case id,id | --limit N | --all] [--include-language] [--profile path] [--audio-manifest path] [--prepare-audio] [--live] [--out .local/path] [--turn-timeout-ms 45000]\nDefault: offline preflight, one original case. --live --prepare-audio generates authored input PCM only; --live --audio-manifest path collects actual Agent replies. No Judge, Langfuse, microphone or browser playback.');
  }else {
    const caseIds=opt['--case']?.split(',')??[],limit=opt['--all']?100:opt['--limit']?Number(opt['--limit']):Math.max(1,caseIds.length);
    const timeout=opt['--turn-timeout-ms']?Number(opt['--turn-timeout-ms']):45000;
    if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>120000)throw new Error('INVALID_TURN_TIMEOUT');
    const {data,sha256:datasetHash}=await boundedJson(opt['--dataset']??DEFAULT_PREPARED_DATASET);
    const cases=selectCases(data,{caseIds,limit,includeLanguage:!!opt['--include-language']});
    const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),clean=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()==='';
    const profilePath=opt['--profile']??process.env.DOUBAO_REALTIME_PROFILE;
    const profile=profilePath?await loadProfile(profilePath):null;
    const audio=opt['--audio-manifest']?await readAudioManifest(opt['--audio-manifest'],cases,{datasetSha256:datasetHash}):null;
    const preflight=runPreflight({cases,profile,env:process.env,inputs:audio?.inputs,worktreeClean:clean,prepareAudio:!!opt['--prepare-audio']});
    console.log(JSON.stringify(preflight,null,2));
    if(opt['--live']) {
      if(!preflight.live_eligible)throw new Error('MULTITURN_PREFLIGHT_BLOCKED');
      const directory=await privateRunDirectory(opt['--out']);
      const progress=value=>console.log(JSON.stringify(value));
      if(opt['--prepare-audio']) {
        const manifest=await prepareInputAudio({cases,datasetSha256:datasetHash,profile,env:process.env,signal:controller.signal,directory,onProgress:progress,timeoutMs:timeout});
        console.log(JSON.stringify({status:manifest.status,entries:manifest.entries.length,audio_manifest:join(directory,'audio-manifest.json'),content_scored:false}));
      }else {
        const {report}=await runMultiturn({cases,inputs:audio.inputs,manifestSha256:audio.manifest_sha256,profile,env:process.env,signal:controller.signal,
          candidateRevision:revision,datasetVersion:data.dataset_version,datasetSha256:datasetHash,turnTimeoutMs:timeout,
          onProgress:progress,checkpoint:(observations,report)=>writeRunCheckpoint(directory,observations,report)});
        console.log(JSON.stringify({...report,output_directory:directory},null,2));
        if(report.status!=='observations_collected')process.exitCode=1;
      }
    }
  }
}catch(error){console.error(/^[A-Z_]{1,80}$/.test(error.message)?error.message:'MULTITURN_RUN_FAILED');process.exitCode=1;}
