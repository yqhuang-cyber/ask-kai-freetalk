import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import WebSocket from 'ws';
import { executeConnectProbe } from '../scripts/actions-doubao-probe.js';

const profile = JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-connect.profile.json',import.meta.url),'utf8'));
const request = JSON.parse(await readFile(new URL('../.github/live/doubao-connect-request.json',import.meta.url),'utf8'));
const env = {DOUBAO_API_KEY:'synthetic-only-secret',GITHUB_SHA:'a'.repeat(40)};

test('connect profile only attests static connection fields; request pins exact profile',async()=>{
  const template = JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
  assert.deepEqual(profile,{...template,reviewed:true,review_scope:'static_session_connect_only'});
  const report = await executeConnectProbe({profile,request,env});
  assert.equal(report.live_eligible,true); assert.equal(report.status,'preflight');
  assert.equal(report.provider_connected,false); assert.equal(report.session_ready_observed,false);
  for (const change of [
    {profile:{...profile,reviewed:false}},
    {profile:{...profile,realtime:{...profile.realtime,reviewed:true}}},
    {profile:{...profile,realtime:{...profile.realtime,ordered_acks_reviewed:true}}},
    {request:{...request,profile_sha256:'0'.repeat(64)}},
    {request:{...request,request_id:'private/unbounded text'}}
  ]) await assert.rejects(executeConnectProbe({profile,request,env,...change}),/INVALID_CONNECT_REQUEST/);
});

test('missing secret blocks a live call before socket creation',async()=>{
  const report = await executeConnectProbe({profile,request,live:true,probe:()=>{throw Error('must not call');}});
  assert.equal(report.status,'blocked'); assert.deepEqual(report.missing,['server_side_test_credential']);
  assert.equal(report.socket_open_observed,false); assert.equal(report.session_ready_observed,false);
});

test('connection result is bounded and never promotes voice/device or ACK acceptance',async()=>{
  let called;
  const report = await executeConnectProbe({profile,request,env,live:true,probe:async options=>{
    called=options;
    return {provider_connected:false,session_ready_observed:true,socket_open_observed:true,ended:'duration_limit',events:[]};
  }});
  assert.equal(called.durationMs,5000); assert.equal(called.maxFrames,64); assert.equal(called.maxFrameBytes,65536);
  assert.equal(report.status,'passed'); assert.equal(report.candidate_revision,env.GITHUB_SHA);
  for (const name of ['microphone_uploaded','voice_behavior_tested','real_experience_accepted','realtime_reviewed','ordered_acks_reviewed']) assert.equal(report[name],false);
  assert.ok(!JSON.stringify(report).includes(env.DOUBAO_API_KEY));
  const failed = await executeConnectProbe({profile,request,env,live:true,probe:async()=>({socket_open_observed:true,session_ready_observed:false,ended:'duration_limit',events:[]})});
  assert.equal(failed.status,'failed');
});

test('real server handshake rejection exposes status only and never follows redirects',async t=>{
  for (const status of [401,403,302]) {
    let targetHits=0;
    const target=createServer((_req,res)=>{targetHits++;res.end('private target');});
    target.listen(0,'127.0.0.1');await once(target,'listening');
    const server=createServer((_req,res)=>res.end());let observedHeader;
    server.on('upgrade',(req,socket)=>{
      observedHeader=req.headers['x-api-key'];
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nLocation: http://127.0.0.1:${target.address().port}/private\r\nX-Private: private-response-marker\r\nContent-Length: 0\r\n\r\n`);
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');
    t.after(()=>{server.closeAllConnections();server.close();target.closeAllConnections();target.close();});
    class LocalClient extends WebSocket {
      constructor(url,options) {
        assert.equal(url,profile.endpoint);assert.equal(options.followRedirects,false);
        assert.equal(options.handshakeTimeout,5000);assert.equal(options.perMessageDeflate,false);
        super(`ws://127.0.0.1:${server.address().port}`,options);
      }
    }
    const report=await executeConnectProbe({profile,request,env,live:true,Client:LocalClient});
    assert.equal(observedHeader,env.DOUBAO_API_KEY);assert.equal(targetHits,0);
    assert.equal(report.http_status,status);assert.equal(report.status,'failed');
    assert.equal(report.session_ready_observed,false);assert.equal(report.ended,'transport_error');
    for(const value of [env.DOUBAO_API_KEY,'private-response-marker','Location:','private target']) assert.ok(!JSON.stringify(report).includes(value));
  }
});

test('Actions CLI preflight needs no key and live mode without a key fails safely',()=>{
  const preflight=spawnSync(process.execPath,['scripts/actions-doubao-probe.js','--preflight'],{encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.equal(preflight.status,0);assert.equal(JSON.parse(preflight.stdout).live_eligible,false);
  const live=spawnSync(process.execPath,['scripts/actions-doubao-probe.js','--live'],{encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.equal(live.status,1);assert.equal(JSON.parse(live.stdout).status,'blocked');
});
