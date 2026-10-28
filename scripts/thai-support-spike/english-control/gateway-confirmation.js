// Supplemental product-path check; planner variability is intentionally retained.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import WebSocket from 'ws';
import {wavPCM} from '../../prepare-fc-probe-inputs.js';
import {INPUTS,normalizeInput,languageSurface} from './cases.js';
const args=process.argv.slice(2),run=args.find(a=>a.startsWith('--run='))?.slice(6);
if(!args.includes('--live')||!run||args.some(a=>a!=='--live'&&!/^--run=[a-z0-9-]{1,40}$/.test(a))||args.filter(a=>a.startsWith('--run=')).length!==1)throw Error('EXPLICIT_RUN_REQUIRED');
const dir='.local/thai-support-spike/english-control-'+run;
const primary=JSON.parse(await readFile(dir+'/result.json','utf8'));
if(primary.results.length!==primary.planned_sessions)throw Error('PRIMARY_RUN_NOT_FINISHED');
try{await readFile(dir+'/gateway-result.json');throw Error('CONFIRMATION_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(dir,{recursive:true,mode:0o700});
const hash=v=>createHash('sha256').update(v).digest('hex');
const report={kind:'supplemental_running_product_gateway',run,real_provider:true,synthetic_inputs:true,synthetic_replay:false,business:'mock_hskai',human_listening:false,browser_audio:false,thai_quality_accepted:false,production_code_changed:false,planner_frozen:false,initial_prompt_frozen:false,planned_sessions:8,results:[]};
async function collect(locale,topic,language){
  const origin='http://127.0.0.1:'+(locale==='th'?4311:4310),input=INPUTS[topic+'_'+language];
  const pcm=wavPCM(await readFile(dir+'/input-'+topic+'_'+language+'.wav'));
  const result={id:`gateway-${locale}-${topic}-${language}`,locale,topic,input_language:language,input_pcm_sha256:hash(pcm),complete:false};
  let ws,pump,failure,ready=false,closed=false,current=null,position=0;
  const wait=async predicate=>{const end=Date.now()+50000;while(!predicate()){if(failure)throw Error(failure);if(Date.now()>end)throw Error('CONFIRMATION_TIMEOUT');await new Promise(r=>setTimeout(r,40));}};
  try{
    const runtime=await (await fetch(origin+'/api/runtime')).json();result.runtime_scenario=runtime.scenario??'legacy_free';result.planner_configured=runtime.planner_configured??null;
    const login=await fetch(origin+'/api/poc/launch',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({uid:'poc-learner'})}),cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw Error('LOGIN_FAILED');
    const call=async(path,body)=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok)throw Error('GATEWAY_REQUEST_FAILED');return r.json();};
    const entry={mode:'free',speech_pace:'slow'},preparation=await call('/api/conversation-preparations',entry);let prepared;
    // Explicit bounded asynchronous poll, since the voice wait is synchronous.
    const until=Date.now()+45000;
    do{prepared=await call('/api/conversation-preparations/'+preparation.preparation_id);if(prepared.status==='failed')throw Error('PREPARATION_FAILED');if(prepared.status==='ready')break;if(Date.now()>until)throw Error('PREPARATION_TIMEOUT');await new Promise(r=>setTimeout(r,100));}while(true);
    result.preparation_planning=prepared.view?.planning??null;
    const ticket=await call('/api/sessions',{...entry,preparation_id:preparation.preparation_id});
    ws=new WebSocket(origin.replace('http:','ws:')+ticket.websocket_path,[ticket.protocol,'ticket.'+ticket.ticket],{origin});
    ws.on('error',()=>{failure='TRANSPORT_FAILED';});ws.on('close',()=>{if(!closed&&!failure)failure='TRANSPORT_CLOSED';});
    ws.on('message',bytes=>{try{const p=JSON.parse(bytes);
      if(p.type==='session.failed'){failure='SESSION_FAILED';return;}
      if(p.type==='session.closed'){closed=true;return;}
      if(p.type==='teaching.state'){result.language_policy=p.language_policy;if(current&&!current.response)result.language_at_reply_start=p.language_policy;}
      const e=p.event;if(!e)return;
      if(e.type==='session.ready'){ready=p.synthetic===false&&p.provider_connected===true;result.provider_connected=ready;return;}
      if(!current)return;
      if(e.type==='user.final'){current.finals++;current.turn=e.turn_id;current.asr=e.payload.text;}
      if(e.type==='response.started'){if(current.response&&current.response!==e.response_id)throw Error();current.response=e.response_id;current.owner=e.turn_id;}
      if(e.response_id!==current.response)return;
      if(e.type==='response.text.delta'){current.text+=e.payload.text;if(current.text.length>4000)throw Error();}
      if(e.type==='response.audio.chunk'){current.audio_bytes+=e.payload.byte_length;if(current.audio_bytes>2400000)throw Error();}
      if(e.type==='response.done')current.done=true;
      if(e.type==='response.cancelled')failure='REPLY_CANCELLED';
    }catch{failure='INVALID_EVENT';}});
    await once(ws,'open');await wait(()=>ready);
    current={text:'',audio_bytes:0,finals:0,done:false};
    pump=setInterval(()=>{try{const frame=Buffer.alloc(640);pcm.copy(frame,0,position,Math.min(position+640,pcm.length));position=Math.min(position+640,pcm.length);ws.send(frame);}catch{failure='INPUT_SEND_FAILED';}},20);
    await wait(()=>current.done);
    Object.assign(result,{asr_exact:normalizeInput(current.asr??'')===normalizeInput(input.text),asr_final_count:current.finals,ownership_matched:!!current.turn&&current.turn===current.owner,audio_bytes:current.audio_bytes,output_sha256:hash(current.text),...languageSurface(current.text)});
    result.expected_bilingual_surface=locale==='th'?result.expected_surface:result.han_characters>0&&result.latin_words>0&&result.thai_characters===0&&result.chinese_first;
    result.complete=current.finals===1&&result.ownership_matched&&current.audio_bytes>0;
    clearInterval(pump);pump=null;ws.send(JSON.stringify({type:'session.end'}));await wait(()=>closed);result.closed=true;
  }catch(e){result.failure=failure??(/^[A-Z_]+$/.test(e.message)?e.message:'CONFIRMATION_FAILED');}
  finally{clearInterval(pump);ws?.terminate();await writeFile(dir+'/'+result.id+'-authored-review.json',JSON.stringify({authored:input.text,asr:current?.asr??null,reply:current?.text??null},null,2)+'\n',{mode:0o600});}
  report.results.push(result);console.log(JSON.stringify(result));
}
for(const locale of ['th','en'])for(const topic of ['gaming','music'])await Promise.all(['zh','en'].map(language=>collect(locale,topic,language)));
await writeFile(dir+'/gateway-result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
if(report.results.some(r=>!r.complete))process.exitCode=1;
