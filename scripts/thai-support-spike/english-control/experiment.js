import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {SeeduplexProvider,validateSeeduplexProfile} from '../../../packages/provider-doubao/seeduplex.js';
import {startMockBackend} from '../../../apps/hskai-mock/src/backend.js';
import {ConversationInitializer} from '../../../packages/agent-core/conversation-initializer.js';
import {ThaiFreeTalkSession} from '../../../packages/free-talk-thai/session.js';
import {pcmWave} from '../../bilingual-speech-pace/evidence.js';
import {wavPCM} from '../../prepare-fc-probe-inputs.js';
import {INPUTS,experimentPlan,normalizeInput,languageSurface,summarize} from './cases.js';

const args=process.argv.slice(2),run=args.find(a=>a.startsWith('--run='))?.slice(6)??'20261028-v1';
if(args.some(a=>a!=='--live'&&!/^--run=[a-z0-9-]{1,40}$/.test(a))||args.filter(a=>a.startsWith('--run=')).length>1||args.includes('--live')&&!args.some(a=>a.startsWith('--run=')))throw Error('INVALID_EXPERIMENT_ARGUMENTS');
const plan=experimentPlan();if(!args.includes('--live')){console.log(JSON.stringify({mode:'dry_run',plan,inputs:INPUTS,product_code_changed:false}));process.exit(0);}
const dir='.local/thai-support-spike/english-control-'+run;await mkdir(dir,{recursive:true,mode:0o700});
try{await readFile(dir+'/result.json');throw Error('EXPERIMENT_RUN_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
const hash=v=>createHash('sha256').update(v).digest('hex'),profile=JSON.parse(await readFile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json','utf8'));validateSeeduplexProfile(profile);
const wait=async(predicate,failure,ms=45000)=>{const end=Date.now()+ms;while(!predicate()){if(failure())throw Error(failure());if(Date.now()>end)throw Error('EXPERIMENT_TIMEOUT');await new Promise(r=>setTimeout(r,30));}};
async function authoredPCM(id,spec){
  const generated=structuredClone(profile);generated.session_create.session.audio.output.speed=0;
  const voice=new SeeduplexProvider({profile:generated,env:process.env}),chunks=[];let done=false,failure,bytes=0;
  let text='';
  try{
    voice.open({sessionId:randomUUID(),instructions:'你是朗读员，不主动开场，只原样朗读提交的固定文字，不翻译、不解释、不添加内容。',onFailure:code=>{failure=code;},onEvent:p=>{try{
      const e=p.event;if(!e)return;
      if(e.type==='session.ready'){voice.mute();voice.speakFixedText(spec.text);}
      if(e.type==='response.text.delta')text+=e.payload.text;
      if(e.type==='response.audio.chunk'){chunks.push(Buffer.from(p.audio,'base64'));bytes+=e.payload.byte_length;if(bytes>480000)failure='INPUT_AUDIO_LIMIT';}
      if(e.type==='response.done')done=true;
    }catch{failure='INPUT_GENERATION_FAILED';}}});
    await wait(()=>done,()=>failure,30000);if(bytes<960)throw Error('EMPTY_INPUT_AUDIO');
    if(text&&normalizeInput(text)!==normalizeInput(spec.text))throw Error('FIXED_INPUT_TEXT_MISMATCH');
    const path=dir+'/input-'+id;await writeFile(path+'-24.wav',pcmWave(Buffer.concat(chunks),24000),{mode:0o600});
    execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path+'-24.wav',path+'.wav']);
    const pcm=wavPCM(await readFile(path+'.wav'));
    return {pcm,evidence:{id,language:spec.language,authored_text_sha256:hash(spec.text),pcm_sha256:hash(pcm),pcm_ms:Math.round(pcm.length/32),generator:'doubao_fixed_text_same_voice',fixed_synthesis_text_observed:!!text,fixed_synthesis_text_match:text?true:null}};
  }finally{await voice.close();}
}

let backend;
let instructions;
try{
  backend=await startMockBackend();const token=await backend.pocPort.issue('poc-learner'),identity=backend.bridge.verify(token,'session:create');identity.memory=await backend.memoryPort.read(identity);
  const preparation=await new ConversationInitializer({port:backend.planningPort,planner:null,mode:'next_turn_advisory'}).prepare({mode:'free',speech_pace:'slow'},identity);
  const session=new ThaiFreeTalkSession({sessionId:'english-input-control',mode:'free',memory:identity.memory,speechPace:'slow',planning:preparation,planner:null});
  session.speech.enable(profile.session_create.session.audio.output.speed??-20);session.captionControls=true;instructions=session.instructions();
}finally{await backend?.close();}
const report={version:1,kind:'controlled_english_input_effect',run,model:profile.session_create.session.model,voice:profile.session_create.session.audio.output.voice,speed:profile.session_create.session.audio.output.speed,instructions_sha256:hash(instructions),fixture:'product_ThaiFreeTalkSession_frozen_authorized_mock_rule_plan',planner_in_critical_path:false,product_gateway_tested:false,policy_updated_between_turns:false,input_generator_same_voice:true,real_provider:true,browser_audio:false,human_listening:false,thai_quality_accepted:false,production_code_changed:false,planned_sessions:plan.sessions.length,planned_turns:plan.sessions.reduce((n,s)=>n+s.inputs.length,0),inputs:[],results:[]};
await writeFile(dir+'/manifest.json',JSON.stringify({plan,inputs:INPUTS,instructions_sha256:hash(instructions)},null,2)+'\n',{mode:0o600});
await writeFile(dir+'/instructions.txt',instructions,{mode:0o600});
const prepared=new Map();
for(const [id,spec] of Object.entries(INPUTS)){const input=await authoredPCM(id,spec);prepared.set(id,input.pcm);report.inputs.push(input.evidence);console.log(JSON.stringify({phase:'input_prepared',...input.evidence}));}
let saves=Promise.resolve();const save=()=>{const data=JSON.stringify({...report,summary:summarize(report.results)},null,2)+'\n';saves=saves.then(()=>writeFile(dir+'/result.json',data,{mode:0o600}));return saves;};await save();
async function collect(spec){
  const provider=new SeeduplexProvider({profile,env:process.env}),result={...spec,instructions_sha256:hash(instructions),provider_ready:false,complete:false,turns:[]},review=[];
  let current,ready=false,failure,pump,queued=Buffer.alloc(0),position=0,inputEndedAt=0;
  try{
    provider.open({sessionId:randomUUID(),instructions,onFailure:code=>{failure=code;},onEvent:p=>{try{
      const e=p.event;if(!e)return;if(e.type==='session.ready'){ready=true;result.provider_ready=true;return;}
      if(!current){if(e.type==='response.started')failure='UNSOLICITED_RESPONSE';return;}
      if(e.type==='user.final'){current.finals++;if(current.turn&&current.turn!==e.turn_id)failure='MULTIPLE_INPUTS';current.turn=e.turn_id;current.asr=e.payload.text;}
      if(e.type==='response.started'){if(current.response&&current.response!==e.response_id)failure='OVERLAPPING_REPLY';current.response=e.response_id;current.owner=e.turn_id;current.startedAt=performance.now();}
      if(e.type==='response.text.delta'){if(e.response_id!==current.response)throw Error();current.text+=e.payload.text;if(current.text.length>4000)failure='TEXT_LIMIT';}
      if(e.type==='response.audio.chunk'){if(e.response_id!==current.response)throw Error();current.audio_bytes+=e.payload.byte_length;current.firstAudioAt??=performance.now();if(current.audio_bytes>1920000)failure='AUDIO_LIMIT';}
      if(e.type==='response.done'&&e.response_id===current.response)current.done=true;
      if(e.type==='response.cancelled')failure='UNEXPECTED_CANCEL';
    }catch{failure='INVALID_EXPERIMENT_EVENT';}}});
    await wait(()=>ready,()=>failure,15000);
    pump=setInterval(()=>{try{const frame=Buffer.alloc(640);queued.copy(frame,0,position,Math.min(position+640,queued.length));position=Math.min(position+640,queued.length);if(current&&!inputEndedAt&&position===queued.length)inputEndedAt=performance.now();provider.sendAudio(frame);}catch{failure='AUDIO_SEND_FAILED';}},20);
    for(const [index,id] of spec.inputs.entries()){
      const authored=INPUTS[id];current={input_id:id,finals:0,text:'',audio_bytes:0,done:false};queued=prepared.get(id);position=0;inputEndedAt=0;
      await wait(()=>current.done,()=>failure);if(!current.turn)await wait(()=>!!current.turn,()=>failure,2000);
      const s=current,complete=s.done&&s.finals===1&&s.turn===s.owner&&s.audio_bytes>0;
      result.turns.push({index,input_id:id,input_language:authored.language,asr_exact:normalizeInput(s.asr??'')===normalizeInput(authored.text),asr_sha256:hash(s.asr??''),asr_final_count:s.finals,ownership_matched:s.turn===s.owner,complete,audio_bytes:s.audio_bytes,audio_pcm_ms:Math.round(s.audio_bytes/48),first_audio_after_input_ms:s.firstAudioAt&&inputEndedAt?Math.round(s.firstAudioAt-inputEndedAt):null,output_sha256:hash(s.text),...languageSurface(s.text)});
      review.push({index,input_id:id,authored:authored.text,asr:s.asr??null,reply:s.text});current=null;
      await new Promise(r=>setTimeout(r,650));
    }
    result.complete=result.turns.length===spec.inputs.length&&result.turns.every(t=>t.complete);
  }catch(e){result.failure=failure??(/^[A-Z_]+$/.test(e.message)?e.message:'EXPERIMENT_FAILED');if(current)review.push({input_id:current.input_id,partial:true,asr:current.asr??null,reply:current.text});}
  finally{clearInterval(pump);result.closed_ack=(await provider.close())?.acknowledged===true;await writeFile(dir+'/'+spec.id+'-authored-review.json',JSON.stringify(review,null,2)+'\n',{mode:0o600});}
  report.results.push(result);await save();console.log(JSON.stringify({phase:'session_complete',id:spec.id,complete:result.complete,failure:result.failure,turns:result.turns.map(t=>({input:t.input_language,latin:t.latin_words,chinese:t.han_characters,thai:t.thai_characters,asr_exact:t.asr_exact,expected_surface:t.expected_surface}))}));return result;
}
// Counterbalanced paired blocks; at most two simultaneous provider sessions.
for(const block of plan.blocks)for(let i=0;i<block.sessions.length;i+=2)await Promise.all(block.sessions.slice(i,i+2).map(collect));
await saves;console.log(JSON.stringify({phase:'finished',summary:summarize(report.results),complete:report.results.filter(r=>r.complete).length,assigned:plan.sessions.length}));
if(report.results.some(r=>!r.complete))process.exitCode=1;
