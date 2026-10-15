import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanningSemanticReviewer,PLANNING_RUBRIC,validateSemanticReview } from '../apps/eval-runner/src/planning-semantic-review.js';
import { authoredReviewInputs } from '../scripts/review-planning.js';
const input={student_input:{text:'authored fixture'},plan_proposal:{task:'synthetic proposal'},learner_feedback:{semantic_review:'unverified'}};
const valid={criteria:PLANNING_RUBRIC.map(r=>({id:r.id,verdict:'unknown',reason:'insufficient_evidence',refs:['learner_feedback']}))};
test('semantic review requires all independent criteria and known source blocks, never fabricated evidence',()=> {
  assert.equal(validateSemanticReview(valid,input).criteria.length,8);
  for(const value of [{criteria:valid.criteria.slice(1)},{criteria:valid.criteria.map(c=>({...c,id:'current_intent'}))},{criteria:valid.criteria.map(c=>({...c,refs:['future_student']}))},{criteria:valid.criteria.map(c=>({...c,refs:['resource']}))},{...valid,raw_reasoning:'PRIVATE'},{criteria:valid.criteria.map(c=>({...c,reason:'PRIVATE_EXCERPT'}))}])assert.throws(()=>validateSemanticReview(value,input),/INVALID/);
});
test('future review transport receives rubric and actual inputs, never evaluation expectations',async()=> {
  const reviewer=new PlanningSemanticReviewer({transport:{provider:'fixture',model:'future-review-fixture',completeJSON:async({messages,schema})=>{assert.ok(schema.properties.criteria);assert.ok(messages[0].content.includes('rubric'));assert.deepEqual(JSON.parse(messages[1].content),input);return valid;}}});
  const r=await reviewer.review(input);assert.equal(r.status,'reviewed');assert.equal(r.all_criteria_pass,false);assert.equal(r.semantic_quality_accepted,false);assert.equal(r.human_calibrated,false);
  assert.equal((await reviewer.review({...input,expect:{gold:'do not transmit'}})).status,'invalid_input');
});
test('even a positive model review is auxiliary and never grants learning/quality acceptance',async()=> {
  const reviewer=new PlanningSemanticReviewer({transport:{provider:'fixture',model:'fixture',completeJSON:async()=>({criteria:valid.criteria.map(c=>({...c,verdict:'pass',reason:'supported'}))})}});
  const r=await reviewer.review(input);assert.equal(r.all_criteria_pass,true);assert.equal(r.semantic_quality_accepted,false);assert.equal(r.human_calibrated,false);
});
test('review timeout/cancel and invalid result preserve unknown without exposing provider errors',async()=> {
  const slow=new PlanningSemanticReviewer({budgetMs:15,transport:{completeJSON:()=>new Promise(()=>{})}});assert.equal((await slow.review(input)).status,'timeout');
  const controller=new AbortController();controller.abort();assert.equal((await slow.review(input,{signal:controller.signal})).status,'cancelled');
  const broken=new PlanningSemanticReviewer({transport:{completeJSON:async()=>{throw new Error('PRIVATE_PROVIDER_RESPONSE');}}});const r=await broken.review(input);assert.equal(r.status,'invalid_or_unavailable');assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
test('accepted-plan reviews refuse non-authored inputs or foreign sessions before any transmission',()=> {
  const dataset={cases:[{id:'authored',turns:[{text:'known authored input'}]}]};
  const row={case_id:'authored',index:0,input:'known authored input',plan:{session_id:'eval-authored',planner_kind:'llm'},goal_review:{}};
  assert.throws(()=>authoredReviewInputs([row],dataset),/SOURCE_REQUIRED/);
  assert.throws(()=>authoredReviewInputs([{...row,input:'private learner content'}],dataset),/SOURCE_REQUIRED/);
  assert.throws(()=>authoredReviewInputs([{...row,plan:{...row.plan,session_id:'foreign'}}],dataset),/SOURCE_REQUIRED/);
  assert.throws(()=>authoredReviewInputs([{...row,plan:{...row.plan,planner_kind:'rule'}}],dataset),/SOURCE_REQUIRED/);
});
