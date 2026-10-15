import { SCENARIOS, loadScenario, ReplayProvider } from '../../../packages/provider-replay/index.js';
import { SessionRuntime } from '../../../packages/agent-core/session.js';
export async function runScenario(id) {
  const fixture = await loadScenario(id);
  const runtime = new SessionRuntime(fixture.session_id);
  const provider = new ReplayProvider(fixture);
  for await (const event of provider.open()) runtime.ingest(event);
  await provider.close();
  return { scenario:id, synthetic:true, provider_connected:false, ...runtime.snapshot() };
}
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  try {
    const ids = process.argv[2] ? [process.argv[2]] : SCENARIOS.map(item => item.id);
    for (const id of ids) console.log(JSON.stringify(await runScenario(id)));
  } catch { console.error('REPLAY_FAILED'); process.exitCode = 1; }
}
