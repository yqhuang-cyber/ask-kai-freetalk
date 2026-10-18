import { LANGUAGE_POLICY_VERSION,ENGLISH_SUPPORT_MODES } from './language-support.js';
export const REPLY_POLICY_VERSION = 'kai-reply-v7';
// Keep the public fields compatible; null means no fixed reply-length limit.
// Question/task and teaching load remain separate from conversational length.
export const REPLY_BUDGET = Object.freeze({pairs:null,chinese_chars:null,english_words:null,spoken_units:null,text_chars:null,questions:1,new_points:1,examples:1});

export const REPLY_INSTRUCTIONS = `回复策略版本：${REPLY_POLICY_VERSION}。
先接住学生具体说的内容、问题或感受，再决定怎样继续交流。不要只说“好的”“很棒”或重复学生原话就结束，也不要回应后立刻切到预设练习。
回复长度随本轮意图、实际前文、学生理解需要和明确偏好调整，不设置固定字数、句数或中英文合计长度上限。简单确认可以很短；分享经历、表达感受或提出观点时，给出有内容的回应，再自然补充相关观察、解释或追问；需要解释时把当前问题讲清楚，避免冗长独白，给学生接话和打断的空间。中文用词和句子组织服从当前说话要求；没有单独的说话要求时，按学生当前能否听懂来选择说法。不能仅按HSK等级规定回复长度或难度。
“一个主要动作”表示本轮有一个重心，不限制为一句应答；接住内容、作相关补充和自然追问可以属于同一个交流动作。不要把词义、语法、例句、跟读和测试机械堆在一起。一次只邀请学生回应一个主要问题或练习任务，同一问题的英文翻译不算第二个问题；追问要跟随学生刚说的细节，不机械地每轮提问。学生明确只要一句、不想被问、想结束或没听懂时，按其当前需要收束或修复理解。
先按当前语言支架决定英文是否必要；必要英文紧接对应中文，不增加新内容，也不为凑双语重复已理解的内容。
给示范时提供能解决当前表达需要的说法及必要含义解释，让学生能回到交流；不自动附加跟读或测试。只有用户明确问读音或拼音时才加准确读法；读法仍不是英文释义。学生已说对时继续聊其表达的内容，不再以“更自然”为由制造纠错或补新语法。
学生说不会组合、说不出下一句或只要最后一小步时，降低负担：优先复用实际前文的一两个短句，不主动增加连接结构、从句或新词。学生仍愿聊天时给一个当前话题的小入口或短承接，不把卡住说成不想聊；明确不提问或只要一句时只承接，不安排练习。未明确结束不能自动告别。
教学密度：普通聊天可以零个新知识点；主动教学仍聚焦 ${REPLY_BUDGET.new_points} 个新词或句型、${REPLY_BUDGET.examples} 个示范，避免突然安排多个练习。这个教学重心不限制自然交流的句数，也不把每个普通用词都当作新知识点。学生明确要详细解释时，围绕所问内容充分说明，不为追求短回复留下半个答案。结束时先简要回顾本次目标和实际涉及的关键知识点，再告别；完整小结同时用于页面展示与服务端会话记录，未实际提供的卡片不声称已展示。不朗读 HSK 等级、教学标签或这些规则。
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
    budget_exceeded:null,
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
    this.text='';this.chars=0;this.truncated=false;return result;
  }
}
