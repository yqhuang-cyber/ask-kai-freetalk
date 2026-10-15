import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FC_INPUT_CASES } from './prepare-fc-probe-inputs.js';
import { loadProfile } from '../packages/provider-doubao/probe.js';
import { runFcPlanningProbe } from '../packages/provider-doubao/fc-planning-probe.js';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { configuredPlanner,plannerDescriptor } from '../packages/agent-core/planner-port.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
let backend;
try {
  const args=process.argv.slice(2),selected=args.find(a=>a.startsWith('--case='))?.slice(7)??'chat';
  if(args.some(a=>a!=='--all'&&a!=='--rule-planner'&&!a.startsWith('--case='))||!Object.hasOwn(FC_INPUT_CASES,selected))throw new Error('INVALID_FC_ARGUMENT');
  const manifest=JSON.parse(await readFile('.local/fc-probe-inputs/manifest.json')),profile=await loadProfile(process.env.DOUBAO_REALTIME_PROFILE),planner=args.includes('--rule-planner')?null:configuredPlanner();
  backend=await startMockBackend();const cases=[],transport=[];
  if(planner)planner.observe=r=>transport.push(r);
  for(const id of args.includes('--all')?Object.keys(FC_INPUT_CASES):[selected]) {
    const entry=manifest.entries.find(e=>e.id===id);
    if(!entry||entry.path!==id+'.pcm'||entry.script_sha256!==hash(FC_INPUT_CASES[id]))throw new Error('INVALID_FC_INPUT_MANIFEST');
    const pcm=await readFile('.local/fc-probe-inputs/'+entry.path),identity=backend.bridge.verify(await backend.pocPort.issue(),'session:create');
    const initializer=new ConversationInitializer({port:backend.planningPort,planner}),bound=new Preparations({initializer}).bind(await initializer.prepare({mode:'topic',topic_id:'sports'},identity),'fc-probe-'+id);
    const s=new TeachingSession({sessionId:bound.plan.session_id,mode:'sports',planning:bound,planner});
    const report=await runFcPlanningProbe({profile,pcm,manifest:{...manifest,...entry},planTurn:async(final,{signal})=> {
      const e={version:1,event_id:'fc-input-'+id,session_id:s.sessionId,seq:1,at_ms:0,turn_id:'fc-turn-'+id,type:'user.final',payload:{text:final.text}};
      const abort=()=>s.planning.invalidate('probe_cancelled');signal.addEventListener('abort',abort,{once:true});
      try{if(signal.aborted)return null;s.accept(e);return await s.planTurn(e);}finally{signal.removeEventListener('abort',abort);}
    }});
    s.finalize({businessSource:'mock_hskai'});cases.push({id,initial_planner:bound.plan.planner_kind,initial_degraded_reason:bound.plan.degraded_reason,...report});console.error(id+': '+report.status+' / '+report.ended);
  }
  const sourceFiles=['scripts/fc-planning-probe.js','packages/provider-doubao/fc-planning-probe.js','packages/agent-core/planner-port.js','packages/agent-core/planner-draft.js','packages/agent-core/planner-full-contract.js','packages/provider-minimax/planner.js','packages/agent-core/planning-state.js'];
  const source_hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,hash(await readFile(p))])));
  console.log(JSON.stringify({version:'fc-planning-experiment-v2',source_hashes,planner:plannerDescriptor(planner),transport,rule_planner_mode:args.includes('--rule-planner'),profile_sha256:hash(JSON.stringify(profile)),input_source:manifest.source,cases,microphone_uploaded:false,browser_audio_tested:false,production_controlled_enabled:false,mandatory_tool_api_verified:false,current_turn_generation_gate_verified:false},null,2));
}catch{console.error('FC_PLANNING_PROBE_FAILED');process.exitCode=1;}
finally{await backend?.close();}
