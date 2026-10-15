import {test} from 'node:test';
import assert from 'node:assert/strict';
import {failureCode,failureMessage} from '../apps/realtime-gateway/public/failure-messages.js';
import {ExperienceTrace} from '../apps/realtime-gateway/public/diagnostics.js';
test('failure categories stay distinguishable without rendering untrusted error text',()=>{
  assert.match(failureMessage('PLAYBACK_BACKLOG'),/待播放语音过多/);
  assert.match(failureMessage('CONTEXT_ACK_TIMEOUT'),/更新等待超时/);
  assert.match(failureMessage('PROVIDER_PROTOCOL_ERROR'),/返回的数据无法处理/);
  for(const code of ['PRIVATE_KEY_AND_TRANSCRIPT','toString','__proto__',null,{}]){
    assert.equal(failureCode(code),'other');assert.equal(failureMessage(code),'实时连接中断，请重新开始。');
  }
});
test('metadata diagnostics retain the playback failure category without private exception text',()=>{
  const trace=new ExperienceTrace();trace.record('browser.failed',{code:failureCode('PLAYBACK_BACKLOG'),text:'PRIVATE'});
  trace.record('browser.failed',{code:failureCode('PRIVATE_KEY_AND_TRANSCRIPT')});
  const result=trace.snapshot();assert.deepEqual(result.timeline.map(r=>r.code),['PLAYBACK_BACKLOG','other']);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
