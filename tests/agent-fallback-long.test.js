import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateLongSession } from '../apps/eval-runner/src/long-session.js';
import { conservativeTurn } from '../packages/agent-core/planning-state.js';
import { validateTurn } from '../packages/agent-core/plan-validator.js';
import { fallbackDecision } from '../packages/agent-core/fallback-policy.js';
import { checkGoalPatch } from '../packages/agent-core/goal-lifecycle.js';
import { SPORTS_RESOURCE,learnerFixture } from '../apps/hskai-mock/src/planning-fixtures.js';
const input=(reason,extras={})=>({turn:{source_event_id:'input',text:'当前内容'},policy:{action:'RESPOND',reason,teaching_paused:false},...extras});
test('fallback actions distinguish sourced difficulty, help, refusal, reported content and actual attempts',()=> {
  const cases=[['ordinary',{},'conservative_planner_fallback'],['student_requested_help',{},'fallback_local_expression_help'],['student_understanding_help',{},'fallback_understanding_help'],['student_continuation_help',{},'fallback_continuation_help'],['student_declined',{policy:{action:'RESPOND',reason:'student_declined',teaching_paused:true}},'fallback_respect_current_choice'],['ordinary',{learner_feedback:{signal:'difficulty_report'}},'fallback_student_difficulty'],['ordinary',{learner_feedback:{signal:'supported_attempt'}},'fallback_follow_observed_content'],['ordinary',{turn:{source_event_id:'input',text:'老师说，我喜欢篮球。'}},'fallback_reported_content']];
  for(const [reason,extras,code] of cases){const p=conservativeTurn(input(reason,extras));assert.equal(p.rationale_code,code);assert.equal(p.reply_directive.new_points,0);assert.equal(p.goal_assessment,null);}
});
test('a declined prerequisite cannot be auto restored by either a rule or a model patch',()=> {
  const context=learnerFixture({owner_id:'o',learner_id:'l'},{variant:'b'}),plan={goal_status:'active',primary_goal:SPORTS_RESOURCE.goals[1]},review={difficulty_count:2,session_declined_goal_ids:['express-likes']},turn={source_event_id:'input',text:'这个练习我还是不会。'};
  const snapshot={plan,turn,policy:{action:'RESPOND',teaching_paused:false},learning_profile:context.learning_profile,learning_history:context.learning_history,resource:SPORTS_RESOURCE,goal_review:review,learner_feedback:{signal:'difficulty_report'}};
  assert.equal(conservativeTurn(snapshot).proposed_plan_patch,null);assert.equal(conservativeTurn(snapshot).rationale_code,'fallback_student_difficulty');
  assert.throws(()=>checkGoalPatch({op:'replace',goal_id:'express-likes',refs:['input']},{plan,context,resource:SPORTS_RESOURCE,choice:{kind:'difficulty'},policy:snapshot.policy,input:turn,review}),/SESSION_DECLINED/);
  assert.doesNotThrow(()=>checkGoalPatch({op:'replace',goal_id:'express-likes',refs:['input']},{plan,context,resource:SPORTS_RESOURCE,choice:{kind:'select',goal_id:'express-likes'},policy:snapshot.policy,input:turn,review}));
});
test('three authored long sessions preserve all 44 constraints, goal provenance and final summary',async()=> {
  const data=JSON.parse(await readFile('docs/eval-datasets/agent-long-session-v2/cases.json'));let total=0;
  for(const c of data.cases){const r=await evaluateLongSession(c);assert.equal(r.passed,true,c.id);assert.equal(r.snapshots,c.turns.length);assert.ok(r.turns.every(t=>t.planner==='rule'));assert.ok(r.summary.goals.every(g=>g.assessment==='unverified'));total+=r.turns.length;}
  assert.equal(total,44);
});
test('shadow observation candidates remain separate across long goal transitions and persistence',async()=> {
  const data=JSON.parse(await readFile('docs/eval-datasets/agent-long-session-v2/cases.json'));
  const port={observeLearner:async input=>({kp_id:input.key_points[0].id,relation:'unknown',semantic_fit:'uncertain',span:null})};
  const r=await evaluateLongSession(data.cases[1],{observationPort:port});assert.equal(r.passed,true);assert.equal(r.summary.attempts,0);assert.ok(r.shadow_candidates.length>0);assert.ok(r.shadow_candidates.every(c=>c.learning_fact===false));
});
