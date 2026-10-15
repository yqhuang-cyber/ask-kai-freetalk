import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { MOCK_IDENTITY,MOCK_MISSION } from '../apps/hskai-mock/src/server.js';
import { readConfig } from '../apps/realtime-gateway/src/config.js';
import { signAssertion } from '../packages/hskai-bridge/identity.js';
import { bridgeEndpoint } from '../packages/hskai-bridge/endpoint.js';
import { ExperienceTrace } from '../apps/realtime-gateway/public/diagnostics.js';
import { REPLY_POLICY_VERSION } from '../packages/agent-core/reply-policy.js';
import { setup,until } from './helpers/realtime.js';

async function backendFor(t){const urls=[];const backend=await startMockBackend({fetcher:(url,options)=>{assert.equal(new URL(url).hostname,'127.0.0.1');urls.push(url);return fetch(url,options);}});t.after(()=>backend.close());return {...backend,urls};}
async function gatewayFor(t,options={}){const backend=await backendFor(t),gateway=await setup(t,{...backend,...options});return {...gateway,backend};}
async function launch(origin,input={},originHeader=origin){const response=await fetch(origin+'/api/poc/launch',{method:'POST',headers:{Origin:originHeader,'Content-Type':'application/json'},body:JSON.stringify(input)});return {response,cookie:response.headers.get('set-cookie')?.split(';')[0]};}

test('standalone config defaults to mock; loopback allowance cannot reach an external HSKai endpoint',()=>{
  assert.equal(readConfig({}).backend,'mock');assert.equal(readConfig({ASK_KAI_BACKEND:'external'}).backend,'external');
  assert.throws(()=>readConfig({ASK_KAI_BACKEND:'test'}),/BACKEND/);
  assert.throws(()=>bridgeEndpoint('http://127.0.0.1:4000/x'),/ENDPOINT/);
  assert.equal(bridgeEndpoint('http://127.0.0.1:4000/x',{allowLocal:true}),'http://127.0.0.1:4000/x');
  for(const endpoint of ['http://hskai.example/x','https://hskai.example/x','http://localhost:4000/x','http://127.0.0.1:4000/x?secret=x'])assert.throws(()=>bridgeEndpoint(endpoint,{allowLocal:true}));
});

test('mock service issues real signed contracts for a fictional learner, with owner-isolated preferences',async t=>{
  const backend=await backendFor(t),identity=backend.bridge.verify(await backend.pocPort.issue(),'session:create');
  assert.equal(identity.learner_id,MOCK_IDENTITY.learner_id);assert.deepEqual(identity.mission,JSON.parse(JSON.stringify(MOCK_MISSION)));
  assert.equal((await backend.memoryPort.read(identity))[0].value,'足球');
  assert.deepEqual(await backend.memoryPort.read({owner_id:'another-owner',learner_id:identity.learner_id}),[]);
  assert.ok(backend.urls.length>=3);
});

test('POC launch is same-origin, HttpOnly and fixed identity; protected routes still reject missing authorization',async t=>{
  const {origin}=await gatewayFor(t);
  for(const path of ['/api/bootstrap','/api/memory'])assert.equal((await fetch(origin+path)).status,401);
  assert.equal((await fetch(origin+'/api/sessions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"mode":"sports"}'})).status,401);
  assert.equal((await launch(origin,{learner_id:'victim'})).response.status,400);
  assert.equal((await launch(origin,{},'http://evil.example')).response.status,403);
  const {response,cookie}=await launch(origin);assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Path=\/api; Max-Age=60/);
  const result=await response.json();assert.equal(result.source,'mock_hskai');assert.ok(!Object.hasOwn(result,'assertion'));
  const bootstrap=await(await fetch(origin+'/api/bootstrap',{headers:{Cookie:cookie}})).json();assert.equal(bootstrap.mission.id,MOCK_MISSION.id);
  const info=await(await fetch(origin+'/api/runtime')).json();assert.equal(info.backend,'mock_hskai');assert.equal(info.provider_connected,false);
  assert.equal((await(await fetch(origin+'/healthz')).json()).mode,'standalone_poc');
});

