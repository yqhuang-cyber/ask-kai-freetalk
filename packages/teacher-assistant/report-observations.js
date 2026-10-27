// Versioned, deliberately bounded dining semantics. These are text observations,
// never acoustic judgments, ability levels, or proof of hearing a prompt.
export const ANALYSIS_VERSION = 'dining-analysis-v2';
const ambiguous = /[“”「」『』"‘’]|(?:他说|她说|老师说|可能|好像|也许|听不清|识别不确定|怎么说|什么意思|翻译)/u;
export function diningQuestion(text) {
  if (typeof text !== 'string' || text.length > 320) return null;
  const question = text.trim().split(/[。！!]/u).at(-1).trim();
  const kind = /^(?:你(?:的)?|您(?:的)?)?口味(?:有)?什么要求[？?]$/u.test(question) || /^(?:你|您)?(?:想要|要|喜欢)什么口味[？?]$/u.test(question) ? 'taste'
    : /^(?:你|您)?(?:想吃|想点|要吃|要点|要)什么[？?]$/u.test(question) ? 'food'
    : /^(?:你|您)?(?:要|想要)几(?:碗|份|盘)[？?]$/u.test(question) ? 'quantity' : null;
  return kind ? {kind, excerpt: question} : null;
}
export function diningAnswer(kind, text, facts) {
  if (typeof text !== 'string' || text.length > 160 || ambiguous.test(text) || /[？?]/u.test(text)) return null;
  if (kind === 'food' && facts.some(f => f.goal_id === 'order_food')) return '回应了食物选择问题，表达中包含点单意图和食物。';
  if (kind === 'taste' && facts.some(f => f.goal_id === 'taste_preference')) return '回应了口味问题，表达中包含具体口味要求。';
  if (kind === 'quantity' && /^(?:(?:我)?(?:要|想要))?[一二两三四五六七八九十](?:碗|份|盘)(?:吧|谢谢)?[。！!]?$/u.test(text.trim())) return '回应了数量问题，使用了数量和量词。';
  return null;
}
export function expressionFeatures(facts) {
  const order = facts.filter(f => f.goal_id === 'order_food');
  const taste = facts.filter(f => f.goal_id === 'taste_preference');
  const features = [];
  if (order.length) features.push({id: 'order_structure', description: '点单表达中同时包含请求意图和食物名称。', evidence: order});
  const quantity = order.filter(f => /一(?:碗|份|盘)/u.test(f.excerpt));
  if (quantity.length) features.push({id: 'quantity_phrase', description: '点单表达中使用了数量和量词，补充了份量信息。', evidence: quantity});
  if (taste.length) features.push({id: 'taste_detail', description: '表达了具体口味偏好或限制，补充了点单细节。', evidence: taste});
  const combined = order.filter(f => taste.some(t => t.turn_id === f.turn_id));
  if (combined.length) features.push({id: 'connected_information', description: '同一轮表达同时提供了食物选择和口味要求。', evidence: [...combined, ...taste.filter(t => combined.some(f => f.turn_id === t.turn_id))]});
  for (const [id, refs] of [['order_food', order], ['taste_preference', taste]]) {
    if (new Set(refs.map(f => f.turn_id)).size >= 2) features.push({id: `reuse_${id}`, description: '在至少两个不同轮次再次使用了相关表达；不代表独立迁移或长期掌握。', evidence: refs});
  }
  return features;
}

export const ORGANIZATION_RULES = Object.freeze({
  reason_link: {pattern: /^(?:我|我们).{1,45}因为.{1,60}[。！!]?$/u, description: '使用“因为”连接自己的陈述和理由；这里只记录表达组织形式，不判断理由恰当性或整体语法准确度。'},
  sequence_link: {pattern: /^(?:我|我们)(?:先|首先).{1,45}(?:然后|接着).{1,60}[。！!]?$/u, description: '使用先后连接词组织两个动作；这里只记录叙述形式，不判断完整故事能力。'},
  clarification: {pattern: /^(?:请再说一遍|我没听懂|没听懂|你说的.{1,20}是什么意思|这.{0,12}是什么意思)[。？?!！]?$/u, description: '明确请求重复或澄清，是维持交流的策略；不据此推断整体听力不足。'}
});
export function observeOrganization(raw){
  if(typeof raw!=='string'||raw.length>120||/[“”「」『』"‘’]|他说|她说|老师说|识别不确定|好像|也许/u.test(raw))return [];
  return Object.entries(ORGANIZATION_RULES).filter(([,rule])=>rule.pattern.test(raw.trim())).map(([feature_id])=>({feature_id,excerpt:raw.trim()}));
}

// Deliberately narrow authored rules. Unrecognized forms are not errors.
export function observeDining(raw){
  if(typeof raw!=='string'||raw.length>160||/[“”「」『』"‘’？?]|(?:他说|她说|老师说|可能|好像|也许|听不清|识别不确定|怎么说|什么意思|翻译)/u.test(raw))return [];
  const clauses=raw.trim().replace(/[。！!]+$/u,'').split(/[，,。；;]/u).map(s=>s.trim()).filter(Boolean);
  const found=[];
  for(const text of clauses){
    if(/^(?:我(?:想|要|想要)|请(?:给我)?|给我)(?:来)?(?:一(?:碗|份|盘))?(?:面条|面|米饭|饭|饺子|包子|炒饭|牛肉面|鸡肉)(?:吧|谢谢)?$/u.test(text))found.push({goal_id:'order_food',excerpt:text});
    if(/^(?:(?:我)?(?:要|想要|喜欢|想吃)(?:微辣|少辣|不辣|清淡|辣的|甜的|咸的)|(?:请)?(?:不要辣|不放辣椒|少放盐|少放辣椒|微辣|少辣|不辣|清淡一点))(?:吧|谢谢)?$/u.test(text))found.push({goal_id:'taste_preference',excerpt:text});
  }
  return found;
}
