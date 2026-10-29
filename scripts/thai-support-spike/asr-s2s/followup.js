import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {wavPCM} from '../../prepare-fc-probe-inputs.js';
import {nativeProbe} from './clients.js';
if(process.argv.slice(2).some(arg=>!['--live','--text-content','--one','--initial-history'].includes(arg)))throw Error('INVALID_SPIKE_ARGUMENTS');
if(!process.argv.includes('--live'))console.log(JSON.stringify({live:false,kind:'authored_history_plus_audio_followup',real_asr_used:false,product_changed:false}));
else{
  const directory='.local/thai-support-spike/asr-s2s/'+new Date().toISOString().replace(/[-:.]/g,'')+'-followup';
  await mkdir(directory,{recursive:true,mode:0o700});
  const activation='请回答我刚才用泰语提出的那个问题。';
  execFileSync('/usr/bin/say',['-v','Tingting','-o',directory+'/activate.aiff',activation]);
  execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',directory+'/activate.aiff',directory+'/activate.wav']);
  const pcm=wavPCM(await readFile(directory+'/activate.wav'));
  const profile=JSON.parse(await readFile(process.env.ASK_KAI_THAI_REALTIME_PROFILE??'.local/seeduplex-thai-profile.json','utf8'));
  const report={kind:'authored_history_plus_audio_followup',product_changed:false,real_asr_used:false,browser_audio_tested:false,human_listening_tested:false,bridge_pass:false,samples:[]},review=[];
  for(const c of [{id:'thai_three_plus_five',text:'สามบวกห้าเท่ากับเท่าไร',answer:/(?:八|8|แปด)/u},{id:'thai_nine_minus_two',text:'เก้าลบสองเท่ากับเท่าไร',answer:/(?:七|7|เจ็ด)/u}].slice(0,process.argv.includes('--one')?1:2)){
    const result=await nativeProbe({profile,pcm,mode:process.argv.includes('--initial-history')?'initial_history_audio_trigger':'history_audio_trigger',text:c.text,source:'authored_context_plus_activation_audio',historyContentType:process.argv.includes('--text-content')?'text':'input_text',verifyHistory:true,audioExpectedText:activation});
    report.samples.push({id:c.id,...result.meta,expected_answer_surface:result.meta.response_complete&&c.answer.test(result.output),semantic_reviewed:false});
    review.push({id:c.id,question:c.text,activation,activation_asr:result.asr,output:result.output,history_readback:result.historyReview});
    await writeFile(directory+'/metadata.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
    await writeFile(directory+'/authored-review.json',JSON.stringify(review,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(report.samples.at(-1)));
  }
  console.log(JSON.stringify({metadata:directory+'/metadata.json',real_asr_used:false,bridge_pass:false}));
}
