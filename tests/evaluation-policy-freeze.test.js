import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LANGUAGE_INSTRUCTIONS,LANGUAGE_POLICY_VERSION,LanguageSupport} from '../apps/eval-runner/src/evaluation-language-v3.js';
import {REPLY_INSTRUCTIONS,REPLY_POLICY_VERSION,REPLY_BUDGET,measureReply} from '../apps/eval-runner/src/evaluation-reply-v3.js';
const sha=s=>createHash('sha256').update(s).digest('hex');
test('evaluation keeps the reviewed v3 language and reply contract independent of candidate code',()=>{
  assert.equal(LANGUAGE_POLICY_VERSION,'kai-language-v3');assert.equal(REPLY_POLICY_VERSION,'kai-reply-v3');
  assert.equal(sha(LANGUAGE_INSTRUCTIONS),'33f519092bb18a629ab288297e7f50276e51037c40f2616cd2b643e453d6ebb0');
  assert.equal(sha(REPLY_INSTRUCTIONS),'e4701a6c0884c29a9ba74cff2a95c9ff206564427f2888572766e48f6f423967');
  assert.deepEqual(REPLY_BUDGET,{pairs:2,chinese_chars:36,english_words:24,spoken_units:48,text_chars:180,questions:1,new_points:1,examples:1});
  const p=new LanguageSupport();p.observe('只用中文');assert.equal(p.snapshot().english_support,'off');
  assert.equal(measureReply('一'.repeat(37)).budget_exceeded,true);
});
