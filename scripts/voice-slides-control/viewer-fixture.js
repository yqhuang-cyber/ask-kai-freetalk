import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {WebSocketServer} from 'ws';
import {SlidesCoordinator} from '../../apps/realtime-gateway/src/slides-coordinator.js';

// Test-only loopback fixture. The ordinary app never serves these controls.
export async function startViewerFixture(){
  const files=new Map([
    ['/',[new URL('viewer-fixture.html',import.meta.url),'text/html']],
    ['/slides-viewer.js',[new URL('../../apps/realtime-gateway/public/slides-viewer.js',import.meta.url),'text/javascript']],
    ['/slides-viewer.css',[new URL('../../apps/realtime-gateway/public/slides-viewer.css',import.meta.url),'text/css']],
    ['/demo-deck.json',[new URL('../../apps/realtime-gateway/public/slides/demo-deck.json',import.meta.url),'application/json']]
  ]);
  const server=createServer(async(req,res)=>{
    const file=req.method==='GET'?files.get(req.url):null;
    if(!file){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(file[0]));
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:1024,perMessageDeflate:false}),coordinators=new Set();
  server.on('upgrade',(req,socket,head)=>{
    const expectedHost=`127.0.0.1:${server.address().port}`;
    if(req.url!=='/fixture'||req.headers.host!==expectedHost||req.headers.origin!==`http://${expectedHost}`){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',ws=>{
    let dropped=false,hold=false,lastReceipt=null,lastCommand=null,ready=false;
    const binding={session_id:randomUUID(),viewer_instance_id:randomUUID(),generation:randomUUID(),deck_id:'kai-demo',deck_version:'1'};
    const send=value=>{if(ws.readyState===1)ws.send(JSON.stringify(value));};
    const coordinator=new SlidesCoordinator({sessionId:binding.session_id,viewerId:binding.viewer_instance_id,generation:binding.generation,ackMs:150,totalMs:700,
      send:packet=>{if(packet.type==='slides.command')lastCommand=packet;send(packet);},onState:state=>send({type:'slides.state',...state})});coordinators.add(coordinator);
    const result=promise=>promise.then(value=>send({type:'fixture.result',result:value}));
    ws.on('message',bytes=>{
      let packet;try{packet=JSON.parse(bytes.toString());}catch{return;}
      if(packet.type==='slides.ready'){if(ready)return;ready=true;result(coordinator.present(1,{requestId:'initial'}));return;}
      if(packet.type==='slides.intent'){result(coordinator.execute(packet.intent,{requestId:packet.request_id}));return;}
      if(packet.type==='fixture.present'){result(coordinator.present(packet.page,{requestId:randomUUID()}));return;}
      if(packet.type==='fixture.drop_ack'){dropped=true;return;}
      if(packet.type==='fixture.hold'){hold=true;return;}
      if(packet.type==='fixture.release'){hold=false;if(lastReceipt)coordinator.receive(lastReceipt);return;}
      if(packet.type==='fixture.forward'){result(coordinator.execute({action:'goto',page:3},{requestId:randomUUID()}));return;}
      if(packet.type==='fixture.duplicate'){if(lastCommand)send(lastCommand);return;}
      if(packet.type==='slides.ack'||packet.type==='slides.snapshot'){
        lastReceipt=packet;
        if(hold)return;
        if(dropped&&packet.type==='slides.ack'){dropped=false;return;}
        coordinator.receive(packet);
      }
    });
    ws.on('close',()=>{coordinator.close();coordinators.delete(coordinator);});send({type:'fixture.config',binding});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:async()=>{for(const coordinator of coordinators)coordinator.close();for(const ws of wss.clients)ws.terminate();wss.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const fixture=await startViewerFixture();console.log(JSON.stringify({url:fixture.url,synthetic_host:true,real_provider:false}));
  const close=async()=>{await fixture.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);
}
