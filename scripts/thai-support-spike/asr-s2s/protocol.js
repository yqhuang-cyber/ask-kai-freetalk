export {encodeAsr,decodeAsr} from '../../../packages/provider-doubao/asr-protocol.js';
export function asrRequest({language,auto=false}={}) {
  if(language!==undefined&&!['zh-CN','th-TH'].includes(language)||auto&&language)throw Error('INVALID_ASR_LANGUAGE');
  return {user:{uid:'ask-kai-authored-thai-spike'},audio:{format:'pcm',rate:16000,bits:16,channel:1,...(language?{language}:{})},request:{model_name:'bigmodel',enable_itn:true,enable_punc:true,enable_ddc:false,show_utterances:true,...(auto?{enable_auto_lang:true}:{})}};
}
export function scriptCounts(text) {
  return {han:(text.match(/\p{Script=Han}/gu)??[]).length,thai:(text.match(/\p{Script=Thai}/gu)??[]).length,latin_words:(text.match(/[a-zA-Z]+/g)??[]).length};
}
export const normalized=text=>text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'').toLowerCase();
export function bridgeGate({source,asrFinal,asrText,sentText,responseComplete,audioBytes,audioNonSilent,echo,semanticReviewed}) {
  return source==='real_asr_final'&&asrFinal===true&&!!asrText&&sentText===asrText&&responseComplete===true&&audioBytes>0&&audioNonSilent===true&&echo===false&&semanticReviewed===true;
}
