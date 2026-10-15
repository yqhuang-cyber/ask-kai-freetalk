import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { preflight, runProbe } from '../packages/provider-doubao/probe.js';

export async function executeConnectProbe({profile,request,env={},live=false,signal,probe=runProbe,Client=WebSocket}) {
  const hash = createHash('sha256').update(JSON.stringify(profile)).digest('hex');
  if (request?.version !== 1 || request.kind !== 'doubao_session_connect' ||
      !/^connect-\d{4}-\d{2}-\d{2}-\d{2}$/.test(request.request_id ?? '') || request.profile_sha256 !== hash ||
      profile.review_scope !== 'static_session_connect_only' || !profile.reviewed ||
      profile.realtime?.reviewed !== false || profile.realtime?.ordered_acks_reviewed !== false ||
      profile.auth?.header !== 'X-Api-Key' || profile.auth?.env !== 'DOUBAO_API_KEY' ||
      profile.ready?.type !== 'session.created' || profile.probe?.mute_after_ready !== true) {
    throw new Error('INVALID_CONNECT_REQUEST');
  }
  const checked = preflight(profile,env);
  const base = {
    version:1, kind:'live_doubao_connection_probe', request_id:request.request_id,
    candidate_revision:/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
    microphone_uploaded:false, voice_behavior_tested:false, real_experience_accepted:false,
    realtime_reviewed:false, ordered_acks_reviewed:false
  };
  if (!live || !checked.live_eligible) return {
    ...base, ...checked, status:live ? 'blocked' : 'preflight',
    socket_open_observed:false, session_ready_observed:false, events:[]
  };
  let http_status = null;
  const report = await probe({profile,env,signal,durationMs:5000,maxFrames:64,maxFrameBytes:65536,
    socketFactory:(url,options) => {
      const socket = new Client(url,{...options,maxPayload:65536,perMessageDeflate:false,
        handshakeTimeout:5000,followRedirects:false});
      // Only the numeric handshake status survives. Never inspect headers/body/reason.
      socket.on('unexpected-response',(_request,response) => {
        if (Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599) {
          http_status = response.statusCode;
        }
        response.resume();
        socket.terminate();
      });
      socket.on('error',() => {});
      return socket;
    }
  });
  return {...base,...report,http_status,
    status:report.session_ready_observed && report.ended === 'duration_limit' ? 'passed' : 'failed'};
}

async function main() {
  const args = process.argv.slice(2);
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT',abort); process.once('SIGTERM',abort);
  let report;
  try {
    if (args.length !== 1 || !['--preflight','--live'].includes(args[0])) throw new Error('INVALID_ARGUMENTS');
    const profile = JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-connect.profile.json',import.meta.url),'utf8'));
    const request = JSON.parse(await readFile(new URL('../.github/live/doubao-connect-request.json',import.meta.url),'utf8'));
    report = await executeConnectProbe({profile,request,env:process.env,live:args[0] === '--live',signal:controller.signal});
  } catch {
    report = {version:1,kind:'live_doubao_connection_probe',status:'failed',error:'CONNECT_PROBE_FAILED',
      provider_connected:false,session_ready_observed:false,microphone_uploaded:false,
      voice_behavior_tested:false,real_experience_accepted:false};
  } finally {
    process.removeListener('SIGINT',abort); process.removeListener('SIGTERM',abort);
  }
  await mkdir('.local/doubao-connect',{recursive:true});
  await writeFile('.local/doubao-connect/result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(report,null,2));
  if (['failed','blocked'].includes(report.status)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
