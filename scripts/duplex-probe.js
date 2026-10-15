import { loadProfile, preflight, runProbe } from '../packages/provider-doubao/probe.js';
const args = process.argv.slice(2);
const live = args.includes('--live');
const controller = new AbortController();
const abort = () => controller.abort();
process.once('SIGINT',abort); process.once('SIGTERM',abort);
try {
  if (args.some(arg => arg !== '--live')) throw new Error('INVALID_PROBE_ARGUMENTS');
  const profile = await loadProfile(process.env.DOUBAO_PROBE_PROFILE ?? new URL('../docs/protocol/duplex-profile.template.json',import.meta.url));
  const report = live ? await runProbe({profile,signal:controller.signal}) : preflight(profile);
  console.log(JSON.stringify(report,null,2));
  if (live && (!report.session_ready_observed || report.ended !== 'duration_limit')) process.exitCode = 1;
} catch (error) {
  const safe = new Set(['INVALID_PROBE_ARGUMENTS','PROFILE_READ_FAILED','PROFILE_TOO_LARGE','PROFILE_INVALID','PROBE_PREFLIGHT_BLOCKED','INVALID_PROBE_LIMITS','INVALID_CREDENTIAL_FORMAT','SOCKET_CREATE_FAILED']);
  console.error(JSON.stringify({error:safe.has(error.message)?error.message:'PROBE_FAILED',provider_connected:false}));
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT',abort); process.removeListener('SIGTERM',abort);
}