test('POC Mission tickets retain one-use authorization, course provenance and provider readiness separation',async t=>{
  const {origin,create,open}=await gatewayFor(t);const {cookie}=await launch(origin);
  assert.equal((await create({mode:'mission',mission_id:'foreign'},{Cookie:cookie})).status,403);
  const response=await create({mode:'mission',mission_id:MOCK_MISSION.id},{Cookie:cookie});assert.equal(response.status,201);
  assert.equal((await create({mode:'sports'},{Cookie:cookie})).status,401);
  const {provider,packets,ws}=await open(await response.json());assert.match(provider.input.instructions,/示例 Mission/);assert.ok(provider.input.instructions.includes(REPLY_POLICY_VERSION));
  assert.ok(!packets.some(p=>p.event?.type==='session.ready'));provider.emit('session.ready');await until(()=>packets.some(p=>p.event?.type==='session.ready'));
  assert.equal(packets.find(p=>p.event?.type==='session.ready').synthetic,true);
  ws.send(JSON.stringify({type:'diagnostics.enable'}));await until(()=>packets.some(p=>p.row?.name==='backend.config'));
  assert.equal(packets.find(p=>p.row?.name==='backend.config').row.fields.business_source,'mock_hskai');
  const trace=new ExperienceTrace();packets.filter(p=>p.row).forEach(p=>trace.gateway(p.row));
  assert.equal(trace.snapshot().business_source,'mock_hskai');assert.equal(trace.snapshot().kind,'synthetic');assert.equal(trace.snapshot().real_experience_accepted,false);
});

test('mock preferences round-trip, export and delete through unchanged gateway/HTTP port contracts',async t=>{
  const {origin,backend}=await gatewayFor(t);
  const call=async(method,path,input)=>{const {cookie}=await launch(origin);return fetch(origin+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});};
  assert.equal((await call('POST','/api/memory',{field:'interest',value:'篮球',learner_id:'victim'})).status,400);
  assert.equal((await call('POST','/api/memory',{field:'interest',value:'篮球'})).status,200);
  const exported=await(await call('GET','/api/memory/export')).json();assert.equal(exported.records[0].value,'篮球');assert.equal(exported.records[0].source,'student_correction');
  const oldIdentity=backend.bridge.verify(await backend.pocPort.issue(),'session:create');backend.bridge.clock=()=>Date.now()+61000;
  assert.throws(()=>backend.bridge.verify(signAssertion({v:1,iss:'hskai',aud:'ask-kai',...MOCK_IDENTITY,jti:'old',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,scopes:['session:create']},backend.bridge.secret),'session:create'),/UNAUTHORIZED/);
  backend.bridge.clock=()=>Date.now();assert.ok(oldIdentity);
  assert.equal((await call('DELETE','/api/memory',{})).status,200);assert.deepEqual((await(await call('GET','/api/memory')).json()).records,[]);
});

test('mock privacy completion applies only to local preferences and retains owner scope',async t=>{
  const backend=await backendFor(t),identity=backend.bridge.verify(await backend.pocPort.issue(),'session:create');
  const queued=await backend.privacyPort.request(identity,'erase');assert.equal(queued.status,'pending');assert.equal(queued.mocked,true);
  await assert.rejects(backend.privacyPort.request({owner_id:'another-owner',learner_id:identity.learner_id},'status',queued.request_id));
  const result=await backend.privacyPort.request(identity,'status',queued.request_id);assert.equal(result.status,'completed');assert.equal(result.scope,'local_mock_preferences_only');
  assert.deepEqual(await backend.memoryPort.read(identity),[]);
});

