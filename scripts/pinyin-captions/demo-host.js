import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const routes=new Map([
 ['/',[new URL('./demo.html',import.meta.url),'text/html; charset=utf-8']],
 ['/pinyin-pro.js',[new URL('../../.local/pinyin-caption-spike/node_modules/pinyin-pro/dist/index.js',import.meta.url),'text/javascript; charset=utf-8']]
]);
const server=createServer(async(req,res)=>{const file=routes.get(req.url);if(req.method!=='GET'||!file){res.writeHead(404);res.end();return;}try{const data=await readFile(file[0]);res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; object-src 'none'; frame-ancestors 'none'"});res.end(data);}catch{res.writeHead(503);res.end('SPIKE_DEPENDENCY_UNAVAILABLE');}});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true,real_provider:false,audio:false})));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
