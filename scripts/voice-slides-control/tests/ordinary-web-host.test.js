import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import WebSocket from 'ws';
import {startOrdinaryWebHost} from '../ordinary-web-host.js';
import {until} from '../../../tests/helpers/realtime.js';
test('ordinary Web host serves the exact application, labels synthetic dependencies, and releases text commands as text',async t=>{
  const host=await startOrdinaryWebHost();t.after(()=>host.close());
  assert.equal(await(await fetch(host.url+'/web.js')).text(),await readFile(new URL('../../../apps/realtime-gateway/public/web.js',import.meta.url),'utf8'));
  assert.equal((await fetch(host.controlUrl,{method:'POST',body:'{}'})).status,403);
  const call=async(path,body,cookie)=>fetch(host.url+path,{method:'POST',headers:{Origin:host.url,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  const launch=await call('/api/poc/launch',{}),cookie=launch.headers.get('set-cookie').split(';')[0];
  const preparation=await(await call('/api/conversation-preparations',{mode:'free'},cookie)).json();let view;
  for(let index=0;index<50;index++){view=await(await fetch(host.url+'/api/conversation-preparations/'+preparation.preparation_id,{headers:{Cookie:cookie}})).json();if(view.status==='ready')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(view.status,'ready');const ticket=await(await call('/api/sessions',{mode:'free',preparation_id:preparation.preparation_id},cookie)).json();
  const ws=new WebSocket(host.url.replace('http:','ws:')+'/api/realtime',['ask-kai.v1',`ticket.${ticket.ticket}`],{origin:host.url}),packets=[];
  ws.on('message',(data,binary)=>{
    const packet=JSON.parse(data.toString());packets.push({packet,binary});
    if(packet.type==='slides.bind')ws.send(JSON.stringify({type:'slides.ready',...Object.fromEntries(['session_id','viewer_instance_id','generation','deck_id','deck_version'].map(key=>[key,packet[key]]))}));
    if(packet.type==='slides.command'){
      const {type,base_revision,...command}=packet;ws.send(JSON.stringify({type:'slides.ack',...command,status:'applied'}));
    }
  });ws.on('error',()=>{});await once(ws,'open');await until(()=>packets.some(({packet})=>packet.event?.type==='session.ready'));
  assert.equal(packets.find(({packet})=>packet.event?.type==='session.ready').packet.synthetic,true);
  await host.control({command:'scenario',name:'queue_add'});await until(()=>host.inspect().sessions.at(-1).held===1);
  await host.control({command:'release_commands'});await until(()=>host.inspect().sessions.at(-1).results.length===2);
  assert.ok(packets.filter(({packet})=>packet.type==='slides.command').every(({binary})=>binary===false));
  assert.deepEqual(host.inspect().sessions.at(-1).commands.slice(3).map(command=>command.page),[2,1]);ws.close();
});
