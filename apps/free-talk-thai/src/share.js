import {createServer,request} from 'node:http';
import {pathToFileURL} from 'node:url';

// Loopback-only bridge for exactly one HTTPS tunnel origin. The Thai entry keeps
// its local Host/Origin checks; only requests carrying this public Host (and, for
// writes and WebSocket upgrades, this exact Origin) are rewritten to the target.
export function createShareProxy({publicOrigin,targetPort}){
  const pub=new URL(publicOrigin);
  if(pub.protocol!=='https:'||pub.origin+'/'!==pub.href)throw Error('SHARE_ORIGIN_MUST_BE_HTTPS_ORIGIN');
  if(!Number.isInteger(targetPort)||targetPort<1||targetPort>65535)throw Error('INVALID_TARGET_PORT');
  const targetHost='127.0.0.1:'+targetPort,targetOrigin='http://'+targetHost;
  const admit=(req,upgrade)=>req.headers.host===pub.host&&(req.headers.origin===undefined?req.method==='GET'&&!upgrade:req.headers.origin===pub.origin);
  const forward=req=>({host:'127.0.0.1',port:targetPort,method:req.method,path:req.url,headers:{...req.headers,host:targetHost,...(req.headers.origin?{origin:targetOrigin}:{})}});
  const csp=headers=>{const policy=headers['content-security-policy'];return policy?{...headers,'content-security-policy':policy.replace("connect-src 'self'",`connect-src 'self' wss://${pub.host}`)}:headers;};
  const server=createServer((req,res)=>{
    if(!admit(req,false)){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});return res.end('{"error":"SHARE_ORIGIN_REQUIRED"}');}
    const upstream=request(forward(req),r=>{res.writeHead(r.statusCode,csp(r.headers));r.pipe(res);});
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    req.pipe(upstream);
  });
  server.on('upgrade',(req,socket,head)=>{
    socket.on('error',()=>{});
    if(!admit(req,true))return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    const upstream=request(forward(req));
    upstream.on('upgrade',(r,target,targetHead)=>{
      const lines=[];for(let i=0;i<r.rawHeaders.length;i+=2)lines.push(r.rawHeaders[i]+': '+r.rawHeaders[i+1]);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`);
      target.setNoDelay(true);socket.setNoDelay(true);
      if(targetHead.length)socket.write(targetHead);if(head.length)target.write(head);
      target.on('error',()=>socket.destroy());socket.on('error',()=>target.destroy());
      target.on('close',()=>socket.destroy());socket.on('close',()=>target.destroy());
      target.pipe(socket);socket.pipe(target);
    });
    upstream.on('response',r=>{r.resume();socket.end(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);});
    upstream.on('error',()=>socket.destroy());
    upstream.end();
  });
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.ASK_KAI_THAI_SHARE_PORT??'4312'),targetPort=Number(process.env.ASK_KAI_THAI_PORT??'4311');
  try{
    if(!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_SHARE_PORT');
    const origin=new URL(process.env.ASK_KAI_THAI_SHARE_ORIGIN??'').origin,server=createShareProxy({publicOrigin:origin,targetPort});
    server.listen(port,'127.0.0.1',()=>console.log(`Free Talk 中泰分享转发: ${origin} → http://127.0.0.1:${port} → http://127.0.0.1:${targetPort} (only this HTTPS origin is admitted)`));
    server.on('error',()=>{console.error('THAI_SHARE_START_FAILED');process.exitCode=1;});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();server.closeAllConnections();});
  }catch{console.error('THAI_SHARE_CONFIGURATION_ERROR: set ASK_KAI_THAI_SHARE_ORIGIN=https://<your-tunnel-host>');process.exitCode=1;}
}
