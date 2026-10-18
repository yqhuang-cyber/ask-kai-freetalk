import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { SessionRuntime } from '../../../packages/agent-core/session.js';
import { SCENARIOS, loadScenario, ReplayProvider } from '../../../packages/provider-replay/index.js';
import { attachRealtime } from './realtime.js';
import { validateMemoryRecord,MEMORY_FIELDS } from '../../../packages/hskai-bridge/identity.js';
import { Metrics } from '../../../packages/policy/metrics.js';
import { DEFAULT_SPEECH_PACE, isSpeechPace } from '../../../packages/agent-core/speech.js';
import { ConversationInitializer } from '../../../packages/agent-core/conversation-initializer.js';
import { Preparations } from './preparations.js';
import { PLANNING_MODES } from '../../../packages/contracts/planning.js';
import { TeachingSession } from '../../../packages/agent-core/teaching.js';
import { LEARNER_PARTS } from '../../../packages/contracts/learner-data.js';

const publicDir = new URL('../public/', import.meta.url);
const staticFiles = new Map([
  ['/closing-playback.js',['closing-playback.js','text/javascript']],
  ['/packages/contracts/conversation-record.js',['../../../packages/contracts/conversation-record.js','text/javascript']],
  ['/', ['index.html','text/html']], ['/web.js', ['web.js','text/javascript']], ['/web.css', ['web.css','text/css']],
  ['/audio.js',['audio.js','text/javascript']], ['/capture-worklet.js',['capture-worklet.js','text/javascript']],
  ['/failure-messages.js',['failure-messages.js','text/javascript']],
  ['/presentation.js',['presentation.js','text/javascript']],
  ['/caption-phrases.js',['caption-phrases.js','text/javascript']],
  ['/summary-cards.js',['summary-cards.js','text/javascript']],
  ['/diagnostics.js',['diagnostics.js','text/javascript']], ['/planning-observer.js',['planning-observer.js','text/javascript']], ['/experience-cases.json',['experience-cases.json','application/json']],
  ['/preparation-client.js',['preparation-client.js','text/javascript']],
  ['/dev/replay', ['replay.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/style.css',['style.css','text/css']]
]);
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
async function streamReplay(req, res, id, paceMs) {
  const fixture = await loadScenario(id);
  const sessionId = randomUUID();
  const runtime = new SessionRuntime(sessionId);
  const provider = new ReplayProvider(fixture, { paceMs });
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  res.writeHead(200, { 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-transform', 'X-Accel-Buffering':'no' });
  const send = async (type, data) => {
    if (res.destroyed) return;
    if (!res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)) {
      try { await once(res, 'drain', { signal: controller.signal }); } catch (error) { if (error.name !== 'AbortError') throw error; }
    }
  };
  try {
    await send('mode', { mode:'synthetic_replay', provider_connected:false, scenario:id });
    for await (const event of provider.open({ sessionId, signal: controller.signal })) {
      const result = runtime.ingest(event);
      await send(result.accepted ? 'accepted' : 'dropped', result.accepted ? event : { event_id:event.event_id, reason:result.reason, response_id:event.response_id ?? null });
    }
    if (!controller.signal.aborted) await send('summary', runtime.snapshot());
  } finally {
    await provider.close();
    if (!res.destroyed) res.end();
  }
}
export async function readJson(req,maxBytes=4096) {
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error('REQUEST_TOO_LARGE');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function createGateway({ paceMs = 120, bridge, memoryPort, privacyPort, pocPort, planningPort, learnerDataPort, planner, planningMode='legacy', speechPaceSupported = false, ...realtimeOptions } = {}) {
  if(!PLANNING_MODES.includes(planningMode))throw new Error('INVALID_PLANNING_MODE');
  if(planningMode!=='legacy'&&!planningPort)throw new Error('PLANNING_PORT_REQUIRED');
  const preparations=planningMode!=='legacy'&&planningPort?new Preparations({initializer:new ConversationInitializer({port:planningPort,planner,mode:planningMode})}):null;
  const metrics=realtimeOptions.metrics ?? new Metrics();
  const speechAvailable=speechPaceSupported===true && typeof realtimeOptions.providerFactory==='function';
  const authorize=(req,scope)=> {
    if(bridge) {
      const identity=bridge.authorize(req,scope);
      // A shared browser cookie may be replaced by another tab. This hint only
      // rejects a mismatch; it never grants access or overrides signed identity.
      if(pocPort&&req.headers['x-ask-kai-mock-uid']!==undefined&&req.headers['x-ask-kai-mock-uid']!==identity.learner_id)throw new Error('MOCK_LEARNER_MISMATCH');
      return identity;
    }
    if(realtimeOptions.providerKind==='test')return {owner_id:'test-owner',learner_id:'test-learner',market:'SG',expires:Date.now()+60000,authorization_until:Date.now()+600000,memory:[],mission:null,scopes:['session:create','memory:read','memory:write','memory:delete']};
    throw new Error('UNAUTHORIZED');
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    // Local diagnostic surface: restrict Host to resist cross-site DNS rebinding.
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '')) return json(res, 403, { error:'LOCAL_HOST_REQUIRED' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error:'CROSS_SITE_DENIED' });
    try {
      const url = new URL(req.url, 'http://localhost');
      if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { service:'ask-kai', mode:pocPort?'standalone_poc':'synthetic_replay', provider_connected:false, status:'ok' });
      if (req.method === 'GET' && url.pathname === '/api/replays') return json(res, 200, { scenarios:SCENARIOS });
      if(req.method==='GET'&&url.pathname==='/api/topics'){if(!planningPort?.topics)return json(res,200,{managed:false,topics:[]});try{return json(res,200,{managed:true,topics:await planningPort.topics.list()});}catch{return json(res,503,{managed:true,topics:[],error:'TOPIC_SERVICE_UNAVAILABLE'});}}
      if(req.method==='GET'&&url.pathname.startsWith('/api/conversations/')) {
        const id=url.pathname.slice('/api/conversations/'.length);if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||url.search)return json(res,400,{error:'INVALID_CONVERSATION_ID'});
        let identity;try{identity=authorize(req,'context:read');}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        if(!planningPort?.readConversation)return json(res,501,{error:'CONVERSATION_RECORD_UNAVAILABLE'});
        try{return json(res,200,await planningPort.readConversation(identity,id));}catch{return json(res,404,{error:'CONVERSATION_NOT_FOUND'});}
      }
      if(req.method==='GET' && url.pathname==='/api/runtime')return json(res,200,{app:'ask-kai-agent-poc',backend:pocPort?'mock_hskai':bridge?'external_hskai':'unconfigured',voice_configured:realtime.available,provider_connected:false,mock_persistence:pocPort?'process_memory':null,planning:{mode:planningMode,available:!!preparations,planner_configured:!!planner,controlled_available:false},entry_previews:planningMode==='legacy'?Object.fromEntries(['sports','free'].map(mode=>[mode,new TeachingSession({sessionId:'preview',mode}).view()])):{}});
      if(url.pathname==='/api/conversation-preparations'||url.pathname.startsWith('/api/conversation-preparations/')) {
        if(!preparations)return json(res,501,{error:'PLANNING_NOT_CONFIGURED'});
        if(!['GET','POST','DELETE'].includes(req.method))return json(res,405,{error:'METHOD_NOT_ALLOWED'});
        if(req.method!=='GET'&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'ORIGIN_REQUIRED'});
        let identity;try{identity=authorize(req,'session:create');}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        try {
          const id=url.pathname.slice('/api/conversation-preparations/'.length);
          if(req.method==='POST'&&url.pathname==='/api/conversation-preparations') {
            if(planningMode==='controlled')return json(res,501,{error:'CONTROLLED_REALTIME_NOT_VERIFIED'});
            const input=await readJson(req,1024);
            if(!input||typeof input!=='object'||Array.isArray(input)||input.observe!==undefined&&typeof input.observe!=='boolean')return json(res,400,{error:'INVALID_PREPARATION'});
            const {observe,...entry}=input;
            return json(res,202,preparations.create(identity,entry,{observe:observe===true}));
          }
          if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))return json(res,400,{error:'INVALID_PREPARATION_ID'});
          if(req.method==='GET')return json(res,200,preparations.view(identity,id));
          if(req.method==='DELETE'){
            // Cleanup is idempotent: consumption/expiry may already have removed it.
            try{preparations.cancel(identity,id);}catch(error){if(error.message!=='PREPARATION_NOT_FOUND')throw error;}
            return json(res,200,{status:'cancelled'});
          }
          return json(res,405,{error:'METHOD_NOT_ALLOWED'});
        }catch(error){return json(res,error.message==='PREPARATION_CAPACITY'?429:error.message==='PREPARATION_NOT_FOUND'?404:400,{error:error.message==='PREPARATION_CAPACITY'?'PREPARATION_CAPACITY':'INVALID_PREPARATION'});}
      }
      if(req.method==='GET'&&url.pathname==='/api/poc/learners') {
        if(!pocPort)return json(res,404,{error:'NOT_FOUND'});
        try{return json(res,200,await pocPort.list());}catch{return json(res,503,{error:'MOCK_HSKAI_UNAVAILABLE'});}
      }
      const learnerPartName=url.pathname.startsWith('/api/learner/')?url.pathname.slice('/api/learner/'.length):null;
      if(learnerPartName&&Object.hasOwn(LEARNER_PARTS,learnerPartName)) {
        if(req.method!=='GET')return json(res,405,{error:'METHOD_NOT_ALLOWED'});
        if(!learnerDataPort)return json(res,501,{error:'LEARNER_DATA_NOT_CONFIGURED'});
        if(url.search)return json(res,400,{error:'IDENTITY_QUERY_FORBIDDEN'});
        let identity;try{identity=authorize(req,LEARNER_PARTS[learnerPartName].scope);}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        try{return json(res,200,await learnerDataPort.readPart(identity,learnerPartName));}catch{return json(res,503,{error:'HSKAI_LEARNER_DATA_UNAVAILABLE'});}
      }
      if(req.method==='POST' && url.pathname==='/api/poc/launch') {
        if(!pocPort)return json(res,404,{error:'NOT_FOUND'});
        if(req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'ORIGIN_REQUIRED'});
        let input;try{input=await readJson(req,256);}catch{return json(res,400,{error:'INVALID_REQUEST'});}
        if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>k!=='uid')||input.uid!==undefined&&(typeof input.uid!=='string'||!pocPort.has(input.uid)))return json(res,400,{error:'INVALID_MOCK_LAUNCH'});
        try {
          const assertion=await pocPort.issue(input.uid),identity=bridge.verify(assertion,'session:create');
          res.setHeader('Set-Cookie',`ask_kai_launch=${assertion}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=60`);
          return json(res,200,{source:'mock_hskai',uid:identity.learner_id,persistence:'process_memory'});
        }catch{return json(res,503,{error:'MOCK_HSKAI_UNAVAILABLE'});}
      }
      if (req.method === 'GET' && url.pathname === '/api/speech-paces') return json(res,200,{supported:speechAvailable,default:speechAvailable?DEFAULT_SPEECH_PACE:null,options:speechAvailable?[{id:'slow',label:'慢速（默认）'},{id:'normal',label:'正常'}]:[]});
      if(req.method==='GET' && url.pathname==='/api/metrics')return json(res,200,metrics.snapshot());
      if(req.method==='GET' && url.pathname==='/api/privacy')return json(res,200,{local_audio_persistence:false,local_transcript_persistence:false,memory_truth_source:pocPort?'local_mock_hskai':'HSKai',mock_persistence:pocPort?'process_memory':null,provider_retention:'not_verified',privacy_requests_available:!!privacyPort});
      if(req.method==='POST' && url.pathname==='/api/privacy/requests') {
        if(req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'ORIGIN_REQUIRED'});
        let input;try{input=await readJson(req,512);}catch{return json(res,400,{error:'INVALID_REQUEST'});}
        if(!input || !['export','erase','status'].includes(input.operation) || Object.keys(input).some(k=>!['operation','request_id'].includes(k)) || (input.operation==='status' && !/^[A-Za-z0-9_-]{1,128}$/.test(input.request_id ?? '')))return json(res,400,{error:'INVALID_PRIVACY_REQUEST'});
        let identity;try{identity=authorize(req,input.operation==='status'?'privacy:read':`privacy:${input.operation}`);}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        if(!privacyPort)return json(res,501,{error:'HSKAI_PRIVACY_WORKFLOW_REQUIRED'});
        try{const result=await privacyPort.request(identity,input.operation,input.request_id);if(input.operation==='erase'){preparations?.revoke(identity);realtime.revoke(identity);}return json(res,input.operation==='status'?200:202,result);}catch{return json(res,503,{error:'PRIVACY_REQUEST_UNAVAILABLE'});}
      }
      if(req.method==='GET' && url.pathname==='/api/memory/export') {
        let identity;try{identity=authorize(req,'memory:read');}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        try{res.setHeader('Content-Disposition','attachment; filename="ask-kai-preferences.json"');return json(res,200,{scope:'authorized_learner_preferences',records:memoryPort?await memoryPort.read(identity):identity.memory});}catch{return json(res,503,{error:'HSKAI_MEMORY_UNAVAILABLE'});}
      }
      if(req.method==='GET' && url.pathname==='/api/bootstrap') {
        let identity;try{identity=authorize(req,'session:create');}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        return json(res,200,{modes:['sports','free',...(identity.mission?['mission']:[])],mission:identity.mission?{id:identity.mission.id,title:identity.mission.title,targets:identity.mission.targets}:null,mission_preview:planningMode==='legacy'&&identity.mission?{...new TeachingSession({sessionId:'preview',mode:'mission',mission:identity.mission}).view(),prompt_title:identity.mission.title}:null,memory_writable:!!memoryPort && identity.scopes.includes('memory:write')});
      }
      if(url.pathname==='/api/memory') {
        if(['POST','DELETE'].includes(req.method) && req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'ORIGIN_REQUIRED'});
        const scope=req.method==='GET'?'memory:read':req.method==='POST'?'memory:write':'memory:delete';
        let identity;try{identity=authorize(req,scope);}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        if(!['GET','POST','DELETE'].includes(req.method))return json(res,405,{error:'METHOD_NOT_ALLOWED'});
        try {
          if(req.method==='GET')return json(res,200,{records:memoryPort ? await memoryPort.read(identity):identity.memory,writable:!!memoryPort && identity.scopes.includes('memory:write'),can_delete:!!memoryPort && identity.scopes.includes('memory:delete')});
          if(!memoryPort)return json(res,501,{error:'HSKAI_MEMORY_WRITER_REQUIRED'});
          let input;try{input=await readJson(req,1024);}catch{return json(res,400,{error:'INVALID_REQUEST'});}
          const allowed=MEMORY_FIELDS;
          if(!input || typeof input!=='object' || Array.isArray(input) || !Object.keys(input).every(k=>['field',...(req.method==='POST'?['value']:[])].includes(k)) || (input.field!==undefined && !allowed.includes(input.field)))return json(res,400,{error:'INVALID_MEMORY'});
          if(req.method==='POST') {
            const now=new Date().toISOString(),expires=new Date(Date.now()+30*86400000).toISOString();
            let record;try{record=validateMemoryRecord({field:input.field,value:input.value,source:'student_correction',updated_at:now,expires_at:expires});}catch{return json(res,400,{error:'INVALID_MEMORY'});}
            await memoryPort.write(identity,record);preparations?.revoke(identity);await realtime.updateMemory(identity,await memoryPort.read(identity));
          } else {await memoryPort.delete(identity,input.field);preparations?.revoke(identity);realtime.revoke(identity);}
          return json(res,200,{records:await memoryPort.read(identity)});
        }catch{return json(res,503,{error:'HSKAI_MEMORY_UNAVAILABLE'});}
      }
      if(req.method==='POST' && url.pathname==='/api/authorization/revoke') {
        if(req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'ORIGIN_REQUIRED'});
        let identity;try{identity=authorize(req,'session:revoke');}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        preparations?.revoke(identity);realtime.revoke(identity);return json(res,200,{revoked:true});
      }
      if (req.method === 'POST' && url.pathname === '/api/sessions') {
        if (!realtime.available) return json(res,501,{error:'REALTIME_NOT_IMPLEMENTED',provider_connected:false});
        const origin=`http://${req.headers.host}`;
        if(req.headers.origin!==origin)return json(res,403,{error:'ORIGIN_REQUIRED'});
        let identity;try{identity=authorize(req,'session:create');}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        let input;
        try {input=await readJson(req);}catch{return json(res,400,{error:'INVALID_REQUEST'});}
        if(!input || !['sports','topic','free','mission'].includes(input.mode) || Object.keys(input).some(k=>!['mode','topic_id','mission_id','speech_pace','opening_request','preparation_id'].includes(k)) || (input.mode==='mission' && typeof input.mission_id!=='string'))return json(res,400,{error:'INVALID_MODE'});
        if(planningMode==='controlled')return json(res,501,{error:'CONTROLLED_REALTIME_NOT_VERIFIED'});
        if(input.mode==='topic'&&!preparations)return json(res,400,{error:'TOPIC_PLANNING_REQUIRED'});
        if(input.speech_pace!==undefined && !isSpeechPace(input.speech_pace))return json(res,400,{error:'INVALID_SPEECH_PACE'});
        if(input.speech_pace!==undefined && !speechAvailable)return json(res,400,{error:'SPEECH_PACE_UNSUPPORTED'});
        if(input.mode==='mission' && identity.mission?.id!==input.mission_id)return json(res,403,{error:'TRUSTED_MISSION_REQUIRED'});
        try{if(memoryPort)identity.memory=await memoryPort.read(identity);}catch{return json(res,503,{error:'HSKAI_MEMORY_UNAVAILABLE'});}
        let planning;
        if(preparations) {
          try {
            const {preparation_id,...entry}=input;
            let id=preparation_id;
            if(id===undefined){const result=preparations.create(identity,entry);id=result.preparation_id;await preparations.get(identity,id).done;}
            planning=await preparations.consume(identity,id,entry);
          }catch{return json(res,409,{error:'PREPARATION_UNAVAILABLE_OR_STALE'});}
        } else if(input.preparation_id!==undefined)return json(res,400,{error:'PLANNING_NOT_CONFIGURED'});
        try{bridge?.consume(identity);}catch{return json(res,401,{error:'LAUNCH_ALREADY_USED'});}
        try{return json(res,201,await realtime.create({origin,mode:input.mode==='topic'&&planning?.resource?.id==='sports'?'sports':input.mode,identity,planning,bindPlanning:preparations?(result,id)=>preparations.bind(result,id):undefined,speechPace:speechAvailable?(input.speech_pace??DEFAULT_SPEECH_PACE):undefined}));}catch(error){const unavailable=error.message==='CONVERSATION_RECORD_UNAVAILABLE';return json(res,unavailable?503:429,{error:unavailable?'CONVERSATION_RECORD_UNAVAILABLE':'SESSION_CAPACITY'});}
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/replays/')) {
        const id = url.pathname.slice('/api/replays/'.length);
        if (!SCENARIOS.some(item => item.id === id)) return json(res, 404, { error:'UNKNOWN_SCENARIO' });
        return await streamReplay(req, res, id, paceMs);
      }
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, type] = staticFiles.get(url.pathname);
        const content = await readFile(new URL(file, publicDir));
        res.writeHead(200, { 'Content-Type':`${type}; charset=utf-8` });
        return res.end(content);
      }
      json(res, 404, { error:'NOT_FOUND' });
    } catch {
      // Never log transcript, request body, provider payload or credentials.
      if (!res.headersSent) json(res, 500, { error:'INTERNAL_ERROR' });
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  const realtime=attachRealtime(server,{...realtimeOptions,planner,planningPort,metrics,businessSource:pocPort?'mock_hskai':bridge?'external_hskai':'unconfigured'});
  server.stopRealtime=()=>{preparations?.close();realtime.close();};
  server.on('close',()=>{preparations?.close();realtime.close();});
  return server;
}
