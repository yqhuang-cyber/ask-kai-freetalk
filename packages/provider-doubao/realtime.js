import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { DUPLEX_ENDPOINT, validateProfile, preflight } from './probe.js';

const pathPattern = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*){0,5}$/;
const eventPattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5}$/;
const forbidden = /^(?:__proto__|prototype|constructor)$/;
const validPath = path => typeof path === 'string' && pathPattern.test(path) && !path.split('.').some(key => forbidden.test(key));
export const field = (value,path) => path?.split('.').reduce((v,k) => v && typeof v === 'object' && Object.hasOwn(v,k) ? v[k] : undefined,value);
export function put(value,path,data) {
  if (!validPath(path)) throw new Error('INVALID_MAPPING_PATH');
  const parts = path.split('.');
  let node = value;
  for (const key of parts.slice(0,-1)) node = node[key] ??= {};
  node[parts.at(-1)] = data;
  return value;
}
export function validateRealtimeProfile(profile) {
  validateProfile(profile);
  const rt = profile.realtime;
  if (!profile.reviewed || !rt?.reviewed || !/^https:\/\/(?:docs\.)?volcengine\.com\//.test(rt.evidence_source ?? '')) throw new Error('DOUBAO_PROTOCOL_NOT_VERIFIED');
  if (rt.audio?.encoding !== 'pcm_s16le' || ![16000,24000,48000].includes(rt.audio.input_rate) || ![16000,24000,48000].includes(rt.audio.output_rate) || rt.audio.frame_ms !== 20) throw new Error('UNSUPPORTED_REVIEWED_AUDIO');
  const rules = {user_partial:['turn','text'],user_final:['turn','text'],response_started:['turn','response'],text_delta:['turn','response','text'],audio_chunk:['turn','response','audio'],response_done:['turn','response'],response_cancelled:['turn','response'],speech_started:['turn'],context_updated:['version'],error:[]};
  const types = new Set([profile.ready.type]);
  for (const [name,paths] of Object.entries(rules)) {
    const rule = rt.inbound?.[name];
    if (!eventPattern.test(rule?.type ?? '') || types.has(rule.type) || paths.some(path => !validPath(rule[path]))) throw new Error('INVALID_INBOUND_MAPPING');
    types.add(rule.type);
  }
  for (const [name,paths] of Object.entries({audio:['data'],cancel:['response'],context:['instructions','version']})) {
    const rule = rt.outbound?.[name];
    if (!eventPattern.test(rule?.type ?? '') || paths.some(path => !validPath(rule[path]) || rule[path] === 'type')) throw new Error('INVALID_OUTBOUND_MAPPING');
  }
  if (!validPath(rt.initial_instructions) || !rt.initial_instructions.startsWith('session.')) throw new Error('INVALID_INSTRUCTIONS_MAPPING');
  return profile;
}

/** Shared bounded JSON transport. Protocol subclasses validate their own wire contract. */
export class DoubaoJsonTransport {
  kind = 'doubao';
  constructor({profile,env=process.env,socketFactory=(url,options)=>new WebSocket(url,options)}) {
    this.profile = validateProfile(profile);
    if (!preflight(profile,env).live_eligible) throw new Error('PROBE_PREFLIGHT_BLOCKED');
    const credential = env[profile.auth.env];
    if (typeof credential !== 'string' || credential.length > 8192 || /[^\x21-\x7e]/.test(credential)) throw new Error('INVALID_CREDENTIAL_FORMAT');
    this.headers = {[profile.auth.header]:profile.auth.prefix+credential};
    this.socketFactory = socketFactory;
    this.ids = new Map(); this.reverse = new Map(); this.seq = 0;
    this.audio = profile.realtime.audio;
  }
  id(value) {
    if (typeof value !== 'string' || !value.length || value.length > 128) throw new Error('INVALID_PROVIDER_ID');
    if (!this.ids.has(value)) {
      if (this.ids.size >= 10000) throw new Error('PROVIDER_ID_LIMIT');
      const id = randomUUID(); this.ids.set(value,id); this.reverse.set(id,value);
    }
    return this.ids.get(value);
  }
  open({sessionId,instructions='',onEvent,onFailure}) {
    this.sessionId = sessionId; this.started = performance.now(); this.onEvent = onEvent;
    this.socket = this.socketFactory(DUPLEX_ENDPOINT,{headers:this.headers,maxPayload:131072,perMessageDeflate:false,handshakeTimeout:5000,followRedirects:false});
    this.socket.on('open',() => {
      if(this.closed)return;
      try {
        const create = structuredClone(this.profile.session_create);
        put(create,this.profile.realtime.initial_instructions,instructions);
        this.send(create);
      }catch{onFailure('PROVIDER_INITIALIZATION_FAILED');}
    });
    this.socket.on('message',(bytes,binary) => {
      if (this.closed) return;
      try {
        if (binary) throw new Error('BINARY_MAPPING_NOT_VERIFIED');
        this.receive(JSON.parse(bytes.toString()));
      } catch { onFailure('PROVIDER_PROTOCOL_ERROR'); }
    });
    this.socket.on('error',() => {if(!this.closed)onFailure('PROVIDER_TRANSPORT_ERROR');});
    this.socket.on('close',() => { if (!this.closed) onFailure('PROVIDER_DISCONNECTED'); });
  }
  event(type,payload={},ids={}) {
    return {version:1,event_id:randomUUID(),session_id:this.sessionId,seq:++this.seq,at_ms:Math.max(0,Math.round(performance.now()-this.started)),type,...ids,payload};
  }
  send(value) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) throw new Error('PROVIDER_NOT_OPEN');
    if (this.socket.bufferedAmount > 262144) throw new Error('PROVIDER_BACKPRESSURE');
    this.socket.send(JSON.stringify(value));
  }
  close() { this.closed = true; this.socket?.terminate(); this.ids.clear(); this.reverse.clear(); }
}

