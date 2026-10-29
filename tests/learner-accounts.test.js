import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { MOCK_LEARNERS,accountContext,accountSyllabusInventory } from '../apps/hskai-mock/src/learner-accounts.js';
import { LEARNER_PARTS,assembleLearnerContext } from '../packages/contracts/learner-data.js';
import { signAssertion } from '../packages/hskai-bridge/identity.js';
import { validateLearningRecord } from '../packages/contracts/planning.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { setup } from './helpers/realtime.js';
async function backendFor(t,options={}){const b=await startMockBackend(options);t.after(()=>b.close());return b;}
const authorize=async(b,uid)=>b.bridge.verify(await b.pocPort.issue(uid),'session:create');

test('authored accounts have UID-linked profiles, bounded knowledge and referenced mock mastery',async t=>{
  const b=await backendFor(t),catalog=await b.pocPort.list();assert.equal(catalog.learners.length,5);
  assert.deepEqual(catalog.learners.map(l=>l.course_level),['HSK1','HSK3','HSK5','HSK7','HSK1']);
  assert.equal(new Set(catalog.learners.map(l=>l.uid)).size,5);
  const counts=[];
  for(const a of catalog.learners){
    const i=await authorize(b,a.uid),ctx=await b.planningPort.read(i);
    assert.equal(ctx.learner_id,a.uid);assert.equal(ctx.student_profile.preferred_name,a.name);assert.equal(ctx.learning_profile.course_level,a.course_level);
    assert.equal(ctx.student_profile.native_language,a.uid==='mock-dao-hsk4'?'泰语':'en');
    assert.ok(ctx.student_profile.background.learning_motivation);assert.ok(ctx.learning_profile.ability_summary);
    const full=await b.learnerDataPort.readPart(i,'learning-profile');assert.ok(full.inventory.grammar_total>70);
    const summary=ctx.learning_profile.syllabus_summary;assert.equal(summary.grammar_mastered,full.inventory.grammar_mastered);assert.ok(!Object.hasOwn(summary,'grammar_points'));
    for(const k of full.inventory.grammar_points)if(k.introduced_level!=='7-9'&&Number(k.introduced_level)<=Number(a.course_level.slice(3)))assert.equal(k.mastery_status,'mock_mastered');
    const ids=new Set(ctx.learning_history.map(h=>h.record_id));
    for(const state of ctx.learning_profile.kp_states)assert.ok(state.evidence_refs.every(ref=>ids.has(ref)));
    const mastered=ctx.learning_profile.knowledge_points.filter(k=>k.mastery_status==='mock_mastered');counts.push(mastered.length);
    assert.ok(mastered.every(k=>k.evidence_origin==='authored_fixture'));assert.equal(ctx.learning_history.length,6);
  }
  assert.deepEqual(counts,[7,12,12,16,7]);
  const dao=await b.planningPort.read(await authorize(b,'mock-dao-hsk4'));
  assert.equal(dao.student_profile.background.life_context.includes('曼谷'),true);
  assert.equal(dao.learning_profile.syllabus_summary.completed_level,1);
  assert.equal(dao.learning_profile.syllabus_summary.current_study_scope,'2');
  assert.equal(dao.learning_profile.syllabus_summary.grammar_mastered,70);
  assert.equal(dao.learning_profile.syllabus_summary.vocabulary.reference_cumulative,300);
  assert.equal(dao.learning_profile.comprehension,'beginner');
  assert.deepEqual(dao.learning_profile.reported_known_expressions,[]);
  assert.deepEqual(dao.learning_profile.review_candidates,['frequency-expression']);
  const {ThaiFreeTalkSession}=await import('../packages/free-talk-thai/session.js');
  const memory=await b.memoryPort.read(await authorize(b,'mock-dao-hsk4'));
  assert.equal(memory.find(r=>r.field==='chinese_comprehension').value,'beginner');
  const session=new ThaiFreeTalkSession({sessionId:'dao-profile-check',mode:'free',memory});
  assert.equal(session.languageSnapshot().comprehension,'beginner');
  assert.equal(session.languageSnapshot().support_mode,'required');
});

test('planning read calls three independently scoped HTTP interfaces; foreign UID, scope and stale envelopes fail',async t=>{
  const paths=[],b=await backendFor(t,{fetcher:(url,args)=>{paths.push(new URL(url).pathname);return fetch(url,args);}}),i=await authorize(b,MOCK_LEARNERS[1].uid);
  paths.length=0;await b.planningPort.read(i);
  assert.deepEqual(paths.sort(),Object.keys(LEARNER_PARTS).map(p=>`/internal/ask-kai/${p}`).sort());
  for(const part of Object.keys(LEARNER_PARTS)){
    await assert.rejects(b.learnerDataPort.readPart({...i,owner_id:'foreign'},part));
    await assert.rejects(b.learnerDataPort.readPart({...i,scopes:['context:read']},part));
    await assert.rejects(b.learnerDataPort.readPart({...i,authorization_until:0},part));
  }
  const rows=await Promise.all(Object.keys(LEARNER_PARTS).map(async p=>[p,await b.learnerDataPort.readPart(i,p)]));const parts=structuredClone(Object.fromEntries(rows));
  parts['learning-profile'].revision++;assert.throws(()=>assembleLearnerContext(parts,i),/SNAPSHOT_CHANGED/);
  parts['learning-profile'].revision--;parts['personal-profile'].data.contact='forbidden';assert.throws(()=>assembleLearnerContext(parts,i),/STUDENT_PROFILE/);
});

