import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request} from 'node:http';
import WebSocket from 'ws';
import {startMockBackend} from '../apps/hskai-mock/src/backend.js';
import {createThaiApp} from '../apps/free-talk-thai/src/server.js';
import {createShareProxy} from '../apps/free-talk-thai/src/share.js';
import {TestProvider,until} from './helpers/realtime.js';

const PUBLIC='https://share.example',HOST='share.example';
const send=(port,{method='GET',path,headers={},body})=>new Promise((resolve,reject)=>{
  const payload=body===undefined?undefined:JSON.stringify(body);
  const req=request({host:'127.0.0.1',port,method,path,headers:{...headers,...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{})}},res=>{let data='';res.setEncoding('utf8');res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:data}));});
  req.on('error',reject);req.end(payload);
});

test('share proxy only accepts a bare HTTPS origin and a valid target port',()=>{
  for(const origin of ['http://share.example','https://share.example/path','https://user@share.example','https://share.example/?q=1','not a url'])assert.throws(()=>createShareProxy({publicOrigin:origin,targetPort:4311}),origin);
  assert.throws(()=>createShareProxy({publicOrigin:PUBLIC,targetPort:0}),/INVALID_TARGET_PORT/);
});

test('share proxy admits only the configured public origin and carries the Thai session end to end',async t=>{
  const backend=await startMockBackend(),providers=[],app=createThaiApp({backend,providerKind:'test',providerFactory:()=>{const p=new TestProvider();providers.push(p);return p;}});
  app.listen(0,'127.0.0.1');await once(app,'listening');
  const proxy=createShareProxy({publicOrigin:PUBLIC,targetPort:app.address().port});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const port=proxy.address().port;
  const sockets=[];
  t.after(async()=>{for(const ws of sockets)ws.terminate();await new Promise(r=>{proxy.close(r);proxy.closeAllConnections();});app.stopRealtime();await new Promise(r=>{app.close(r);app.closeAllConnections();});await backend.close();});
  let cookie;
  const call=(path,body,headers={})=>send(port,{method:body===undefined?'GET':'POST',path,body,headers:{Host:HOST,Origin:PUBLIC,...(cookie?{Cookie:cookie}:{}),...headers}});

  const page=await send(port,{path:'/',headers:{Host:HOST}});assert.equal(page.status,200);assert(page.headers['content-security-policy'].includes(`connect-src 'self' wss://${HOST}`));
  assert.equal((await send(port,{path:'/',headers:{Host:'other.example'}})).status,403);
  assert.equal((await send(port,{path:'/',headers:{Host:'127.0.0.1:'+port}})).status,403);
  assert.equal((await call('/api/poc/launch',{uid:'poc-learner'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await send(port,{method:'POST',path:'/api/poc/launch',body:{uid:'poc-learner'},headers:{Host:HOST}})).status,403);

  const launch=await call('/api/poc/launch',{uid:'poc-learner'});assert.equal(launch.status,200);cookie=launch.headers['set-cookie'][0].split(';')[0];
  const prepared=JSON.parse((await call('/api/conversation-preparations',{mode:'free',speech_pace:'slow'})).body);
  const deadline=Date.now()+3000;for(;;){const view=JSON.parse((await call('/api/conversation-preparations/'+prepared.preparation_id)).body);if(view.status==='ready')break;assert(view.status!=='failed'&&Date.now()<deadline,'THAI_PREPARATION_FAILED');await new Promise(r=>setTimeout(r,10));}
  const ticket=JSON.parse((await call('/api/sessions',{mode:'free',speech_pace:'slow',preparation_id:prepared.preparation_id})).body);assert.equal(ticket.protocol,'ask-kai.thai.v1');

  const url='ws://127.0.0.1:'+port+ticket.websocket_path,protocols=[ticket.protocol,'ticket.'+ticket.ticket];
  const foreign=new WebSocket(url,protocols,{origin:'https://evil.example',headers:{Host:HOST}});sockets.push(foreign);foreign.on('error',()=>{});
  const [,rejected]=await once(foreign,'unexpected-response');assert.equal(rejected.statusCode,403);
  const ws=new WebSocket(url,protocols,{origin:PUBLIC,headers:{Host:HOST}}),packets=[];sockets.push(ws);ws.on('error',()=>{});ws.on('message',b=>packets.push(JSON.parse(b)));
  await once(ws,'open');assert.equal(ws.protocol,'ask-kai.thai.v1');
  providers[0].emit('session.ready');await until(()=>packets.some(x=>x.event?.type==='session.ready'));
});
