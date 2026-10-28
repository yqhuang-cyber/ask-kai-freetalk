import test from 'node:test';
import assert from 'node:assert/strict';
import {ThaiLanguageSupport} from '../packages/free-talk-thai/language.js';
import {ThaiFreeTalkSession} from '../packages/free-talk-thai/session.js';
const input=(s,text,turn='t1')=>s.observe(text,{turn_id:turn,source_event_id:'e-'+turn,context_version:1});
test('ASR comma after reply scope never promotes a one-reply request into session preference',()=>{
  for(const text of ['这次，只用中文。','这次回答，请只说中文。','这一句，不要泰语解释。']){
    const s=new ThaiLanguageSupport();input(s,text);assert.equal(s.snapshot().request_scope,'reply',text);assert.equal(s.snapshot().session_preference,'auto',text);assert.equal(s.snapshot().support_mode,'off',text);s.completeReply('t1');assert.equal(s.snapshot().support_mode,'required',text);
  }
});
test('Thai quoted controls cannot change the current session',()=>{
  for(const text of ['‘只用中文’是什么意思？','「只用中文」是什么意思？','“这次只用中文”是什么意思？']){const s=new ThaiLanguageSupport();input(s,text);assert.equal(s.snapshot().session_preference,'auto',text);assert.equal(s.snapshot().request_scope,'default',text);}
});
test('session default and reply exception are separate in compiled Thai voice instructions',()=>{
  const s=new ThaiFreeTalkSession({sessionId:'s',mode:'free'});
  s.accept({version:1,event_id:'e1',session_id:'s',turn_id:'t1',seq:1,at_ms:1,type:'user.final',payload:{text:'这次只用中文。'}});
  const snapshot=s.contextSnapshot();assert.equal(snapshot.language.support_mode,'off');assert.equal(snapshot.language.session_support_mode,'required');assert(!snapshot.instructions.includes('当前会话设置：只用中文'));assert(snapshot.instructions.includes('本轮例外'));
});
test('Thai audit flags Latin leakage, Thai leakage while Chinese-only, and Thai before Chinese',()=>{
  const s=new ThaiFreeTalkSession({sessionId:'s',mode:'free'});
  for(const [text,mode] of [['你好。 Hello.','required'],['你好。 สวัสดี','off'],['สวัสดี。 你好。','required']]){const audit=s.createReplyAudit({languageContextMatched:true,language:{support_mode:mode}});audit.append(text);assert.equal(audit.finish('done').language_order_issue,true,text);}
});
test('old completion, rapid replacement and cancellation cannot clear a new reply language request',()=>{
  for(let repeat=0;repeat<20;repeat++){
    const s=new ThaiLanguageSupport();input(s,'这次只用中文。','old');input(s,'这次加上泰语解释。','new');assert.equal(s.completeReply('old'),false);assert.equal(s.snapshot().support_mode,'required');assert.equal(s.snapshot().request_scope,'reply');s.completeReply('new');assert.equal(s.snapshot().session_preference,'auto');assert.equal(s.snapshot().request_scope,'default');
  }
});
