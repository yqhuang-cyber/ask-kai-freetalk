// Isolated real-provider diagnostic. Only authored inputs; no learner recordings.
// Audio returned by S2S is independently re-transcribed, never inferred from captions.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {HistoryTurnProvider} from '../../packages/provider-doubao/history-turn.js';
import {inputInstructions,BRIDGE_TRIGGER} from '../../apps/free-talk-thai/src/input-policy.js';
import {recognize,hash} from './asr-s2s/clients.js';
import {scriptCounts,normalized} from './asr-s2s/protocol.js';
import {pcmWave} from '../bilingual-speech-pace/evidence.js';
import {wavPCM} from '../prepare-fc-probe-inputs.js';

if(process.argv.slice(2).some(arg=>!['--live','--replies-only'].includes(arg)))throw Error('INVALID_ARGUMENTS');
const repliesOnly=process.argv.includes('--replies-only');
if(!process.argv.includes('--live')){
  console.log(JSON.stringify({live:false,planned_s2s_calls:repliesOnly?2:4,planned_loopback_asr_calls:repliesOnly?4:4,application_changed:false}));
}else{
  const directory='.local/thai-support-spike/output-language-'+new Date().toISOString().replace(/[-:.]/g,'');
  await mkdir(directory,{recursive:true,mode:0o700});
  const profile=JSON.parse(await readFile(process.env.ASK_KAI_THAI_REALTIME_PROFILE??'.local/seeduplex-thai-profile.json','utf8'));
  const trigger=await readFile('apps/free-talk-thai/assets/trigger.pcm');
  const report={authored_inputs_only:true,real_provider:true,application_changed:false,profiles_changed:false,browser_audio:false,human_listening:false,loopback_asr_is_not_human_review:true,voice:profile.session_create.session.audio.output.voice,model:profile.session_create.session.model,samples:[]};
  const review=[];
  const unsupported=text=>/(?:不支持.{0,8}(?:语种|语言|泰语)|(?:语种|语言|泰语).{0,8}不支持)/u.test(text);
  async function collect(c){
    const history=c.mode==='bridge'?[{role:'user',text:c.input},{role:'assistant',text:'我先记下这个问题。'}]:[];
    const provider=new HistoryTurnProvider({profile,history});
    const chunks=[],meta={id:c.id,mode:c.mode,ready:false,complete:false,provider_failure:null,audio_bytes:0};
    let output='',nativeAsr='',pump,timer,settled=false;
    await new Promise(resolve=>{
      const finish=()=>{if(settled)return;settled=true;clearInterval(pump);clearTimeout(timer);resolve();};
      timer=setTimeout(()=>{meta.provider_failure='DIAGNOSTIC_TIMEOUT';finish();},35000);
      provider.open({sessionId:'output-language-'+c.id,instructions:c.mode==='bridge'?inputInstructions('th'):'这是自制文本的语音合成测试。不要主动开场。',onFailure:code=>{meta.provider_failure=/^[A-Z0-9_]{1,80}$/.test(code)?code:'PROVIDER_FAILURE';finish();},onEvent:packet=>{
        if(settled)return;const e=packet.event;if(!e)return;
        if(e.type==='session.ready'){
          meta.ready=true;provider.mute();
          void provider.verifyHistory().then(()=>{
            if(settled)return;
            if(c.mode==='bridge'){
              provider.unmute();let position=0;
              pump=setInterval(()=>{try{const frame=Buffer.alloc(640);trigger.copy(frame,0,position,Math.min(position+640,trigger.length));position=Math.min(position+640,trigger.length);provider.sendAudio(frame);}catch{meta.provider_failure='TRIGGER_SEND_FAILED';finish();}},20);
            }else provider.speakFixedText(c.text);
          }).catch(()=>{meta.provider_failure='HISTORY_OR_SUBMISSION_FAILED';finish();});
        }
        if(e.type==='user.final')nativeAsr=e.payload.text;
        if(e.type==='response.text.delta')output+=e.payload.text;
        if(e.type==='response.audio.chunk'){
          const pcm=Buffer.from(packet.audio,'base64');chunks.push(pcm);meta.audio_bytes+=pcm.length;
          if(meta.audio_bytes>1440000){meta.provider_failure='DIAGNOSTIC_AUDIO_LIMIT';finish();}
        }
        if(e.type==='response.done'){meta.complete=true;finish();}
      }});
    });
    await provider.close();
    const audio=Buffer.concat(chunks);Object.assign(meta,{audio_ms:audio.length/48,output_text_sha256:hash(output),output_scripts:scriptCounts(output),output_text_unsupported_notice:unsupported(output),trigger_matches:c.mode==='bridge'?normalized(nativeAsr)===normalized(BRIDGE_TRIGGER):null});
    let heard='',thaiHeard='';
    if(audio.length){
      await writeFile(directory+'/'+c.id+'-output.wav',pcmWave(audio),{mode:0o600});
      execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',directory+'/'+c.id+'-output.wav',directory+'/'+c.id+'-loopback.wav']);
      const pcm=wavPCM(await readFile(directory+'/'+c.id+'-loopback.wav'));
      if(pcm.length<=480000){
        const result=await recognize({pcm,auto:true});heard=result.text;meta.loopback_asr={final:result.meta.final,ended:result.meta.ended,provider_error:result.meta.error_code};
        if(repliesOnly){const th=await recognize({pcm,language:'th-TH'});thaiHeard=th.text;meta.fixed_th_loopback={final:th.meta.final,ended:th.meta.ended,scripts:scriptCounts(th.text),unsupported_notice:unsupported(th.text)};}
      }
      else meta.loopback_asr={final:false,ended:'audio_exceeds_diagnostic_asr_limit'};
    }
    Object.assign(meta,{audio_asr_scripts:scriptCounts(heard),audio_asr_unsupported_notice:unsupported(heard),audio_asr_matches_fixed_text:c.mode==='fixed'&&heard?normalized(heard)===normalized(c.text):null});
    review.push({id:c.id,input:c.input??c.text,provider_output_text:output,native_trigger_transcript:nativeAsr,audio_loopback_transcript:heard,fixed_th_loopback_transcript:thaiHeard});
    return meta;
  }
  const cases=repliesOnly?[
    {id:'reply_math',mode:'bridge',input:'สามบวกห้าเท่ากับเท่าไร'},
    {id:'reply_word',mode:'bridge',input:'แมว ภาษาจีนพูดว่าอะไร'}
  ]:[
    {id:'fixed_zh',mode:'fixed',text:'你好，很高兴见到你。'},
    {id:'fixed_th',mode:'fixed',text:'สวัสดี ยินดีที่ได้รู้จัก'},
    {id:'fixed_zh_th',mode:'fixed',text:'你好，很高兴见到你。 สวัสดี ยินดีที่ได้รู้จัก'},
    {id:'history_trigger',mode:'bridge',input:'ช่วยทักทายฉันสั้นๆ เป็นภาษาจีนแล้วตามด้วยภาษาไทย'}
  ];
  for(const c of cases){
    const sample=await collect(c);report.samples.push(sample);
    await writeFile(directory+'/metadata.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
    await writeFile(directory+'/authored-review.json',JSON.stringify(review,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(sample));
  }
  console.log(JSON.stringify({directory,...report}));
}
