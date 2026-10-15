import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSummary,SummaryState } from '../apps/realtime-gateway/public/summary-cards.js';
import { summaryFixture } from './helpers/summary.js';
const project=packet=>projectSummary(packet,{sessionId:packet.session_id,mode:packet.summary.mode});
test('all entry modes project sourced attempts and optional review without identifiers or assessment claims',()=> {
  for(const mode of ['sports','mission','free']) {
    const p=summaryFixture({mode}),v=project(p);assert.equal(v.items[0].attempts,1);assert.equal(v.items[0].text,'我喜欢足球');assert.equal(v.review.id,v.items[0].id);assert.equal(v.synthetic,true);assert.equal(v.mock,true);
    const json=JSON.stringify(v);for(const key of ['session_id','source_event_id','response_id','completion_id','mastered'])assert.ok(!json.includes(key));
  }
});
test('conversation, insufficient, text-only and unsupported goals remain honest zero-attempt views',()=> {
  const chat=project(summaryFixture({mode:'free',practice:false}));assert.equal(chat.focus,'conversation_only');assert.deepEqual(chat.items,[]);assert.equal(chat.goal,null);assert.equal(chat.review,null);
  assert.equal(project(summaryFixture({empty:true})).focus,'insufficient');
  const text=project(summaryFixture({mode:'free',textOnly:true}));assert.equal(text.focus,'target_text_observed');assert.equal(text.items[0].attempts,0);
  const other=project(summaryFixture({mode:'mission',unsupported:true}));assert.equal(other.goal.supported,false);assert.deepEqual(other.items,[]);
});
test('partial facts stay marked partial; suppressed data never projects points even if the packet includes stale items',()=> {
  assert.equal(project(summaryFixture({failed:true})).partial,true);
  const p=summaryFixture({suppressed:true});p.summary.learning_items=summaryFixture().summary.learning_items;
  const v=project(p);assert.equal(v.focus,'unavailable');assert.deepEqual(v.items,[]);assert.equal(v.goal,null);assert.equal(v.review,null);
});
test('unknown versions, foreign session/mode, unsourced refs and inconsistent counts are rejected',()=> {
  const mutations=[p=>p.summary.schema_version=99,p=>p.summary.policy_version='unknown',p=>p.session_id='foreign',p=>p.summary.session_id='foreign',p=>p.summary.mode='free',p=>p.summary.assessment.mastery_assessed=true,
    p=>p.summary.learning_items[0].attempt_refs=[],p=>p.summary.learning_items[0].attempt_refs[0].session_id='foreign',p=>p.summary.learning_items[0].attempt_count=10,p=>p.summary.counts.attempts=-1,
    p=>p.summary.learning_items.push(p.summary.learning_items[0]),p=>p.summary.review_suggestions[0].expression_id='missing',p=>p.summary.learning_items[0]=null,p=>p.summary.learning_items[0].attempt_refs=[null],p=>p.summary.goals=[null],p=>{p.summary.goals=[];delete p.summary.learning_items[0].goal_id;},p=>p.summary.review_suggestions=[null]];
  for(const mutate of mutations){const p=summaryFixture();mutate(p);assert.equal(projectSummary(p,{sessionId:'fixture-summary',mode:'sports'}),null);}
});

test('legacy summaries remain displayable and v2 recaps require matching session sources without projecting identifiers',()=>{
  const legacy=summaryFixture();legacy.summary.schema_version=1;legacy.summary.policy_version='kai-summary-v1';delete legacy.summary.conversation_recap;assert.ok(project(legacy));
  const p=summaryFixture(),v=project(p);assert.deepEqual(v.recap.topics,['运动']);assert.equal(v.recap.expressions[0].text,'我喜欢足球');
  assert.ok(!JSON.stringify(v.recap).includes('source_event_id'));
  p.summary.conversation_recap.expressions[0].source_refs[0].session_id='foreign';assert.equal(project(p),null);
});
test('wrong or missing forwarded text provenance cannot become a target-only card',()=> {
  for(const mutate of [p=>p.summary.learning_items[0].target_text_refs=[],p=>p.summary.learning_items[0].target_text_refs[0].playback_confirmed=true,p=>p.summary.learning_items[0].target_text_refs[0].source_event_ids=[],p=>p.summary.learning_items[0].target_text_refs[0].scope='heard']) {
    const p=summaryFixture({mode:'free',textOnly:true});mutate(p);assert.equal(project(p),null);
  }
});
test('state binds to the ticket, accepts one summary and fences old replies after restart or mode change',()=> {
  const s=new SummaryState(),p=summaryFixture();assert.equal(s.accept(p),false);s.begin(p.session_id,'sports');assert.equal(s.accept(p),true);assert.equal(s.accept(p),false);
  const result=s.finish();result.items[0].text='mutated';assert.equal(s.finish().items[0].text,'我喜欢足球');assert.equal(s.accept(p),false);
  s.begin('new-session','free');assert.equal(s.accept(p),false);assert.equal(s.finish().focus,'unavailable');s.reset();assert.equal(s.finish(),null);
});
test('missing/invalid receipt produces unavailable and safety/revocation clears a previously accepted summary',()=> {
  const s=new SummaryState();s.begin('s','sports');assert.equal(s.finish().reason,'missing');
  const p=summaryFixture();s.begin(p.session_id,'sports');s.accept(p);s.suppress('safety');assert.equal(s.accept(p),false);assert.deepEqual(s.finish().items,[]);assert.equal(s.finish().focus,'unavailable');
  s.begin(p.session_id,'sports');s.accept(p);s.suppress('authorization');assert.equal(s.finish().review,null);
});
