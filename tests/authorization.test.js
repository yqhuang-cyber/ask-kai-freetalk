import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { HskaiBridge,signAssertion } from '../packages/hskai-bridge/identity.js';
import { InMemoryLearnerStore,HskaiMemoryPort } from '../packages/hskai-bridge/memory.js';
import { setup,until } from './helpers/realtime.js';
const secret='test-only-bridge-secret-not-for-real-accounts';
function claims(extra={}) {
  const now=Math.floor(Date.now()/1000);
  return {v:1,iss:'hskai',aud:'ask-kai',owner_id:'owner-a',learner_id:'learner-a',jti:randomUUID(),iat:now,exp:now+60,authorization_until:now+600,market:'SG',minor:true,consent:{voice:true,guardian:true},scopes:['session:create','memory:read','memory:write','memory:delete','session:revoke'],...extra};
}
const token=extra=>signAssertion(claims(extra),secret);
const headers=extra=>({Authorization:`Bearer ${token(extra)}`});
test('signed identity rejects forged, expired, unconsented or wrong audience assertions',()=> {
  const bridge=new HskaiBridge({secret,markets:['SG']});
  assert.equal(bridge.verify(token(),'session:create').learner_id,'learner-a');
  for(const extra of [{aud:'wrong'},{exp:0},{consent:{voice:true,guardian:false}},{market:'US'},{scopes:['memory:read']}])assert.throws(()=>bridge.verify(token(extra),'session:create'));
  assert.throws(()=>bridge.verify(token().replace(/.$/,'!'),'session:create'));
  const signed=token();const [body,sig]=signed.split('.');const forged=Buffer.from(JSON.stringify(claims({learner_id:'victim'}))).toString('base64url');assert.throws(()=>bridge.verify(`${forged}.${sig}`,'session:create'),/UNAUTHORIZED/);
  assert.ok(body);assert.throws(()=>new HskaiBridge({secret:'short'}),/CONFIGURED/);
});
test('launch nonce is single-use and trusted Mission completion is mandatory',()=> {
  const bridge=new HskaiBridge({secret,markets:['SG']});const identity=bridge.verify(token(),'session:create');bridge.consume(identity);assert.throws(()=>bridge.consume(identity),/ALREADY_USED/);
  assert.throws(()=>bridge.verify(token({mission:{id:'m1',completion_id:'c1',completed:false,title:'课程',targets:['你好']}}),'session:create'),/MISSION/);
});
test('HttpOnly launch-cookie format is supported without exposing secrets to frontend JS',()=> {
  const bridge=new HskaiBridge({secret,markets:['SG']});const signed=token();
  const identity=bridge.authorize({headers:{cookie:`other=x; ask_kai_launch=${signed}; other2=y`}},'session:create');assert.equal(identity.owner_id,'owner-a');
});
test('owner-scoped memory correction, read and deletion resist identity injection',async t=> {
  const bridge=new HskaiBridge({secret,markets:['SG']}),memoryPort=new InMemoryLearnerStore();
  const {origin}=await setup(t,{bridge,memoryPort});
  const call=(method,input,extra={},path='/api/memory')=>fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...headers(extra)},...(input?{body:JSON.stringify(input)}:{})});
  assert.equal((await call('POST',{field:'interest',value:'足球'})).status,200);
  const own=await(await call('GET')).json();assert.equal(own.records[0].value,'足球');assert.equal(own.records[0].source,'student_correction');
  const other=await(await call('GET',null,{owner_id:'owner-b'},'/api/memory?learner_id=learner-a')).json();assert.equal(other.records.length,0);
  assert.equal((await call('POST',{field:'interest',value:'篮球',learner_id:'victim'})).status,400);
  assert.equal((await call('POST',{field:'mastery',value:'accurate'})).status,400);
  assert.equal((await call('DELETE',{})).status,200);assert.equal((await(await call('GET')).json()).records.length,0);
});
test('memory mutation requires write scope and matching origin even with query strings',async t=> {
  const {origin}=await setup(t,{bridge:new HskaiBridge({secret,markets:['SG']}),memoryPort:new InMemoryLearnerStore()});
  const body=JSON.stringify({field:'interest',value:'足球'});
  assert.equal((await fetch(origin+'/api/memory',{method:'POST',headers:{Origin:origin,...headers({scopes:['memory:read']})},body})).status,401);
  assert.equal((await fetch(origin+'/api/memory?x=1',{method:'POST',headers:{Origin:'http://evil.example',...headers()},body})).status,403);
});
test('trusted Mission mode and launch ticket cannot be forged by browser fields',async t=> {
  const bridge=new HskaiBridge({secret,markets:['SG']});const {origin,create,open}=await setup(t,{bridge});
  const mission={id:'m1',completion_id:'c1',completed:true,title:'运动任务',targets:['喜欢']};
  const launch=headers({mission});
  const bootstrap=await(await fetch(origin+'/api/bootstrap',{headers:launch})).json();assert.ok(bootstrap.modes.includes('mission'));
  assert.equal((await create({mode:'mission',mission_id:'foreign'},launch)).status,403);
  assert.equal((await create({mode:'mission',mission_id:'m1',title:'伪造'},launch)).status,400);
  const response=await create({mode:'mission',mission_id:'m1'},launch);assert.equal(response.status,201);
  assert.equal((await create({mode:'sports'},launch)).status,401);
  const {provider}=await open(await response.json());assert.match(provider.input.instructions,/运动任务/);
});
test('deletion and consent revocation end only the authorized learner connection',async t=> {
  const bridge=new HskaiBridge({secret,markets:['SG']}),memoryPort=new InMemoryLearnerStore();const {origin,create,open}=await setup(t,{bridge,memoryPort});
  const a=await open(await(await create({mode:'sports'},headers())).json());
  const b=await open(await(await create({mode:'sports'},headers({owner_id:'owner-b',learner_id:'learner-b'}))).json());
  a.provider.emit('session.ready');a.provider.emit('user.final',{text:'我喜欢足球'},{turn_id:'t1'});
  const closed=once(a.ws,'close');const response=await fetch(origin+'/api/authorization/revoke',{method:'POST',headers:{Origin:origin,...headers({consent:{voice:false,guardian:false}})}});
  assert.equal(response.status,200);await closed;assert.equal(a.provider.closed,true);assert.notEqual(b.provider.closed,true);
  const summary=a.packets.find(p=>p.type==='teaching.summary');assert.equal(summary.summary.focus,'unavailable');assert.equal(summary.summary.end_reason,'authorization_revoked');
  assert.deepEqual(summary.attempts,[]);assert.deepEqual(summary.summary.learning_items,[]);assert.equal(summary.goal,'');assert.ok(!b.packets.some(p=>p.type==='teaching.summary'));
  b.provider.emit('session.ready');await until(()=>b.packets.some(p=>p.event?.type==='session.ready'));
});
test('HSKai memory port requires HTTPS, bounded data and signed owner scope; no redirects',async()=> {
  assert.throws(()=>new HskaiMemoryPort({endpoint:'http://upstream.invalid',secret}),/ENDPOINT/);
  const port=new HskaiMemoryPort({endpoint:'https://hskai.example/internal/ask-kai/memory',secret,fetcher:async(url,options)=> {
    assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).operation,'read');
    const [body]=options.headers.Authorization.slice(7).split('.');const scoped=JSON.parse(Buffer.from(body,'base64url'));assert.equal(scoped.owner_id,'owner-a');assert.equal(scoped.aud,'hskai-memory');
    return new Response(JSON.stringify({records:[]}));
  }});
  assert.deepEqual(await port.read({owner_id:'owner-a',learner_id:'learner-a'}),[]);
});