test('mock safety queue never claims a real human handoff or increments delivered-human metrics',async t=>{
  const {origin,create,open}=await gatewayFor(t);const {cookie}=await launch(origin),response=await create({mode:'sports'},{Cookie:cookie});
  const {provider,packets,ws}=await open(await response.json());const closed=once(ws,'close');provider.emit('session.ready');provider.emit('user.final',{text:'我想伤害自己'},{turn_id:'t1'});
  await closed;const handoff=packets.find(p=>p.type==='safety.handoff');assert.equal(handoff.mocked,true);assert.equal(handoff.delivered,false);
  assert.equal(packets.at(-1).code,'SAFETY_RESTRICTED');
  const info=await(await fetch(origin+'/api/privacy')).json();assert.equal(info.memory_truth_source,'local_mock_hskai');assert.equal(info.provider_retention,'not_verified');
  const metrics=JSON.stringify(await(await fetch(origin+'/api/metrics')).json());assert.ok(!metrics.includes('handoffs_delivered'));
});

test('internal mock HTTP checks signature, audience, operation, nonce, origin and identity injection',async t=>{
  const backend=await backendFor(t),now=Math.floor(Date.now()/1000),endpoint=backend.memoryPort.endpoint;
  const claims={v:1,iss:'ask-kai',aud:'hskai-memory',...MOCK_IDENTITY,jti:randomUUID(),iat:now,exp:now+30,operation:'read'};
  const signed=signAssertion(claims,backend.bridge.secret);
  const call=(token=signed,input={operation:'read'},headers={})=>fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
  assert.equal((await call()).status,200);assert.equal((await call()).status,401);
  assert.equal((await call(signAssertion({...claims,jti:randomUUID(),aud:'wrong'},backend.bridge.secret))).status,401);
  assert.equal((await call(signAssertion({...claims,jti:randomUUID()},backend.bridge.secret),{operation:'write'})).status,400);
  assert.equal((await call(signAssertion({...claims,jti:randomUUID()},backend.bridge.secret),{operation:'read',learner_id:'victim'})).status,400);
  assert.equal((await call(signAssertion({...claims,jti:randomUUID()},backend.bridge.secret),{operation:'read'},{Origin:'http://evil.example'})).status,403);
});

test('mock restart resets preferences and rotates signing secrets; non-POC gateway has no launch endpoint',async t=>{
  const first=await startMockBackend();let old;
  try{old=await first.pocPort.issue();await first.memoryPort.delete(MOCK_IDENTITY);}finally{await first.close();}
  const second=await backendFor(t);assert.throws(()=>second.bridge.verify(old,'session:create'),/UNAUTHORIZED/);assert.equal((await second.memoryPort.read(MOCK_IDENTITY)).length,1);
  const {origin}=await setup(t);assert.equal((await launch(origin)).response.status,404);
});

test('POC preview can bootstrap business data without a voice provider and never fabricates voice readiness',async t=>{
  const {origin}=await gatewayFor(t,{providerFactory:null});const {cookie}=await launch(origin);
  assert.equal((await fetch(origin+'/api/bootstrap',{headers:{Cookie:cookie}})).status,200);
  const result=await fetch(origin+'/api/sessions',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:'{"mode":"sports"}'});
  assert.equal(result.status,501);assert.equal((await result.json()).provider_connected,false);
});

test('actual POC entrypoint starts both local services and ignores external HSKai settings',async t=>{
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['apps/realtime-gateway/src/main.js','--poc'],{cwd:new URL('../',import.meta.url),env:{ASK_KAI_HOST:'127.0.0.1',ASK_KAI_PORT:String(port),ASK_KAI_PROVIDER:'replay',ASK_KAI_BACKEND:'external',HSKAI_MEMORY_ENDPOINT:'https://external-do-not-contact.invalid',HSKAI_BRIDGE_SECRET:'invalid'}});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let output='';child.stdout.on('data',chunk=>{output+=chunk;});
  const deadline=Date.now()+5000;
  while(!output.includes('Ask Kai POC:')){if(Date.now()>deadline || child.exitCode!==null)throw new Error('POC_START_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,20));}
  const origin=`http://127.0.0.1:${port}`;
  const {response,cookie}=await launch(origin);assert.equal(response.status,200);assert.equal((await fetch(origin+'/api/memory',{headers:{Cookie:cookie}})).status,200);
  const exiting=once(child,'exit');child.kill('SIGTERM');assert.equal((await exiting)[0],0);
});
