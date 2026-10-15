import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HskaiPrivacyPort } from '../packages/hskai-bridge/privacy.js';
import { HskaiSafeguardingPort } from '../packages/hskai-bridge/safeguarding.js';
import { HskaiBridge,signAssertion } from '../packages/hskai-bridge/identity.js';
import { setup } from './helpers/realtime.js';
const secret='test-only-control-plane-secret-not-a-real-key';
test('privacy workflow acknowledges only queued requests and binds upstream owner scope',async()=> {
  const port=new HskaiPrivacyPort({endpoint:'https://hskai.example/internal/privacy',secret,fetcher:async(url,options)=>{
    const [body]=options.headers.Authorization.slice(7).split('.');const claims=JSON.parse(Buffer.from(body,'base64url'));assert.equal(claims.aud,'hskai-privacy');assert.equal(claims.learner_id,'learner-a');assert.equal(options.redirect,'error');
    return new Response(JSON.stringify({request_id:'r1',status:'pending'}));
  }});
  assert.equal((await port.request({owner_id:'owner-a',learner_id:'learner-a'},'erase')).status,'pending');
  const bad=new HskaiPrivacyPort({endpoint:'https://hskai.example/internal/privacy',secret,fetcher:async()=>new Response(JSON.stringify({request_id:'r1',status:'completed'}))});
  await assert.rejects(bad.request({owner_id:'owner-a',learner_id:'learner-a'},'erase'),/ACK/);
});
test('safeguarding requires acknowledgement of an assigned human team; no raw text sent',async()=> {
  const sent=[];
  const port=new HskaiSafeguardingPort({endpoint:'https://hskai.example/internal/safety',secret,fetcher:async(url,options)=>{sent.push(JSON.parse(options.body));return new Response(JSON.stringify({accepted:true,case_id:'case-1',assigned_team:'care-team'}));}});
  const result=await port.request({identity:{owner_id:'owner-a',learner_id:'learner-a'},session_id:'s1',source_event_id:'e1',reason:'abuse',policy_version:'v1'});
  assert.equal(result.delivered,true);assert.deepEqual(Object.keys(sent[0]).sort(),['policy_version','reason','request_id','session_id','source_event_id']);
  await assert.rejects(port.request({reason:'raw student text'}),/REASON/);
});
test('memory rights remain available after voice consent is withdrawn',()=> {
  const now=Math.floor(Date.now()/1000),bridge=new HskaiBridge({secret,markets:[]});
  const token=signAssertion({v:1,iss:'hskai',aud:'ask-kai',owner_id:'o1',learner_id:'l1',jti:'n1',iat:now,exp:now+30,minor:true,market:'not-admitted',consent:{voice:false,guardian:false},scopes:['memory:delete']},secret);
  assert.equal(bridge.verify(token,'memory:delete').learner_id,'l1');assert.throws(()=>bridge.verify(token,'session:create'));
});
test('privacy route does not allow learner identity injection',async t=> {
  const {origin}=await setup(t,{privacyPort:{request:async()=>({request_id:'r1',status:'pending'})}});
  const response=await fetch(origin+'/api/privacy/requests',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({operation:'erase',learner_id:'victim'})});assert.equal(response.status,400);
  const info=await(await fetch(origin+'/api/privacy')).json();assert.equal(info.local_audio_persistence,false);assert.equal(info.provider_retention,'not_verified');
});
