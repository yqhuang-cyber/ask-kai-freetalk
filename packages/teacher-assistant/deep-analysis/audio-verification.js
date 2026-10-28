import {createHash} from 'node:crypto';
export const AUDIO_CHECK_VERSION='audio-auto-check-v1';
export const hashAudioValue=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function pcmQuality(pcm){
  const powers=[];let peak=0,clipped=0,sum=0;
  for(let start=0;start<pcm.length;start+=640){let power=0,count=0;for(let i=start;i<Math.min(start+640,pcm.length);i+=2){const sample=pcm.readInt16LE(i);peak=Math.max(peak,Math.abs(sample));if(Math.abs(sample)>=32700)clipped++;power+=sample*sample;sum+=sample*sample;count++;}powers.push(Math.sqrt(power/Math.max(1,count)));}
  const sorted=[...powers].sort((a,b)=>a-b),quiet=sorted.filter(p=>p<600),noise=quiet.length>=3?quiet[Math.floor(quiet.length/2)]:sorted[Math.floor(sorted.length*.1)]??0,speech=sorted[Math.floor(sorted.length*.8)]??0;
  return {method:'pcm-frame-energy-v2',duration_ms:pcm.length/32,rms:Math.round(Math.sqrt(sum/Math.max(1,pcm.length/2))),peak,clipped_samples:clipped,speech_frames:powers.filter(p=>p>=600).length,noise_floor_rms:Math.round(noise),estimated_snr_db:Math.round(Math.min(80,20*Math.log10((speech+1)/(noise+1))))};
}
export function precheckAudioUnit(unit,pcm){
  const metrics=pcmQuality(pcm),capture=unit.capture;let reason=null;
  if(!capture||capture.protocol!=='homework-mic-v1'||!capture.playback_known)reason='capture_unverified';
  else if(!capture.continuous)reason='capture_gap';
  else if(capture.playback_overlap)reason='playback_overlap';
  else if(!capture.aec)reason='echo_control_unavailable';
  else if(unit.boundary_reason==='capacity'||unit.starts_after_capacity===true)reason='incomplete_utterance';
  else if(metrics.clipped_samples)reason='clipping';
  else if(metrics.duration_ms<500||metrics.speech_frames<10||metrics.rms<200)reason='insufficient_speech';
  else if(metrics.estimated_snr_db<12)reason='noise_or_uncertain_quality';
  return {version:AUDIO_CHECK_VERSION,state:reason?'excluded':'ready',reason,metrics,source_basis:'authorized_mic_channel',identity_verified:false,quality_guaranteed:false};
}
const normalized=text=>text.normalize('NFKC').replace(/[^\p{Script=Han}a-z0-9]/giu,'').toLowerCase();
export function audioAsrDecision(unit,asr,{learnerTexts=[]}={}){
  const duration=(unit.sample_end-unit.sample_start)/16;
  if(asr?.schema_version!=='audio-asr-v1'||asr.provider!=='tencent_asr'||!Array.isArray(asr.sentences)||asr.sentences.length>1000)throw new Error('INVALID_AUDIO_ASR');
  const speakers=new Set(),sentences=asr.sentences;
  for(const sentence of sentences){
    if(typeof sentence.text!=='string'||sentence.text.length>2000||!Number.isInteger(sentence.speaker_id)||sentence.speaker_id<0||sentence.speaker_id>20||!Number.isInteger(sentence.start_ms)||!Number.isInteger(sentence.end_ms)||sentence.start_ms<0||sentence.end_ms<=sentence.start_ms||sentence.end_ms>duration+100||!Array.isArray(sentence.words)||sentence.words.length>1000)throw new Error('INVALID_AUDIO_ASR');
    speakers.add(sentence.speaker_id);
    for(const word of sentence.words)if(typeof word.text!=='string'||word.text.length>100||!Number.isInteger(word.start_ms)||!Number.isInteger(word.end_ms)||word.start_ms<sentence.start_ms||word.end_ms<=word.start_ms||word.end_ms>sentence.end_ms+100)throw new Error('INVALID_AUDIO_ASR');
  }
  if(!sentences.length)return {state:'excluded',reason:'no_recognized_speech',reference:null};
  if(speakers.size!==1)return {state:'excluded',reason:'multiple_speakers',reference:null};
  if(sentences.some((s,i)=>i&&s.start_ms<sentences[i-1].end_ms))return {state:'excluded',reason:'overlapping_speakers',reference:null};
  const text=sentences.map(s=>s.text).join(''),chinese=[...text].filter(c=>/\p{Script=Han}/u.test(c)).length;
  if(chinese<2||chinese/Math.max(1,[...normalized(text)].length)<.7)return {state:'excluded',reason:'language_not_supported',reference:null};
  // SOE accepts one sentence per assessment. Select a traceable sentence rather
  // than concatenate provider results with ambiguous sentence-relative timings.
  const selected=sentences.filter(sentence=>{const count=[...sentence.text].filter(c=>/\p{Script=Han}/u.test(c)).length;return count>=2&&count/Math.max(1,[...normalized(sentence.text)].length)>=.7;}).sort((a,b)=>(b.end_ms-b.start_ms)-(a.end_ms-a.start_ms))[0];
  if(!selected)return {state:'excluded',reason:'language_not_supported',reference:null};
  const referenceText=selected.text.replace(/[，。！？、；：,.!?;:\s]/gu,''),clean=normalized(selected.text);
  const candidate=[...referenceText].length<=30&&[...referenceText].length>0&&selected.words.length>0&&learnerTexts.some(t=>normalized(t).includes(clean));
  const assessment_window=sentences.length>1?{start_sample:Math.max(0,(selected.start_ms-100)*16),end_sample:Math.min(unit.sample_end-unit.sample_start,(selected.end_ms+100)*16)}:null;
  return {state:'eligible',reason:null,assessment_window,recognized_sentences:sentences.length,reference:candidate?{text:referenceText,basis:'auto_aligned',verified:false,review_required:true,asr_hash:hashAudioValue(asr),comparison:'independent_asr_agreement'}:null,identity_verified:false,limitations:['声源依据是获准麦克风通道与自动检查，不是声纹身份认证。','质量指标为有界检测，不能证明没有任何噪声。',...(sentences.length>1?['本语音段包含多句，仅选取其中一句评测，其他句子未评。']:[])]};
}
