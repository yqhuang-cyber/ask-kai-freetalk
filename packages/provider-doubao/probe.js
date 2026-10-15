import { readFile } from 'node:fs/promises';
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const DUPLEX_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue';
export const PROTOCOL_SOURCE = 'https://docs.volcengine.com/docs/6561/2556358';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pathPattern = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*){0,5}$/;
const eventPattern = /^(?:error|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5})$/;
const safeKey = /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/;
function hasSecretKey(value) {
  if (Array.isArray(value)) return value.some(hasSecretKey);
  if (!object(value)) return false;
  return Object.entries(value).some(([key,item]) => /api.?key|access.?key|token|secret|password|authorization/i.test(key) || hasSecretKey(item));
}
function field(value, path) {
  return path.split('.').reduce((current,key) => object(current) && Object.hasOwn(current,key) ? current[key] : undefined,value);
}
export function validateProfile(profile) {
  if (!object(profile) || profile.version !== 1 || profile.endpoint !== DUPLEX_ENDPOINT || typeof profile.reviewed !== 'boolean') throw new Error('INVALID_PROTOCOL_PROFILE');
  if (!Array.isArray(profile.observed_event_types) || profile.observed_event_types.length > 64 || !profile.observed_event_types.every(type => typeof type === 'string' && eventPattern.test(type))) throw new Error('INVALID_EVENT_ALLOWLIST');
  if (!Array.isArray(profile.identity_paths) || profile.identity_paths.length > 8 || !profile.identity_paths.every(path => typeof path === 'string' && pathPattern.test(path) && /(?:^|\.)(?:id|response_id|turn_id|item_id|call_id|question_id)$/.test(path))) throw new Error('INVALID_IDENTITY_PATHS');
  if (!object(profile.session_create) || profile.session_create.type !== 'session.create' || !object(profile.session_create.session) || hasSecretKey(profile.session_create) || Buffer.byteLength(JSON.stringify(profile.session_create)) > 32768) throw new Error('INVALID_SESSION_CREATE');
  if (!profile.reviewed) return profile;
  if (!object(profile.auth) || !/^[a-zA-Z][a-zA-Z0-9-]{0,63}$/.test(profile.auth.header ?? '') || /^(host|connection|upgrade|cookie|sec-|proxy-)/i.test(profile.auth.header) || !/^DOUBAO_[A-Z0-9_]{1,64}$/.test(profile.auth.env ?? '')) throw new Error('INVALID_AUTH_MAPPING');
  if (typeof profile.auth.prefix !== 'string' || profile.auth.prefix.length > 16 || /[^\x20-\x7e]/.test(profile.auth.prefix)) throw new Error('INVALID_AUTH_MAPPING');
  if (!object(profile.ready) || !eventPattern.test(profile.ready.type ?? '') || !pathPattern.test(profile.ready.session_id_path ?? '') || !profile.observed_event_types.includes(profile.ready.type)) throw new Error('INVALID_READY_MAPPING');
  if (typeof profile.evidence_source !== 'string' || !/^https:\/\/(?:docs\.)?volcengine\.com\//.test(profile.evidence_source)) throw new Error('OFFICIAL_PROTOCOL_EVIDENCE_REQUIRED');
  if (profile.probe?.mute_after_ready !== undefined && (profile.probe.mute_after_ready !== true || profile.auth.header !== 'X-Api-Key' || profile.ready.type !== 'session.created')) throw new Error('INVALID_PROBE_MUTE_MAPPING');
  return profile;
}
export async function loadProfile(path) {
  let bytes;
  try { bytes = await readFile(path); } catch { throw new Error('PROFILE_READ_FAILED'); }
  if (bytes.length > 65536) throw new Error('PROFILE_TOO_LARGE');
  try { return validateProfile(JSON.parse(bytes.toString('utf8'))); } catch { throw new Error('PROFILE_INVALID'); }
}
export function preflight(profile, env = process.env) {
  validateProfile(profile);
  const missing = [];
  if (!profile.reviewed) missing.push('official_api_profile_review');
  if (profile.reviewed && !env[profile.auth.env]) missing.push('server_side_test_credential');
  return { mode:'protocol_probe', endpoint:DUPLEX_ENDPOINT, live_eligible:missing.length === 0, provider_connected:false, profile_reviewed:profile.reviewed, missing, profile_sha256:createHash('sha256').update(JSON.stringify(profile)).digest('hex') };
}

/** Bounded JSON-only probe; never records payload values, transcripts or audio. */
export async function runProbe({ profile, env = process.env, signal, durationMs = 5000, maxFrames = 64, maxFrameBytes = 65536, socketFactory = (url,options) => new WebSocket(url,options) }) {
  const checked = preflight(profile,env);
  if (!checked.live_eligible) throw new Error('PROBE_PREFLIGHT_BLOCKED');
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 10000 || !Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 128 || !Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > 1048576) throw new Error('INVALID_PROBE_LIMITS');
  const key = env[profile.auth.env];
  if (typeof key !== 'string' || key.length > 8192 || /[^\x21-\x7e]/.test(key)) throw new Error('INVALID_CREDENTIAL_FORMAT');
  if (signal?.aborted) return { ...checked, socket_open_observed:false, session_ready_observed:false, ended:'aborted', events:[] };
  // Auth is taken only from an explicitly reviewed profile. No guessed header.
  let socket;
  try { socket = socketFactory(DUPLEX_ENDPOINT,{headers:{[profile.auth.header]:profile.auth.prefix + key}}); }
  catch { throw new Error('SOCKET_CREATE_FAILED'); }
  socket.binaryType = 'arraybuffer';
  const identitySalt = randomBytes(32);
  const started = performance.now();
  const report = { ...checked, socket_open_observed:false, session_ready_observed:false, ended:null, events:[] };
  return await new Promise(resolve => {
    let finished = false;
    let opened = false;
    const finish = reason => {
      if (finished) return;
      finished = true;
      report.ended = reason;
      report.provider_connected = false;
      clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      socket.removeEventListener('open',onOpen);
      socket.removeEventListener('message',onMessage);
      socket.removeEventListener('error',onError);
      socket.removeEventListener('close',onClose);
      // Keep a no-op error listener while an aborted handshake settles.
      socket.addEventListener('error',() => {},{once:true});
      try { if (report.session_ready_observed && profile.probe?.mute_after_ready) socket.send(JSON.stringify({type:'session.close'})); socket.close(); } catch {}
      resolve(report);
    };
    const onAbort = () => finish('aborted');
    const onError = () => finish('transport_error');
    const onClose = () => finish('remote_closed');
    const onOpen = () => {
      opened = true;
      report.socket_open_observed = true;
      try { socket.send(JSON.stringify(profile.session_create)); }
      catch { finish('send_failed'); }
    };
    const onMessage = event => {
      if (finished || !opened) return;
      if (report.events.length >= maxFrames) return finish('frame_limit');
      const time_ms = Math.round(performance.now()-started);
      if (typeof event.data !== 'string') {
        const byte_length = event.data?.byteLength ?? event.data?.size ?? 0;
        report.events.push({time_ms,type:'binary_unmapped',byte_length});
        return finish(byte_length > maxFrameBytes ? 'oversized_frame' : 'binary_protocol_unverified');
      }
      const byte_length = Buffer.byteLength(event.data);
      if (byte_length > maxFrameBytes) return finish('oversized_frame');
      let payload;
      try { payload = JSON.parse(event.data); } catch { return finish('invalid_json'); }
      if (!object(payload)) return finish('invalid_json_shape');
      const type = profile.observed_event_types.includes(payload.type) ? payload.type : 'unmapped';
      // Only safe structural keys, never their values or provider error messages.
      const keys = Object.keys(payload).filter(key => safeKey.test(key)).slice(0,32);
      const identity_refs = {};
      for (const path of profile.identity_paths) {
        const value = field(payload,path);
        if (typeof value === 'string' && value.length > 0 && value.length <= 128) identity_refs[path] = createHmac('sha256',identitySalt).update(value).digest('hex').slice(0,24);
      }
      report.events.push({time_ms,type,byte_length,keys,identity_refs});
      if (payload.type === 'error' && profile.observed_event_types.includes('error')) return finish('provider_error');
      const sessionId = field(payload,profile.ready.session_id_path);
      if (payload.type === profile.ready.type && typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 128) {
        if (!report.session_ready_observed && profile.probe?.mute_after_ready) {
          try { socket.send(JSON.stringify({type:'input_audio_mute.commit'})); } catch { return finish('send_failed'); }
        }
        report.session_ready_observed = true;
        report.provider_connected = true;
      }
    };
    const timer = setTimeout(() => finish('duration_limit'),durationMs);
    socket.addEventListener('open',onOpen);
    socket.addEventListener('message',onMessage);
    socket.addEventListener('error',onError);
    socket.addEventListener('close',onClose);
    signal?.addEventListener('abort',onAbort,{once:true});
    if (signal?.aborted) onAbort();
  });
}
