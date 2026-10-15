import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservationCoordinator,JsonObservationPort,observationInput,validateObservationCandidate } from '../packages/agent-core/observation-port.js';
import { learnerFixture,SPORTS_RESOURCE } from '../apps/hskai-mock/src/planning-fixtures.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
const snapshot=(text='篮球是我最喜欢的运动。')=>({plan:{session_id:'s',revision:1,goal_status:'active',primary_goal:SPORTS_RESOURCE.goals[0]},turn:{turn_id:'t',source_event_id:'input',text,input_revision:1,revision:1,authorization_epoch:1,expires_at:Date.now()+5000},resource:SPORTS_RESOURCE,actual_context:[],learner_feedback:null});
const draft={kp_id:'likes-expression',relation:'learner_expression',semantic_fit:'appropriate',span:{start:0,end:11}};
test('model-independent observation port produces sourced uncalibrated candidates for a paraphrase, never learning facts',async()=> {
  const port=new JsonObservationPort({transport:{completeJSON:async({messages,schema})=>{assert.ok(schema.properties.span);const input=JSON.parse(messages[1].content);assert.equal(input.source.text,snapshot().turn.text);return draft;}}});
  const c=new ObservationCoordinator({port});const row=await c.start(snapshot());assert.equal(row.status,'candidate_validated');assert.equal(row.candidate.goal_id,'express-likes');assert.equal(row.candidate.source_event_id,'input');assert.equal(row.candidate.learning_fact,false);assert.equal(row.candidate.semantic_review,'uncalibrated');
});
test('candidate rejects out-of-goal KP, invalid spans, quoted/reported roles and injected mastery fields',()=> {
  const input=observationInput(snapshot());
  for(const bad of [{...draft,kp_id:'time-expression'},{...draft,span:{start:0,end:999}},{...draft,mastered:true},{...draft,support:'independent'},{...draft,relation:'question'}])assert.throws(()=>validateObservationCandidate(bad,input));
  assert.throws(()=>validateObservationCandidate({...draft,span:{start:1,end:7}},observationInput(snapshot('“我喜欢篮球”是什么意思？'))),/ROLE_CONFLICT/);
  assert.throws(()=>validateObservationCandidate({...draft,span:{start:4,end:10}},observationInput(snapshot('老师说，我喜欢篮球。'))),/ROLE_CONFLICT/);
  assert.throws(()=>validateObservationCandidate({...draft,span:{start:0,end:5}},observationInput(snapshot('我喜欢篮球吗？'))),/ROLE_CONFLICT/);
});
test('shadow observation cancellation/deadline isolate results even if an adapter ignores abort',async()=> {
  let release;const c=new ObservationCoordinator({port:{observeLearner:()=>new Promise(r=>{release=r;})}});
  const pending=c.start(snapshot());await Promise.resolve();c.cancel('new_input');const row=await pending;release(draft);await Promise.resolve();assert.equal(row.status,'cancelled');assert.equal(c.rows.filter(r=>r.status==='candidate_validated').length,0);
  const timeout=new ObservationCoordinator({budgetMs:10,port:{observeLearner:()=>new Promise(()=>{})}});assert.equal((await timeout.start(snapshot())).status,'timeout');
  const stale=new ObservationCoordinator({port:{observeLearner:async()=>draft}});assert.equal((await stale.start(snapshot(),{isCurrent:()=>false})).status,'stale');
  let calls=0;const expired=new ObservationCoordinator({port:{observeLearner:async()=>{calls++;return draft;}}}),old=snapshot();old.turn.expires_at=Date.now()-1;
  assert.equal((await expired.start(old)).status,'stale');assert.equal(calls,0);
});
test('new input, goal change and close cancel real TeachingSession observation work without changing saved evidence',async()=> {
  const identity={owner_id:'owner',learner_id:'learner',scopes:['session:create'],authorization_until:Date.now()+60000},initializer=new ConversationInitializer({port:{read:async()=>learnerFixture(identity),getResource:async()=>SPORTS_RESOURCE}}),planning=new Preparations({initializer}).bind(await initializer.prepare({mode:'topic',topic_id:'sports'},identity),'s');
  let release;const s=new TeachingSession({sessionId:'s',mode:'sports',planning,observationPort:{observeLearner:()=>new Promise(r=>{release=r;})}});
  const e=(text,id)=>({version:1,event_id:'input-'+id,session_id:'s',turn_id:id,seq:1,at_ms:0,type:'user.final',payload:{text}});
  const old=e('篮球是我最喜欢的运动。','old');s.accept(old);await s.planTurn(old);const work=s.planning.observationWork;const next=e('我不想练习了。','new');s.accept(next);await s.planTurn(next);assert.equal((await work).status,'cancelled');release(draft);assert.equal(s.planning.plan.goal_status,'paused');assert.equal(s.learningRecord().observations.length,0);s.finalize();assert.equal(s.planning.observationCoordinator.closed,true);
});
test('completed shadow candidates never become attempt assessment or persisted facts',async()=> {
  const identity={owner_id:'owner',learner_id:'learner',scopes:['session:create'],authorization_until:Date.now()+60000},initializer=new ConversationInitializer({port:{read:async()=>learnerFixture(identity),getResource:async()=>SPORTS_RESOURCE}}),planning=new Preparations({initializer}).bind(await initializer.prepare({mode:'topic',topic_id:'sports'},identity),'s');
  const s=new TeachingSession({sessionId:'s',mode:'sports',planning,observationPort:{observeLearner:async()=>draft}}),e={version:1,event_id:'input',session_id:'s',turn_id:'t',seq:1,at_ms:0,type:'user.final',payload:{text:snapshot().turn.text}};s.accept(e);await s.planTurn(e);await s.planning.observationWork;
  assert.equal(s.planning.observationCoordinator.rows[0].status,'candidate_validated');assert.equal(s.planning.review().assessment.attempt_count,0);assert.equal(s.learningRecord().observations.length,0);assert.equal(s.planning.plan.primary_goal.id,'express-likes');s.finalize();
});
