// Frozen evaluation contract from Agent fbd4a80e158dc1b0693c160e9b9b7d235fe39c00.
// Do not edit when the candidate Agent policy changes; rubric updates require a new evaluation version.
import { LANGUAGE_POLICY_VERSION,ENGLISH_SUPPORT_MODES } from './evaluation-language-v3.js';
export const REPLY_POLICY_VERSION = 'kai-reply-v3';
export const REPLY_BUDGET = Object.freeze({pairs:2,chinese_chars:36,english_words:24,spoken_units:48,text_chars:180,questions:1,new_points:1,examples:1});

export const REPLY_INSTRUCTIONS = `回复策略版本：${REPLY_POLICY_VERSION}。
先按当前语言支架决定英文是否必要；必要英文紧接对应短中文，不增加新内容。所有确认语、寒暄、拼音、示范及翻译都计入本轮预算。
默认只用一句短中文，必要时配对应短英文；需要反馈加追问时，整轮最多 ${REPLY_BUDGET.pairs} 句中文及其必要的英文。两种语言共用一个预算：汉字最多 ${REPLY_BUDGET.chinese_chars} 个、英文最多 ${REPLY_BUDGET.english_words} 词、汉字数加英文词数加数字组数最多 ${REPLY_BUDGET.spoken_units}，含标点和空格总计最多 ${REPLY_BUDGET.text_chars} 字符。先把中文说短，再用短英文对应，不能把英文当作额外讲解空间。
每轮选择一个主要动作：回应当前内容、澄清一个问题、修正一个明确错误、示范一个表达或简短告别。不要把“回答＋词义＋语法＋例句＋跟读＋追问”连成一轮。最多一个主要问题或练习任务，同一问题的英文翻译不算第二个问题；回应后可以自然停下，不必附加问题。
教学密度：普通聊天可以零个新知识点；需要教学时最多 ${REPLY_BUDGET.new_points} 个新词或句型、${REPLY_BUDGET.examples} 个短示范，示范也占上述句数和总预算。先给最有用的一点再停下，不逐词拆解，不同时安排跟读或新练习。学生要详细解释时先解释一个点，等其回应再继续；会话复盘使用结束后的可视化总结，口头告别不展开知识清单，未实际提供的卡片不声称已展示。不朗读 HSK 等级、教学标签或这些规则。
只说自然可朗读的正文，使用句末标点分隔中英文；不要语言标签、Markdown、列表或舞台说明。安全规则优先，不能为了简短省略必要的安全帮助。`;

// Surface checks only. Translation equivalence, HSK difficulty, new concepts and
// question/task intent require a human or semantic Judge; script counts cannot prove them.
function sentences(text) {
  const result=[];let current='',quote=null;
  const closing={'“':'”','「':'」','『':'』','"':'"'};
  const chars=Array.from(text);
  for(let i=0;i<chars.length;i++) {
    const char=chars[i];current+=char;
    if(quote===char){
      quote=null;
      const next=chars.slice(i+1).find(c=>! /\s/u.test(c));
      if(/[。！？.!?]/u.test(chars[i-1]??'') && (next===undefined || /\p{Script=Latin}/u.test(next))){result.push(current);current='';}
      continue;
    }
    if(!quote && closing[char]){quote=closing[char];continue;}
    const decimal=char==='.' && /\p{N}/u.test(chars[i-1]??'') && /\p{N}/u.test(chars[i+1]??'');
    if(!quote && !decimal && /[。！？.!?\n]/u.test(char)) {
      while(i+1<chars.length && /[。！？.!?\n]/u.test(chars[i+1]))current+=chars[++i];
      if(/[\p{L}\p{N}]/u.test(current))result.push(current);
      current='';
    }
  }
  if(/[\p{L}\p{N}]/u.test(current))result.push(current);
  return result;
}

export function measureReply(text,{complete=true,englishSupport='required',languageContextMatched=true}={}) {
  if(typeof text!=='string')throw new Error('INVALID_REPLY_TEXT');
  if(!ENGLISH_SUPPORT_MODES.includes(englishSupport))throw new Error('INVALID_LANGUAGE_SUPPORT');
  const chinese_chars=(text.match(/\p{Script=Han}/gu)??[]).length;
  const english_words=(text.match(/\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’\-]\p{Script=Latin}[\p{Script=Latin}\p{M}]*)*/gu)??[]).length;
  const numeric_units=(text.match(/\p{N}+(?:[.,]\p{N}+)*/gu)??[]).length;
  const spoken_units=chinese_chars+english_words+numeric_units;
  const text_chars=Array.from(text).length;
  const parts=sentences(text).map(value=>({language:/\p{Script=Han}/u.test(value)?'zh':/\p{Script=Latin}/u.test(value)?'en':'other',question:/[?？]/u.test(value)}));
  const zh=parts.filter(p=>p.language==='zh'),en=parts.filter(p=>p.language==='en');
  let pair_count=0;
  for(let i=0;i<parts.length-1;i++)if(parts[i].language==='zh' && parts[i+1].language==='en')pair_count++;
  const chineseFirst=parts.length>0 && parts[0].language==='zh' && parts.every((part,i)=>part.language==='zh' || (part.language==='en' && parts[i-1]?.language==='zh'));
  const requiredPairs=parts.length%2===0 && parts.every((part,i)=>part.language===(i%2?'en':'zh'));
  const orderOk=chineseFirst && (englishSupport!=='required' || requiredPairs);
  // A translated question counts once, not as two independent question intents.
  const question_pairs=Math.max(zh.filter(p=>p.question).length,en.filter(p=>p.question).length);
  return {reply_policy_version:REPLY_POLICY_VERSION,language_policy_version:LANGUAGE_POLICY_VERSION,english_support:englishSupport,language_context_matched:languageContextMatched,audit_complete:complete,text_chars,chinese_chars,english_words,numeric_units,spoken_units,chinese_sentences:zh.length,english_sentences:en.length,pair_count,question_pairs,
    budget_exceeded:chinese_chars>REPLY_BUDGET.chinese_chars || english_words>REPLY_BUDGET.english_words || spoken_units>REPLY_BUDGET.spoken_units || text_chars>REPLY_BUDGET.text_chars || zh.length>REPLY_BUDGET.pairs || en.length>REPLY_BUDGET.pairs,
    language_order_issue:complete && languageContextMatched?!orderOk:null,english_support_issue:complete && languageContextMatched?(englishSupport==='off' && en.length>0):null,question_budget_exceeded:question_pairs>REPLY_BUDGET.questions,
    translation_review_required:true,language_support_review_required:true,teaching_density_review_required:true};
}

// Opt-in diagnostics keep a bounded transient prefix, cleared at every terminal
// reply. Interrupted/failed/truncated replies cannot establish a language violation.
export class ReplyAudit {
  constructor(options={}){this.options={...options};this.text='';this.chars=0;this.truncated=false;}
  append(delta) {
    const chars=Array.from(delta);this.chars+=chars.length;
    const remaining=4096-Array.from(this.text).length;
    this.text+=chars.slice(0,remaining).join('');
    if(chars.length>remaining)this.truncated=true;
  }
  finish(state) {
    const result=measureReply(this.text,{...this.options,complete:state==='done' && !this.truncated && this.chars>0});
    result.text_chars=this.chars;result.audit_truncated=this.truncated;
    result.budget_exceeded ||= this.chars>REPLY_BUDGET.text_chars;
    this.text='';this.chars=0;this.truncated=false;return result;
  }
}
