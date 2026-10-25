export const DEFAULT_SPEECH_PACE = 'slow';
export const SPEECH_PACE_VERSION = 'kai-speech-v1';
export const isSpeechPace = value => value === 'slow' || value === 'normal';
export function speechPaceInstructions(pace) {
  if (pace === undefined) return '';
  if (!isSpeechPace(pace)) throw new Error('INVALID_SPEECH_PACE');
  const style = pace === 'slow' ? '适合初学者的慢速、清楚且自然的语气，不拖长单个字。' : '自然、清楚的正常语速。';
  return `语音风格版本：${SPEECH_PACE_VERSION}；档位：${pace}。使用${style}在短句和意群边界自然停顿，避免一口气连续讲解。不要朗读语速设置或停顿指令。`;
}

// Session-local controls are distinct from the two persisted/initial presets.
export const SPEECH_SPEEDS=Object.freeze([-40,-20,0,20,40]);
export const isSpeechSpeed=value=>SPEECH_SPEEDS.includes(value);
export function speechSpeedLabel(speed){return ({'-40':'更慢','-20':'慢速',0:'正常',20:'较快',40:'更快'})[speed];}
export function speechSpeedInstructions(speed) {
  if(!isSpeechSpeed(speed))throw new Error('INVALID_SPEECH_SPEED');
  const style=speed<0?'放慢语速，清楚自然，不拖长单字':speed>0?'适当加快语速，保持清楚自然':'使用清楚自然的正常语速';
  return `语音风格版本：${SPEECH_PACE_VERSION}；本场有效语速：${speechSpeedLabel(speed)}（speed=${speed}）。${style}；在意群边界自然停顿。当前会话设置优先于初始计划和画像中的旧语速。不要朗读内部设置；调速的请求确认和成功确认由宿主按真实执行状态播报，不自行声称已完成。`;
}
export function classifySpeechPace(raw) {
  if(typeof raw!=='string'||raw.length>2000)return null;
  const text=raw.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|‘[^’]*’|(?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])/gu,' ').trim();
  // Controls are deliberately narrow. Discussion, negation, and mixed opposing
  // instructions stay with the conversation model rather than changing settings.
  if(/什么意思|怎么(?:说|讲|翻译)|怎么用|意思是|这个词|这句话|\b(?:mean|means|translate|translation|how.*say)\b/iu.test(text))return null;
  const controls=[];
  for(const clause of text.split(/[，,。.!！?？;；\n]/u).map(c=>c.trim()).filter(Boolean)) {
    const clean=clause.replace(/^(?:好的?|嗯|那|请问)\s*/u,'').replace(/^(?:could|can|would) you\s+/iu,'');
    if(/^(?:(?:请|可以|能不能|能|麻烦你?|你(?:能|可以)?|Kai|凯)\s*)*(?:(?:把)?(?:你(?:的)?(?:说话)?(?:语速|速度)|语速|说话速度)(?:调(?:整)?得?|调成|改成)?|说(?:话)?(?:得)?|讲(?:话)?(?:得)?)?\s*(?:再|稍微|稍稍)?(?:放)?(慢|快)(?:一)?(?:点|些|一点儿)(?:儿)?(?:说|讲)?(?:好吗|好不好|可以吗|吗|吧|呀|啊)?$/iu.test(clean)) {
      controls.push(/慢/u.test(clean)?'slower':'faster');continue;
    }
    if(/^(?:(?:请|可以|能不能|你|把语速|语速)\s*)*(?:恢复|回到|调回)(?:正常|原来)(?:的)?(?:语速|速度)?(?:吧|好吗|吗)?$|^(?:please\s+)?(?:speak|talk)(?:\s+(?:a (?:little|bit)|a little bit))?\s+(?:more\s+)?(?:slowly|slower|faster)(?:\s+please)?$|^(?:please\s+)?(?:slower|faster|slow down|speed up)(?:\s+please)?$|^(?:please\s+)?(?:normal speed|back to normal(?: speed)?|speak normally)(?:\s+please)?$/iu.test(clean)) {
      controls.push(/恢复|回到|调回|normal/iu.test(clean)?'normal':/slow/iu.test(clean)?'slower':'faster');
    }
  }
  return controls.length&&new Set(controls).size===1?controls[0]:null;
}

export class SpeechPaceState {
  constructor(pace){this.applied=pace==='normal'?0:-20;this.desired=this.applied;this.contextSpeed=this.applied;this.contextRequest=null;this.request=null;this.enabled=false;}
  enable(speed){if(!isSpeechSpeed(speed))return;this.enabled=true;this.applied=this.desired=this.contextSpeed=speed;}
  observe(event){
    if(!this.enabled)return null;
    const intent=classifySpeechPace(event.payload.text);if(!intent)return null;
    const before=this.desired,index=SPEECH_SPEEDS.indexOf(before);
    const target=intent==='normal'?0:SPEECH_SPEEDS[Math.max(0,Math.min(SPEECH_SPEEDS.length-1,index+(intent==='slower'?-1:1)))];
    const request={id:event.event_id,turn_id:event.turn_id,intent,before,target,changed:target!==this.contextSpeed||target!==this.applied};
    this.desired=target;this.request=request;return request;
  }
  release(id){if(this.request?.id!==id)return false;this.contextSpeed=this.request.target;this.contextRequest=id;return true;}
  confirm(snapshot){if(!this.enabled||!isSpeechSpeed(snapshot?.speed))return false;this.applied=snapshot.speed;return true;}
  snapshot(){return {speed:this.contextSpeed,request_id:this.contextRequest};}
  abandon(id){if(this.request?.id!==id)return;this.request=null;this.desired=this.contextSpeed;}
}

export function speechConfirmation(request,phase,{english=false}={}) {
  const direction=request.intent==='slower'?'放慢':request.intent==='faster'?'加快':'恢复正常';
  const limit=!request.changed;
  const zh=limit?(request.intent==='normal'?'现在已经是正常语速了。':`现在已经是本次可用的最${request.intent==='slower'?'慢':'快'}语速了。`):phase==='before'?`好的，我来把语速${direction}一点。`:`已经${direction}了，接下来我会${request.intent==='slower'?'说慢一点':request.intent==='faster'?'说快一点':'用正常语速说话'}。`;
  const line=request.intent==='normal'&&phase==='before'&&!limit?'好的，我来恢复正常语速。':zh;
  if(!english)return line;
  return line+' '+(limit?'This is already the available speed.':phase==='before'?request.intent==='slower'?"Okay, I'll slow down.":request.intent==='faster'?"Okay, I'll speed up.":"Okay, I'll return to normal speed.":request.intent==='slower'?"I've slowed down.":request.intent==='faster'?"I've sped up.":"I'm back to normal speed.");
}
