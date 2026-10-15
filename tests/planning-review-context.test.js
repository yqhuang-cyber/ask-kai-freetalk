import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { learnerFixture,SPORTS_RESOURCE } from '../apps/hskai-mock/src/planning-fixtures.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { conservativeTurn } from '../packages/agent-core/planning-state.js';
import { planHash } from '../packages/agent-core/plan-validator.js';
import { REVIEW_BUNDLE_VERSION,planningReviewRow,validatedBundleInputs } from '../apps/eval-runner/src/planning-review-bundle.js';
const identity={owner_id:'owner',learner_id:'learner',authorization_until:Date.now()+600000,scopes:['session:create']};
async function bound(){const initializer=new ConversationInitializer({port:{read:async()=>learnerFixture(identity,{variant:'b'}),getResource:async()=>SPORTS_RESOURCE}});return new Preparations({initializer}).bind(await initializer.prepare({mode:'topic',topic_id:'sports'},identity),'eval-case');}
const final=(text,id)=>({version:1,event_id:'input-'+id,session_id:'eval-case',seq:1,at_ms:0,type:'user.final',turn_id:id,payload:{text}});
test('review hook binds exactly the model input before a goal replacement, retaining original evidence after context changes',async()=> {
  const captures=[],inputs=[];
  const s=new TeachingSession({sessionId:'eval-case',mode:'sports',planning:await bound(),onAcceptedProposal:v=>captures.push(v),planner:{planTurn:async input=>{inputs.push(input);return conservativeTurn(input);}}});
  for(const [i,text] of ['这个练习太难了。','这个练习我还是不会。'].entries()){const e=final(text,'t'+i);s.accept(e);await s.planTurn(e);}
  assert.equal(s.planning.plan.primary_goal.id,'express-likes');assert.equal(captures[1].input_snapshot.plan.primary_goal.id,'express-time');assert.equal(planHash(captures[1].input_snapshot),planHash(inputs[1]));assert.ok(Object.isFrozen(captures[1].input_snapshot));
  const oldHash=planHash(captures[1]);s.updateLearnerContext(learnerFixture(identity,{variant:'d',revision:2}));assert.equal(planHash(captures[1]),oldHash);
});
test('a canceled late proposal never captures input for a newly accepted turn',async()=> {
  let release;const captures=[];
  const s=new TeachingSession({sessionId:'eval-case',mode:'sports',planning:await bound(),onAcceptedProposal:v=>captures.push(v),planner:{planTurn:input=>input.turn.turn_id==='old'?new Promise(r=>{release=()=>r(conservativeTurn(input));}):Promise.resolve(conservativeTurn(input))}});
  const old=final('你好。','old');s.accept(old);const pending=s.planTurn(old);await Promise.resolve();const next=final('再聊一句。','new');s.accept(next);await s.planTurn(next);release();assert.equal(await pending,null);assert.deepEqual(captures.map(c=>c.plan.turn_id),['new']);
});
test('full review bundle refuses changed snapshot, wrong binding, duplicate rows or unattested old arrays',async()=> {
  let captured;const s=new TeachingSession({sessionId:'eval-case',mode:'sports',planning:await bound(),planner:{planTurn:async input=>conservativeTurn(input)},onAcceptedProposal:v=>{captured=v;}});
  const e=final('我下午打篮球。','t');s.accept(e);await s.planTurn(e);const row=structuredClone(planningReviewRow('case',0,captured));row.plan.planner_kind='llm';const {hash,...body}=row.plan;row.plan.hash=planHash(body);row.proposal_hash=row.plan.hash;
  const dataset={cases:[{id:'case',turns:[{text:e.payload.text}]}]},bundle={schema_version:REVIEW_BUNDLE_VERSION,source:'authored_synthetic_goal_eval',dataset_sha256:'dataset',candidate:{},rows:[row]};
  const result=validatedBundleInputs(bundle,dataset,'dataset');assert.equal(result.length,1);assert.deepEqual(result[0].input.student_input,captured.input_snapshot.turn);assert.deepEqual(result[0].input.actual_context,captured.input_snapshot.actual_context);assert.equal(result[0].input.conversation_plan.primary_goal.id,'express-time');
  for(const mutate of [b=>b.rows[0].input_snapshot.turn.text='private',b=>b.rows[0].input_snapshot.plan.revision++,b=>delete b.rows[0].input_snapshot.actual_context,b=>b.rows[0].plan.input_ref='wrong',b=>b.rows.push(b.rows[0]),b=>b.dataset_sha256='different']){const bad=structuredClone(bundle);mutate(bad);assert.throws(()=>validatedBundleInputs(bad,dataset,'dataset'));}
  assert.throws(()=>validatedBundleInputs([row],dataset,'dataset'));
});
test('capture callback failure cannot control teaching execution and production defaults do not retain snapshots',async()=> {
  const s=new TeachingSession({sessionId:'eval-case',mode:'sports',planning:await bound(),onAcceptedProposal:()=>{throw new Error('PRIVATE');}});const e=final('你好。','t');s.accept(e);assert.ok(await s.planTurn(e));assert.equal(s.planning.acceptedInput,undefined);
});
test('captured actual teacher output and consumption are original snapshots, not later playback or future replies',async()=> {
  let captured;const s=new TeachingSession({sessionId:'eval-case',mode:'sports',planning:await bound(),onAcceptedProposal:v=>{captured=v;}});
  const packet=(type,text='')=>({event:{version:1,event_id:'teacher-'+type,session_id:s.sessionId,seq:1,at_ms:0,type,turn_id:'prior',response_id:'reply',payload:{text}}});
  s.planning.observe(packet('response.started'));s.planning.observe(packet('response.text.delta','可以说：我下午打篮球。'));s.planning.observe(packet('response.done'));
  const e=final('我下午打篮球。','t');s.accept(e);await s.planTurn(e);
  assert.equal(captured.input_snapshot.actual_context[0].role,'teacher');assert.equal(captured.input_snapshot.prior_execution.execution_id,'reply');assert.equal(captured.input_snapshot.prior_execution.consumption,'unknown');
  s.planning.consumption('reply',{state:'client_reported_complete',audio_ms:100});assert.equal(captured.input_snapshot.prior_execution.consumption,'unknown');
  assert.equal(captured.input_snapshot.learner_feedback.prompt.preceded_student_speech,'unknown');
});
