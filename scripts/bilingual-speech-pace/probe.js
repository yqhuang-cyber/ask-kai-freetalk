import {randomUUID, createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, mkdir,writeFile} from 'node:fs/promises';
import WebSocket from 'ws';
import {DUPLEX_ENDPOINT, preflight} from '../../packages/provider-doubao/probe.js';
import {validateSeeduplexProfile} from '../../packages/provider-doubao/seeduplex.js';
import {wavPCM} from '../prepare-fc-probe-inputs.js';
import {TUTOR_PACE_PROMPTS,TUTOR_PACE_SUITES} from './cases.js';
import {authoredInputEvidence,pcmWave,trimAuthoredPcm} from './evidence.js';

// Isolated S2S experiment. Authored OS speech is the input, never a microphone.
// Output audio, ASR and provider transcripts stay in memory; only aggregates
// leave the process. This does not change the production tutor or its prompts.
const sentences={
  zh:'今天下午，我们一起去公园散步，看看树上的小鸟，再聊聊你喜欢的事情。',
  en:"This afternoon, let's take a walk in the park, watch the birds in the trees, and talk about your favorite things."
};
const queries={zh:'请读中文例句。',en:'请读英文例句。',mixed:'请连续读两句例句。'};
const normalize=text=>text.toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
const target=kind=>kind==='mixed'?sentences.zh+' '+sentences.en:sentences[kind];
const common=`听到请求中文例句，只原样说出中文例句：${sentences.zh}\n听到请求英文例句，只原样说出英文例句：${sentences.en}\n听到请求连续示范两句例句，先原样说出中文例句，再原样说出英文例句。不要解释、问候、加标题、添加词语或重复句子。文字固定，说话节奏遵循你的角色和声音风格。`;
const originalCommon=`你是语言示范员。听到“请读中文例句”，只原样朗读中文例句：${sentences.zh}\n听到“请读英文例句”，只原样朗读英文例句：${sentences.en}\n听到“请连续读两句例句”，先原样朗读中文例句，再原样朗读英文例句。不要解释、问候、加标题、添加词语或重复句子。`;
const styles={
  neutral:'中文和英文都用自然正常的说话节奏，不刻意放慢任何一种语言。',
  differential:'按语言区别控制实际发声节奏：中文明显慢一些，约为平时正常语速的七成，保持自然连贯，不逐字蹦读；英文保持平时正常的自然语速，不要放慢英文。中英文切换时立即使用对应语言的节奏。不要口头说明这个要求，直接用声音执行。'
};
const args=process.argv.slice(2),suiteName=args.find(a=>a.startsWith('--suite='))?.slice(8)??'original';
const suite=TUTOR_PACE_SUITES[suiteName];
const conditions=suite?structuredClone(suite.conditions):[{id:'neutral_0',style:'neutral',speed:0},{id:'differential_0',style:'differential',speed:0},
  {id:'differential_minus20',style:'differential',speed:-20},{id:'neutral_minus20',style:'neutral',speed:-20}];
const sequence=suite?.sequence??['zh','en','zh','en','mixed'];
const fixedTargets=suite?.fixed_targets!==false;
const naturalTask='请根据学生当下的问题自然回答，每次给一个简短实用建议，不问候、不追加问题、不解释内部要求。根据学生请求选择中文、英文或中英双语。具体措辞由你自然组织，说话节奏遵循你的角色和声音风格。';
const instructionsFor=condition=>condition.instructions??(suite?TUTOR_PACE_PROMPTS[condition.style]+'\n'+(fixedTargets?common:naturalTask)+'\n':originalCommon+'\n'+styles[condition.style]);
const report={version:2,suite:suiteName,kind:'live_bilingual_s2s_pace_spike',status:'not_run',real_provider:false,
  input_source:'local_os_authored_speech',microphone_uploaded:false,browser_audio_tested:false,
  human_listening_tested:false,production_agent_changed:false,output_audio_saved:false,
  per_language_mixed_audio_alignment:false,samples:[],conditions,
  content_control:fixedTargets?'fixed_target':'natural_reply',
  instruction_sha256:conditions.map(c=>({id:c.id,sha256:createHash('sha256').update(instructionsFor(c)).digest('hex')})),
  target_sha256:fixedTargets?Object.fromEntries(Object.keys(queries).map(k=>[k,createHash('sha256').update(target(k)).digest('hex')])):null};
