import { readConfig } from './config.js';
import { createGateway } from './server.js';
import { loadProfile } from '../../../packages/provider-doubao/probe.js';
import { createDoubaoProvider, validateDoubaoRealtimeProfile, SEEDUPLEX_PROTOCOL } from '../../../packages/provider-doubao/seeduplex.js';
import { HskaiBridge } from '../../../packages/hskai-bridge/identity.js';
import { HskaiMemoryPort } from '../../../packages/hskai-bridge/memory.js';
import { HskaiSafeguardingPort } from '../../../packages/hskai-bridge/safeguarding.js';
import { HskaiPrivacyPort } from '../../../packages/hskai-bridge/privacy.js';
import { startMockBackend } from '../../hskai-mock/src/backend.js';
import { configuredPlanner } from '../../../packages/agent-core/planner-port.js';
let mockBackend;
try {
  const config = readConfig({...process.env,...(process.argv.includes('--poc')?{ASK_KAI_BACKEND:'mock'}:{})});
  const profile=config.provider==='doubao' ? validateDoubaoRealtimeProfile(await loadProfile(config.profilePath)) : null;
  if(profile)createDoubaoProvider({profile});
  if(config.backend==='mock')mockBackend=await startMockBackend();
  const bridge=mockBackend?.bridge ?? (profile ? new HskaiBridge({secret:process.env.HSKAI_BRIDGE_SECRET,markets:(process.env.HSKAI_ALLOWED_MARKETS ?? '').split(',').filter(Boolean)}) : undefined);
  const memoryPort=mockBackend?.memoryPort ?? (profile && process.env.HSKAI_MEMORY_ENDPOINT ? new HskaiMemoryPort({endpoint:process.env.HSKAI_MEMORY_ENDPOINT,secret:process.env.HSKAI_BRIDGE_SECRET}):undefined);
  const safeguardingPort=mockBackend?.safeguardingPort ?? (profile && process.env.HSKAI_SAFEGUARDING_ENDPOINT ? new HskaiSafeguardingPort({endpoint:process.env.HSKAI_SAFEGUARDING_ENDPOINT,secret:process.env.HSKAI_BRIDGE_SECRET}):undefined);
  const privacyPort=mockBackend?.privacyPort ?? (profile && process.env.HSKAI_PRIVACY_ENDPOINT ? new HskaiPrivacyPort({endpoint:process.env.HSKAI_PRIVACY_ENDPOINT,secret:process.env.HSKAI_BRIDGE_SECRET}):undefined);
  const planningPort=mockBackend?.planningPort;
  const server = createGateway({bridge,memoryPort,safeguardingPort,privacyPort,pocPort:mockBackend?.pocPort,planningPort,learnerDataPort:mockBackend?.learnerDataPort,planningMode:process.env.ASK_KAI_PLANNING_MODE??(mockBackend?'next_turn_advisory':'legacy'),planner:configuredPlanner(),speechPaceSupported:profile?.realtime?.protocol===SEEDUPLEX_PROTOCOL,providerFactory:profile ? ticket=>createDoubaoProvider({profile,speechPace:ticket.speech_pace}) : undefined});
  server.listen(config.port, config.host, () => console.log(`Ask Kai POC: http://${config.host === '::1' ? '[::1]' : config.host}:${config.port} (${mockBackend?'local mock HSKai':'external backend'}; ${profile ? 'reviewed voice configured; readiness per session':'Doubao disconnected'})`));
  server.on('error', () => { console.error('GATEWAY_START_FAILED');server.stopRealtime();void mockBackend?.close();process.exitCode = 1; });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
    server.stopRealtime();
    server.close();
    server.closeAllConnections();
    void mockBackend?.close();
  });
} catch (error) {
  await mockBackend?.close();
  console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'GATEWAY_CONFIGURATION_ERROR');
  process.exitCode = 1;
}
