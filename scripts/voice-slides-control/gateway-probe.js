import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import WebSocket from 'ws';
import {createGateway} from '../../apps/realtime-gateway/src/server.js';
import {createDoubaoProvider,validateDoubaoRealtimeProfile} from '../../packages/provider-doubao/seeduplex.js';
import {loadProfile} from '../../packages/provider-doubao/probe.js';
import {SLIDES_CASES} from './cases.js';
import {SLIDES_CONTROL_CASES} from './control-cases.js';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';

const directory='.local/voice-slides-control';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,ms=25000){const deadline=Date.now()+ms;while(!check()){if(Date.now()>deadline)throw new Error('GATEWAY_PROBE_TIMEOUT');await delay(20);}}
export async function runGatewayProbe({profile,inputs,timeoutMs=100000,interruptionInput=null}={}){
  validateDoubaoRealtimeProfile(profile);
  let provider,ws,binding,page=1,revision=0,frame=0,pumping=false,providerReady=false,failure=null,closed=false;
  const queue=[],commands=[],results=[],steps=[],replies=[],asr=[];let replyDone=0,callCount=0;
  let injected=false,interruptionTurn=null,interruptionFinal=false,secondMeaningful=false,startedBeforeAck=false,reviewAckReleased=false,firstTurn=null,lastForwardedTurn=null,staleText=0,staleAudio=0;
  const ackTimers=new Set();
  const mockBackend=await startMockBackend();
  const server=createGateway({bridge:mockBackend.bridge,memoryPort:mockBackend.memoryPort,pocPort:mockBackend.pocPort,providerKind:'doubao',slidesControls:true,slidesDemoHistory:true,maxSessionMs:timeoutMs,providerFactory:ticket=>{
    provider=createDoubaoProvider({profile,speechPace:ticket.speech_pace});
    const sendResults=provider.sendUiResults.bind(provider);
    provider.sendUiResults=values=>{for(const value of values)results.push({status:value.outcome.status,reason:value.outcome.reason,page:value.outcome.page,confirmed:value.outcome.confirmed});return sendResults(values);};
    const open=provider.open.bind(provider);provider.open=options=>open({...options,onEvent:packet=>{
      if(packet.control==='ui.calls'){
        callCount+=packet.calls.length;
        if(interruptionInput&&!injected){injected=true;queue.push(interruptionInput.pcm);}
      }
      if(packet.control==='user.speech.candidate'&&injected&&!interruptionTurn){interruptionTurn=packet.turn_id;startedBeforeAck=!reviewAckReleased;}
      if(packet.event?.type==='user.final'&&!firstTurn)firstTurn=packet.event.turn_id;
      if(['user.partial','user.final'].includes(packet.event?.type)&&packet.event.turn_id===interruptionTurn)secondMeaningful=true;
      if(packet.event?.type==='user.final'&&packet.event.turn_id===interruptionTurn)interruptionFinal=true;
      return options.onEvent(packet);
    }});return provider;
  }});
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
    const launch=await fetch(origin+'/api/poc/launch',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({})});
    const cookie=launch.headers.get('set-cookie')?.split(';')[0];
    const response=await fetch(origin+'/api/sessions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({mode:'free'})});
    if(!response.ok)throw new Error('GATEWAY_PROBE_TICKET_FAILED');const ticket=await response.json();
    ws=new WebSocket(origin.replace('http:','ws:')+'/api/realtime',['ask-kai.v1',`ticket.${ticket.ticket}`],{origin});
    const send=value=>{if(ws.readyState===1)ws.send(JSON.stringify(value));};
    ws.on('message',bytes=>{
      const packet=JSON.parse(bytes.toString());
      if(packet.type==='slides.bind'){
        binding=Object.fromEntries(['session_id','viewer_instance_id','generation','deck_id','deck_version'].map(key=>[key,packet[key]]));send({type:'slides.ready',...binding});
      }
      if(packet.type==='slides.command'){
        if(packet.base_revision!==revision||packet.revision!==revision+1||packet.page<1||packet.page>3){failure='INVALID_COMPONENT_COMMAND';return;}
        page=packet.page;revision=packet.revision;commands.push({page,revision});
        // Synthetic component transport only. Browser paint/audio is a separate acceptance layer.
        const receipt={type:'slides.ack',...binding,command_id:packet.command_id,status:'applied',page,revision};
        if(interruptionInput&&packet.revision===4){const timer=setTimeout(()=>{ackTimers.delete(timer);reviewAckReleased=true;send(receipt);},1500);ackTimers.add(timer);}
        else send(receipt);
      }
      if(packet.type==='session.failed')failure=packet.code;
      if(packet.event?.type==='session.ready')providerReady=packet.provider_connected===true&&!packet.synthetic;
      if(packet.event?.type==='user.final')asr.push(packet.event.payload.text);
      if(packet.event?.type==='response.text.delta'){replies.push(packet.event.payload.text);if(secondMeaningful&&packet.event.turn_id===firstTurn)staleText++;}
      if(packet.event?.type==='response.audio.chunk'&&secondMeaningful&&packet.event.turn_id===firstTurn)staleAudio++;
      if(packet.event?.type==='response.done'){replyDone++;lastForwardedTurn=packet.event.turn_id;}
    });
    ws.on('close',()=>{closed=true;});ws.on('error',()=>{failure='GATEWAY_PROBE_SOCKET_ERROR';});
    await once(ws,'open');await until(()=>providerReady||failure);if(failure)throw new Error(failure);
    pumping=true;
    const pump=async()=>{let at=performance.now();while(pumping&&ws.readyState===1){
      const active=queue[0];let pcm=Buffer.alloc(640);if(active){pcm=active.subarray(frame,frame+640);frame+=640;if(frame>=active.length){queue.shift();frame=0;}if(pcm.length<640)pcm=Buffer.concat([pcm,Buffer.alloc(640-pcm.length)]);}
      ws.send(pcm);at+=20;await delay(Math.max(0,at-performance.now()));
    }};const pumpingPromise=pump().catch(()=>{failure='GATEWAY_AUDIO_PUMP_FAILED';});
    for(const input of inputs){
      if(failure)throw new Error(failure);
      await until(()=>!provider.pendingControl&&!provider.uiBusy||failure);if(failure)throw new Error(failure);
      const previousReplies=replyDone,previousCalls=callCount,previousResults=results.length,previousCommands=commands.length,previousAsr=asr.length;
      queue.push(input.pcm);const started=performance.now();
      await until(()=>queue.length===0||failure);await until(()=>replyDone>previousReplies&&(!interruptionInput||interruptionFinal&&lastForwardedTurn===interruptionTurn)&&!provider.pendingControl&&!provider.uiBusy||failure||closed);
      if(failure||closed)throw new Error(failure??'GATEWAY_PROBE_CLOSED');
      steps.push({id:input.id,expected_page:input.expectedPage,actual_page:page,page_matches:page===input.expectedPage,tool_calls:callCount-previousCalls,tool_results:results.slice(previousResults),component_commands:commands.length-previousCommands,asr_received:asr.length>previousAsr,elapsed_ms:Math.round(performance.now()-started)});
    }
    pumping=false;await pumpingPromise;
  }catch(error){failure=/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'GATEWAY_PROBE_FAILED';}
  finally{
    for(const timer of ackTimers)clearTimeout(timer);
    pumping=false;if(ws?.readyState===1){ws.send(JSON.stringify({type:'session.end'}));await Promise.race([once(ws,'close'),delay(3000)]);}ws?.terminate();
    server.stopRealtime();await new Promise(resolve=>server.close(resolve));server.closeAllConnections();
    await mockBackend.close();
  }
  return {report:{version:1,real_provider_connected:providerReady,ordinary_gateway:true,ordinary_provider:true,synthetic_viewer:true,synthetic_history:true,browser_audio_tested:false,human_listening_tested:false,provider_input_ownership_verified:false,default_enabled:false,passed:!failure&&steps.length===inputs.length&&steps.every(step=>step.page_matches)&&(!interruptionInput||injected&&interruptionFinal&&startedBeforeAck&&staleText===0&&staleAudio===0),failure,steps,tool_calls:callCount,component_commands:commands,tool_results:results,...(interruptionInput?{interruption:{id:interruptionInput.id,injected,second_final_received:interruptionFinal,second_started_before_receipt:startedBeforeAck,stale_text_forwarded_after_second_input:staleText,stale_audio_chunks_forwarded_after_second_input:staleAudio,synthetic_receipt_hold_ms:1500}}:{})},privateAuthoredReplies:{replies,asr}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv.includes('--live')){console.log('Needs --live. Runs previous → forward request (deferred) → first page through ordinary Gateway; synthetic Viewer, real Doubao.');}
  else{
    const manifest=JSON.parse(await readFile(directory+'/manifest.json','utf8'));
    const interruptionId=process.argv.includes('--interrupt-question')?'quote':process.argv.includes('--interrupt-add')?'add-previous':null;
    async function loadInput(id,expectedPage){
      const testCase=[...SLIDES_CASES,...SLIDES_CONTROL_CASES].find(item=>item.id===id),entry=manifest.entries.find(item=>item.id===id);
      if(!testCase||!entry||entry.path!==id+'.pcm'||entry.script_sha256!==createHash('sha256').update(testCase.text).digest('hex'))throw new Error('MISSING_AUTHORED_INPUT');
      const pcm=await readFile(directory+'/'+entry.path);
      if(createHash('sha256').update(pcm).digest('hex')!==entry.pcm_sha256)throw new Error('AUTHORED_INPUT_HASH_MISMATCH');
      return {id,expectedPage,pcm};
    }
    const inputs=[];for(const [id,page] of interruptionId?[['previous',interruptionId==='quote'?2:1]]:[['previous',2],['forward-goto',2],['return-first',1]])inputs.push(await loadInput(id,page));
    const result=await runGatewayProbe({profile:await loadProfile(process.env.DOUBAO_REALTIME_PROFILE),inputs,interruptionInput:interruptionId?await loadInput(interruptionId,null):null});
    await mkdir(directory,{recursive:true,mode:0o700});
    const stem=interruptionId?'gateway-interrupt-'+interruptionId:'gateway-integration';
    await writeFile(directory+'/'+stem+'-report.json',JSON.stringify(result.report,null,2)+'\n',{mode:0o600});
    await writeFile(directory+'/'+stem+'-authored-replies.json',JSON.stringify(result.privateAuthoredReplies,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(result.report,null,2));if(!result.report.passed)process.exitCode=1;
  }
}
