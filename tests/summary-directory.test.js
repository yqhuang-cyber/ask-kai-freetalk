import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GENERAL_EXPRESSIONS,directExpression,forwardedExpressionRanges} from '../packages/agent-core/summary-directory.js';
test('directory observes literal clauses without crediting quotes, negation, questions or unrelated substrings',()=>{
  const music=GENERAL_EXPRESSIONS.find(e=>e.id==='likes-music'),hot=GENERAL_EXPRESSIONS.find(e=>e.id==='hot');
  assert.equal(directExpression('我喜欢音乐。',music),true);
  for(const text of ['我不喜欢音乐。','他说我喜欢音乐。','我喜欢音乐吗？','“我喜欢音乐”。','请翻译“我喜欢音乐”。'])assert.equal(directExpression(text,music),false,text);
  assert.equal(directExpression('热闹。',hot),false);assert.equal(directExpression('热。',hot),true);
  const apple=GENERAL_EXPRESSIONS.find(e=>e.id==='apple'),text='“苹果”。 Apple.';const ranges=forwardedExpressionRanges(text,apple);assert.equal(ranges.length,1);assert.equal(text.slice(ranges[0].from,ranges[0].to),'苹果');
  assert.equal(forwardedExpressionRanges('苹果汁。',apple).length,0);
});
