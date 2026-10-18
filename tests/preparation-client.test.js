import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PreparationClient,preparationReadyMessage } from '../apps/realtime-gateway/public/preparation-client.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const response=value=>({ok:true,json:async()=>value});

test('ready status distinguishes validation failure, timeout, configuration and provider failure without exposing raw errors',()=>{
  for(const [reason,label] of Object.entries({planner_validation_failed:'规划结果未通过检查',planner_timeout:'规划超时',planner_unconfigured:'规划模型尚未配置',planner_unavailable:'规划服务暂不可用'}))assert.equal(preparationReadyMessage({degraded:true,degraded_reason:reason}),`对话已准备；${label}，当前使用保守策略。`);
  for(const reason of ['PRIVATE_RESPONSE','__proto__',undefined])assert.equal(preparationReadyMessage({degraded:true,degraded_reason:reason}),'对话已准备；当前使用保守策略。');
  assert.equal(preparationReadyMessage({degraded:false}),'对话已准备，可以开始。');
});

test('browser accepts a fallback returned at the server planning deadline on the next poll',async t=> {
  t.mock.timers.enable({apis:['setTimeout']});
  let ready=false;
  const statuses=[],views=[];
  const view={planning:{degraded:true,planner_kind:'rule'}};
  const client=new PreparationClient({
    fetcher:async(_path,options={})=>options.method==='POST'
      ?response({preparation_id:'prepared'})
      :response(ready?{status:'ready',view}:{status:'preparing'}),
    onStatus:state=>statuses.push(state),onView:value=>views.push(value)
  });
  const pending=client.prepare({mode:'topic',topic_id:'sports'});
  await flush();
  t.mock.timers.tick(14950);await flush();
  ready=true;
  t.mock.timers.tick(100);await flush();
  assert.equal(await pending,'prepared');
  assert.deepEqual(statuses,['preparing','ready']);
  assert.deepEqual(views,[view]);
});

test('browser still bounds waiting when preparations never finish',async t=> {
  t.mock.timers.enable({apis:['setTimeout']});
  const statuses=[];
  const client=new PreparationClient({
    fetcher:async(_path,options={})=>response(options.method==='POST'?{preparation_id:'stuck'}:{status:'preparing'}),
    onStatus:state=>statuses.push(state)
  });
  const pending=client.prepare({mode:'free'});await flush();
  t.mock.timers.tick(20000);await flush();
  assert.equal(await pending,null);
  assert.deepEqual(statuses,['preparing','failed']);
});

test('switching entries during the extra wait never displays an old result or failure',async t=> {
  t.mock.timers.enable({apis:['setTimeout']});
  const statuses=[],views=[];
  const client=new PreparationClient({
    fetcher:async(_path,options={})=>response(options.method==='POST'?{preparation_id:'old'}:{status:'preparing'}),
    onStatus:state=>statuses.push(state),onView:value=>views.push(value)
  });
  const pending=client.prepare({mode:'free'});await flush();
  t.mock.timers.tick(15100);await flush();
  client.cancel();await flush();
  t.mock.timers.tick(5000);await flush();
  assert.equal(await pending,null);
  assert.deepEqual(statuses,['preparing']);
  assert.deepEqual(views,[]);
});
