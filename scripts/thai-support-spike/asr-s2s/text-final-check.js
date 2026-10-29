import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {nativeProbe,hash} from './clients.js';
import {wavPCM} from '../../prepare-fc-probe-inputs.js';
const sourceArg=process.argv.slice(2).find(a=>a.startsWith('--source='));
if(process.argv.slice(2).some(a=>a!=='--live'&&!/^--source=[0-9TZ]+-stability$/.test(a))||!sourceArg)throw Error('INVALID_DIAGNOSTIC_ARGUMENTS');
if(!process.argv.includes('--live'))console.log(JSON.stringify({live:false,scope:'stream_vs_final_text_only',product_changed:false}));
else{
  const source='.local/thai-support-spike/asr-s2s/'+sourceArg.slice(9);
  const batch=JSON.parse(await readFile(source+'/metadata.json','utf8')),reviews=JSON.parse(await readFile(source+'/authored-review.json','utf8'));
  const row=reviews.find(r=>r.conversation==='b'&&r.id==='thai_math'),sample=batch.samples.find(r=>r.conversation==='b'&&r.id==='thai_math');
  if(!row?.asr_final||hash(row.asr_final)!==sample?.asr?.text_sha256||sample.asr.final!==true)throw Error('UNVERIFIED_ASR_SOURCE');
  const directory='.local/thai-support-spike/asr-s2s/'+new Date().toISOString().replace(/[-:.]/g,'')+'-text-final';await mkdir(directory,{recursive:true,mode:0o700});
  const profile=JSON.parse(await readFile(process.env.ASK_KAI_THAI_REALTIME_PROFILE??'.local/seeduplex-thai-profile.json','utf8'));
  const activation='请回答我刚才用泰语提出的那个问题。',zh='三加五等于几？';
  const audio=text=>readFile(source+'/'+hash('zh'+text).slice(0,16)+'.wav').then(wavPCM);
  const report={kind:'independent_delta_vs_final_text_diagnostic',baseline_changed:false,product_changed:false,browser_audio_tested:false,human_listening_tested:false,samples:[]},review=[];
  for(const c of [{id:'chinese_native',mode:'audio',text:zh,source:'authored_os_tts',pcm:await audio(zh),audioExpectedText:zh},{id:'thai_initial_history',mode:'initial_history_audio_trigger',text:row.asr_final,source:'real_asr_final',pcm:await audio(activation),audioExpectedText:activation}]){
    const r=await nativeProbe({...c,profile,verifyHistory:true,requireHistoryReadback:true});
    report.samples.push({id:c.id,...r.meta});review.push({id:c.id,stream_text:r.output,final_text:r.outputFinal});
  }
  await writeFile(directory+'/metadata.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});await writeFile(directory+'/authored-review.json',JSON.stringify(review,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({metadata:directory+'/metadata.json',samples:report.samples.map(s=>({id:s.id,response_complete:s.response_complete,final_text_present:s.final_text_present,final_matches_stream:s.final_matches_stream,stream_replacement_characters:s.stream_replacement_characters,final_text_replacement_characters:s.final_text_replacement_characters}))}));
}