let socket,waiting,current,sessionId,pump,deadline,eventCount=0,stage='preflight',failure;
const fail=code=>{failure=code;if(waiting){const task=waiting;waiting=null;clearTimeout(task.timer);task.reject(new Error(code));}};
const send=value=>socket.send(JSON.stringify({event_id:randomUUID(),...value}));
const expect=(predicate,action,timeout=45000)=>new Promise((resolve,reject)=>{
  if(failure)return reject(new Error(failure));
  if(waiting)return reject(new Error('BILINGUAL_CONCURRENT_WAIT'));
  waiting={predicate,resolve,reject,timer:setTimeout(()=>fail('BILINGUAL_EVENT_TIMEOUT'),timeout)};
  try{action();}catch{fail('BILINGUAL_SEND_FAILED');}
});
const stop=()=>{clearTimeout(pump);pump=null;if(socket?.readyState===WebSocket.OPEN)try{send({type:'session.close'});}catch{}socket?.terminate();};
const abort=()=>{fail('BILINGUAL_ABORTED');stop();};
function metrics(chunks){
  const pcm=Buffer.concat(chunks),frameBytes=480; // 10 ms at 24 kHz / s16 mono
  let first=-1,last=-1,active=0;
  for(let offset=0;offset<pcm.length;offset+=frameBytes){
    const end=Math.min(offset+frameBytes,pcm.length);let sum=0;
    for(let i=offset;i+1<end;i+=2)sum+=pcm.readInt16LE(i)**2;
    if(Math.sqrt(sum/((end-offset)/2))>=300){if(first<0)first=offset;last=end;active+=end-offset;}
  }
  return {pcm_ms:Math.round(pcm.length/48),energy_span_ms:first<0?0:Math.round((last-first)/48),
    energy_active_ms:Math.round(active/48)};
}
try{
  if(args.some(a=>!['--live','--keep-authored-audio'].includes(a)&&!['--suite=original',...Object.keys(TUTOR_PACE_SUITES).map(k=>'--suite='+k)].includes(a))||args.filter(a=>a.startsWith('--suite=')).length>1)throw new Error('INVALID_PROBE_ARGUMENTS');
  if(args.includes('--live')){
    const profile=JSON.parse(await readFile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json','utf8'));
    validateSeeduplexProfile(profile);
    if(!preflight(profile).live_eligible)throw new Error('BILINGUAL_PREFLIGHT_BLOCKED');
    const key=process.env[profile.auth.env];
    if(typeof key!=='string'||key.length>8192||/[^\x21-\x7e]/.test(key))throw new Error('INVALID_CREDENTIAL_FORMAT');
    report.model=profile.session_create.session.model;
    report.voice=profile.session_create.session.audio.output.voice;
    const directory='.local/bilingual-pace-probe';await mkdir(directory,{recursive:true,mode:0o700});
    const inputs=new Map(),partsCache=new Map();report.authored_inputs=[];
    for(const condition of conditions)for(const kind of new Set(condition.sequence??sequence)){
      const specs=condition.input_specs?.[kind]??[{text:(condition.queries??queries)[kind],voice:condition.query_voice??'Tingting'}];
      const parts=[],partEvidence=[];
      for(const spec of specs){
        const voice=spec.voice??'Tingting',cacheKey=JSON.stringify({text:spec.text,voice,rate:spec.rate??null});
        if(!partsCache.has(cacheKey)){
          const path=`${directory}/input-${createHash('sha256').update(cacheKey).digest('hex').slice(0,16)}`;
          execFileSync('/usr/bin/say',['-v',voice,...(spec.rate?['-r',String(spec.rate)]:[]),'-o',path+'.aiff',spec.text]);
          execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path+'.aiff',path+'.wav']);
          partsCache.set(cacheKey,wavPCM(await readFile(path+'.wav')));
        }
        const pcm=specs.length>1?trimAuthoredPcm(partsCache.get(cacheKey)):partsCache.get(cacheKey);
        if(parts.length)parts.push(Buffer.alloc(1600)); // 50 ms gap in authored input only.
        parts.push(pcm);partEvidence.push({sha256:createHash('sha256').update(pcm).digest('hex'),pcm_ms:Math.round(pcm.length/32)});
      }
      const pcm=Buffer.concat(parts);if(pcm.length>640000)throw new Error('BILINGUAL_INPUT_LIMIT');
      inputs.set(condition.id+':'+kind,pcm);
      report.authored_inputs.push({condition:condition.id,kind,pcm_ms:Math.round(pcm.length/32),parts:partEvidence});
      if(args.includes('--keep-authored-audio'))await writeFile(`${directory}/${suiteName}-${condition.id}-input-${kind}.wav`,pcmWave(pcm,16000),{mode:0o600});
    }
    process.once('SIGINT',abort);process.once('SIGTERM',abort);
    deadline=setTimeout(()=>{fail('BILINGUAL_DURATION_LIMIT');stop();},480000);
    for(const condition of conditions){
      stage=condition.id;failure=null;sessionId=null;current=null;
      const closedReplies=new Set();
      const session=structuredClone(profile.session_create.session);
      session.instructions=instructionsFor(condition);
      if(condition.speed===null)delete session.audio.output.speed;else session.audio.output.speed=condition.speed;
      if(condition.voice)session.audio.output.voice=condition.voice;
      socket=new WebSocket(DUPLEX_ENDPOINT,{headers:{[profile.auth.header]:profile.auth.prefix+key},
        maxPayload:131072,perMessageDeflate:false,followRedirects:false,handshakeTimeout:5000});
      socket.on('error',()=>fail('BILINGUAL_TRANSPORT_ERROR'));
      socket.on('close',()=>fail('BILINGUAL_DISCONNECTED'));
      socket.on('message',(bytes,binary)=>{
        try{
          if(binary||++eventCount>12000)throw new Error('BILINGUAL_FRAME_LIMIT');
          const raw=JSON.parse(bytes.toString());
          if(raw.type==='error'){
            const code=raw.code??raw.status_code;
            if((typeof code==='number'&&Number.isFinite(code))||(typeof code==='string'&&/^[A-Z0-9_]{1,80}$/i.test(code)))report.provider_error_code=code;
            throw new Error('BILINGUAL_PROVIDER_ERROR');
          }
          if(raw.type==='session.created'){
            if(sessionId||typeof raw.session?.id!=='string'||!raw.session.id.length)throw new Error('BILINGUAL_SESSION_ID');
            sessionId=raw.session.id;
            condition.voice_echo_matches=typeof raw.session?.audio?.output?.voice==='string'?raw.session.audio.output.voice===session.audio.output.voice:null;
          }
          if(current){
            if(raw.type==='conversation.item.input_audio_transcription.completed'){
              if(current.inputId&&current.inputId!==raw.item_id)throw new Error('BILINGUAL_OVERLAPPING_INPUT');
              const observed=normalize(raw.text??raw.transcript??''),expected=normalize((condition.queries??queries)[current.kind]);
              current.inputId=raw.item_id;current.asrMatch=observed===expected;
              current.asrCharacters=observed.length;current.expectedCharacters=expected.length;
              current.asrControl=/中文.*慢.*英文.*正常/u.test(observed);
              current.inputEvidence=authoredInputEvidence(raw.text??raw.transcript??'',(condition.queries??queries)[current.kind],condition.asr_variants?.[current.kind]??[]);
            }
            if(['response.output_audio.started','response.output_text.delta','response.output_text.done','response.output_audio.done'].includes(raw.type)){
              if(typeof raw.response_id!=='string'||closedReplies.has(raw.response_id))throw new Error('BILINGUAL_REPLY_ID');
              if(current.responseId&&current.responseId!==raw.response_id)throw new Error('BILINGUAL_OVERLAPPING_REPLY');
              current.responseId=raw.response_id;
              if(typeof raw.question_id!=='string')throw new Error('BILINGUAL_QUESTION_ID');
              if(current.questionId&&current.questionId!==raw.question_id)throw new Error('BILINGUAL_FOREIGN_QUESTION');
              current.questionId=raw.question_id;
            }
            if(raw.type==='response.output_audio.started'){current.audioStarted=true;current.audioStartedAt=performance.now();}
            if(raw.type==='response.output_text.delta')current.text+=raw.delta??'';
            if(raw.type==='response.output_text.done'){current.text=raw.text??current.text;current.textDone=true;}
            if(current.text.length>4000)throw new Error('BILINGUAL_TEXT_LIMIT');
            if(raw.type==='response.output_audio.delta'){
              if(!current.audioStarted||!current.responseId)throw new Error('BILINGUAL_UNBOUND_AUDIO');
              if(raw.response_id!==undefined&&raw.response_id!==current.responseId)throw new Error('BILINGUAL_FOREIGN_AUDIO');
              const pcm=Buffer.from(raw.delta,'base64');
              if(!pcm.length||pcm.length%2||pcm.toString('base64')!==raw.delta)throw new Error('BILINGUAL_INVALID_PCM');
              current.bytes+=pcm.length;if(current.bytes>48*40000)throw new Error('BILINGUAL_AUDIO_LIMIT');
              current.chunks.push(pcm);
              current.firstPcmAt??=performance.now();
            }
            if(raw.type==='response.output_audio.done')current.audioDone=true;
          }else if(raw.type==='response.output_audio.started')throw new Error('BILINGUAL_UNEXPECTED_REPLY');
          if(waiting?.predicate(raw)){
            const task=waiting;waiting=null;clearTimeout(task.timer);task.resolve();
          }
        }catch(error){fail(/^BILINGUAL_[A-Z_]+$/.test(error.message)?error.message:'BILINGUAL_INVALID_EVENT');socket.terminate();}
      });
      await expect(r=>r.type==='session.created',()=>socket.once('open',()=>send({...profile.session_create,session})),15000);
      report.real_provider=true;
      let queued=Buffer.alloc(0),position=0;
      const tick=()=>{
        if(socket.readyState!==WebSocket.OPEN)return;
        const frame=Buffer.alloc(640);
        if(position<queued.length){queued.copy(frame,0,position,Math.min(position+640,queued.length));position+=640;if(position>=queued.length&&current)current.inputEndedAt=performance.now();}
        send({type:'input_audio_buffer.append',audio:frame.toString('base64')});pump=setTimeout(tick,20);
      };tick();
      const repeats={};
      for(const [index,kind] of (condition.sequence??sequence).entries()){
        stage=condition.id+'_'+(index+1);
        current={kind,text:'',chunks:[],bytes:0,audioStarted:false};
        await expect(()=>current?.audioDone&&current.textDone&&current.asrMatch!==undefined,()=>{
          queued=Buffer.concat([Buffer.alloc(6400),inputs.get(condition.id+':'+kind)]);position=0;
        });
        if(current.questionId!==current.inputId)throw new Error('BILINGUAL_INPUT_REPLY_MISMATCH');
        const outputKind=condition.output_kinds?.[kind]??kind;
        const expectedOutput=Object.hasOwn(condition.targets??{},kind)?condition.targets[kind]:fixedTargets?target(outputKind):null;
        const han=(current.text.match(/\p{Script=Han}/gu)??[]).length,english=(current.text.match(/[a-z]+(?:['’][a-z]+)*/giu)??[]).length;
        const sample={condition:condition.id,kind,repeat:repeats[kind]=(repeats[kind]??0)+1,
          phase:condition.control_kind?(kind===condition.control_kind?'control':index<(condition.sequence??sequence).indexOf(condition.control_kind)?'baseline':'after_control'):'measurement',
          asr_matches_authored_query:current.asrMatch,output_matches_target:expectedOutput?normalize(current.text)===normalize(expectedOutput):null,
          asr_observed_characters:current.asrCharacters,asr_expected_characters:current.expectedCharacters,
          asr_bilingual_pace_keywords_observed:current.asrControl,
          input_evidence:current.inputEvidence,
          output_language_matches_case:outputKind==='zh'?han>0&&english===0:outputKind==='en'?english>0&&han===0:han>0&&english>0,
          han_characters:han,english_words:english,
          text_done:current.textDone,audio_done:current.audioDone,
          first_audio_after_input_ms:Number.isFinite(current.inputEndedAt)?Math.round(current.audioStartedAt-current.inputEndedAt):null,
          first_pcm_after_input_ms:Number.isFinite(current.inputEndedAt)&&Number.isFinite(current.firstPcmAt)?Math.round(current.firstPcmAt-current.inputEndedAt):null,
          ...metrics(current.chunks)};
        if(outputKind!=='mixed'&&sample.phase!=='control'&&sample.energy_span_ms>0)sample.units_per_second=Number(((outputKind==='zh'?han:english)*1000/sample.energy_span_ms).toFixed(3));
        if(args.includes('--keep-authored-audio')){
          const path=`${directory}/${suiteName}-${condition.id}-${index+1}-${kind}.wav`;
          await writeFile(path,pcmWave(Buffer.concat(current.chunks)),{mode:0o600});sample.authored_review_clip=path;report.output_audio_saved=true;
        }
        report.samples.push(sample);closedReplies.add(current.responseId);current=null;
        console.error(JSON.stringify(sample));
      }
      clearTimeout(pump);pump=null;
      await expect(r=>r.type==='session.closed',()=>send({type:'session.close'}),5000);
      socket.removeAllListeners('close');socket.terminate();socket=null;
      condition.close_acknowledged=true;
    }
    report.status=report.samples.every(s=>(suite?.canonical_input?s.input_evidence.accepted:s.asr_matches_authored_query)&&s.output_matches_target!==false&&s.output_language_matches_case&&s.energy_span_ms>0)?'measured':'inconclusive';
  }
}catch(error){
  report.status='incomplete';report.stage=stage;
  report.error=/^(BILINGUAL_|INVALID_|DOUBAO_|SEEDUPLEX_|UNSUPPORTED_|UNREVIEWED_)[A-Z_]+$/.test(error.message)?error.message:'BILINGUAL_FAILED';
}finally{
  clearTimeout(deadline);process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);stop();
}
console.log(JSON.stringify(report,null,2));
if(!['not_run','measured','inconclusive'].includes(report.status))process.exitCode=1;
