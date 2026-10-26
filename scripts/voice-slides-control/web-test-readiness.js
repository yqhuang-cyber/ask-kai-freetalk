import {voiceReadiness as nativeReadiness} from '/native-voice-readiness.js';
export function voiceReadiness(packet,audio){
  if(packet?.type==='event'&&packet.event?.type==='session.ready'&&packet.synthetic===true&&packet.provider_connected===false&&audio){
    return {status:'合成联调中',preview:'普通页面合成联调 · 豆包未连接',opening:'正在启动合成输入…',capture:'合成语音与 Planner 测试；持续发送静音帧，不开启麦克风。',real_provider:false};
  }
  return nativeReadiness(packet,audio);
}
