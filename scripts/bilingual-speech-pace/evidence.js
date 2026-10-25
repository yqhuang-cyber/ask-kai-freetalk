// Finite, preregistered normalization for authored probe inputs. No fuzzy
// keyword matching or inferred intent; negation and language scope survive.
export const canonicalPaceText=text=>text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
const legacy=text=>text.toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
export function authoredInputEvidence(observed,expected,variants=[]){
  const normalized=canonicalPaceText(observed),target=canonicalPaceText(expected);
  return {
    legacy_exact:legacy(observed)===legacy(expected),
    canonical_exact:normalized===target,
    accepted:[expected,...variants].some(v=>canonicalPaceText(v)===normalized),
    unicode_compatibility_changed:legacy(observed)!==normalized,
    observed_characters:normalized.length,expected_characters:target.length,
    // Fixed diagnostic labels only, never actual provider transcript values.
    vocabulary:Object.fromEntries(['中文','英文','英语','汉语','慢','快','正常','公园','建议','例句','chinese','english','slow','normal'].map(word=>[word,normalized.includes(word)]))
    ,diagnostic_homophone_repair_matches:normalized.replaceAll('中午','中文')===target&&normalized!==target
  };
}
export function pcmWave(pcm,rate=24000){
  if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2)throw new Error('BILINGUAL_INVALID_PCM');
  const header=Buffer.alloc(44);
  header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVE',8);header.write('fmt ',12);
  header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);
  header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
  header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);
}
export function trimAuthoredPcm(pcm){
  // Remove only the edges of OS-authored input parts; output PCM is never
  // trimmed, stretched or joined for playback by this experiment.
  let first=-1,last=-1;
  for(let offset=0;offset<pcm.length;offset+=320){
    const end=Math.min(offset+320,pcm.length);let energy=0;
    for(let i=offset;i+1<end;i+=2)energy+=pcm.readInt16LE(i)**2;
    if(Math.sqrt(energy/((end-offset)/2))>=200){if(first<0)first=offset;last=end;}
  }
  if(first<0)throw new Error('BILINGUAL_SILENT_AUTHORED_INPUT');
  return pcm.subarray(Math.max(0,first-640),Math.min(pcm.length,last+640));
}
