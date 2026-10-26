import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {attachRealtime} from '../../apps/realtime-gateway/src/realtime.js';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';
import {createDoubaoProvider,validateDoubaoRealtimeProfile} from '../../packages/provider-doubao/seeduplex.js';
import {loadProfile} from '../../packages/provider-doubao/probe.js';

// Test host only: actual ordinary Gateway/Provider/Viewer; author PCM replaces a microphone.
// No fixture route or author-input endpoint is registered by the ordinary application.
export async function startGatewayViewerFixture({profile}={}){
  validateDoubaoRealtimeProfile(profile);const backend=await startMockBackend();
  const files=new Map([
    ['/',[new URL('./gateway-viewer-fixture.html',import.meta.url),'text/html']],
    ['/fixture.js',[new URL('./gateway-viewer-fixture-browser.js',import.meta.url),'text/javascript']],
    ...['slides-viewer.js','slides-viewer.css','audio.js','diagnostics.js'].map(name=>['/'+name,[new URL('../../apps/realtime-gateway/public/'+name,import.meta.url),name.endsWith('.css')?'text/css':'text/javascript']]),
    ['/demo-deck.json',[new URL('../../apps/realtime-gateway/public/slides/demo-deck.json',import.meta.url),'application/json']],
    ...['previous','forward-goto','return-first','add-previous'].map(id=>['/author/'+id,[new URL('../../.local/voice-slides-control/'+id+'.pcm',import.meta.url),'application/octet-stream']])
  ]);
  const server=createServer(async(req,res)=>{
    try{
      const origin=`http://127.0.0.1:${server.address().port}`;
      if(req.headers.host!==`127.0.0.1:${server.address().port}`){res.writeHead(403);res.end();return;}
      if(req.method==='POST'&&req.url==='/start'){
        if(req.headers.origin!==origin){res.writeHead(403);res.end();return;}
        const assertion=await backend.pocPort.issue(),identity=backend.bridge.verify(assertion,'session:create');backend.bridge.consume(identity);
        const ticket=await realtime.create({origin,mode:'free',identity,speechPace:'slow'});
        res.writeHead(201,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(ticket));return;
      }
      const file=req.method==='GET'?files.get(req.url):null;if(!file){res.writeHead(404);res.end();return;}
      const data=await readFile(file[0]);res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store'});res.end(data);
    }catch{if(!res.headersSent)res.writeHead(503);res.end();}
  });
  const realtime=attachRealtime(server,{providerKind:'doubao',businessSource:'mock_hskai',slidesControls:true,slidesDemoHistory:true,maxConnections:1,maxSessionMs:180000,providerFactory:ticket=>createDoubaoProvider({profile,speechPace:ticket.speech_pace})});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:async()=>{realtime.close();await new Promise(resolve=>server.close(resolve));server.closeAllConnections();await backend.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv.includes('--live'))console.log('Requires --live. Test-only author audio and mock identity; real Doubao, normal gateway and real browser viewer.');
  else{
    const fixture=await startGatewayViewerFixture({profile:await loadProfile(process.env.DOUBAO_REALTIME_PROFILE)});console.log(JSON.stringify({url:fixture.url,real_provider:true,authored_audio:true,microphone:false}));
    const close=async()=>{await fixture.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);
  }
}
