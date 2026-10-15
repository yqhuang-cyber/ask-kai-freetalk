// A small authored POC directory, independent of case IDs and references.
// Literal observation is not a correctness, understanding or mastery judgment.
export const EXPRESSION_DIRECTORY_VERSION='kai-expression-directory-v1';
export const GENERAL_EXPRESSIONS=Object.freeze([
  {id:'likes-drawing',text:'我喜欢画画',pinyin:'wǒ xǐ huān huà huà',english:'I like drawing.',type:'phrase'},
  {id:'likes-games',text:'我喜欢玩游戏',pinyin:'wǒ xǐ huān wán yóu xì',english:'I like playing games.',type:'phrase'},
  {id:'likes-spicy',text:'我喜欢吃辣',pinyin:'wǒ xǐ huān chī là',english:'I like spicy food.',type:'phrase'},
  {id:'likes-music',text:'我喜欢音乐',pinyin:'wǒ xǐ huān yīn yuè',english:'I like music.',type:'phrase'},
  {id:'apple',text:'苹果',pinyin:'píng guǒ',english:'apple',type:'word'},
  {id:'ice-cream',text:'冰淇淋',pinyin:'bīng qí lín',english:'ice cream',type:'word'},
  {id:'hobby',text:'爱好',pinyin:'ài hào',english:'hobby',type:'word'},
  {id:'pencil',text:'铅笔',pinyin:'qiān bǐ',english:'pencil',type:'word'},
  {id:'drawing',text:'画画',pinyin:'huà huà',english:'to draw',type:'word'},
  {id:'music',text:'音乐',pinyin:'yīn yuè',english:'music',type:'word'},
  {id:'spicy',text:'辣',pinyin:'là',english:'spicy',type:'word'},
  {id:'hot',text:'热',pinyin:'rè',english:'hot (temperature)',type:'word'}
].map(Object.freeze));
export const RECAP_TOPICS=Object.freeze([
  {id:'sports',label:'运动',pattern:/(?:足球|篮球|跑步|游泳)|\b(?:football|soccer|basketball|running|swimming)\b/iu},
  {id:'food',label:'日常饮食',pattern:/(?:苹果|冰淇淋|面条|食物|吃饭)|\b(?:apples?|ice cream|noodles?|food|spicy)\b/iu},
  {id:'hobbies',label:'兴趣爱好',pattern:/(?:画画|音乐|游戏|爱好)|\b(?:drawing|music|games?|hobb(?:y|ies))\b/iu},
  {id:'weather',label:'天气',pattern:/(?:天气|下雨|晴天|今天很热)|\b(?:weather|raining|sunny)\b/iu}
].map(Object.freeze));
const unquoted=text=>text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|‘[^’]*’|(?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])/gu,' ');
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function directExpression(text,entry) {
  const value=unquoted(text);
  // No questions, negations, quoted examples or third-person clauses earn an
  // attempt. Whole literal clauses are deliberately more limited than a parser.
  const pattern=new RegExp(`(?:^|[。！!，,；;\\n])\\s*${escape(entry.text)}(?=[。！!，,；;\\n]|$)`,'u');
  return pattern.test(value);
}
export function forwardedExpressionRanges(text,entry) {
  const pattern=new RegExp(`(?:^|[。！!，,；;：:\\n“「"\\s])(${escape(entry.text)})(?=[。！!.,，；;”」"]|$)`,'gu');
  return [...text.matchAll(pattern)].map(m=>({from:m.index+m[0].length-m[1].length,to:m.index+m[0].length}));
}
export const expressionRequest=text=>/(?:怎么(?:用中文)?说|中文怎么|用中文怎么|教我(?:说|一句|中文)|怎么用中文)|\b(?:how (?:do|can|would) (?:i|you|we) say|how to say|help me say|teach me|what(?: is|'s)\b.{1,80}\bin chinese)\b/iu.test(unquoted(text));
