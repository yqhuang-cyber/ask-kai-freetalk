import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {attachRealtime} from '../../realtime-gateway/src/realtime.js';
import {readJson} from '../../realtime-gateway/src/server.js';
import {Preparations} from '../../realtime-gateway/src/preparations.js';
import {ConversationInitializer} from '../../../packages/agent-core/conversation-initializer.js';
import {ThaiFreeTalkSession} from '../../../packages/free-talk-thai/session.js';

const COOKIE='ask_kai_thai_launch',PROTOCOL='ask-kai.thai.v1';
const own=new URL('../public/',import.meta.url),shared=new URL('../../realtime-gateway/public/',import.meta.url);
const files=new Map(['index.html','web.js','web.css','caption-phrases.js'].map(f=>['/'+(f==='index.html'?'':f),new URL(f,own)]));
for(const f of ['audio.js','capture-worklet.js','diagnostics.js','presentation.js','voice-readiness.js','caption-annotations.js','caption-settings.js','closing-playback.js','speech-playback.js'])files.set('/'+f,new URL(f,shared));
files.set('/vendor/pinyin-pro.js',new URL('../../../node_modules/pinyin-pro/dist/index.js',shared));
files.set('/vendor/pinyin-traditional.js',new URL('../../../node_modules/@pinyin-pro/data/dist/traditional.mjs',shared));
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
const freeEntry=input=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['mode','speech_pace','preparation_id'].includes(k))||input.mode!=='free'||!['slow','normal'].includes(input.speech_pace??'slow'))throw Error('INVALID_THAI_ENTRY');return {mode:'free',speech_pace:input.speech_pace??'slow'};};

// Independent HTTP entry, cookie, one-use preparation store and Mock backend.
// No route can select teacher/topic/mission or mutate the old language profile.
export function createThaiApp({backend,planner,providerFactory,providerKind='doubao',...realtimeOptions}){
  const {bridge,pocPort,memoryPort,planningPort}=backend;
  const preparations=new Preparations({initializer:new ConversationInitializer({port:planningPort,planner,mode:'next_turn_advisory'})});
  const authorize=(req,scope)=>{
    const token=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    const identity=bridge.verify(token,scope);
    if(req.headers['x-ask-kai-mock-uid']!==undefined&&req.headers['x-ask-kai-mock-uid']!==identity.learner_id)throw Error('WRONG_LEARNER');
    return identity;
  };
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const origin='http://'+req.headers.host;
    if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host??'')||req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'LOCAL_ORIGIN_REQUIRED'});
    if(req.method!=='GET'&&req.headers.origin!==origin)return json(res,403,{error:'ORIGIN_REQUIRED'});
    try{
      const url=new URL(req.url,origin);if(url.search)return json(res,400,{error:'QUERY_NOT_ALLOWED'});
      if(req.method==='GET'&&files.has(url.pathname)){const path=files.get(url.pathname),content=await readFile(path);res.writeHead(200,{'Content-Type':/\.m?js$/.test(path.pathname)?'text/javascript; charset=utf-8':path.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});return res.end(content);}
      if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
      if(req.method==='GET'&&url.pathname==='/healthz')return json(res,200,{service:'ask-kai-free-thai',status:'ok',provider_connected:false});
      if(req.method==='GET'&&url.pathname==='/api/runtime')return json(res,200,{scenario:'free_thai',backend:'mock_hskai',voice_configured:!!providerFactory,provider_connected:false,support_locale:'th',experimental:true,thai_quality_accepted:false,planner_configured:!!planner});
      if(req.method==='GET'&&url.pathname==='/api/poc/learners')return json(res,200,await pocPort.list());
      if(req.method==='POST'&&url.pathname==='/api/poc/launch'){
        const input=await readJson(req,256);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='uid')||typeof input.uid!=='string'||!pocPort.has(input.uid))return json(res,400,{error:'INVALID_MOCK_LEARNER'});
        const token=await pocPort.issue(input.uid),identity=bridge.verify(token,'session:create');
        res.setHeader('Set-Cookie',`${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=60`);
        return json(res,200,{source:'mock_hskai',uid:identity.learner_id});
      }
      if(req.method==='POST'&&url.pathname==='/api/conversation-preparations'){
        const identity=authorize(req,'session:create'),input=await readJson(req,512),entry=freeEntry(input);if(input.preparation_id!==undefined)throw Error('INVALID_THAI_ENTRY');
        return json(res,202,preparations.create(identity,entry));
      }
      const preparation=url.pathname.match(/^\/api\/conversation-preparations\/([A-Za-z0-9_-]{1,128})$/);
      if(preparation){const identity=authorize(req,'session:create');if(req.method==='GET')return json(res,200,{...preparations.view(identity,preparation[1]),scenario:'free_thai'});if(req.method==='DELETE'){preparations.cancel(identity,preparation[1]);return json(res,200,{status:'cancelled'});}}
      if(req.method==='POST'&&url.pathname==='/api/sessions'){
        if(!providerFactory)return json(res,501,{error:'VOICE_NOT_CONFIGURED',provider_connected:false});
        const identity=authorize(req,'session:create'),input=await readJson(req,512),entry=freeEntry(input);
        if(typeof input.preparation_id!=='string')return json(res,400,{error:'PREPARATION_REQUIRED'});
        identity.memory=await memoryPort.read(identity);
        let planning;try{planning=await preparations.consume(identity,input.preparation_id,entry);}catch{return json(res,409,{error:'PREPARATION_UNAVAILABLE_OR_STALE'});}
        bridge.consume(identity);
        return json(res,201,{...await realtime.create({origin,mode:'free',identity,planning,bindPlanning:(result,id)=>preparations.bind(result,id),speechPace:entry.speech_pace}),scenario:'free_thai'});
      }
      if(req.method==='POST'&&url.pathname==='/api/authorization/revoke'){const identity=authorize(req,'session:revoke');preparations.revoke(identity);realtime.revoke(identity);return json(res,200,{revoked:true});}
      const conversation=url.pathname.match(/^\/api\/conversations\/([A-Za-z0-9_-]{1,128})$/);
      if(req.method==='GET'&&conversation)return json(res,200,await planningPort.readConversation(authorize(req,'context:read'),conversation[1]));
      return json(res,404,{error:'NOT_FOUND'});
    }catch(error){const code=error.message;json(res,['UNAUTHORIZED','WRONG_LEARNER','CONSENT_OR_MARKET_DENIED','LAUNCH_ALREADY_USED'].includes(code)?401:code==='PREPARATION_NOT_FOUND'?404:code==='SESSION_CAPACITY'||code==='PREPARATION_CAPACITY'?429:400,{error:['INVALID_THAI_ENTRY','PREPARATION_NOT_FOUND','PREPARATION_CAPACITY','SESSION_CAPACITY'].includes(code)?code:'THAI_REQUEST_UNAVAILABLE'});}
  });
  const realtime=attachRealtime(server,{...realtimeOptions,providerFactory,providerKind,planningPort,planner,safeguardingPort:backend.safeguardingPort,businessSource:'mock_hskai',protocol:PROTOCOL,websocketPath:'/api/realtime-thai',conversationFactory:ticket=>new ThaiFreeTalkSession({sessionId:ticket.session_id,mode:'free',memory:ticket.identity.memory,speechPace:ticket.speech_pace,planning:ticket.planning,planner,resourceVerifier:planningPort.checkResource?(resource,options)=>planningPort.checkResource(ticket.identity,resource,options):null})});
  server.stopRealtime=()=>{preparations.close();realtime.close();};server.on('close',()=>server.stopRealtime());return server;
}
