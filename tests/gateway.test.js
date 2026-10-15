import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:net';
import { request } from 'node:http';
import { createGateway } from '../apps/realtime-gateway/src/server.js';
import { readConfig } from '../apps/realtime-gateway/src/config.js';
import { DoubaoProvider } from '../packages/provider-doubao/index.js';
async function start(t) {
  const server = createGateway({paceMs:0});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}
test('configuration fails closed for public binding, invalid ports and real-provider mode', () => {
  assert.equal(readConfig({}).provider,'replay');
  assert.throws(() => readConfig({ASK_KAI_HOST:'0.0.0.0'}),/LOOPBACK/);
  for (const port of ['0','65536','1x','1.5']) assert.throws(() => readConfig({ASK_KAI_PORT:port}),/INVALID_PORT/);
  assert.throws(() => readConfig({ASK_KAI_PROVIDER:'doubao',DOUBAO_API_KEY:'test-only'}),/DOUBAO_PROTOCOL_NOT_VERIFIED/);
  assert.throws(() => readConfig({ASK_KAI_PROVIDER:'other'}),/INVALID_PROVIDER/);
});
test('Doubao placeholder never claims readiness or accepts audio', async () => {
  const provider = new DoubaoProvider();
  await assert.rejects(async () => { for await (const _ of provider.open()) assert.fail('unexpected event'); },/DOUBAO_PROTOCOL_NOT_VERIFIED/);
  await assert.rejects(provider.sendAudio(new Uint8Array()),/DOUBAO_PROTOCOL_NOT_VERIFIED/);
});
test('health and Web preview explicitly show disconnected mode; replay has its own entry', async t => {
  const {url} = await start(t);
  const health = await (await fetch(`${url}/healthz`)).json();
  assert.equal(health.provider_connected,false); assert.equal(health.mode,'synthetic_replay');
  const page = await fetch(url);
  const html = await page.text();
  assert.match(html,/豆包未连接/); assert.match(html,/和 Kai 聊一聊/);
  assert.match(html,/href="\/dev\/replay"/);
  assert.match(await (await fetch(`${url}/dev/replay`)).text(),/合成测试数据/);
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('SSE delivers accepted projections, isolated late events and summary', async t => {
  const {url} = await start(t);
  const response = await fetch(`${url}/api/replays/interruption`);
  assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const frames = (await response.text()).trim().split('\n\n').map(frame => ({type:frame.split('\n')[0].slice(7),data:JSON.parse(frame.split('\n')[1].slice(6))}));
  assert.equal(frames[0].data.provider_connected,false);
  assert.equal(frames.filter(frame => frame.type === 'dropped').length,3);
  assert.equal(frames.at(-1).type,'summary');
  assert.equal(frames.at(-1).data.status,'closed');
  assert.ok(!frames.filter(frame => frame.type === 'accepted').some(frame => frame.data.payload.text?.includes('不应显示')));
});
test('real sessions and WebSocket upgrades are explicitly unimplemented', async t => {
  const {url,server} = await start(t);
  const response = await fetch(`${url}/api/sessions`,{method:'POST'});
  assert.equal(response.status,501); assert.equal((await response.json()).provider_connected,false);
  const socket = connect(server.address().port,'127.0.0.1');
  socket.write('GET /realtime HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  let result = ''; for await (const data of socket) result += data;
  assert.match(result,/501 Not Implemented/);
});
test('unknown fixtures and static paths are rejected', async t => {
  const {url} = await start(t);
  assert.equal((await fetch(`${url}/api/replays/nope`)).status,404);
  assert.equal((await fetch(`${url}/.env`)).status,404);
  assert.equal((await fetch(`${url}/api/replays`)).status,200);
  assert.equal((await fetch(`${url}/app.js`)).status,200);
  assert.equal((await fetch(`${url}/style.css`)).status,200);
  assert.equal((await fetch(`${url}/web.js`)).status,200);
  assert.equal((await fetch(`${url}/web.css`)).status,200);
});
test('cross-site and foreign Host requests cannot access diagnostics', async t => {
  const {url} = await start(t);
  const status = headers => new Promise((resolve,reject) => {
    const req = request(`${url}/healthz`,{headers},res => { res.resume(); resolve(res.statusCode); });
    req.on('error',reject); req.end();
  });
  assert.equal(await status({Host:'evil.example'}),403);
  assert.equal(await status({'Sec-Fetch-Site':'cross-site'}),403);
});
