import { PLANNING_VERSION } from '../packages/contracts/planning.js';
import { readFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { learnerFixture,SPORTS_RESOURCE,missionResource } from '../apps/hskai-mock/src/planning-fixtures.js';
import { MOCK_IDENTITY,MOCK_MISSION } from '../apps/hskai-mock/src/server.js';
import { ConversationInitializer,normalizeEntry } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { TURN_PLANNING_BUDGET_MS } from '../packages/agent-core/planning-state.js';
import { configuredPlanner,PLANNER_PROMPT_VERSION,plannerDescriptor } from '../packages/agent-core/planner-port.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
async function sourceHashes(dir) {
  const out={};for(const item of await readdir(dir,{withFileTypes:true})){const path=`${dir}/${item.name}`;if(item.isDirectory()){if(item.name!=='node_modules')Object.assign(out,await sourceHashes(path));}else if(item.name.endsWith('.js'))out[path]=hash(await readFile(path));}return out;
}
const live=process.argv.includes('--live');
const probe=process.argv.includes('--probe');
try {
  if(process.argv.slice(2).some(v=>!['--live','--probe'].includes(v))||probe&&!live)throw new Error('INVALID_PLANNING_EVAL_ARGUMENT');
  const baseline=JSON.parse(await readFile('docs/eval-baselines/dynamic-planning-v1-baseline.json'));
  if(hash(await readFile(baseline.dataset.path))!==baseline.dataset.sha256)throw new Error('FROZEN_DATASET_CHANGED');
  const planner=live?configuredPlanner():null;if(live&&!planner)throw new Error('MINIMAX_PLANNER_CONFIG_REQUIRED');
  const identity={...MOCK_IDENTITY,mission:MOCK_MISSION,scopes:['session:create','context:read','curriculum:read','learning:write'],authorization_until:Date.now()+600000};
  const cases=[],transport=[];if(planner)planner.observe=row=>{if(transport.length<48)transport.push(row);};
  // Independent synthetic learner fixtures, separate from old content scores.
  // No author reference or future turn is supplied to the planner.
  const variants=probe?['a']:live?['a','b']:['a','b','c','d','e'];
  for(const variant of variants)for(const mode of probe?['sports']:['sports','mission','free']) {
    const port={read:async i=>learnerFixture(i,{variant}),getResource:async(i,e)=>e.mode==='free'?null:e.mode==='mission'?missionResource(i.mission):SPORTS_RESOURCE};
    const initializer=new ConversationInitializer({port,planner,budgetMs:15000}),entry=normalizeEntry({mode,...(mode==='mission'?{mission_id:MOCK_MISSION.id}:{})},identity);
    const start=performance.now();let result;
    try{result=await initializer.prepare(entry,identity);}catch{cases.push({fixture:variant,mode,contract_valid:false,status:'initialization_failed_or_deadline',elapsed_ms:Math.round(performance.now()-start),plan_quality:null,execution_control_verified:false,content_score:null});continue;}
    const bound=new Preparations({initializer}).bind(result,`eval-${variant}-${mode}`);
    const teaching=new TeachingSession({sessionId:bound.plan.session_id,mode,mission:identity.mission,planning:bound,planner});
    const e={version:1,event_id:`input-${variant}-${mode}`,session_id:bound.plan.session_id,seq:1,at_ms:0,type:'user.final',turn_id:'turn-1',payload:{text:mode==='free'?'今天想聊宇宙。':'我喜欢篮球。'}};
    teaching.accept(e);const turn=await teaching.planTurn(e);
    cases.push({fixture:variant,mode,contract_valid:true,initial_planner:bound.plan.planner_kind,initial_degraded:!!bound.plan.degraded_reason,turn_planner:turn?.planner_kind??null,turn_degraded:turn?!!turn.degraded_reason:null,initial_goal:bound.plan.primary_goal?.id??null,free_goal_empty:mode==='free'?bound.plan.primary_goal===null&&bound.plan.key_points.length===0:null,elapsed_ms:Math.round(performance.now()-start),plan_quality:null,execution_control_verified:false,content_score:null,learning_assessment:null});
    teaching.finalize({businessSource:'mock_hskai'});
  }
  const source_hashes={...await sourceHashes('packages'),...await sourceHashes('apps'),...await sourceHashes('scripts')};
  console.log(JSON.stringify({schema_version:'planning-eval-v1',baseline_commit:baseline.legacy_commit,candidate:{source_hashes,planner_profile:plannerDescriptor(planner),prompt:plannerDescriptor(planner).prompt,contract:PLANNING_VERSION,path:'next_turn_advisory'},input:'synthetic_mock_fixtures',probe_only:probe,budgets:{initial_ms:15000,turn_ms:TURN_PLANNING_BUDGET_MS},model_calls_enabled:live,transport,real_provider_connected:false,browser_audio_tested:false,contains_transcripts:false,case_count:cases.length,cases,quality_acceptance:false,unverified:['MiniMax semantic calibration','current-turn generation gate','real duplex and browser audio','latency and cost thresholds']},null,2));
}catch(error){console.error(['MINIMAX_PLANNER_CONFIG_REQUIRED','FROZEN_DATASET_CHANGED','INVALID_PLANNING_EVAL_ARGUMENT'].includes(error.message)?error.message:'PLANNING_EVAL_FAILED');process.exitCode=1;}
