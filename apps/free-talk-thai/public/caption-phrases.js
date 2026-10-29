// Free Talk Thai presentation fork; the original caption policy stays unchanged.
// Presentation estimates only. No supplier word timestamps or semantic rewriting.
export const CAPTION_POLICY=Object.freeze({version:'kai-thai-captions-v2',poll_ms:60,min_reveal_ms:160,stream_unit_ms:240,soft_wait_ms:240,max_units:8,max_speech_units:8,max_chars:48,max_reply_chars:4000,preview_ms:200,thai_grapheme_weight:0.5});
const words=new Intl.Segmenter('th',{granularity:'word'});
const graphemes=new Intl.Segmenter('th',{granularity:'grapheme'});
// Duration estimates are distinct from dictionary words used for line breaking.
// Two authored same-voice pairs measured 0.44/0.51 Han-unit per Thai grapheme.
// Rounded 0.5 is a bounded presentation estimate, never a provider timestamp.
export function captionSpeechUnits(text) {
  const han=(text.match(/\p{Script=Han}/gu)??[]).length;
  const thai=[...graphemes.segment(text)].filter(g=>/\p{Script=Thai}/u.test(g.segment)).length;
  const latin=(text.match(/\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’][\p{Script=Latin}\p{M}]+)*/gu)??[]).length;
  const numbers=(text.match(/\p{N}+(?:[.,]\p{N}+)*/gu)??[]).length;
  const symbols=[...graphemes.segment(text)].filter(g=>/\p{Extended_Pictographic}/u.test(g.segment)).length;
  return han+thai*CAPTION_POLICY.thai_grapheme_weight+latin+numbers+symbols;
}
export function captionUnits(text) {
  const han=(text.match(/\p{Script=Han}/gu)??[]).length;
  const latin=(text.match(/\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’][\p{Script=Latin}\p{M}]+)*/gu)??[]).length;
  const numbers=(text.match(/\p{N}+(?:[.,]\p{N}+)*/gu)??[]).length;
  const symbols=[...graphemes.segment(text)].filter(t=>/\p{Extended_Pictographic}/u.test(t.segment)).length;
  const thai=[...words.segment(text)].filter(t=>t.isWordLike&&/\p{Script=Thai}/u.test(t.segment)).length;
  return Math.max(1,han+thai+latin+numbers+symbols);
}
function finishAt(text,end) {
  while(end<text.length && /[”」』）》\])\s]/u.test(text[end]))end++;
  return text.slice(0,end);
}
export function takeCaptionPhrase(text,{flush=false,soft=false}={}) {
  if(!text || !text.trim())return flush?text:null;
  const tokens=[...words.segment(text)];let boundary=0,language=null;
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i],end=token.index+token.segment.length;
    // The last word might still be arriving ("foot" + "ball"). Never emit it
    // as a normal complete word before a delimiter or response completion.
    if(!flush && i===tokens.length-1 && token.isWordLike)break;
    const tokenLanguage=/\p{Script=Han}/u.test(token.segment)?'zh':/\p{Script=Thai}/u.test(token.segment)?'th':/\p{Script=Latin}/u.test(token.segment)?'latin':null;
    if(language&&tokenLanguage&&language!==tokenLanguage&&boundary)return finishAt(text,boundary);
    language??=tokenLanguage;
    const prefix=text.slice(0,end),units=captionUnits(prefix),speechUnits=captionSpeechUnits(prefix);
    if((units>CAPTION_POLICY.max_units || speechUnits>CAPTION_POLICY.max_speech_units || [...prefix].length>CAPTION_POLICY.max_chars) && boundary)return finishAt(text,boundary);
    if([...token.segment].length>CAPTION_POLICY.max_chars) {
      // Exceptional unbroken tokens remain bounded without splitting a grapheme.
      let size=0,cut=0;for(const g of graphemes.segment(token.segment)){size+=[...g.segment].length;if(size>CAPTION_POLICY.max_chars && cut)break;cut=g.index+g.segment.length;}
      return finishAt(text,token.index+cut);
    }
    boundary=end;
    const abbreviation=token.segment==='.' && /^(?:Mr|Mrs|Ms|Dr|Prof|vs|etc|[A-Z])$/u.test(tokens[i-1]?.segment??'');
    if(!abbreviation && /[，。？！,!?;；:\n.]$/u.test(token.segment) && !token.isWordLike)return finishAt(text,end);
    if(units>=CAPTION_POLICY.max_units || speechUnits>=CAPTION_POLICY.max_speech_units)return finishAt(text,end);
  }
  if(flush)return text;
  if(soft && boundary && captionUnits(text.slice(0,boundary))>=4)return finishAt(text,boundary);
  return null;
}
