import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {recognize,nativeProbe,hash} from './clients.js';
import {wavPCM} from '../../prepare-fc-probe-inputs.js';
import {normalized} from './protocol.js';

const activation='请回答我刚才用泰语提出的那个问题。';
const conversations=[
  {id:'a',name:'小明',intro:'我叫小明，我喜欢猫。',word:'แมว ภาษาจีนพูดว่าอะไร',wordAnswer:'猫',mathZh:'三加五等于几？',mathZhAnswer:'8|八',mathTh:'เก้าลบสองเท่ากับเท่าไร',mathThAnswer:'7|七',end:'วันนี้พอแค่นี้ ขอบคุณ ลาก่อน',intent:'goodbye'},
  {id:'b',name:'小红',intro:'我叫小红，我喜欢狗。',word:'น้ำ ภาษาจีนพูดว่าอะไร',wordAnswer:'水',mathZh:'四加五等于几？',mathZhAnswer:'9|九',mathTh:'แปดลบสามเท่ากับเท่าไร',mathThAnswer:'5|五',end:'วันนี้พอแค่นี้ ขอบคุณ ลาก่อน',intent:'goodbye'},
  {id:'c',name:'张三',intro:'我叫张三，我喜欢音乐。',word:'ขอบคุณ ภาษาจีนพูดว่าอะไร',wordAnswer:'谢谢',mathZh:'六加一等于几？',mathZhAnswer:'7|七',mathTh:'สิบลบหกเท่ากับเท่าไร',mathThAnswer:'4|四',end:'ฉันยังไม่อยากจบ ขอคุยต่อ',intent:'continue'}
];
const plans=conversations.map(c=>({...c,turns:[
  {id:'intro',locale:'zh',input:c.intro,kind:'acknowledge'},
  {id:'name_recall',locale:'th',input:'ฉันชื่ออะไร',kind:'memory',keyword:c.name},
  {id:'translation',locale:'th',input:c.word,kind:'translation',keyword:c.wordAnswer},
  {id:'chinese_math',locale:'zh',input:c.mathZh,kind:'math',keyword:c.mathZhAnswer},
  {id:'thai_math',locale:'th',input:c.mathTh,kind:'math',keyword:c.mathThAnswer},
  {id:'intent',locale:'th',input:c.end,kind:c.intent}
]}));
if(process.argv.slice(2).some(a=>a!=='--live'))throw Error('INVALID_SPIKE_ARGUMENTS');
if(!process.argv.includes('--live'))console.log(JSON.stringify({live:false,conversations:3,planned_turns:18,thai_asr_requests:12,chinese_native_turns:6,mechanism:'fresh_s2s_per_turn_with_actual_prior_QA',activation,product_changed:false}));
else{
  const directory='.local/thai-support-spike/asr-s2s/'+new Date().toISOString().replace(/[-:.]/g,'')+'-stability';await mkdir(directory,{recursive:true,mode:0o700});
  const profile=JSON.parse(await readFile(process.env.ASK_KAI_THAI_REALTIME_PROFILE??'.local/seeduplex-thai-profile.json','utf8'));
  const cache=new Map();
  async function audio(text,locale){
    const key=hash(locale+text);if(cache.has(key))return cache.get(key);
    const path=directory+'/'+key.slice(0,16);
    execFileSync('/usr/bin/say',['-v',locale==='th'?'Kanya':'Tingting','-o',path+'.aiff',text]);
    execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path+'.aiff',path+'.wav']);
    const pcm=wavPCM(await readFile(path+'.wav'));cache.set(key,pcm);return pcm;
  }
  const activationPcm=await audio(activation,'zh');
  // Freeze authored audio before any external calls or measured bridge latency.
  for(const c of plans)for(const t of c.turns)await audio(t.input,t.locale);
  const report={kind:'asr_s2s_workaround_stability',script_sha256:hash(await readFile(new URL('./stability.js',import.meta.url))),native_probe_sha256:hash(await readFile(new URL('./clients.js',import.meta.url))),model:profile.session_create.session.model,voice:profile.session_create.session.audio.output.voice,profile_sha256:hash(JSON.stringify(profile)),planned_conversations:3,planned_turns:18,authored_os_tts_only:true,product_changed:false,browser_audio_tested:false,human_listening_tested:false,raw_trace_saved:false,provider_native_text_query_verified:false,product_interruption_tested:false,product_end_lifecycle_tested:false,samples:[]},reviews=[];
  const save=async()=>{
    await writeFile(directory+'/metadata.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
    await writeFile(directory+'/authored-review.json',JSON.stringify(reviews,null,2)+'\n',{mode:0o600});
  };
  for(const c of plans){
    const history=[];
    for(const t of c.turns){
      const sample={conversation:c.id,id:t.id,locale:t.locale,kind:t.kind,prior_qa_pairs:history.length/2,semantic_reviewed:false};
      report.samples.push(sample);
      let text=t.input,asrResult,source='authored_os_tts';
      if(t.locale==='th'){
        asrResult=await recognize({pcm:await audio(t.input,t.locale),auto:true});sample.asr=asrResult.meta;
        if(!asrResult.meta.final||!asrResult.text){sample.ended='asr_failed';report.unattempted_after_failure??=[];report.unattempted_after_failure.push({conversation:c.id,after:t.id});await save();console.log(JSON.stringify(sample));break;}
        text=asrResult.text;source='real_asr_final';
      }
      const afterAsr=performance.now();
      const result=await nativeProbe({profile,mode:t.locale==='th'?'initial_history_audio_trigger':'audio',text,pcm:t.locale==='th'?activationPcm:await audio(t.input,t.locale),source,history,verifyHistory:true,requireHistoryReadback:true,audioExpectedText:t.locale==='th'?activation:t.input});
      sample.s2s=result.meta;
      sample.ended=result.meta.ended;
      sample.asr_final_used_unchanged=t.locale==='th'?result.meta.input_text_sha256===asrResult.meta.text_sha256:null;
      sample.full_output_complete=result.meta.ready&&result.meta.response_complete&&result.meta.audio_non_silent&&result.meta.session_closed_ack;
      sample.output_replacement_characters=(result.output.match(/\ufffd/gu)??[]).length;
      sample.keyword_present=t.keyword?new RegExp(t.keyword,'u').test(result.output):null;
      sample.chinese_first=/\p{Script=Han}/u.test(result.output.match(/[\p{Script=Han}\p{Script=Thai}A-Za-z]/u)?.[0]??'');
      sample.bilingual_surface=result.meta.han>0&&result.meta.thai>0&&result.meta.latin_words===0;
      sample.question_marks=(result.output.match(/[?？]/gu)??[]).length;
      sample.output_text_sha256=hash(result.output);
      sample.s2s_open_to_first_audio_ms=result.meta.first_audio_after_open_ms??null;
      sample.s2s_call_total_ms=Math.round(performance.now()-afterAsr);
      reviews.push({conversation:c.id,id:t.id,kind:t.kind,authored_input:t.input,asr_final:t.locale==='th'?text:result.asr,output:result.output,expected_keyword:t.keyword??null,expected_intent:t.kind,prior_qa_pairs:history.length/2});
      if(sample.full_output_complete){
        // Native Chinese audio uses its actual ASR final; Thai uses the exact
        // independent final. Never fabricate a successful user transcript.
        const accepted=t.locale==='th'?text:result.asr;
        if(!accepted){sample.ended='missing_native_asr';await save();console.log(JSON.stringify(sample));break;}
        history.push({role:'user',text:accepted},{role:'assistant',text:result.output});
      }else{report.unattempted_after_failure??=[];report.unattempted_after_failure.push({conversation:c.id,after:t.id});await save();console.log(JSON.stringify(sample));break;}
      await save();console.log(JSON.stringify(sample));
    }
  }
  await save();console.log(JSON.stringify({metadata:directory+'/metadata.json',attempted_turns:report.samples.length,planned_turns:18,product_changed:false}));
}
