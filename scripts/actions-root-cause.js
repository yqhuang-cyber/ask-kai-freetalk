import { readFile,mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { SeeduplexProvider } from '../packages/provider-doubao/seeduplex.js';
import { preflight } from '../packages/provider-doubao/probe.js';
import { scopedEvaluationProfile } from '../apps/eval-runner/src/evaluation-batch.js';
import { observeTrialProvider } from '../apps/eval-runner/src/actions-multiturn.js';
import { BASELINE_PATH,verifyEvaluationBaseline } from '../apps/eval-runner/src/eval-baseline.js';
import { DEFAULT_PREPARED_DATASET,sha256 } from '../apps/eval-runner/src/multiturn-plan.js';
import { privateRunDirectory,runMultiturn } from '../apps/eval-runner/src/multiturn.js';
import { atomicPrivateJson } from '../apps/eval-runner/src/private-artifacts.js';
import { validateRootCauseRequest,readRootCauseInputs,trialInputs } from '../apps/eval-runner/src/root-cause-plan.js';
import { summarizeRootCauseRun,compiledContextMetadata } from '../apps/eval-runner/src/root-cause-report.js';

const aborter=new AbortController(),abort=()=>aborter.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
let directory;
try {
  if(process.argv.length!==2||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()||
    execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==process.env.GITHUB_SHA)throw new Error('INVALID_CANDIDATE_REVISION');
  const db=await readFile(DEFAULT_PREPARED_DATASET),pb=await readFile('docs/protocol/seeduplex-connect.profile.json'),data=JSON.parse(db),profile=JSON.parse(pb),baseline=JSON.parse(await readFile(BASELINE_PATH));
  const baselineInfo=await verifyEvaluationBaseline({baseline,dataBytes:db,profileBytes:pb}),request=JSON.parse(await readFile('.github/live/root-cause-request.json'));
  const plan=validateRootCauseRequest(request,{baseline,data,dataSha:sha256(db),profileBytes:pb,env:process.env});
  if(!preflight(profile,process.env).live_eligible)throw new Error('SERVER_CREDENTIAL_REQUIRED');
  directory=await privateRunDirectory('.local/root-cause');await mkdir(join(directory,'trials'),{mode:0o700});
  await atomicPrivateJson(join(directory,'request.json'),{...request,...baselineInfo,runner_revision:process.env.GITHUB_SHA});
  await atomicPrivateJson(join(directory,'plan.json'),plan);
  const sourceInputs=await readRootCauseInputs({data,datasetSha256:sha256(db),directory:'.local/task03-source-fixtures'});
  const signal=AbortSignal.any([aborter.signal,AbortSignal.timeout(request.duration_ms)]),scoped=scopedEvaluationProfile(profile),results=[];
  const report=()=>summarizeRootCauseRun(plan,results,{baselineInfo,runnerRevision:process.env.GITHUB_SHA,datasetSha256:sha256(db)});
  await atomicPrivateJson(join(directory,'root-cause-report.json'),report());
  for(const trial of plan.trials) {
    if(signal.aborted)break;
    const path=join(directory,'trials',trial.trial_id);await mkdir(path,{mode:0o700});
    const inputs=trialInputs(trial,sourceInputs),trialMetadata={...trial};delete trialMetadata.case;
    await atomicPrivateJson(join(path,'trial.json'),{...trialMetadata,initial_profile:trial.case.initial_profile,input_sha256:trial.steps.map(s=>inputs.get(`${trial.case_id}/${s.step}`).sha256)});
    const diagnosticRows=[],compiled=[],providerFactory=ticket=>{
      const provider=observeTrialProvider(new SeeduplexProvider({profile:scoped,env:process.env,protocolProbe:true,speechPace:ticket.speech_pace}),
        {profile:scoped,onDiagnostic:row=>{if(diagnosticRows.length<2048)diagnosticRows.push(row);}});
      const open=provider.open.bind(provider),update=provider.updateContext.bind(provider);
      provider.open=options=>{compiled.push(compiledContextMetadata(options.instructions,1,'session_create'));return open(options);};
      provider.updateContext=options=>{compiled.push(compiledContextMetadata(options.instructions,options.version,'context_request'));return update(options);};
      return provider;
    };
    const decorate=o=>({...o,...baselineInfo,observation_scope:'task03_root_cause_diagnostic',original_baseline_replaced:false,trial:trialMetadata,context_compilations:structuredClone(compiled)});
    const collected=await runMultiturn({cases:[trial.case],inputs,profile:scoped,env:process.env,signal,
      candidateRevision:process.env.GITHUB_SHA,datasetVersion:data.dataset_version,datasetSha256:sha256(db),
      manifestSha256:sha256(Buffer.from(JSON.stringify(trial.steps.map(s=>({source_case_id:s.source_case_id,source_turn:s.source_turn,sha256:inputs.get(`${trial.case_id}/${s.step}`).sha256}))))),
      protocolProbe:true,providerFactory,turnTimeoutMs:45000,
      onProgress:row=>console.log(JSON.stringify({trial_id:trial.trial_id,...row})),
      checkpoint:async(o,r)=>{await atomicPrivateJson(join(path,'observations.json'),decorate(o));await atomicPrivateJson(join(path,'collection-report.json'),r);}});
    const observations=decorate(collected.observations);results.push({trial,observations});
    await atomicPrivateJson(join(path,'protocol-diagnostics.json'),{raw_values_retained:false,truncated:diagnosticRows.length===2048,rows:diagnosticRows});
    await atomicPrivateJson(join(directory,'root-cause-report.json'),report());
    console.log(JSON.stringify({trial_id:trial.trial_id,status:collected.report.status,valid_steps:collected.report.collected_turns}));
  }
  const final=report();await atomicPrivateJson(join(directory,'root-cause-report.json'),final);
  console.log(JSON.stringify({status:final.status,attempted_trials:final.attempted_trials,valid_steps:final.valid_steps,expected_steps:final.expected_steps,agent_changed:false,judge_calls:0}));
  if(final.status!=='diagnostics_collected')process.exitCode=1;
}catch(error){const failure=/^[A-Z_]{1,80}$/.test(error.message)?error.message:'ROOT_CAUSE_DIAGNOSTIC_FAILED';if(directory)await atomicPrivateJson(join(directory,'failure.json'),{failure,agent_changed:false,original_baseline_replaced:false});console.error(failure);process.exitCode=1;}
finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
