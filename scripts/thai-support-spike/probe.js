import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {SeeduplexProvider,validateSeeduplexProfile} from '../../packages/provider-doubao/seeduplex.js';
import {wavPCM} from '../prepare-fc-probe-inputs.js';
import {pcmWave} from '../bilingual-speech-pace/evidence.js';

// Isolated Free Talk capability probe: authored inputs only, no learner data,
// product prompts, profile edits or raw wire logs. Review audio/text is private
// and opt-in; it is never a recording of a learner.
const base='你是 Kai，一位友善、耐心的 AI 中文学习伙伴。这是自由聊天，先回应学生当前意思，不安排课程、作业或额外练习。不要主动开场。每次简短回应，最多一个问题。';
const thai='学生熟悉泰语。先说一句简短中文，紧接一句自然泰语解释同一意思。泰语必须使用泰文，不使用英文、拼音或罗马字转写，不增加第二个问题。当前明确只要中文时，只说中文。';
export const CASES=[
  {id:'english_control',voice:'Tingting',input:'你好，我喜欢音乐。',instructions:base+'先说一句中文，再用一句英文解释同一意思。',expected:'zh_en'},
  {id:'thai_fixed',voice:'Tingting',input:'请读例句。',instructions:base+'只原样朗读这两句：我喜欢音乐。 ฉันชอบดนตรี 不要添加或翻译为其他语言。',expected:'zh_th'},
  {id:'thai_natural_1',voice:'Tingting',input:'你好，我喜欢音乐。',instructions:base+thai,expected:'zh_th'},
  {id:'thai_natural_2',voice:'Tingting',input:'今天我很开心。',instructions:base+thai,expected:'zh_th'},
  {id:'thai_help',voice:'Tingting',input:'散步是什么意思？请先说中文，再用泰语解释。',instructions:base+thai,expected:'zh_th'},
  {id:'chinese_only_override',voice:'Tingting',input:'这次只用中文回答，你喜欢音乐吗？',instructions:base+thai,expected:'zh'},
  {id:'thai_input_exploratory',voice:'Kanya',input:'ฉันชอบดนตรี',instructions:base+thai,expected:'zh_th',exploratory_input:true}
];
const args=process.argv.slice(2),selected=args.find(a=>a.startsWith('--case='))?.slice(7);
if(args.some(a=>!['--live','--keep-review-sample'].includes(a)&&!a.startsWith('--case='))||args.filter(a=>a.startsWith('--case=')).length>1||selected&&!CASES.some(c=>c.id===selected))throw Error('INVALID_SPIKE_ARGUMENTS');
const cases=CASES.filter(c=>!selected||c.id===selected);
if(!args.includes('--live')){console.log(JSON.stringify({mode:'dry_run',cases,production_changed:false,live_provider:false}));process.exit(0);}
const profile=JSON.parse(await readFile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json','utf8'));
validateSeeduplexProfile(profile);
const directory='.local/thai-support-spike';await mkdir(directory,{recursive:true,mode:0o700});
const keepReview=args.includes('--keep-review-sample');
const hash=s=>createHash('sha256').update(s).digest('hex');
const normalize=s=>s.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'').toLowerCase();
async function run(c){
  const path=directory+'/'+c.id;
  execFileSync('/usr/bin/say',['-v',c.voice,'-o',path+'.aiff',c.input]);
  execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path+'.aiff',path+'.wav']);
  const pcm=wavPCM(await readFile(path+'.wav'));if(pcm.length>640000||pcm.length<640)throw Error('AUTHORED_PCM_LIMIT');
  const result={id:c.id,expected:c.expected,live_provider:false,input_source:'authored_os_tts',exploratory_input:c.exploratory_input===true,input_sha256:hash(pcm),instructions_sha256:hash(c.instructions),asr_final_count:0,asr_matches_authored:null,asr_han:0,asr_thai:0,audio_bytes:0,audio_non_silent:false,response_done:false,ownership_matched:false};
  let text='',inputId=null,replyId=null,turnId=null,pump,deadline,position=0,settled=false;const audio=[];
  const provider=new SeeduplexProvider({profile,env:process.env});
  await new Promise(resolve=>{
    const finish=async reason=>{
      if(settled)return;settled=true;clearInterval(pump);clearTimeout(deadline);result.ended=reason;
      result.ownership_matched=!!inputId&&inputId===turnId;
      result.han_characters=(text.match(/\p{Script=Han}/gu)??[]).length;
      result.thai_characters=(text.match(/\p{Script=Thai}/gu)??[]).length;
      result.latin_words=(text.match(/[A-Za-z]+/g)??[]).length;
      const first=text.match(/[\p{Script=Han}\p{Script=Thai}A-Za-z]/u)?.[0];
      result.chinese_first=!!first&&/\p{Script=Han}/u.test(first);
      result.surface_language_match=result.chinese_first&&(c.expected==='zh_en'?result.latin_words>0&&result.thai_characters===0:c.expected==='zh_th'?result.thai_characters>0&&result.latin_words===0:result.thai_characters===0&&result.latin_words===0);
      result.complete_sample=reason==='reply_done'&&result.live_provider&&result.response_done&&result.asr_final_count===1&&result.ownership_matched&&result.audio_bytes>0;
      result.text_sha256=hash(text);
      result.session_closed_ack=(await provider.close())?.acknowledged===true;
      if(keepReview&&result.complete_sample){
        await writeFile(path+'-reply.wav',pcmWave(Buffer.concat(audio),24000),{mode:0o600});
        await writeFile(path+'-reply.txt',text+'\n',{mode:0o600});
        result.review_sample_saved=true;
      }
      text='';audio.length=0;resolve();
    };
    deadline=setTimeout(()=>finish('duration_limit'),35000);
    provider.open({sessionId:randomUUID(),instructions:c.instructions,onFailure:code=>finish(code),onEvent:message=>{
      if(settled)return;
      try{
        const event=message.event;if(!event)return;
        if(event.type==='session.ready'){
          result.live_provider=true;
          pump=setInterval(()=>{try{const frame=Buffer.alloc(640);pcm.copy(frame,0,position,Math.min(position+640,pcm.length));position=Math.min(position+640,pcm.length);provider.sendAudio(frame);}catch{finish('input_send_failed');}},20);
        }
        if(event.type==='user.final'){
          if(inputId&&inputId!==event.turn_id)return void finish('multiple_input');
          inputId=event.turn_id;result.asr_final_count++;
          result.asr_matches_authored=normalize(event.payload.text)===normalize(c.input);
          result.asr_han=(event.payload.text.match(/\p{Script=Han}/gu)??[]).length;
          result.asr_thai=(event.payload.text.match(/\p{Script=Thai}/gu)??[]).length;
        }
        if(event.type.startsWith('response.')){
          if(replyId&&replyId!==event.response_id)return void finish('multiple_reply');
          replyId=event.response_id;turnId=event.turn_id;
        }
        if(event.type==='response.text.delta'){text+=event.payload.text;if(text.length>4000)return void finish('text_limit');}
        if(event.type==='response.audio.chunk'){
          const bytes=Buffer.from(message.audio,'base64');result.audio_bytes+=bytes.length;
          if(keepReview)audio.push(bytes);
          for(let i=0;i+1<bytes.length;i+=2)if(Math.abs(bytes.readInt16LE(i))>300){result.audio_non_silent=true;break;}
          if(result.audio_bytes>1920000)return void finish('audio_limit');
        }
        if(event.type==='response.done'){result.response_done=true;finish('reply_done');}
      }catch{finish('invalid_probe_event');}
    }});
  });
  return result;
}
const report={version:1,kind:'free_talk_thai_support_spike',model:profile.session_create.session.model,voice:profile.session_create.session.audio.output.voice,speed:profile.session_create.session.audio.output.speed,production_changed:false,teacher_assistant_changed:false,mock_business_used:false,browser_audio_tested:false,human_listening_tested:false,thai_quality_accepted:false,output_audio_saved:keepReview,output_transcripts_saved:keepReview,samples:[]};
for(const c of cases){const result=await run(c);report.samples.push(result);await writeFile(directory+'/result'+(selected?'-'+selected:'')+'.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));}
// Capability absence is a finding; only incomplete collection fails the command.
if(report.samples.some(s=>!s.complete_sample))process.exitCode=1;
