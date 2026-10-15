// Presentation estimates only. No supplier word timestamps or semantic rewriting.
export const CAPTION_POLICY=Object.freeze({version:'kai-captions-v1',poll_ms:80,min_reveal_ms:320,stream_unit_ms:300,soft_wait_ms:400,max_units:12,max_chars:64,max_reply_chars:4000});
const words=new Intl.Segmenter('zh',{granularity:'word'});
const graphemes=new Intl.Segmenter('zh',{granularity:'grapheme'});
export function captionUnits(text) {
  const han=(text.match(/\p{Script=Han}/gu)??[]).length;
  const latin=(text.match(/\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’][\p{Script=Latin}\p{M}]+)*/gu)??[]).length;
  const numbers=(text.match(/\p{N}+(?:[.,]\p{N}+)*/gu)??[]).length;
  const symbols=[...graphemes.segment(text)].filter(t=>/\p{Extended_Pictographic}/u.test(t.segment)).length;
  return Math.max(1,han+latin+numbers+symbols);
}
function finishAt(text,end) {
  while(end<text.length && /[”」』）》\])\s]/u.test(text[end]))end++;
  return text.slice(0,end);
}
export function takeCaptionPhrase(text,{flush=false,soft=false}={}) {
  if(!text || !text.trim())return flush?text:null;
  const tokens=[...words.segment(text)];let boundary=0;
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i],end=token.index+token.segment.length;
    // The last word might still be arriving ("foot" + "ball"). Never emit it
    // as a normal complete word before a delimiter or response completion.
    if(!flush && i===tokens.length-1 && token.isWordLike)break;
    const prefix=text.slice(0,end),units=captionUnits(prefix);
    if((units>CAPTION_POLICY.max_units || [...prefix].length>CAPTION_POLICY.max_chars) && boundary)return finishAt(text,boundary);
    if([...token.segment].length>CAPTION_POLICY.max_chars) {
      // Exceptional unbroken tokens remain bounded without splitting a grapheme.
      let size=0,cut=0;for(const g of graphemes.segment(token.segment)){size+=[...g.segment].length;if(size>CAPTION_POLICY.max_chars && cut)break;cut=g.index+g.segment.length;}
      return finishAt(text,token.index+cut);
    }
    boundary=end;
    const abbreviation=token.segment==='.' && /^(?:Mr|Mrs|Ms|Dr|Prof|vs|etc|[A-Z])$/u.test(tokens[i-1]?.segment??'');
    if(!abbreviation && /[，。？！,!?;；:\n.]$/u.test(token.segment) && !token.isWordLike)return finishAt(text,end);
    if(units>=CAPTION_POLICY.max_units)return finishAt(text,end);
  }
  if(flush)return text;
  if(soft && boundary && captionUnits(text.slice(0,boundary))>=4)return finishAt(text,boundary);
  return null;
}
