// Authored experiment inputs, fixed before collection. No learner records.
export const INPUTS=Object.freeze({
  gaming_zh:{language:'zh',text:'你最近玩电子游戏吗？'},
  gaming_en:{language:'en',text:'Have you played any video games lately?'},
  music_zh:{language:'zh',text:'我喜欢音乐。你喜欢什么音乐？'},
  music_en:{language:'en',text:'I like music. What kind of music do you like?'},
  happy_zh:{language:'zh',text:'今天我很开心，因为我见到了朋友。'},
  happy_en:{language:'en',text:'I am happy today because I saw a friend.'},
  intro_zh:{language:'zh',text:'我最近喜欢和朋友聊天。'},
  intro_en:{language:'en',text:'Lately, I enjoy chatting with friends.'},
  request_zh:{language:'zh',text:'你最近玩电子游戏吗？请只用英语回答。'},
  request_en:{language:'en',text:'Have you played any video games lately? Please answer only in English.'}
});
export function experimentPlan(){
  const blocks=[];
  for(let repeat=1;repeat<=3;repeat++)for(const topic of ['gaming','music','happy'])blocks.push({id:`fresh-${topic}-${repeat}`,sessions:(repeat%2?['zh','en']:['en','zh']).map(language=>({id:`fresh-${topic}-${repeat}-${language}`,stage:'fresh',repeat,topic,input_language:language,inputs:[topic+'_'+language]}))});
  for(let repeat=1;repeat<=2;repeat++)blocks.push({id:'history-'+repeat,sessions:(repeat===1?['zz','ee','ez','ze']:['ze','ez','ee','zz']).map(cell=>({id:`history-${repeat}-${cell}`,stage:'history',repeat,topic:'gaming',history_language:cell[0]==='z'?'zh':'en',input_language:cell[1]==='z'?'zh':'en',inputs:['intro_'+(cell[0]==='z'?'zh':'en'),'gaming_'+(cell[1]==='z'?'zh':'en')]}))});
  for(let repeat=1;repeat<=3;repeat++)blocks.push({id:'request-'+repeat,sessions:(repeat%2?['en','zh']:['zh','en']).map(language=>({id:`request-${repeat}-${language}`,stage:'explicit_request',repeat,topic:'gaming',input_language:language,inputs:['request_'+language]}))});
  return {version:1,blocks,sessions:blocks.flatMap(b=>b.sessions)};
}
export const normalizeInput=text=>text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
export function languageSurface(text){
  const han=(text.match(/\p{Script=Han}/gu)??[]).length,thai=(text.match(/\p{Script=Thai}/gu)??[]).length,latin=(text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)??[]).length;
  const first=text.match(/[\p{Script=Han}\p{Script=Thai}\p{Script=Latin}]/u)?.[0],chineseFirst=!!first&&/\p{Script=Han}/u.test(first);
  return {han_characters:han,thai_characters:thai,latin_words:latin,latin_leakage:latin>0,chinese_missing:han===0,thai_missing:thai===0,chinese_first:chineseFirst,expected_surface:han>0&&thai>0&&latin===0&&chineseFirst,lately_present:/\blately\b/iu.test(text)};
}
export function summarize(results){
  const groups={};
  for(const r of results){const target=r.turns.at(-1),key=r.stage==='history'?`history_${r.history_language}_${r.input_language}`:`${r.stage}_${r.input_language}`;
    const g=groups[key]??={assigned:0,complete:0,latin_leakage:0,chinese_missing:0,thai_missing:0,expected_surface:0,asr_exact:0};g.assigned++;
    if(!r.complete||!target?.complete)continue;g.complete++;for(const k of ['latin_leakage','chinese_missing','thai_missing','expected_surface'])if(target[k])g[k]++;if(target.asr_exact)g.asr_exact++;
  }
  const paired={complete_pairs:0,both_clean:0,en_only_latin:0,zh_only_latin:0,both_latin:0};
  const keys=[...new Set(results.filter(r=>r.stage==='fresh').map(r=>r.topic+'-'+r.repeat))];
  for(const key of keys){const pair=results.filter(r=>r.stage==='fresh'&&r.topic+'-'+r.repeat===key);const zh=pair.find(r=>r.input_language==='zh'),en=pair.find(r=>r.input_language==='en');if(!zh?.complete||!en?.complete)continue;paired.complete_pairs++;const z=zh.turns[0].latin_leakage,e=en.turns[0].latin_leakage;paired[z?e?'both_latin':'zh_only_latin':e?'en_only_latin':'both_clean']++;}
  return {groups,paired};
}
