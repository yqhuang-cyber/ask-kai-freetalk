// Authored fixed-speech duration samples; not linguistic/pronunciation acceptance.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {SeeduplexProvider,validateSeeduplexProfile} from '../../packages/provider-doubao/seeduplex.js';
const args=process.argv.slice(2),run=args.find(a=>a.startsWith('--run='))?.slice(6);
if(!args.includes('--live')||!run||args.some(a=>a!=='--live'&&!/^--run=[a-z0-9-]{1,40}$/.test(a)))throw Error('EXPLICIT_RUN_REQUIRED');
const dir='.local/thai-support-spike/caption-calibration-'+run;await mkdir(dir,{recursive:true,mode:0o700});
try{await readFile(dir+'/result.json');throw Error('RESULT_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
const profile=JSON.parse(await readFile(process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-profile.json','utf8'));validateSeeduplexProfile(profile);
const texts=[['happy','zh','今天我很开心，因为我见到了朋友。'],['happy','th','วันนี้ฉันมีความสุขมาก เพราะได้เจอเพื่อน'],['music','zh','我喜欢听音乐，也喜欢和朋友聊天。'],['music','th','ฉันชอบฟังเพลง และชอบคุยกับเพื่อน']];
const graphemes=new Intl.Segmenter('th',{granularity:'grapheme'}),report={kind:'authored_fixed_speech_duration_calibration',run,real_provider:true,human_listening:false,production_code_changed:false,speed:0,samples:[]};
for(const [topic,locale,text] of texts){
  let bytes=0,done=false,failure;const result={topic,locale,text_sha256:createHash('sha256').update(text).digest('hex'),han:(text.match(/\p{Script=Han}/gu)??[]).length,thai_graphemes:[...graphemes.segment(text)].filter(g=>/\p{Script=Thai}/u.test(g.segment)).length,complete:false};
  const p=new SeeduplexProvider({profile,env:process.env,speechPace:'normal'});
  try{
    p.open({sessionId:randomUUID(),instructions:'只朗读提交的固定文字，不翻译，不添加内容。',onFailure:code=>{failure=code;},onEvent:packet=>{try{const e=packet.event;if(!e)return;if(e.type==='session.ready'){p.mute();p.speakFixedText(text);}if(e.type==='response.audio.chunk'){bytes+=e.payload.byte_length;if(bytes>1440000)failure='AUDIO_LIMIT';}if(e.type==='response.done')done=true;}catch{failure='EVENT_FAILED';}}});
    const until=Date.now()+30000;while(!done){if(failure)throw Error(failure);if(Date.now()>until)throw Error('TIMEOUT');await new Promise(r=>setTimeout(r,30));}
    result.complete=bytes>0;result.audio_pcm_ms=Math.round(bytes/48);
  }catch(e){result.failure=/^[A-Z_]+$/.test(e.message)?e.message:'FAILED';}finally{result.closed_ack=(await p.close())?.acknowledged===true;}
  report.samples.push(result);await writeFile(dir+'/result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));
}
if(report.samples.some(s=>!s.complete))process.exitCode=1;
