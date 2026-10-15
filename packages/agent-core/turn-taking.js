export const TURN_POLICY_VERSION='kai-turn-v1';
export const TURN_INSTRUCTIONS=`话轮规则版本：${TURN_POLICY_VERSION}。学生短暂停顿、说“嗯”或寻找词语时优先等待，不急着接话、代答或催促。不要把背景声音当作学生的新问题。学生继续表达时让他先说完；明确插话或要求停止时停止旧回答，再回应新的意图。`;
export function hasSpeechText(value) {
  if(typeof value!=='string')return false;
  const text=value.replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
  return !!text && !/^(?:嗯+|哦+|啊+|呃+|唔+|uh|um|hmm|mm)$/u.test(text);
}
