import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TeachingSession} from '../packages/agent-core/teaching.js';
import {LanguageSupport,languageHelpKind,sameLanguageSupport} from '../packages/agent-core/language-support.js';
import {metadata} from '../apps/realtime-gateway/public/diagnostics.js';
const final=(text,turn)=>({version:1,event_id:`e-${turn}`,session_id:'s',seq:1,at_ms:0,type:'user.final',turn_id:turn,payload:{text}});
const mission={title:'Example',targets:['表达喜好']};
test('understanding help repairs the current conversation without teaching a new point or claiming mastery',()=>{
  for(const mode of ['free','sports','mission']){
    const s=new TeachingSession({sessionId:'s',mode,mission});
    s.accept(final('How do I say flower?','first'));
    s.accept(final("I don't understand the word.",'help'));const d=s.view().decision;
    assert.equal(d.action,'RESPOND');assert.equal(d.reason,'student_understanding_help');
    assert.equal(d.new_points,0);assert.equal(d.goal_id,null);assert.equal(d.reference_context_turn_id,'first');
    assert.equal(s.languageSnapshot().help_kind,'understanding');assert.equal(s.languageSnapshot().comprehension,'unknown');
    assert.equal(s.evidence.length,0);assert.equal(s.view().attempt_count,0);
    assert.equal(metadata({decision_reason:d.reason,private_text:'SECRET'}).decision_reason,d.reason);
  }
});
test('unanchored understanding requests clarify at most once, rather than alternating new questions',()=>{
  const s=new TeachingSession({sessionId:'s',mode:'free'});
  for(const [i,text]of ["I don't understand.",'我没听懂。',"I didn't get that."].entries()){
    s.accept(final(text,`help-${i}`));const d=s.view().decision;
    assert.equal(d.action,i===0?'CLARIFY_INTENT':'RESPOND');assert.equal(d.new_points,0);
    if(i>0)assert.equal(d.reason,'clarification_limit');
  }
});
test('current bilingual requests override a Chinese profile and misunderstanding never rewrites comprehension',()=>{
  const at=Date.now(),memory=['support_language','chinese_comprehension'].map((field,i)=>({field,value:i?'comfortable':'zh',source:'authorized_hskai_profile',updated_at:new Date(at).toISOString(),expires_at:new Date(at+86400000).toISOString()}));
  const p=new LanguageSupport({memory});p.observe('Please add English translation.',{turn_id:'switch'});
  assert.equal(p.snapshot().english_support,'required');p.observe('English only when needed.',{turn_id:'auto'});
  assert.equal(p.snapshot().english_support,'adaptive');p.observe("I don't understand.",{turn_id:'help'});
  const a=p.snapshot();assert.equal(a.english_support,'required');assert.equal(a.help_kind,'understanding');
  assert.equal(p.completeReply('old'),false);assert.equal(p.snapshot().help_kind,'understanding');
  p.completeReply('help');assert.equal(p.snapshot().help_kind,'none');assert.equal(p.snapshot().english_support,'adaptive');
  p.observe('Please speak Chinese only.',{turn_id:'zh'});p.observe('我没听懂你说的。',{turn_id:'help-zh'});
  assert.equal(p.snapshot().help_kind,'understanding');assert.equal(p.snapshot().english_support,'off');
  assert.equal(p.snapshot().comprehension,'comfortable');assert.deepEqual(p.memory,memory);
  assert.equal(sameLanguageSupport(a,{...a,help_kind:'expression'}),false);
});
test('quotes and reports cannot manufacture a request; expression help is distinct from comprehension',()=>{
  for(const text of ['He said "I don\'t understand".','他说“我没听懂”。',"Don't say I don't understand.",'我理解这个词。'])assert.equal(languageHelpKind(text),'none',text);
  for(const text of ['How can I add a place?','I don’t know how to combine these words.','这个词中文怎么说？'])assert.equal(languageHelpKind(text),'expression',text);
  const s=new TeachingSession({sessionId:'s',mode:'free'});s.accept(final('只想聊天，不练习。','pause'));s.accept(final('我没听懂。','help'));
  assert.equal(s.view().decision.teaching_paused,true);assert.equal(s.view().decision.new_points,0);
  const state=JSON.parse(s.language.instructions().split('本轮语言状态（JSON 数据）：')[1]);
  assert.equal(state.state_scope,'confirmed_history');assert.equal(state.current_input_takes_precedence,true);
});
test('a trusted Chinese default survives English questions while an explicit reply exception never becomes the next default',()=>{
  const at=Date.now(),record=value=>({field:'support_language',value,source:'authorized_hskai_profile',updated_at:new Date(at).toISOString(),expires_at:new Date(at+86400000).toISOString()});
  const p=new LanguageSupport({memory:[record('zh')]});
  p.observe('How do I say a color in Chinese?',{turn_id:'color'});assert.equal(p.snapshot().english_support,'off');
  assert.match(p.instructions(),/会话默认.*只说中文/);assert.equal(p.snapshot().help_kind,'expression');
  p.observe('这个词加英文解释。',{turn_id:'exception'});assert.equal(p.snapshot().english_support,'required');
  assert.match(p.instructions(),/会话默认.*只说中文/);p.completeReply('exception');assert.equal(p.snapshot().english_support,'off');
  p.observe('Please add English translation.',{turn_id:'setting'});assert.equal(p.snapshot().session_preference,'zh_en');
  assert.match(p.instructions(),/会话默认.*中文先说/);
  assert.deepEqual(p.memory,[record('zh')]);
});
