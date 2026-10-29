// Diagnostic only: real provider metadata replayed through unchanged presentation
// code with a simulated PCM playback clock. No browser/human listening claim.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {SeeduplexProvider,validateSeeduplexProfile} from '../../packages/provider-doubao/seeduplex.js';
import {startMockBackend} from '../../apps/hskai-mock/src/backend.js';
import {ConversationInitializer} from '../../packages/agent-core/conversation-initializer.js';
import {TeachingSession} from '../../packages/agent-core/teaching.js';
import {ThaiFreeTalkSession} from '../../packages/free-talk-thai/session.js';
import {wavPCM} from '../prepare-fc-probe-inputs.js';
import {normalizeInput} from './english-control/cases.js';

const hash=v=>createHash('sha256').update(v).digest('hex');
const args=process.argv.slice(2),run=args.find(a=>a.startsWith('--run='))?.slice(6);
if(!args.includes('--live')||!run||args.some(a=>!['--live','--slow-only'].includes(a)&&!/^--run=[a-z0-9-]{1,40}$/.test(a))||args.filter(a=>a.startsWith('--run=')).length!==1)throw Error('EXPLICIT_RUN_REQUIRED');
const dir='.local/thai-support-spike/caption-sync-'+run;await mkdir(dir,{recursive:true,mode:0o700});
try{await readFile(dir+'/result.json');throw Error('RESULT_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
const profile=JSON.parse(await readFile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json','utf8'));validateSeeduplexProfile(profile);
const input=wavPCM(await readFile('.local/thai-support-spike/english-control-20261028-paired-v1/input-gaming_zh.wav'));
const source=new URL('../../apps/realtime-gateway/public/presentation.js',import.meta.url);
const presentationSource=await readFile(source,'utf8');
const dataURL=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
async function presentationFor(locale,zeroGate=false){
  const activeSource=locale==='th'?new URL('../../apps/free-talk-thai/public/presentation.js',import.meta.url):source;
  const activeText=await readFile(activeSource,'utf8');
  const phrase=new URL(locale==='th'?'../../apps/free-talk-thai/public/caption-phrases.js':'../../apps/realtime-gateway/public/caption-phrases.js',import.meta.url);
  const policy=zeroGate?dataURL((await readFile(phrase,'utf8')).replace(/stream_unit_ms:\d+/u,'stream_unit_ms:0')):phrase.href;
  return (await import(dataURL(activeText.replace("'./diagnostics.js'",JSON.stringify(new URL('./diagnostics.js',source).href)).replace("'./caption-phrases.js'",JSON.stringify(policy))))).Presentation;
}
async function replay(events,locale,zeroGate=false){
  const Presentation=await presentationFor(locale,zeroGate);
  let wall=0,serial=0,received=0,nextAt=0,available=0;const spans=[],timers=new Map(),reveals=[];
  const played=()=>spans.reduce((n,s)=>n+Math.min(s.duration,Math.max(0,wall-s.start)),0);
  const view=new Presentation({now:()=>wall,schedule:(fn,ms)=>{timers.set(++serial,{fn,at:wall+ms});return serial;},unschedule:id=>timers.delete(id),render:()=>{},stopAudio:()=>{},
    play:(bytes,rate)=>{const duration=bytes/2/rate*1000,start=Math.max(wall+30,nextAt);nextAt=start+duration;received+=duration;spans.push({start,duration});},
    getPlayback:()=>({played_ms:played(),received_ms:received,running:true,clock_source:'simulated_pcm_spans'}),
    onObserve:(name,f)=>{if(name==='caption.revealed')reveals.push({at_ms:wall,visible_chars:f.visible_chars,available_chars:available,phrase_units:f.phrase_units,cue_at_ms:f.cue_at_ms,played_ms:played()});}
  });
  let i=0;while(i<events.length||timers.size){
    const timer=[...timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
    const event=events[i];
    if(event&&(!timer||event.at_ms<=timer[1].at)){
      wall=event.at_ms;i++;
      if(event.type==='response.started')view.begin('reply');
      if(event.type==='response.text.delta'){available+=[...event.text].length;view.append('reply',event.text);}
      if(event.type==='response.audio.chunk')view.audio('reply',event.bytes,24000);
      if(event.type==='response.done')view.done('reply');
    }else{wall=timer[1].at;timers.delete(timer[0]);timer[1].fn();}
    if(wall>120000)throw Error('REPLAY_LIMIT');
    if(view.mode==='complete'&&i===events.length)break;
  }
  const sample=at=>{const r=reveals.filter(r=>r.at_ms<=at).at(-1);return {at_ms:Math.round(at),visible_chars:r?.visible_chars??0,total_chars:available};};
  const firstAudio=spans[0]?.start??0,audioEnd=nextAt;
  return {kind:zeroGate?'diagnostic_zero_stream_gate':'production_policy',clock:'simulated_pcm_not_device',first_reveal_ms:reveals[0]?.at_ms??null,last_reveal_ms:reveals.at(-1)?.at_ms??null,audio_start_ms:Math.round(firstAudio),audio_end_ms:Math.round(audioEnd),audio_pcm_ms:Math.round(received),caption_tail_after_audio_ms:Math.round(Math.max(0,(reveals.at(-1)?.at_ms??0)-audioEnd)),completion_ms:Math.round(wall),reveals,checkpoints:[.25,.5,.75,1].map(p=>({audio_fraction:p,...sample(firstAudio+(audioEnd-firstAudio)*p)}))};
}
const wait=async(test,fail,ms=60000)=>{const end=Date.now()+ms;while(!test()){if(fail())throw Error(fail());if(Date.now()>end)throw Error('PROBE_TIMEOUT');await new Promise(r=>setTimeout(r,30));}};
const report={date:'2026-10-29',run,kind:'caption_sync_diagnostic',real_provider:true,browser_audio:false,human_listening:false,production_code_changed:false,source_sha256:hash(presentationSource),input_pcm_sha256:hash(input),input_kind:'authored_reused_chinese_audio',planner:'frozen_authorized_mock_rule_plan',samples:[]};
report.thai_source_sha256=hash(await readFile(new URL('../../apps/free-talk-thai/public/presentation.js',import.meta.url),'utf8'));
let backend;
try{
  backend=await startMockBackend();
  for(const pace of (args.includes('--slow-only')?['slow']:['slow','normal']))for(const locale of ['th','en']){
    const id=locale+'-'+pace,result={id,locale,pace,complete:false},events=[];let ready=false,done=false,failure,bytes=0,text='',asr='',response,turn,owner,pump;
    const token=await backend.pocPort.issue('poc-learner'),identity=backend.bridge.verify(token,'session:create');identity.memory=await backend.memoryPort.read(identity);
    const planning=await new ConversationInitializer({port:backend.planningPort,planner:null,mode:'next_turn_advisory'}).prepare({mode:'free',speech_pace:pace},identity);
    const Session=locale==='th'?ThaiFreeTalkSession:TeachingSession;
    const session=new Session({sessionId:'caption-sync-diagnostic',mode:'free',memory:identity.memory,speechPace:pace,planning,planner:null});session.captionControls=true;session.speech.enable(pace==='slow'?-20:0);
    const instructions=session.instructions();result.instructions_sha256=hash(instructions);
    const provider=new SeeduplexProvider({profile,env:process.env,speechPace:pace}),start=performance.now();let position=0;
    try{
      provider.open({sessionId:randomUUID(),instructions,onFailure:code=>{failure=code;},onEvent:p=>{try{
        const e=p.event;if(!e)return;const at_ms=Math.round(performance.now()-start);
        if(e.type==='session.ready'){ready=true;return;}
        if(e.type==='user.final'){if(turn)throw Error();turn=e.turn_id;asr=e.payload.text;return;}
        if(e.type==='response.started'){if(response)throw Error();response=e.response_id;owner=e.turn_id;events.push({type:e.type,at_ms});return;}
        if(e.type.startsWith('response.')&&e.response_id!==response)throw Error();
        if(e.type==='response.text.delta'){text+=e.payload.text;events.push({type:e.type,at_ms,text:e.payload.text});if(text.length>4000)throw Error();}
        if(e.type==='response.audio.chunk'){bytes+=e.payload.byte_length;events.push({type:e.type,at_ms,bytes:e.payload.byte_length});if(bytes>2880000)throw Error();}
        if(e.type==='response.done'){events.push({type:e.type,at_ms});done=true;}
        if(e.type==='response.cancelled')failure='UNEXPECTED_CANCEL';
      }catch{failure='INVALID_PROBE_EVENT';}}});
      await wait(()=>ready,()=>failure,15000);
      pump=setInterval(()=>{try{const frame=Buffer.alloc(640);input.copy(frame,0,position,Math.min(position+640,input.length));position=Math.min(position+640,input.length);provider.sendAudio(frame);}catch{failure='INPUT_FAILED';}},20);
      await wait(()=>done,()=>failure);clearInterval(pump);
      result.complete=!!turn&&turn===owner&&bytes>0;result.asr_exact=normalizeInput(asr)===normalizeInput('你最近玩电子游戏吗？');result.ownership_matched=turn===owner;
      const t=events.filter(e=>e.type==='response.text.delta'),a=events.filter(e=>e.type==='response.audio.chunk');
      Object.assign(result,{text_chunks:t.length,audio_chunks:a.length,output_chars:[...text].length,output_sha256:hash(text),han:(text.match(/\p{Script=Han}/gu)??[]).length,thai:(text.match(/\p{Script=Thai}/gu)??[]).length,latin_words:(text.match(/[A-Za-z]+/g)??[]).length,audio_pcm_ms:Math.round(bytes/48),first_text_ms:t[0]?.at_ms,first_audio_ms:a[0]?.at_ms,last_text_ms:t.at(-1)?.at_ms,done_ms:events.at(-1)?.at_ms});
      result.first_text_minus_audio_ms=result.first_text_ms-result.first_audio_ms;
      result.presentation=await replay(events,locale);result.diagnostic_zero_gate=await replay(events,locale,true);
      result.max_extra_gate_delay_ms=Math.max(0,...result.presentation.reveals.map((r,i)=>r.at_ms-(result.diagnostic_zero_gate.reveals[i]?.at_ms??r.at_ms)));
      await writeFile(dir+'/'+id+'-authored-replay.json',JSON.stringify({asr,text,events},null,2)+'\n',{mode:0o600});
    }catch(e){result.failure=failure??(/^[A-Z_]+$/.test(e.message)?e.message:'PROBE_FAILED');}
    finally{clearInterval(pump);result.closed_ack=(await provider.close())?.acknowledged===true;}
    report.samples.push(result);await writeFile(dir+'/result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({id,complete:result.complete,failure:result.failure,first_text_minus_audio_ms:result.first_text_minus_audio_ms,audio_pcm_ms:result.audio_pcm_ms,extra_gate_delay_ms:result.max_extra_gate_delay_ms,tail_ms:result.presentation?.caption_tail_after_audio_ms}));
  }
}finally{await backend?.close();}
if(report.samples.some(s=>!s.complete))process.exitCode=1;
