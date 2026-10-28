import {createHmac,randomInt,randomUUID,createHash} from 'node:crypto';
import WebSocket from 'ws';
import {requireThat} from '../teacher-assistant/contracts.js';
import {isDeepStrictEqual} from 'node:util';
export const TENCENT_API_PROFILE='soe-wss-2026-01-16';
export function audioEligibility(segment){
  if(segment?.speaker!=='learner_verified')return {eligible:false,reason:'speaker_unverified'};
  if(!segment.quality||!['noise','clipping','missing_frames','overlap'].every(k=>segment.quality[k]==='not_detected'))return {eligible:false,reason:'quality_unverified'};
  return {eligible:true,reason:null};
}
export function verifiedAudioReference(segment){
  const alignment=segment?.alignment,reference=alignment?.reference,basis=alignment?.basis;
  if(!['author_verified','teacher_reviewed'].includes(basis)||alignment.reference_text_verified!==true||reference?.verified!==true||reference.basis!==basis||typeof reference.text!=='string'||[...reference.text].length<1||[...reference.text].length>30)return null;
  if(basis==='teacher_reviewed'&&(!segment.source_review_hash||reference.review_hash!==segment.source_review_hash))return null;
  return reference;
}
const audioSource=segment=>({id:segment.id,sha256:segment.sha256,stream_id:segment.stream_id,sample_start:segment.sample_start,sample_end:segment.sample_end,...(segment.source_review_hash?{source_review_hash:segment.source_review_hash}:{})});
export function signedAssessmentURL({appId,secretId,secretKey,voiceId,mode=3,reference='',recording=true,timestamp=Math.floor(Date.now()/1000),nonce=randomInt(1,2147483647)}){
  requireThat(/^\d{1,20}$/.test(appId)&&typeof secretId==='string'&&secretId.length>0&&typeof secretKey==='string'&&secretKey.length>0,'TENCENT_CONFIG_REQUIRED');
  const params={secretid:secretId,timestamp,expired:timestamp+300,nonce,server_engine_type:'16k_zh',voice_id:voiceId,voice_format:0,text_mode:0,ref_text:reference,eval_mode:mode,score_coeff:1,sentence_info_enabled:0,rec_mode:recording?1:0};
  const pairs=Object.keys(params).sort().map(k=>[k,String(params[k])]),path=`soe.cloud.tencent.com/soe/api/${appId}`;
  const signature=createHmac('sha1',secretKey).update(path+'?'+pairs.map(([k,v])=>`${k}=${v}`).join('&')).digest('base64');
  return 'wss://'+path+'?'+new URLSearchParams([...pairs,['signature',signature]]).toString();
}
const score=(v,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:null;
const text=v=>typeof v==='string'&&v.length<=128?v:'';
function range(raw,segment){const start=raw.MemBeginTime,end=raw.MemEndTime;if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)return null;const a=segment.sample_start+Math.round(start*16),b=segment.sample_start+Math.round(end*16);return b<=segment.sample_end?{start:a,end:b}:null;}
export function normalizeAssessment(raw,{segment,mode=3,reference=null}){
  requireThat(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Array.isArray(raw.Words)&&raw.Words.length<=2000,'TENCENT_INVALID_RESULT');
  const words=raw.Words.map(w=>{
    requireThat(w&&typeof w==='object','TENCENT_INVALID_RESULT');let tone=null;
    if(mode===1&&w.Tone?.Valid===true){const ref=w.Tone.RefTone,hyp=w.Tone.HypothesisTone;requireThat([ref,hyp].every(v=>Number.isInteger(v)&&v>=0&&v<=5),'TENCENT_INVALID_TONE');tone={reference:ref,hypothesis:hyp};}
    requireThat(w.PhoneInfos===undefined||Array.isArray(w.PhoneInfos)&&w.PhoneInfos.length<=30,'TENCENT_INVALID_RESULT');
    return {word:text(w.Word),range:range(w,segment),accuracy:score(w.PronAccuracy,100),fluency:score(w.PronFluency,1),tone,phones:mode===1?(w.PhoneInfos??[]).map(p=>({phone:text(p.Phone),range:range(p,segment),accuracy:score(p.PronAccuracy,100)})):[]};
  });
  requireThat(words.some(w=>w.word&&w.accuracy!==null)||score(raw.PronAccuracy,100)!==null||score(raw.PronFluency,1)!==null,'TENCENT_EMPTY_RESULT');
  return {schema_version:'audio-assessment-v1',provider:'tencent_soe_v2',api_profile:TENCENT_API_PROFILE,status:'review_required',mode,audio:audioSource(segment),reference:mode===1?reference:null,accuracy:score(raw.PronAccuracy,100),fluency:score(raw.PronFluency,1),words};
}
export function validateAudioAssessment(result,segment){
  requireThat(audioEligibility(segment).eligible,'AUDIO_NOT_ELIGIBLE');
  requireThat(result&&Object.keys(result).every(k=>['schema_version','provider','api_profile','status','mode','audio','reference','accuracy','fluency','words'].includes(k))&&result.schema_version==='audio-assessment-v1'&&result.provider==='tencent_soe_v2'&&result.api_profile===TENCENT_API_PROFILE&&result.status==='review_required'&&[1,3].includes(result.mode),'INVALID_AUDIO_ASSESSMENT');
  requireThat(isDeepStrictEqual(result.audio,audioSource(segment)),'AUDIO_ASSESSMENT_SOURCE_CHANGED');
  if(result.mode===1)requireThat(!!verifiedAudioReference(segment)&&isDeepStrictEqual(result.reference,verifiedAudioReference(segment)),'AUDIO_REFERENCE_UNVERIFIED');else requireThat(result.reference===null,'AUDIO_REFERENCE_UNVERIFIED');
  const validRange=r=>r===null||r&&Object.keys(r).length===2&&Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end)&&r.start>=segment.sample_start&&r.end>r.start&&r.end<=segment.sample_end;
  requireThat((result.accuracy===null||score(result.accuracy,100)!==null)&&(result.fluency===null||score(result.fluency,1)!==null)&&Array.isArray(result.words)&&result.words.length<=2000,'INVALID_AUDIO_ASSESSMENT');
  for(const w of result.words){requireThat(w&&Object.keys(w).length===6&&Object.keys(w).every(k=>['word','range','accuracy','fluency','tone','phones'].includes(k))&&typeof w.word==='string'&&w.word.length<=128&&validRange(w.range)&&(w.accuracy===null||score(w.accuracy,100)!==null)&&(w.fluency===null||score(w.fluency,1)!==null)&&Array.isArray(w.phones)&&w.phones.length<=30,'INVALID_AUDIO_WORD');
    requireThat(w.tone===null||result.mode===1&&Object.keys(w.tone).length===2&&['reference','hypothesis'].every(k=>Number.isInteger(w.tone[k])&&w.tone[k]>=0&&w.tone[k]<=5),'INVALID_AUDIO_TONE');
    requireThat(result.mode===1||!w.phones.length,'INVALID_AUDIO_PHONES');for(const p of w.phones)requireThat(Object.keys(p).length===3&&typeof p.phone==='string'&&p.phone.length<=128&&validRange(p.range)&&(p.accuracy===null||score(p.accuracy,100)!==null),'INVALID_AUDIO_PHONES');}
  return result;
}
const providerError=code=>({4002:'TENCENT_AUTH_FAILED',4003:'TENCENT_SERVICE_DISABLED',4004:'TENCENT_QUOTA',4005:'TENCENT_QUOTA',4006:'TENCENT_RATE_LIMIT',4007:'TENCENT_AUDIO_FORMAT',4014:'TENCENT_AUDIO_TOO_LONG',4105:'TENCENT_NO_SPEECH',4108:'TENCENT_NO_SPEECH',4109:'TENCENT_UNSUPPORTED_MODE'}[code]??'TENCENT_PROVIDER_ERROR');
export class TencentAudioAssessmentPort{
  constructor({appId,secretId,secretKey,socketFactory=url=>new WebSocket(url,{maxPayload:262144,followRedirects:false}),timeoutMs,recording=true}={}){Object.assign(this,{appId,secretId,secretKey,socketFactory,timeoutMs,recording});}
  async assess({segment,pcm_base64,mode=3,reference=null},{signal,beforeSend=async()=>{}}={}){
    requireThat(audioEligibility(segment).eligible,'AUDIO_NOT_ELIGIBLE');requireThat(segment.encoding==='pcm_s16le'&&segment.sample_rate===16000&&segment.channels===1,'TENCENT_AUDIO_FORMAT');
    const pcm=Buffer.from(pcm_base64??'','base64');requireThat(pcm.length>0&&pcm.length%2===0&&Number.isSafeInteger(segment.sample_start)&&segment.sample_start>=0&&Number.isSafeInteger(segment.sample_end)&&pcm.length/2===segment.sample_end-segment.sample_start&&createHash('sha256').update(pcm).digest('hex')===segment.sha256,'AUDIO_ASSESSMENT_SOURCE_CHANGED');
    requireThat(pcm.length<=16000*2*60,'TENCENT_AUDIO_TOO_LONG');requireThat([1,3].includes(mode),'TENCENT_UNSUPPORTED_MODE');
    if(mode===1)requireThat(!!verifiedAudioReference(segment)&&isDeepStrictEqual(reference,verifiedAudioReference(segment)),'AUDIO_REFERENCE_UNVERIFIED');
    const timeout=AbortSignal.timeout(this.timeoutMs??(this.recording?30000:Math.ceil(pcm.length/32)+15000)),combined=signal?AbortSignal.any([signal,timeout]):timeout;combined.throwIfAborted();await beforeSend();combined.throwIfAborted();
    const voiceId=randomUUID(),url=signedAssessmentURL({...this,voiceId,mode,reference:mode===1?reference.text:'',recording:this.recording});
    return new Promise((resolve,reject)=>{
      let ws,settled=false,handshake=false,paceTimer,lastResult,lastSentence;const clean=()=>{clearTimeout(paceTimer);combined.removeEventListener('abort',abort);try{ws?.terminate();}catch{}};
      const finish=(error,value)=>{if(settled)return;settled=true;clean();error?reject(new Error(error)):resolve(value);},abort=()=>finish(signal?.aborted?'TENCENT_CANCELLED':'TENCENT_TIMEOUT');
      combined.addEventListener('abort',abort,{once:true});if(combined.aborted){abort();return;}
      try{ws=this.socketFactory(url);}catch{finish('TENCENT_UNAVAILABLE');return;}
      ws.on('error',()=>finish('TENCENT_UNAVAILABLE'));ws.on('close',()=>finish('TENCENT_CONNECTION_LOST'));
      const send=(value,callback)=>{try{ws.send(value,error=>{if(error)finish('TENCENT_UNAVAILABLE');else callback?.();});}catch{finish('TENCENT_UNAVAILABLE');}};
      ws.on('message',async bytes=>{if(settled)return;try{
        requireThat(Buffer.byteLength(bytes)<=262144,'TENCENT_INVALID_RESULT');const packet=JSON.parse(bytes.toString());requireThat(Number.isInteger(packet.code)&&packet.voice_id===voiceId,'TENCENT_WRONG_RESPONSE');if(packet.code!==0){finish(providerError(packet.code));return;}
        if(!handshake){requireThat(!packet.result&&!packet.final,'TENCENT_WRONG_RESPONSE');handshake=true;await beforeSend();combined.throwIfAborted();if(settled)return;
          if(this.recording)send(pcm,()=>send(JSON.stringify({type:'end'})));
          else{let offset=0;const next=()=>{if(settled)return;if(offset===pcm.length){send(JSON.stringify({type:'end'}));return;}const chunk=pcm.subarray(offset,offset+1280);offset+=chunk.length;send(chunk,()=>{paceTimer=setTimeout(next,40);});};next();}return;}
        if(packet.result!==undefined&&packet.result!==null){let raw=packet.result;if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{throw new Error('TENCENT_INVALID_RESULT');}}
          if(lastSentence!==undefined&&raw?.SentenceId!==undefined&&lastSentence!==raw.SentenceId)throw new Error('TENCENT_MULTIPLE_SENTENCES_UNSUPPORTED');
          lastSentence=raw?.SentenceId;lastResult=normalizeAssessment(raw,{segment,mode,reference});}
        if(packet.final===1){requireThat(lastResult,'TENCENT_INVALID_RESULT');finish(null,lastResult);}
      }catch(e){finish(/^(?:TENCENT_|RECORD_|ANALYSIS_|STAGE_|AUDIO_)[A-Z_]+$/.test(e.message)?e.message:'TENCENT_INVALID_RESULT');}});
    });
  }
}
