import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TeachingSession} from '../packages/agent-core/teaching.js';
const final=(text,turn='end')=>({version:1,event_id:`e-${turn}`,session_id:'s',seq:1,at_ms:0,type:'user.final',turn_id:turn,payload:{text}});
test('authored end-and-recap requests all select closing without creating teaching evidence',async()=>{
  const data=JSON.parse(await readFile(new URL('../docs/eval-datasets/freechat-v3.1/ask-kai-freechat-eval-v3.1.json',import.meta.url)));
  for(const c of data.cases){const s=new TeachingSession({sessionId:'s',mode:'free'});s.accept(final(c.turns.at(-1).input.text));
    assert.equal(s.view().decision.action,'CLOSE',c.id);assert.equal(s.view().decision.new_points,0,c.id);assert.equal(s.evidence.length,0);
    assert.equal(s.stage,'closing');assert.equal(s.view().decision.goal_id,null);
  }
});
test('general endings pause all entry goals and a new chat never silently resumes the previous exercise',()=>{
  for(const mode of ['free','sports','mission'])for(const text of ['Can we end the chat?','We can stop here.','Please finish our conversation.','今天先到这儿。','这次练习结束了。','我得走了。']){
    const s=new TeachingSession({sessionId:'s',mode,mission:{title:'Example',targets:['表达喜好']}});s.accept(final(text));
    assert.equal(s.view().decision.action,'CLOSE',text);assert.equal(s.view().decision.teaching_paused,true);
    s.accept(final('我还想聊一下。','continue'));assert.equal(s.stage,'conversation');assert.equal(s.view().decision.teaching_paused,true);assert.equal(s.view().decision.new_points,0);
  }
});
test('quotes, word meanings, negations and uncertain ASR cannot manufacture a closing command',()=>{
  for(const text of ['Goodbye means 再见.','再见是一个词。','How do I say goodbye?','Can we stop saying goodbye?','Please do not end the chat.',"I'm not done.","I'm mending now.",'And the chat please recap.','老师说“我们结束聊天”。','What does "practice is over" mean?','不要结束聊天。']){
    const s=new TeachingSession({sessionId:'s',mode:'free'});s.accept(final(text));assert.notEqual(s.view().decision.action,'CLOSE',text);
  }
});
