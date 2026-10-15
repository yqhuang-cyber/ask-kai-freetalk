import { once } from 'node:events';
import WebSocket from 'ws';
import { createGateway } from '../../realtime-gateway/src/server.js';
import { startMockBackend } from '../../hskai-mock/src/backend.js';
import { createDoubaoProvider,validateSeeduplexProfile } from '../../../packages/provider-doubao/seeduplex.js';
import { profileMemory,comparableText } from './multiturn-plan.js';
import { CollectionEvidence,observeMemoryPort,authorProviderAssociation } from './collection-evidence.js';

// Starts the same gateway, authorization ports, reducer, teaching, safety and
// summary projection as Web. Fixture overrides exist only in this CLI process.
export async function openAgentHarness({profile,env=process.env,initialProfile,caseId=null,signal,
  providerFactory,providerKind='doubao',turnTimeoutMs=45000,contextTimeoutMs=5000,protocolProbe=false}={}) {
  if(providerKind==='doubao')validateSeeduplexProfile(profile,{protocolProbe});
  else if(providerKind!=='test'||typeof providerFactory!=='function')throw new Error('INVALID_EVAL_PROVIDER');
  const evidence=new CollectionEvidence();
  const backend=await startMockBackend({initialMemory:profileMemory(initialProfile),mission:null});
  const memoryAudit=observeMemoryPort(backend.memoryPort);
  let diagnosticStart=0,inputEvidence=null;
  let server,ws,pump,current,closed=false,failure=null,ready=false,summary=null,terminal=null,latestState=null;
  let queued=Buffer.alloc(0),position=0,appliedVersion=1;
  const wake=new Set(),diagnostics=[],replies=new Map(),finals=new Map();
  const notify=()=>{for(const f of wake)f();wake.clear();};
  const fail=code=>{failure??=code;notify();};
  const wait=async(predicate,timeout=turnTimeoutMs)=> {
    const end=Date.now()+timeout;
    while(!predicate()) {
      if(failure)throw new Error(failure);
      if(signal?.aborted)throw new Error('RUN_ABORTED');
      if(Date.now()>=end)throw new Error('TURN_TIMEOUT');
      await new Promise(resolve=>{const timer=setTimeout(()=>{wake.delete(done);resolve();},Math.min(50,end-Date.now()));const done=()=>{clearTimeout(timer);resolve();};wake.add(done);});
    }
  };
  const stop=async()=> {
    if(closed)return;closed=true;clearTimeout(pump);
    if(ws?.readyState===WebSocket.OPEN){try{ws.send(JSON.stringify({type:'session.end'}));await wait(()=>terminal!==null,2500);}catch{}ws.terminate();}
    if(server){server.stopRealtime();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
    await backend.close();
  };
  try {
    server=createGateway({bridge:backend.bridge,memoryPort:memoryAudit.port,safeguardingPort:backend.safeguardingPort,privacyPort:backend.privacyPort,pocPort:backend.pocPort,
      providerKind,speechPaceSupported:true,contextTimeoutMs,readyTimeoutMs:10000,
      providerFactory:ticket=>{
        const provider=(providerFactory??(ticket=>createDoubaoProvider({profile,env,speechPace:ticket.speech_pace,protocolProbe})))(ticket);
        const open=provider.open.bind(provider);
        provider.open=options=>open({...options,onEvent:packet=>{
          if(packet.event)evidence.event('provider_adapter',packet.event.type,packet.event);
          if(packet.control)evidence.event('provider_adapter',packet.control,packet);
          options.onEvent(packet);
        }});return provider;
      }});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin=`http://127.0.0.1:${server.address().port}`;
    const post=async(path,body,cookie)=>{
      const response=await fetch(origin+path,{method:'POST',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(5000),...(signal?[signal]:[])]),headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
      if(!response.ok)throw new Error('EVAL_GATEWAY_REQUEST_FAILED');return response;
    };
    const launch=await post('/api/poc/launch',{}),cookie=launch.headers.get('set-cookie')?.split(';')[0];
    if(!cookie)throw new Error('EVAL_LAUNCH_COOKIE_MISSING');
    const ticket=await(await post('/api/sessions',{mode:'free',speech_pace:'slow'},cookie)).json();
    ws=new WebSocket(origin.replace('http:','ws:')+'/api/realtime',['ask-kai.v1',`ticket.${ticket.ticket}`],{origin,maxPayload:262144,perMessageDeflate:false});
    ws.on('error',()=>fail('EVAL_CLIENT_TRANSPORT_ERROR'));
    ws.on('close',()=>{if(!closed&&!terminal)fail('EVAL_SESSION_DISCONNECTED');notify();});
    ws.on('message',bytes=>{
      try {
        const packet=JSON.parse(bytes.toString());
        if(packet.type==='session.failed'){terminal=packet.type;fail(/^[A-Z_]{1,80}$/.test(packet.code??'')?packet.code:'EVAL_SESSION_FAILED');}
        if(packet.type==='session.closed')terminal=packet.type;
        if(packet.type==='teaching.summary')summary=packet.summary;
        if(packet.type==='teaching.state')latestState=packet;
        if(packet.type==='teaching.context.applied')appliedVersion=packet.version;
        if(packet.type==='diagnostics.event') {
          if(diagnostics.length>=4096)throw new Error('EVAL_DIAGNOSTIC_LIMIT');
          diagnostics.push(packet.row);
        }
        const e=packet.event;
        if(e)evidence.event('gateway_client',e.type,e);
        if(['session.failed','session.closed','teaching.context.applied','teaching.summary'].includes(packet.type))evidence.event('gateway_client',packet.type);
        if(packet.type==='diagnostics.event'&&packet.row?.name==='speech.candidate')evidence.event('gateway_client','speech.candidate',packet.row.fields);
        if(e?.type==='session.ready') {
          if((providerKind==='doubao'&&(!packet.provider_connected||packet.synthetic))||(providerKind==='test'&&!packet.synthetic))throw new Error('EVAL_PROVIDER_KIND_MISMATCH');
          ready=true;
        }
        if(e?.type==='user.final') {
          if(!current)throw new Error('UNEXPECTED_STUDENT_TURN');
          if(!finals.has(e.turn_id))finals.set(e.turn_id,{text:e.payload.text,case_turn:current});
          if([...finals.values()].filter(f=>f.case_turn===current).length>1)throw new Error('MULTIPLE_ASR_TURNS');
          if([...replies.values()].some(r=>r.case_turn===current&&r.turn_id!==e.turn_id))throw new Error('EVAL_REPLY_OWNERSHIP_MISMATCH');
        }
        if(e?.type==='response.started') {
          if(!current)throw new Error('UNSOLICITED_MODEL_REPLY');
          if([...finals].some(([id,f])=>f.case_turn===current&&id!==e.turn_id))throw new Error('EVAL_REPLY_OWNERSHIP_MISMATCH');
          replies.set(e.response_id,{turn_id:e.turn_id,case_turn:current,text:'',completed:false,audio_bytes:0});
        }
        if(e?.type?.startsWith('response.')&&e.type!=='response.started') {
          const r=replies.get(e.response_id);
          if(!r||r.turn_id!==e.turn_id)throw new Error('EVAL_REPLY_OWNERSHIP_MISMATCH');
          if(e.type==='response.text.delta'){r.text+=e.payload.text;if(r.text.length>4096)throw new Error('EVAL_REPLY_TEXT_LIMIT');}
          if(e.type==='response.audio.chunk')r.audio_bytes+=e.payload.byte_length;
          if(e.type==='response.done')r.completed=true;
          if(e.type==='response.cancelled')throw new Error('EVAL_REPLY_CANCELLED');
        }
        notify();
      }catch(error){fail(/^[A-Z_]{1,80}$/.test(error.message)?error.message:'EVAL_PACKET_INVALID');}
    });
    // ws emits packets immediately after open; handlers above are attached first.
    await wait(()=>ws.readyState===WebSocket.OPEN,10000);
    ws.send(JSON.stringify({type:'diagnostics.enable'}));
    await wait(()=>ready,10000);
    const tick=()=>{
      if(closed||failure||ws.readyState!==WebSocket.OPEN)return;
      try {
        const frame=Buffer.alloc(640),offset=position;
        if(position<queued.length){queued.copy(frame,0,position,Math.min(position+640,queued.length));position+=640;}
        if(ws.bufferedAmount>65536)throw new Error('EVAL_INPUT_BACKPRESSURE');
        const audioStart=Math.max(offset,3200),audioEnd=Math.min(offset+640,queued.length);
        const sent=inputEvidence&&audioEnd>audioStart?queued.subarray(audioStart,audioEnd):Buffer.alloc(0);
        const owner=inputEvidence;
        ws.send(frame,error=>{if(owner&&sent.length)evidence.flushed(owner,sent.length,error);});
        if(owner&&sent.length)evidence.enqueue(owner,sent);
        notify();pump=setTimeout(tick,20);
      }catch{fail('EVAL_INPUT_PUMP_FAILED');}
    };tick();
    const association=(input,audio,complete)=>authorProviderAssociation({caseId,turn:input.turn,audioSha:audio.sha256,
      finals:[...finals].filter(([,f])=>f.case_turn===input.turn).map(([turn_id])=>({turn_id})),
      replies:[...replies].filter(([,r])=>r.case_turn===input.turn).map(([response_id,r])=>({...r,response_id})),complete});
    return {
      snapshotTurn(input,audio) {
        const r=[...replies.values()].find(r=>r.case_turn===input.turn&&finals.get(r.turn_id)?.case_turn===input.turn);
        const f=(r&&finals.get(r.turn_id))??[...finals.values()].find(f=>f.case_turn===input.turn);
        const segments=[...finals].filter(([,f])=>f.case_turn===input.turn),fragments=[...replies].filter(([,r])=>r.case_turn===input.turn);
        return {turn:input.turn,script_input:input.text,actual_student_transcript:f?.text??null,actual_kai:r?.text??null,
          input_source:audio.source,input_audio_sha256:audio.sha256,input_audio_duration_ms:audio.duration_ms,
          // A failed collector turn can contain a completed model fragment.
          // Preserve that fact without admitting the failed segment to scoring.
          reply_complete:false,model_reply_complete:r?.completed===true,playback_measured:false,author_provider_association:association(input,audio,false),asr_surface_match:f?comparableText(f.text)===comparableText(input.text):null,
          asr_segments:segments.slice(0,4).map(([id,f])=>({turn_id:id,text:f.text})),
          reply_fragments:fragments.slice(0,4).map(([id,r])=>({response_id:id,turn_id:r.turn_id,text:r.text,model_reply_complete:r.completed})),
          fragments_truncated:segments.length>4||fragments.length>4,
          dependency_review:input.dependency.type==='prior_reply_semantics'?'required':'not_required',
          context_dependency:structuredClone(input.dependency),diagnostics:evidence.turns.has(input.turn)?diagnostics.slice(diagnosticStart):[],collection_evidence:evidence.snapshot(input.turn)};
      },
      async turn(input,audio) {
        if(failure)throw new Error(failure);
        await wait(()=>position>=queued.length&&appliedVersion===(latestState?.context_version??1));
        current=input.turn;diagnosticStart=diagnostics.length;
        inputEvidence=evidence.begin(input.turn,audio.bytes);
        queued=Buffer.concat([Buffer.alloc(3200),audio.bytes]);position=0;
        await wait(()=>{
          const output=[...replies.values()].filter(r=>r.case_turn===current);
          if(output.length>1)throw new Error('MULTIPLE_MODEL_REPLIES');
          const r=output[0],f=r&&finals.get(r.turn_id);
          return position>=queued.length&&r?.completed&&f?.case_turn===current;
        });
        const r=[...replies.values()].find(r=>r.case_turn===current),f=finals.get(r.turn_id);
        if(!r.text.trim())throw new Error('EVAL_MISSING_REPLY_TEXT');
        const result={turn:input.turn,script_input:input.text,actual_student_transcript:f.text,actual_kai:r.text,
          input_source:audio.source,input_audio_sha256:audio.sha256,input_audio_duration_ms:audio.duration_ms,
          asr_surface_match:comparableText(f.text)===comparableText(input.text),reply_complete:true,author_provider_association:association(input,audio,true),
          pcm_output_duration_ms:r.audio_bytes/48,playback_measured:false,
          dependency_review:input.dependency.type==='prior_reply_semantics'?'required':'not_required',
          context_dependency:structuredClone(input.dependency)};
        await wait(()=>appliedVersion===(latestState?.context_version??1));
        result.next_turn_context_version=appliedVersion;result.context_update_confirmed=true;
        result.diagnostics=diagnostics.slice(diagnosticStart);
        result.collection_evidence=evidence.snapshot(input.turn);
        evidence.finishTurn();current=null;return result;
      },
      async finish(){await stop();return {summary,session_terminal:terminal,failure,collection_evidence:evidence.snapshotSession(),memory_audit:memoryAudit.snapshot()};},
      close:stop
    };
  }catch(error){await stop();throw error;}
}
