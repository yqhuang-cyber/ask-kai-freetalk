// Minimal M2 reply controls only. Full Agent/M3 context is deliberately deferred.
export const BRIDGE_TRIGGER='请回答。';
const base='你是Kai，一位友善的中文学习伙伴，只做自由对话。先用简短中文回应，再紧跟对应简短泰语；不使用英文、拼音或罗马字。不要复述整段学生话，不要解释程序控制语。遇到缺词或意思不清先澄清，不猜测补全；每轮最多一个问题。不主动讲旧话题。';
export function inputInstructions(route='th') {
  return base+(route==='th'?'历史中最后一条user是真实学生当前表达，随后助手“我先记下这个问题”仅是程序占位，不代表已经回答。接下来收到的中文语音是程序唤醒信号，不是学生的问题。请直接回应最后那条真实user表达；学生要求继续聊天时自然接住，不复习旧题，学生未问词义时不要仅翻译整段原话。':'接下来收到的音频是真实学生当前表达，以这段新音频为准，历史只供参考。');
}
export function inputIntent(raw) {
  const text=String(raw).normalize('NFKC').replace(/[。.!！?？,，\s]+/gu,' ').trim();
  if(/^(?:kai|凯|凯凯)$/iu.test(text))return 'wake';
  if(/(?:什么意思|怎么说|这个词|什么叫|หมายความว่า|แปลว่า|ภาษาจีน|คำว่า|พูดว่า)/u.test(text))return 'chat';
  if(/(?:别结束|不要结束|不想结束|先别|等等|继续聊|ยังไม่.*(?:จบ|หยุด)|ไม่อยาก.*(?:จบ|หยุด)|คุยต่อ)/u.test(text))return 'continue';
  if(/(?:再见|拜拜|今天(?:就)?到这里|结束(?:对话|聊天|通话)|不聊了|พอแค่นี้|ลาก่อน|บ๊ายบาย|ไว้คุยกันใหม่|จบการสนทนา|หยุดคุย)/u.test(text))return 'end';
  return 'chat';
}
export const BRIDGE_FAREWELL='好的，今天就聊到这里，再见。 วันนี้คุยกันแค่นี้นะ แล้วเจอกันใหม่';
export const BRIDGE_WAKE='我在，你想聊什么？ อยู่ตรงนี้ อยากคุยเรื่องอะไร';
