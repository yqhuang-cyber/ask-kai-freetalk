import {createServer,request as httpRequest} from 'node:http';
import {EventEmitter,once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,readdir,unlink,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import WebSocket,{WebSocketServer} from 'ws';
import {createGateway,readJson} from '../../apps/realtime-gateway/src/server.js';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';
import {SeeduplexProvider} from '../../packages/provider-doubao/seeduplex.js';
import {conservativeTurn} from '../../packages/agent-core/planning-state.js';

// Synthetic wire peer + module substitution on an isolated loopback proxy.
// HTML, web.js, auth/preparation, Gateway, Provider and Viewer are the ordinary modules.
// Test commands never become product routes, and no synthetic readiness flags are forged.
export async function startOrdinaryWebHost(){
  const backend=await startMockBackend(),sessions=[],sockets=new Set(),pendingPlans=[];
  const faults={holdCommands:false,dropAck:false,dropAllReceipts:false,holdContext:false,deckUnavailable:false,rejectSynthetic:false,holdPlanner:false};
  let seq=0,callSeq=0,replySeq=0;
  const planner={describe:()=>({provider:'synthetic_fixture'}),async planConversation(){throw new Error('PLANNER_UNAVAILABLE');},planTurn(input){
    if(faults.holdPlanner)return new Promise(resolve=>pendingPlans.push(()=>resolve(conservativeTurn(input))));return Promise.resolve(conservativeTurn(input));
  }};
  const profile=JSON.parse(await readFile(new URL('../../docs/protocol/seeduplex-profile.template.json',import.meta.url)));
  profile.reviewed=true;Object.assign(profile.realtime,{reviewed:true,ordered_acks_reviewed:true});
  const gateway=createGateway({...backend,providerKind:'test',speechPaceSupported:true,slidesControls:true,slidesDemoHistory:true,planningMode:'next_turn_advisory',planner,
    providerFactory:ticket=>{
      const session={index:sessions.length,closed:false,sent:[],results:[],commands:[],states:[],speechPhases:[],held:[],frames:0,bindings:null,callQuestions:new Map()};sessions.push(session);
      const socket=new EventEmitter(),wire=raw=>socket.emit('message',Buffer.from(JSON.stringify({event_id:'fixture-'+(++seq),...raw})),false);
      session.wire=wire;
      const output=(question,text,{id='fixture-reply-'+(++replySeq),audioMs=200,done=true}={})=>{
        wire({type:'response.output_audio.started',response_id:id,question_id:question});wire({type:'response.output_text.delta',response_id:id,question_id:question,delta:text});
        wire({type:'response.output_text.done',response_id:id,question_id:question,text});
        for(let bytes=audioMs*48;bytes>0;bytes-=48000)wire({type:'response.output_audio.delta',response_id:id,question_id:question,delta:Buffer.alloc(Math.min(48000,bytes)).toString('base64')});
        if(done)wire({type:'response.output_audio.done',response_id:id,question_id:question});return id;
      };session.output=output;
      Object.assign(socket,{readyState:1,bufferedAmount:0,terminate:()=>{},send:text=>{
        const packet=JSON.parse(text);
        if(packet.type==='input_audio_buffer.append'){session.frames++;return;}
        session.sent.push(packet);
        queueMicrotask(()=>{
          if(packet.type==='session.create')wire({type:'session.created',session:{id:'fixture-session-'+session.index}});
          if(packet.type==='session.update'&&!faults.holdContext)wire({type:'session.updated',session:{id:'fixture-session-'+session.index}});
          if(packet.type==='response.cancel')wire({type:'response.canceled'});
          if(packet.type==='session.close')wire({type:'session.closed'});
          if(packet.type==='speech_text_buffer.commit'){
            const question='fixture-fixed-'+(++replySeq),id='fixture-fixed-reply-'+replySeq;
            wire({type:'response.output_audio.started',response_id:id,question_id:question});
            wire({type:'response.output_audio.delta',response_id:id,question_id:question,delta:Buffer.alloc(9600).toString('base64')});
            wire({type:'response.output_audio.done',response_id:id,question_id:question});
          }
        });
      }});
      const provider=new SeeduplexProvider({profile,speechPace:ticket.speech_pace,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});session.provider=provider;
      const open=provider.open.bind(provider);provider.open=input=>{open(input);socket.emit('open');};
      const close=provider.close.bind(provider);provider.close=()=>{session.closed=true;return close();};
      const result=provider.sendUiResults.bind(provider);provider.sendUiResults=values=>{
        result(values);for(const value of values){session.results.push({id:value.callId,...value.outcome});
          const owner=session.callQuestions.get(value.callId);if(owner?.reply){const text=value.outcome.status==='applied'?`合成确认：已到第${value.outcome.page}页。`:value.outcome.status==='unknown'?'合成确认：当前页面还不能确认。':'合成确认：请求已按实际状态处理。';
            queueMicrotask(()=>output(owner.question,text));}
        }
      };
      session.input=(question,text)=>{session.lastQuestion=question;wire({type:'conversation.item.input_audio_transcription.started',item_id:question});wire({type:'conversation.item.input_audio_transcription.completed',item_id:question,text});};
      session.call=(question,args={action:'previous'},{reply=true,kind='navigate',name,id='fixture-call-'+(++callSeq)}={})=>{
        name??=provider.profile.session_create.session.tools?.find(tool=>tool.name.startsWith(kind==='cancel'?'cancel_pending_slides_':'navigate_slides_'))?.name;
        if(!name)throw new Error('FIXTURE_TOOL_UNAVAILABLE');session.callQuestions.set(id,{question,reply});
        wire({type:'response.function_call_arguments.done',items:[{call_id:id,name,arguments:JSON.stringify(args)}]});return id;
      };return provider;
    }});
  gateway.listen(0,'127.0.0.1');await once(gateway,'listening');const gatewayPort=gateway.address().port;
  const overrides=new Map([
    ['/audio.js','web-test-audio.js'],['/voice-readiness.js','web-test-readiness.js']
  ]);
  const front=createServer(async(req,res)=>{
    try{
      if(req.headers.host!==`127.0.0.1:${front.address().port}`){res.writeHead(403);res.end();return;}
      if(req.method==='GET'&&req.url==='/slides/demo-deck.json'&&faults.deckUnavailable){res.writeHead(503);res.end();return;}
      const override=req.method==='GET'?overrides.get(req.url):null;
      if(override&&!(req.url==='/voice-readiness.js'&&faults.rejectSynthetic)){
        const data=await readFile(new URL(override,import.meta.url));res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(data);return;
      }
      const path=req.url==='/native-audio.js'?'/audio.js':req.url==='/native-voice-readiness.js'?'/voice-readiness.js':req.url;
      const upstream=httpRequest({host:'127.0.0.1',port:gatewayPort,path,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);
    }catch{if(!res.headersSent)res.writeHead(503);res.end();}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:131072,perMessageDeflate:false});
  front.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/api/realtime'||req.headers.origin!==`http://${req.headers.host}`){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,client=>{
      const protocols=req.headers['sec-websocket-protocol'].split(',').map(value=>value.trim());
      const upstream=new WebSocket(`ws://127.0.0.1:${gatewayPort}/api/realtime`,protocols,{origin:req.headers.origin,headers:{Host:req.headers.host}});
      sockets.add(client);sockets.add(upstream);let session;const queue=[];
      upstream.on('open',()=>{session=sessions.at(-1);session.client=client;session.upstream=upstream;for(const item of queue)upstream.send(item.data,{binary:item.binary});});
      client.on('message',(data,binary)=>{
        if(!binary){const packet=JSON.parse(data.toString());if(['slides.ack','slides.snapshot'].includes(packet.type)&&packet.revision>=4){
          if(faults.dropAllReceipts)return;if(faults.dropAck&&packet.type==='slides.ack'){faults.dropAck=false;return;}
        }}
        if(upstream.readyState===1)upstream.send(data,{binary});else if(queue.length<32)queue.push({data,binary});
      });
      upstream.on('message',(data,binary)=>{
        if(!binary){const packet=JSON.parse(data.toString());if(packet.type==='slides.bind')session.bindings=Object.fromEntries(['session_id','viewer_instance_id','generation','deck_id','deck_version'].map(key=>[key,packet[key]]));
          if(packet.type==='slides.state')session.states.push(packet);
          if(packet.type==='speech.state')session.speechPhases.push(packet.phase);
          if(packet.type==='slides.command'){session.commands.push(packet);if(faults.holdCommands&&packet.revision>=4){session.held.push(data);return;}}
          if(packet.type==='session.failed')session.failure=packet.code;
        }if(client.readyState===1)client.send(data,{binary});
      });
      const cleanup=()=>{sockets.delete(client);sockets.delete(upstream);if(client.readyState<2)client.close();if(upstream.readyState<2)upstream.close();};
      client.on('close',cleanup);upstream.on('close',cleanup);client.on('error',cleanup);upstream.on('error',cleanup);
    });
  });
  front.listen(0,'127.0.0.1');await once(front,'listening');
  const inspect=()=>({synthetic:true,real_provider:false,pending_plans:pendingPlans.length,sessions:sessions.map(session=>({index:session.index,closed:session.closed,frames:session.frames,failure:session.failure??null,held:session.held.length,speech_phase:session.speechPhases.at(-1)??null,results:session.results.map(({status,reason,page,confirmed,cancelled_count,in_flight})=>({status,reason,page,confirmed,cancelled_count,in_flight})),commands:session.commands.map(({page,revision})=>({page,revision})),state:session.states.at(-1)?{page:session.states.at(-1).page,confirmed:session.states.at(-1).confirmed,pending:session.states.at(-1).pending,queued:session.states.at(-1).queued}:null,contexts:session.sent.filter(packet=>packet.type==='session.update').map(packet=>({page:/最新组件确认快照：\{"page":(\d+)/.exec(packet.session.instructions)?.[1]??null,speed:packet.session.audio?.output?.speed,tool_count:packet.session.tools?.length??0,latest_input_advisory:!!session.lastQuestion&&packet.session.instructions.includes('"source_turn_id":"'+session.provider.turn(session.lastQuestion).id+'"')})),native_cancels:session.sent.filter(packet=>packet.type==='response.cancel').length}))});
  async function control(input){
    if(input.command==='inspect')return inspect();
    if(input.command==='faults'){for(const [key,value] of Object.entries(input.values??{})){if(!Object.hasOwn(faults,key)||typeof value!=='boolean')throw new Error('INVALID_FIXTURE_FAULT');faults[key]=value;}return inspect();}
    if(input.command==='release_planner'){faults.holdPlanner=false;for(const release of pendingPlans.splice(0))release();return inspect();}
    const session=sessions.at(-1);if(!session||session.closed)throw new Error('NO_ACTIVE_FIXTURE_SESSION');
    if(input.command==='release_commands'){faults.holdCommands=false;for(const data of session.held.splice(0))if(session.client.readyState===1)session.client.send(data,{binary:false});return inspect();}
    if(input.command==='ack_context'){faults.holdContext=false;session.wire({type:'session.updated',session:{id:'fixture-session-'+session.index}});return inspect();}
    if(input.command==='disconnect'){session.upstream.terminate();return inspect();}
    if(input.command==='scenario'){
      const name=input.name,question='fixture-input-'+(++callSeq);
      if(name==='review'){session.input(question,'回到上一页。');session.call(question);}
      else if(name==='pace_review'){session.input(question,'慢一点，帮我回上一页。');session.call(question);}
      else if(name==='queue_cancel'||name==='queue_correct'||name==='queue_add'){
        faults.holdCommands=true;session.input(question,'回上一页。');session.call(question,undefined,{reply:false});session.call(question,undefined,{reply:false});
        if(name!=='queue_add'){
          const next=question+'-control';session.input(next,name==='queue_cancel'?'算了不要翻了。':'不是上一页，改成第一页。');
          session.call(next,name==='queue_cancel'?{}:{action:'goto',page:1,replace_pending:true},{kind:name==='queue_cancel'?'cancel':'navigate',reply:false});
        }
      }
      else if(name==='late_old_reply'){
        faults.holdCommands=true;session.input(question,'回上一页。');session.call(question,undefined,{reply:false});
        session.input(question+'-new','下一页用英语怎么说？');session.lateQuestion=question;
      }
      else if(name==='finish_late_reply'){
        session.output(session.lateQuestion,'旧翻页确认不应出现。');session.output(session.lateQuestion+'-new','新问题回应：next page。');
      }
      else if(name==='settle'){session.output(session.lastQuestion,'合成检查：以实际页面结果为准。');}
      else if(name==='planner_input'){session.input(question,'我想聊音乐。');session.output(question,'合成回应：我们聊音乐。');}
      else throw new Error('UNKNOWN_FIXTURE_SCENARIO');
      return inspect();
    }
    throw new Error('INVALID_FIXTURE_COMMAND');
  }
  const controller=createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/'||req.headers['x-ask-kai-test']!=='authored_fixture'){res.writeHead(403);res.end();return;}
    try{const result=await control(await readJson(req,2048));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));}
    catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:/^[A-Z_]+$/.test(error.message)?error.message:'FIXTURE_FAILED'}));}
  });controller.listen(0,'127.0.0.1');await once(controller,'listening');
  // CUA's Node sandbox has no loopback network access. This test-only mailbox
  // permits the same bounded commands through the already writable workspace.
  const base=resolve('.local/voice-slides-control');await mkdir(base,{recursive:true,mode:0o700});
  const controlDirectory=await mkdtemp(base+'/ordinary-control-');let reading=false;
  const mailbox=setInterval(async()=>{
    if(reading)return;reading=true;
    try{for(const name of (await readdir(controlDirectory)).filter(name=>/^[a-f0-9-]{36}\.request\.json$/.test(name)).slice(0,20)){
      let result;try{const data=await readFile(controlDirectory+'/'+name);if(data.length>2048)throw new Error('FIXTURE_COMMAND_TOO_LARGE');result={ok:true,data:await control(JSON.parse(data))};}
      catch(error){result={ok:false,error:/^[A-Z_]+$/.test(error.message)?error.message:'FIXTURE_COMMAND_FAILED'};}
      await writeFile(controlDirectory+'/'+name.replace('.request.','.response.'),JSON.stringify(result),{mode:0o600});await unlink(controlDirectory+'/'+name);
    }}catch{}finally{reading=false;}
  },30);
  return {url:`http://127.0.0.1:${front.address().port}`,controlUrl:`http://127.0.0.1:${controller.address().port}`,controlDirectory,control,inspect,close:async()=>{
    clearInterval(mailbox);
    for(const socket of sockets)socket.terminate();gateway.stopRealtime();wss.close();
    for(const server of [controller,front,gateway]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await backend.close();await rm(controlDirectory,{recursive:true,force:true});
  }};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const host=await startOrdinaryWebHost();console.log(JSON.stringify({url:host.url,controlUrl:host.controlUrl,controlDirectory:host.controlDirectory,synthetic:true,real_provider:false,ordinary_web:true}));
  const close=async()=>{await host.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);
}
