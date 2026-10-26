// Explicit, whole-command controls only. Quotes, questions, mixed tasks and
// negated cancellation stay with the conversation model, never a substring rule.
export function classifyCaptionPinyin(raw){
  if(typeof raw!=='string'||raw.length>2000||/[“”「」『』"‘’]/u.test(raw))return null;
  const text=raw.normalize('NFKC').trim().replace(/[。.!！?？]+$/u,'').replace(/^(?:好的?|嗯|那|请问)[,，]?\s*/u,'');
  const clauses=text.split(/[,，;；]/u).map(c=>c.trim()).filter(Boolean),targets=[];
  for(let clause of clauses){
    if(/^(?:中文|汉字|中文字幕)(?:继续)?(?:保留|保持|不变|还要|照常显示)$|^(?:保留|保持|继续显示)(?:中文|汉字|中文字幕)$/u.test(clause))continue;
    clause=clause.replace(/^(?:(?:请|麻烦你?|你|可以|能不能|能|帮我|帮忙)\s*)+/u,'').replace(/(?:好吗|好不好|可以吗|吧|呀|啊|了)$/u,'').trim();
    const object='(?:字幕(?:上|中|里)?的?|中文(?:字幕)?的?)?拼音(?:注释|注音|标注|显示)?';
    if(new RegExp(`^(?:(?:把|将)${object}(?:关掉|关闭|隐藏|去掉|取消)|(?:关闭|关掉|隐藏|去掉|取消)${object}|(?:不用|不要|别)(?:再)?(?:显示|加|标注)?${object}|${object}(?:关掉|关闭|隐藏))$`,'u').test(clause)){targets.push(false);continue;}
    if(new RegExp(`^(?:(?:把|将)${object}(?:重新|再)?(?:打开|开启|显示|加上)|(?:重新|再)?(?:打开|开启|显示|加上|恢复)${object}|${object}(?:重新|再)?(?:打开|开启|显示))$`,'u').test(clause)){targets.push(true);continue;}
    const en=clause.toLowerCase().replace(/^(?:please |(?:can|could|would) you )+/u,'').replace(/ please$/u,'');
    if(/^(?:hide|disable|turn off|stop showing|don't show)(?: the)? pinyin(?: annotations?)?(?: (?:in|on|from) (?:the )?(?:captions|subtitles))?(?: but keep (?:the )?chinese)?$/u.test(en)){targets.push(false);continue;}
    if(/^(?:show|enable|turn on|restore)(?: the)? pinyin(?: annotations?)?(?: (?:in|on) (?:the )?(?:captions|subtitles))?(?: again)?$/u.test(en)){targets.push(true);continue;}
    return null;
  }
  return targets.length&&new Set(targets).size===1?targets[0]:null;
}
export function captionPinyinInstructions(enabled){
  return `字幕拼音规则 kai-caption-pinyin-v1：拼音是应用的阅读注释，只显示在字幕里；正常语音及回复正文不附加逐字拼音或转写，学生明确求助读音教学时除外。本场上次页面确认的拼音状态：${enabled?'显示':'隐藏'}。明确的“关闭拼音／打开拼音”等单独设置指令由宿主执行并按页面回执播报，不自行宣称已经更改，不把关闭拼音理解为关闭字幕、结束对话或改变永久画像。混合问题继续正常回应，不能声称已修改未确认的设置。`;
}
