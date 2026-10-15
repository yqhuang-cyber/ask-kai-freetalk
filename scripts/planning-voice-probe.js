import { createHash } from 'node:crypto';
import { loadProfile,runProbe } from '../packages/provider-doubao/probe.js';
import { validateDoubaoRealtimeProfile } from '../packages/provider-doubao/seeduplex.js';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { ConversationInitializer,normalizeEntry } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { configuredPlanner } from '../packages/agent-core/planner-port.js';
let backend,stage='configuration';
try {
  if(process.argv.slice(2).length||!process.env.DOUBAO_REALTIME_PROFILE)throw new Error('VOICE_PROFILE_REQUIRED');
  const source=await loadProfile(process.env.DOUBAO_REALTIME_PROFILE);validateDoubaoRealtimeProfile(source);
  const planner=configuredPlanner();if(!planner)throw new Error('MINIMAX_PLANNER_CONFIG_REQUIRED');
  stage='mock_backend';backend=await startMockBackend();const identity=backend.bridge.verify(await backend.pocPort.issue(),'session:create');
  stage='initialization';
  const initializer=new ConversationInitializer({port:backend.planningPort,planner}),result=await initializer.prepare(normalizeEntry({mode:'free'},identity),identity);
  const planning=new Preparations({initializer}).bind(result,'planning-voice-probe');
  const teaching=new TeachingSession({sessionId:'planning-voice-probe',mode:'free',planning,memory:identity.memory});
  const snapshot=teaching.contextSnapshot(),profile=structuredClone(source);profile.session_create.session.instructions=snapshot.instructions;
  const accepted_at=Date.now(),requested_at=Date.now();
  stage='voice_connection';const report=await runProbe({profile,durationMs:5000,maxFrames:64});
  console.log(JSON.stringify({scope:'free_initial_context_connection_only',input:'synthetic_mock_context',microphone_uploaded:false,voice_output_tested:false,browser_audio_tested:false,current_turn_generation_gate_verified:false,initial_plan_hash:planning.plan.hash,context_hash:snapshot.hash,source_profile_hash:createHash('sha256').update(JSON.stringify(source)).digest('hex'),initial_planner:planning.plan.planner_kind,degraded:!!planning.plan.degraded_reason,accepted_before_connection_request:accepted_at<=requested_at,connection:report,quality_acceptance:false},null,2));
  if(!report.session_ready_observed||report.ended!=='duration_limit')process.exitCode=1;
}catch(error){const codes=['VOICE_PROFILE_REQUIRED','MINIMAX_PLANNER_CONFIG_REQUIRED','PREPARATION_CANCELLED','PLANNING_AUTHORIZATION_REQUIRED','PLANNER_CANCELLED'];console.log(JSON.stringify({scope:'free_initial_context_connection_only',status:'failed',stage,code:codes.includes(error.message)?error.message:'PLANNING_VOICE_PROBE_FAILED',microphone_uploaded:false,voice_output_tested:false,browser_audio_tested:false,current_turn_generation_gate_verified:false,quality_acceptance:false}));process.exitCode=1;}
finally{await backend?.close();}
