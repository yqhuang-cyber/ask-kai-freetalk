import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {wavPCM} from '../../prepare-fc-probe-inputs.js';
import {recognize,nativeProbe,hash} from './clients.js';
import {normalized,bridgeGate} from './protocol.js';
import {asrPreflight} from './config.js';

const args=process.argv.slice(2),stage=args.find(a=>a.startsWith('--stage='))?.slice(8)??'all';
if(args.some(a=>!['--live','--preflight'].includes(a)&&!/^--stage=(all|asr|s2s)$/.test(a))||args.filter(a=>a.startsWith('--stage=')).length>1||args.includes('--preflight')&&args.length!==1)throw Error('INVALID_SPIKE_ARGUMENTS');
const authored={zh:'三加五等于几？',th:'สามบวกห้าเท่ากับเท่าไร'};
if(args.includes('--preflight')){
  const result=asrPreflight(process.env);console.log(JSON.stringify(result));if(!result.configured)process.exitCode=1;
}else if(!args.includes('--live')){
  console.log(JSON.stringify({live:false,stage,source:'authored_os_tts_only',asr_endpoint:'bigmodel_nostream',s2s_model:'1.2.6.1',product_changed:false,plan:'scripts/thai-support-spike/asr-s2s/README.md'}));
}else{
  const runId=new Date().toISOString().replace(/[-:.]/g,'');
  const directory='.local/thai-support-spike/asr-s2s/'+runId;await mkdir(directory,{recursive:true,mode:0o700});
  const report={version:1,kind:'front_asr_current_s2s_capability',run_id:runId,stage,authored_audio_only:true,real_learner_data:false,product_changed:false,shared_profiles_changed:false,browser_audio_tested:false,human_listening_tested:false,raw_trace_saved:false,bridge_pass:false,asr:[],native:[]};
  const save=async()=>writeFile(directory+'/metadata.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
  const pcm={};
  for(const [language,text] of Object.entries(authored)){
    const path=directory+'/'+language;
    execFileSync('/usr/bin/say',['-v',language==='th'?'Kanya':'Tingting','-o',path+'.aiff',text]);
    execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path+'.aiff',path+'.wav']);
    pcm[language]=wavPCM(await readFile(path+'.wav'));
  }
  pcm.mixed=Buffer.concat([pcm.zh,Buffer.alloc(6400),pcm.th]);
  const reviews={asr:[],native:[]},recognized={};
  if(stage!=='s2s'){
    const cases=[{id:'th_fixed',input:'th',language:'th-TH'},{id:'th_auto',input:'th',auto:true},{id:'zh_auto',input:'zh',auto:true},{id:'mixed_auto',input:'mixed',auto:true}];
    for(const c of cases){
      const result=await recognize({...c,pcm:pcm[c.input]});
      const expected=c.input==='mixed'?authored.zh+authored.th:authored[c.input];
      report.asr.push({id:c.id,...result.meta,strict_text_match:result.meta.final&&normalized(result.text)===normalized(expected)});
      if(result.meta.final&&result.text)recognized[c.id]=result.text;
      reviews.asr.push({id:c.id,expected,recognized:result.text});
      await save();console.log(JSON.stringify({stage:'asr',sample:report.asr.at(-1)}));
      // Four identical authorization failures add no recognition evidence.
      if(!result.meta.upgrade&&result.meta.http_status===403){report.asr_not_attempted=cases.slice(1).map(item=>item.id);break;}
    }
    if(process.env.DOUBAO_ASR_RESOURCE_ID===undefined&&report.asr.every(item=>!item.upgrade)){
      const result=await recognize({pcm:pcm.th,language:'th-TH',resource:'volc.bigasr.sauc.duration'});
      report.asr.push({id:'th_fixed_asr1_access_control',...result.meta,strict_text_match:result.meta.final&&normalized(result.text)===normalized(authored.th)});
      reviews.asr.push({id:'th_fixed_asr1_access_control',expected:authored.th,recognized:result.text});
      if(result.meta.final&&result.text)recognized.th_fixed=result.text;
      await save();console.log(JSON.stringify({stage:'asr',sample:report.asr.at(-1)}));
    }
  }
  if(stage!=='asr'){
    const profile=JSON.parse(await readFile(process.env.ASK_KAI_THAI_REALTIME_PROFILE??process.env.DOUBAO_REALTIME_PROFILE??'.local/seeduplex-thai-profile.json','utf8'));
    report.model=profile.session_create.session.model;report.voice=profile.session_create.session.audio.output.voice;report.profile_sha256=hash(JSON.stringify(profile));
    const cases=[
      {id:'audio_zh_positive',mode:'audio',text:authored.zh,pcm:pcm.zh,source:'authored_os_tts'},
      {id:'history_zh_single',mode:'history_user',text:recognized.zh_auto??authored.zh,source:recognized.zh_auto?'real_asr_final':'authored_text'},
      {id:'history_th_single',mode:'history_user',text:recognized.th_auto??recognized.th_fixed??authored.th,source:recognized.th_auto||recognized.th_fixed?'real_asr_final':'authored_text'},
      {id:'history_zh_complete_qa',mode:'history_pair',text:authored.zh,source:'authored_complete_qa_fixture'},
      {id:'recitation_zh_negative',mode:'recitation',text:authored.zh,source:'authored_text'},
      {id:'history_th_single_repeat',mode:'history_user',text:recognized.th_auto??recognized.th_fixed??authored.th,source:recognized.th_auto||recognized.th_fixed?'real_asr_final':'authored_text'}
    ];
    for(const c of cases){
      const result=await nativeProbe({...c,profile});
      // A semantic review is deliberately required; a digit or history ACK alone is not a pass.
      const pass=bridgeGate({source:c.source,asrFinal:c.source==='real_asr_final',asrText:c.text,sentText:c.text,responseComplete:result.meta.response_complete,audioBytes:result.meta.audio_bytes,audioNonSilent:result.meta.audio_non_silent,echo:result.meta.echo,semanticReviewed:false});
      report.native.push({id:c.id,...result.meta,bridge_pass:pass,semantic_reviewed:false,product_turn_ownership_tested:false});
      reviews.native.push({id:c.id,input:c.text,output:result.output,native_asr:result.asr});
      await writeFile(directory+'/authored-review.json',JSON.stringify(reviews,null,2)+'\n',{mode:0o600});
      await save();console.log(JSON.stringify({stage:'s2s',sample:report.native.at(-1)}));
    }
    const asrText=recognized.th_auto??recognized.th_fixed;
    if(asrText){
      // Use the actual ASR final, byte-for-byte as a JS string. Never replace it
      // with the expected authored transcript to manufacture a bridge success.
      const activation='请回答我刚才用泰语提出的那个问题。',path=directory+'/activation';
      execFileSync('/usr/bin/say',['-v','Tingting','-o',path+'.aiff',activation]);
      execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path+'.aiff',path+'.wav']);
      const result=await nativeProbe({profile,mode:'initial_history_audio_trigger',text:asrText,pcm:wavPCM(await readFile(path+'.wav')),source:'real_asr_final',verifyHistory:true,audioExpectedText:activation});
      report.native.push({id:'real_asr_initial_history_bridge',...result.meta,asr_final_used_unchanged:true,bridge_pass:false,semantic_reviewed:false,product_turn_ownership_tested:false});
      reviews.native.push({id:'real_asr_initial_history_bridge',input:asrText,output:result.output,native_activation_asr:result.asr,history_readback:result.historyReview});
      report.bridge_manual_review_required=true;
      await save();console.log(JSON.stringify({stage:'bridge',sample:report.native.at(-1)}));
    }else report.bridge_not_attempted='no_real_asr_final';
  }
  await writeFile(directory+'/authored-review.json',JSON.stringify(reviews,null,2)+'\n',{mode:0o600});
  await save();console.log(JSON.stringify({metadata:directory+'/metadata.json',bridge_pass:report.bridge_pass,product_changed:false}));
}
