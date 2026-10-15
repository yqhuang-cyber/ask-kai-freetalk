export const POLICY_VERSION='kai-child-safety-v1';
export const SAFETY_MESSAGE='这件事很重要，请找身边可信任的大人一起处理。如果眼前有危险，请立即寻求当地紧急帮助。';
const rules=[
  ['self_harm',/我(?:想|要)(?:自杀|伤害自己)|不想活了|(?:kill|hurt) myself/iu],
  ['abuse',/我被(?:虐待|性侵)|有人(?:伤害我|强迫我保密)/u],
  ['adult_content',/色情|性交|sexual content/iu],
  ['privacy',/(?:告诉我|发给我|给我)你的(?:住址|电话|密码|学校地址)|(?:send|tell) me your (?:address|password|phone)/iu]
];
/** Deterministic floor only; not a complete moderation or safeguarding model. */
export class SafetyPolicy {
  constructor(){this.output='';}
  inspect(text,{output=false}={}) {
    if(output){this.output=(this.output+text).slice(-4000);text=this.output;}
    for(const [reason,pattern] of rules)if(pattern.test(text))return {restricted:true,reason,policy_version:POLICY_VERSION};
    return {restricted:false,reason:null,policy_version:POLICY_VERSION};
  }
  newResponse(){this.output='';}
}
export function authorizeTool(call,{learnerId,sessionId,sourceEvents,lesson}) {
  if(!call || !call.args || Object.keys(call).some(k=>!['name','args'].includes(k)))throw new Error('INVALID_TOOL');
  const args=call.args;
  if(Object.keys(args).some(k=>!['session_id','learner_id','source_event_id','word'].includes(k)) || args.session_id!==sessionId || args.learner_id!==learnerId)throw new Error('TOOL_SCOPE_DENIED');
  if(call.name==='word_card' && lesson?.cards.some(c=>c.word===args.word))return structuredClone(lesson.cards.find(c=>c.word===args.word));
  if(call.name==='record_attempt') {
    const event=sourceEvents.get(args.source_event_id);
    if(event?.type==='user.final' && event.session_id===sessionId && lesson?.id==='sports-likes' && /我(?:很)?喜欢[^。？！\n]{0,20}(足球|篮球|跑步|游泳)/u.test(event.payload.text))return {kind:'attempted',goal_id:lesson.goal.id,source_event_id:event.event_id};
  }
  throw new Error('TOOL_NOT_ALLOWED');
}
