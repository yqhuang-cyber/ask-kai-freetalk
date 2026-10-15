import { immutable } from '../contracts/planning.js';
export const LEARNER_FEEDBACK_VERSION='kai-learner-feedback-v1';
// Limited structural evidence, never a general semantic or pronunciation Judge.
// A direct utterance may establish an attempt, not its truth or independence.
export function supportedExpression(text,rule) {
  if(typeof text!=='string'||text.length>2000)return null;
  const t=text.trim();
  if(/说错|更正|改口|不是|举例|例句|假设|这句话|这个句子|怎么说|怎么翻译|什么意思|对不对|我不喜欢/u.test(t))return null;
  const pattern=rule==='likes-attempt-v1'?/^我(?:很)?喜欢(踢足球|打篮球|足球|篮球|跑步|游泳)(?=[。！!，,；;\n]|$)/u:rule==='time-attempt-v1'?/^我(上午|下午|晚上)(踢足球|打篮球|跑步|游泳)(?=[。！!，,；;\n]|$)/u:null;
  const m=pattern?.exec(t);if(!m)return null;
  return rule==='likes-attempt-v1'?`我喜欢${m[1].replace(/^踢|^打/u,'')}`:m[0];
}
export function observedPrompt(expression,executions,currentTurn) {
  // Nearest actual output wins; do not skip an intervening cancelled reply.
  const prior=[...executions??[]].reverse().find(x=>x.turn_id!==currentTurn);
  const base={execution_ref:prior?.execution_id??null,output_state:prior?.status??'none',consumption:prior?.consumption??'unknown',scope:'unknown',preceded_student_speech:'unknown'};
  if(!prior||!expression)return immutable(base);
  if(prior.status==='cancelled')return immutable({...base,scope:'cancelled_output'});
  const compact=s=>s.replace(/[\s。！!，,；;“”「」『』"']/gu,'');
  if(compact(prior.text??'').includes(compact(expression)))base.scope='matching_model_forwarded';
  // Even client-reported completion does not establish ordering before speech.
  return immutable(base);
}