/** Explicitly reviewed generic mappings. No wire defaults. */
export class ReviewedDoubaoProvider extends DoubaoJsonTransport {
  constructor(options) { validateRealtimeProfile(options.profile); super(options); }
  receive(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_PROVIDER_EVENT');
    if (raw.type === this.profile.ready.type) {
      this.id(field(raw,this.profile.ready.session_id_path));
      return this.onEvent({event:this.event('session.ready')});
    }
    const match = Object.entries(this.profile.realtime.inbound).find(([,rule]) => rule.type === raw.type);
    if (!match) return; // unreviewed events are never forwarded
    const [name,rule] = match;
    if (name === 'error') throw new Error('PROVIDER_REPORTED_ERROR');
    if (name === 'context_updated') return this.onEvent({control:'context.updated',version:field(raw,rule.version)});
    const ids = {turn_id:this.id(field(raw,rule.turn))};
    if (['response_started','text_delta','audio_chunk','response_done','response_cancelled'].includes(name)) ids.response_id = this.id(field(raw,rule.response));
    if (name === 'speech_started') return this.onEvent({control:'user.speech.started',...ids});
    const types = {user_partial:'user.partial',user_final:'user.final',response_started:'response.started',text_delta:'response.text.delta',audio_chunk:'response.audio.chunk',response_done:'response.done',response_cancelled:'response.cancelled'};
    let payload = {};
    if (['user_partial','user_final','text_delta'].includes(name)) payload = {text:field(raw,rule.text)};
    if (name==='audio_chunk') {
      const audio = field(raw,rule.audio);
      if (typeof audio !== 'string' || audio.length > 87384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio)) throw new Error('INVALID_PROVIDER_AUDIO');
      const bytes = Buffer.from(audio,'base64');
      if (!bytes.length || bytes.length > 65536 || bytes.length % 2) throw new Error('INVALID_PROVIDER_AUDIO');
      payload = {byte_length:bytes.length,format:'pcm_s16le'};
      return this.onEvent({event:this.event(types[name],payload,ids),audio:bytes.toString('base64'),sample_rate:this.audio.output_rate});
    }
    this.onEvent({event:this.event(types[name],payload,ids)});
  }
  sendAudio(bytes) {
    if (!bytes.length || bytes.length % 2 || bytes.length > this.audio.input_rate * 2 / 50) throw new Error('INVALID_INPUT_AUDIO');
    const rule = this.profile.realtime.outbound.audio;
    this.send(put({type:rule.type},rule.data,Buffer.from(bytes).toString('base64')));
  }
  cancel(responseId) {
    const rule = this.profile.realtime.outbound.cancel;
    const raw = this.reverse.get(responseId);
    if (!raw) throw new Error('UNKNOWN_RESPONSE');
    this.send(put({type:rule.type},rule.response,raw));
  }
  updateContext({instructions,version}) {
    const rule = this.profile.realtime.outbound.context;
    this.send(put(put({type:rule.type},rule.instructions,instructions),rule.version,version));
  }
}
