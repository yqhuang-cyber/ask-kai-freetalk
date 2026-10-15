import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TeachingSession} from '../packages/agent-core/teaching.js';
const setup=()=>{let i=0;const s=new TeachingSession({sessionId:'s',mode:'free'});return {s,say(text){s.accept({version:1,event_id:`e-${++i}`,session_id:'s',seq:i,at_ms:i,type:'user.final',turn_id:`t${i}`,payload:{text}});return s.view().decision;}};};
test('unbound multi-meaning expression requests clarify once without a guessed teaching target',()=>{
  for(const text of ['How do I say play for my hobby?','How can I say I like it hot?','How do I say bank?','How do I say I like that for my hobby?']){
    const {say}=setup();let d=say(text);assert.equal(d.action,'CLARIFY_INTENT',text);assert.equal(d.reason,'ambiguous_expression');assert.equal(d.new_points,0);
    d=say(text);assert.equal(d.reason,'clarification_limit');assert.equal(d.action,'RESPOND');assert.equal(d.new_points,0);
  }
});
test('current and actual prior sense cues answer directly; profile assumptions and multiple senses cannot choose a translation',()=>{
  for(const [context,request]of [['I like video games.','How do I say play?'],['I prefer spicy food.','How do I say hot?'],['I mean my savings account.','How do I say bank?']]){
    const {s,say}=setup();say(context);const d=say(request);assert.notEqual(d.action,'CLARIFY_INTENT');assert.equal(d.action,'TEACH_TARGET');
    assert.ok(!JSON.stringify(s.view()).includes(context));assert.ok(s.teaching.contextHints.length<=2);
  }
  for(const text of ['How do I say play piano?','How do I say hot tea?','How do I say a bank by the river?'])assert.notEqual(setup().say(text).action,'CLARIFY_INTENT',text);
  const {say}=setup();assert.equal(say('How do I say hot for spicy food or temperature?').action,'CLARIFY_INTENT');
});
test('topic changes discard stale cues, while correct sentences still stay conversation rather than correction',()=>{
  const {s,say}=setup();say('I like playing video games.');say('Can we talk about something else?');
  assert.equal(s.teaching.contextHints.length,0);assert.equal(say('How do I say play?').action,'CLARIFY_INTENT');
  const sports=new TeachingSession({sessionId:'s',mode:'sports'});sports.accept({version:1,event_id:'right',session_id:'s',seq:1,at_ms:0,type:'user.final',turn_id:'right',payload:{text:'我喜欢足球。'}});
  assert.equal(sports.view().decision.action,'FOLLOW_UP');assert.equal(sports.view().decision.new_points,0);
});
