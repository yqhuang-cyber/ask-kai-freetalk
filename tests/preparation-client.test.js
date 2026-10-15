import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PreparationClient } from '../apps/realtime-gateway/public/preparation-client.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const response=value=>({ok:true,json:async()=>value});

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
