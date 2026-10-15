import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createGateway } from '../../apps/realtime-gateway/src/server.js';
export class TestProvider {
  kind='test';audio={encoding:'pcm_s16le',input_rate:16000,output_rate:24000,frame_ms:20};seq=0;frames=[];cancelled=[];contexts=[];
  open(input){this.input=input;}
  emit(type,payload={},ids={},extra={}) {this.input.onEvent({event:{version:1,event_id:randomUUID(),session_id:this.input.sessionId,seq:++this.seq,at_ms:this.seq,type,payload,...ids},...extra});}
  control(control,extra={}){this.input.onEvent({control,...extra});}
  sendAudio(bytes){this.frames.push(Buffer.from(bytes));}
  cancel(id){this.cancelled.push(id);}
  updateContext(value){this.contexts.push(value);}
  close(){this.closed=true;}
}
export async function setup(t,options={}) {
  const providers=[];
  const server=createGateway({providerKind:'test',providerFactory:()=>{const p=new TestProvider();providers.push(p);return p;},...options});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.stopRealtime();server.close(resolve);server.closeAllConnections();}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const create=async(input={mode:'sports'},headers={})=>fetch(`${origin}/api/sessions`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
  const open=async(ticket)=> {
    const ws=new WebSocket(origin.replace('http:','ws:')+'/api/realtime',['ask-kai.v1',`ticket.${ticket.ticket}`],{origin});
    const packets=[];ws.on('message',bytes=>packets.push(JSON.parse(bytes.toString())));ws.on('error',()=>{});
    await once(ws,'open');
    return {ws,packets,provider:providers.at(-1)};
  };
  return {server,origin,create,open,providers};
}
export async function until(predicate) {
  const deadline=Date.now()+1000;
  while(!predicate()){if(Date.now()>deadline)throw new Error('TEST_WAIT_TIMEOUT');await new Promise(r=>setTimeout(r,5));}
}
