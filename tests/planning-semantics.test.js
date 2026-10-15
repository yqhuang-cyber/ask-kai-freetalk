import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkPlanningBehavior } from '../apps/eval-runner/src/planning-semantics.js';
test('independent authored constraints reject plausible but wrong goals, action and help scope',()=> {
  const expect={goal:null,actions:['RESPOND','SCAFFOLD'],local_help:true,new_points:0};
  const good={goal:null,action:'RESPOND',local_help:true,new_points:0};
  assert.equal(checkPlanningBehavior(good,expect).passed,true);
  for(const bad of [{goal:'express-likes'},{action:'INVITE_PRACTICE'},{local_help:false},{new_points:1}])assert.equal(checkPlanningBehavior({...good,...bad},expect).passed,false);
  assert.equal(checkPlanningBehavior(good,expect).semantic_review,'pending');
});
test('behavior constraints are authored separately from prompts and contain no reference reply',async()=> {
  const raw=await readFile('docs/eval-datasets/dynamic-goals-v1/cases.json','utf8'),data=JSON.parse(raw);
  assert.equal(data.cases.length,12);assert.equal(new Set(data.cases.map(c=>c.id)).size,12);
  assert.ok(!raw.includes('reference_answer'));
  for(const c of data.cases)assert.ok(c.turns.every(t=>typeof t.text==='string'&&Object.keys(t.expect).length));
});
