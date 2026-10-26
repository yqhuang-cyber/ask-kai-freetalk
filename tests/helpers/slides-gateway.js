import {EventEmitter,once} from 'node:events';
import {readFile} from 'node:fs/promises';
import WebSocket from 'ws';
import {createGateway} from '../../apps/realtime-gateway/src/server.js';
import {SeeduplexProvider} from '../../packages/provider-doubao/seeduplex.js';
import {until} from './realtime.js';
const template=JSON.parse(await readFile(new URL('../../docs/protocol/seeduplex-profile.template.json',import.meta.url)));
export async function setupSlidesGateway(t,{slidesControls=true,slidesDemoHistory=true,viewer=true,...options}={}){
  const sent=[],packets=[],commands=[];let provider,wire,binding,autoAck=true;
  const server=createGateway({providerKind:'test',slidesControls,slidesDemoHistory,...options,providerFactory:()=>{
    const profile=structuredClone(template);profile.reviewed=true;Object.assign(profile.realtime,{reviewed:true,ordered_acks_reviewed:true});
    const socket=new EventEmitter();Object.assign(socket,{readyState:1,bufferedAmount:0,send:value=>sent.push(JSON.parse(value)),terminate:()=>{}});
    provider=new SeeduplexProvider({profile,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});
    const open=provider.open.bind(provider);provider.open=value=>{open(value);socket.emit('open');};
    const close=provider.close.bind(provider);provider.close=()=>{const result=close();socket.emit('message',Buffer.from('{"type":"session.closed"}'),false);return result;};
    let seq=0;wire=value=>socket.emit('message',Buffer.from(JSON.stringify({event_id:'wire'+(++seq),...value})),false);
    return provider;
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.stopRealtime();server.close(resolve);server.closeAllConnections();}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const ticket=await(await fetch(origin+'/api/sessions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({mode:'free'})})).json();
  const ws=new WebSocket(origin.replace('http:','ws:')+'/api/realtime',['ask-kai.v1',`ticket.${ticket.ticket}`],{origin});
  const send=packet=>ws.send(JSON.stringify(packet));
  const ack=command=>send({type:'slides.ack',...binding,command_id:command.command_id,status:'applied',page:command.page,revision:command.revision});
  ws.on('message',bytes=>{
    const packet=JSON.parse(bytes.toString());packets.push(packet);
    if(packet.type==='slides.bind'&&viewer){binding=Object.fromEntries(['session_id','viewer_instance_id','generation','deck_id','deck_version'].map(key=>[key,packet[key]]));send({type:'slides.ready',...binding});}
    if(packet.type==='slides.command'){commands.push(packet);if(autoAck)ack(packet);}
  });ws.on('error',()=>{});await once(ws,'open');
  const ready=async()=>{await until(()=>sent.some(p=>p.type==='session.create'));wire({type:'session.created',session:{id:'raw-session'}});await until(()=>packets.some(p=>p.event?.type==='session.ready'));};
  const input=(id,text)=>{wire({type:'conversation.item.input_audio_transcription.started',item_id:id});wire({type:'conversation.item.input_audio_transcription.completed',item_id:id,text});};
  const tools=()=>sent.filter(p=>p.type==='session.create'||p.type==='session.update').at(-1).session.tools;
  const call=(id,args={action:'previous'},name=tools().find(tool=>tool.name.startsWith('navigate_slides_')).name)=>wire({type:'response.function_call_arguments.done',items:[{call_id:id,name,arguments:JSON.stringify(args)}]});
  const reply=(id='reply',question='input')=>{wire({type:'response.output_audio.started',response_id:id,question_id:question});wire({type:'response.output_audio.done',response_id:id,question_id:question});};
  return {server,ws,send,packets,sent,commands,ack,wire:packet=>wire(packet),ready,input,call,reply,tools,provider:()=>provider,hold:()=>{autoAck=false;},binding:()=>binding,origin};
}