test('internal part endpoints bind audience/nonce/UID to the signed assertion, not request fields',async t=>{
  const b=await backendFor(t),i=await authorize(b,MOCK_LEARNERS[2].uid),now=Math.floor(Date.now()/1000),part='learning-profile';
  const claims={v:1,iss:'ask-kai',aud:`hskai-${part}`,owner_id:i.owner_id,learner_id:i.learner_id,scopes:['learning-profile:read'],operation:'read',iat:now,exp:now+30,jti:randomUUID()};
  const call=(token,input={operation:'read'},headers={})=>fetch(b.learnerDataPort.endpoints[part],{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
  const token=signAssertion(claims,b.bridge.secret);assert.equal((await call(token)).status,200);assert.equal((await call(token)).status,401);
  assert.equal((await call(signAssertion({...claims,jti:randomUUID(),aud:'hskai-personal-profile'},b.bridge.secret))).status,401);
  assert.equal((await call(signAssertion({...claims,jti:randomUUID()},b.bridge.secret),{operation:'read',uid:MOCK_LEARNERS[0].uid})).status,400);
  assert.equal((await call(signAssertion({...claims,jti:randomUUID(),scopes:[]},b.bridge.secret))).status,403);
  assert.equal((await call(signAssertion({...claims,jti:randomUUID()},b.bridge.secret),undefined,{Origin:'http://evil.example'})).status,403);
});

test('preference edits and saved attempts are learner-isolated and never promote authored mastery',async t=>{
  const b=await backendFor(t),one=await authorize(b,MOCK_LEARNERS[0].uid),two=await authorize(b,MOCK_LEARNERS[1].uid),before=await b.planningPort.read(one),other=await b.planningPort.read(two),now=Date.now();
  await b.memoryPort.write(one,{field:'interest',value:'游泳',source:'student_correction',updated_at:new Date(now).toISOString(),expires_at:new Date(now+86400000).toISOString()});
  const record=validateLearningRecord({schema_version:'learning-record-v1',session_id:'same-session',plan_id:'plan-one',plan_revision:1,resource_ref:{id:'sports',version:'mock-sports-v3'},observations:[{observation_id:'obs-one',turn_id:'turn-one',source_event_id:'event-one',kp_id:'likes-expression',state:'attempted',support:'unknown',execution_ref:null}],outcome:'ended',source:'ask_kai_observation'});
  const receipt=await b.planningPort.append(one,record,record.session_id),duplicate=await b.planningPort.append(one,record,record.session_id);assert.equal(receipt.receipt_id,duplicate.receipt_id);
  const after=await b.planningPort.read(one),unchanged=await b.planningPort.read(two);assert.equal(after.student_profile.interests[0].label,'游泳');assert.equal(unchanged.revision,other.revision);assert.equal(unchanged.learning_history.length,6);
  assert.deepEqual(after.learning_profile.knowledge_points,before.learning_profile.knowledge_points);assert.deepEqual(after.learning_profile.kp_states,before.learning_profile.kp_states);
  assert.ok(after.learning_history[0].observations[0].includes('未评估掌握'));
  await b.memoryPort.delete(one);assert.deepEqual((await b.planningPort.read(one)).student_profile.interests,[]);
});

test('bounded history marks truncation without claiming that old evidence or mastery was newly assessed',async t=>{
  const b=await backendFor(t),i=await authorize(b,MOCK_LEARNERS[3].uid);
  for(let n=0;n<6;n++)await b.planningPort.append(i,{schema_version:'learning-record-v1',session_id:`history-${n}`,plan_id:'plan-history',plan_revision:1,resource_ref:null,observations:[],outcome:'ended',source:'ask_kai_observation'},`history-${n}`);
  const c=await b.planningPort.read(i);assert.equal(c.learning_history.length,10);assert.equal(c.coverage.learning_history,'partial');assert.equal(c.history_page.truncated,true);
});

test('selected UID launch and three protected browser APIs feed initialization and reject browser identity injection',async t=>{
  const b=await backendFor(t),g=await setup(t,{...b,planningMode:'next_turn_advisory'});
  const launch=async uid=>fetch(g.origin+'/api/poc/launch',{method:'POST',headers:{Origin:g.origin,'Content-Type':'application/json'},body:JSON.stringify({uid})});
  for(const p of Object.keys(LEARNER_PARTS))assert.equal((await fetch(g.origin+`/api/learner/${p}`)).status,401);
  assert.equal((await launch('victim')).status,400);
  const response=await launch(MOCK_LEARNERS[2].uid),cookie=response.headers.get('set-cookie').split(';')[0];assert.equal((await response.json()).uid,MOCK_LEARNERS[2].uid);
  for(const p of Object.keys(LEARNER_PARTS)){const r=await fetch(g.origin+`/api/learner/${p}`,{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.equal((await r.json()).uid,MOCK_LEARNERS[2].uid);}
  assert.equal((await fetch(g.origin+'/api/learner/personal-profile',{headers:{Cookie:cookie,'X-Ask-Kai-Mock-Uid':MOCK_LEARNERS[1].uid}})).status,401);
  assert.equal((await fetch(g.origin+'/api/memory',{method:'POST',headers:{Cookie:cookie,Origin:g.origin,'Content-Type':'application/json','X-Ask-Kai-Mock-Uid':MOCK_LEARNERS[1].uid},body:'{"field":"interest","value":"wrong-learner"}'})).status,401);
  assert.equal((await fetch(g.origin+'/api/learner/personal-profile?uid=poc-learner',{headers:{Cookie:cookie}})).status,400);
  const i=await authorize(b,MOCK_LEARNERS[2].uid);let captured;
  const initializer=new ConversationInitializer({port:b.planningPort,planner:{planConversation:async input=>{captured=input;throw new Error('offline');}}});
  await initializer.prepare({mode:'topic',topic_id:'sports'},i);
  assert.equal(captured.student_profile.preferred_name,'Leo');assert.equal(captured.learning_profile.course_level,'HSK5');assert.equal(captured.learning_profile.knowledge_points.length,16);assert.equal(captured.learning_profile.syllabus_summary.grammar_mastered,409);assert.equal(captured.learning_profile.syllabus_summary.vocabulary.reference_cumulative,3600);assert.equal(captured.learning_history.length,6);
});

test('catalog and UID switching do not exist on gateways without the mock backend',async t=>{
  const g=await setup(t);assert.equal((await fetch(g.origin+'/api/poc/learners')).status,404);
  assert.equal((await fetch(g.origin+'/api/learner/learning-profile')).status,501);
});

test('aggregation retries a revision race once and fails persistent mixed snapshots',async()=>{
  const { HskaiLearnerDataPort }=await import('../packages/hskai-bridge/learner-data-port.js');
  const { learnerPart }=await import('../packages/contracts/learner-data.js');
  const now=Date.now(),identity={...MOCK_LEARNERS[1],authorization_until:now+60000,scopes:['context:read',...Object.values(LEARNER_PARTS).map(p=>p.scope)]};
  for(const persistent of [false,true]){
    let calls=0;
    const port=new HskaiLearnerDataPort({endpoints:Object.fromEntries(Object.keys(LEARNER_PARTS).map(p=>[p,`http://127.0.0.1:1234/${p}`])),allowLocal:true,secret:'synthetic-secret-for-learner-race-only',fetcher:async url=>{
      const n=calls++,part=new URL(url).pathname.slice(1),revision=n%3===0&&(persistent||n<3)?1:2;
      return new Response(JSON.stringify(learnerPart(accountContext(identity,{revision,now,fixtureAt:now}),part,'mock-learners-v2',part==='learning-profile'?accountSyllabusInventory(identity,{fixtureAt:now}):undefined)));
    }});
    if(persistent)await assert.rejects(port.read(identity),/SNAPSHOT_CHANGED/);else assert.equal((await port.read(identity)).revision,2);
    assert.equal(calls,6);
  }
});


test('official reference is cumulative, source indexed and advanced 7-9 is not all mastered by HSK7',async()=>{
  const {HSK_REFERENCE}=await import('../apps/hskai-mock/src/hsk-inventory.js');
  const {accountSyllabusInventory}=await import('../apps/hskai-mock/src/learner-accounts.js');
  const {validateSyllabusInventory}=await import('../packages/contracts/hsk-inventory.js');
  assert.deepEqual(HSK_REFERENCE.vocabulary_counts,{'1':300,'2':200,'3':500,'4':1000,'5':1600,'6':1800,'7-9':5600});
  const inv=MOCK_LEARNERS.map(i=>accountSyllabusInventory(i));
  assert.deepEqual(inv.map(x=>x.grammar_mastered),[70,244,409,530,70]);
  for(let n=1;n<4;n++){const now=new Map(inv[n].grammar_points.map(p=>[p.kp_id,p]));for(const p of inv[n-1].grammar_points.filter(k=>k.mastery_status==='mock_mastered'))assert.equal(now.get(p.kp_id)?.mastery_status,'mock_mastered');}
  assert.equal(inv[3].per_level['7-9'].total,134);assert.equal(inv[3].per_level['7-9'].mastered,72);
  const missing=structuredClone(inv[1]);missing.grammar_points.find(k=>k.introduced_level==='1').mastery_status='practicing';assert.throws(()=>validateSyllabusInventory(missing,MOCK_LEARNERS[1]));
  const bad=structuredClone(inv[1]);bad.grammar_points[0].evidence_refs=['foreign-course'];assert.throws(()=>validateSyllabusInventory(bad,MOCK_LEARNERS[1]));
});
