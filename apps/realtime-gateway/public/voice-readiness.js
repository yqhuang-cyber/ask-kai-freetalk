// Real-provider readiness policy. Test hosts may replace this dependency explicitly;
// the shipped application never accepts synthetic events as a real connection.
export function voiceReadiness(packet,audio){
  if(packet?.type!=='event'||packet.event?.type!=='session.ready'||packet.synthetic!==false||packet.provider_connected!==true||!audio)return null;
  return {status:'已连接',preview:'Web 对话 · 实时服务已就绪',opening:'正在开启麦克风……',capture:'麦克风持续开启，你可以自然地说话。',real_provider:true};
}
