import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TeachingSession} from '../packages/agent-core/teaching.js';
import {REPLY_BUDGET} from '../packages/agent-core/reply-policy.js';
import {REPLY_BUDGET as FROZEN_BUDGET} from '../apps/eval-runner/src/evaluation-reply-v3.js';
const event=(text,turn)=>({version:1,event_id:`e-${turn}`,session_id:'s',seq:1,at_ms:0,type:'user.final',turn_id:turn,payload:{text}});
test('being stuck but willing to chat offers a sourced low-pressure continuation without new teaching',()=>{
  for(const text of ['I have no new topic, but I still want a little friendly chat.',"I don't know what to say next but I'm still here for a little chat.",'没有新话题，但我还想聊。','I have no new question, but I would like a related idea to keep chatting.']){
    const s=new TeachingSession({sessionId:'s',mode:'sports'});s.accept(event('我喜欢足球。','topic'));s.accept(event(text,'stuck'));const d=s.view().decision;
    assert.equal(d.reason,'student_continuation_help',text);assert.equal(d.action,'RESPOND');assert.equal(d.new_points,0);
    assert.equal(d.goal_id,null);assert.equal(d.reference_context_turn_id,'topic');assert.equal(s.stage,'practice');
    assert.equal(s.evidence.length,1); // The existing explicit statement only.
  }
});
test('quoted help and unwillingness do not imply a continuation, and no profile or old goal is resumed',()=>{
  const s=new TeachingSession({sessionId:'s',mode:'free'});s.accept(event('只想聊天，不练习。','pause'));
  s.accept(event('没有新话题，但我还想聊。','stuck'));assert.equal(s.view().decision.teaching_paused,true);
  for(const text of ['I have no new topic.',"I don't want to keep chatting.",'She said "I have no new topic but still want to chat".']){
    s.accept(event(text,text.length.toString()));assert.notEqual(s.view().decision.reason,'student_continuation_help',text);
  }
  assert.equal(REPLY_BUDGET.chinese_chars,null);assert.equal(FROZEN_BUDGET.chinese_chars,36);assert.equal(s.memory.length,0);
});
