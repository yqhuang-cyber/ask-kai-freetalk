// Only local, fixed messages reach the page. Never display provider payloads,
// exception messages, credentials or transcripts as diagnostic errors.
const messages=Object.freeze({
  PLAYBACK_BACKLOG:'待播放语音过多，对话已中断。请重新开始。',
  PLAYBACK_LIMIT:'语音播放缓冲已满，对话已中断。请重新开始。',
  INVALID_AUDIO:'收到的语音无法播放，请重新开始。',
  CAPTION_LIMIT:'回复字幕超出处理范围，对话已中断。请重新开始。',
  REPLY_LIMIT:'本次对话已达到回复数量上限，请重新开始。',
  CONTEXT_ACK_TIMEOUT:'语音服务更新等待超时，对话已中断。请重新开始。',
  CANCEL_ACK_TIMEOUT:'语音服务未及时确认打断，对话已中断。请重新开始。',
  PROVIDER_READY_TIMEOUT:'语音服务连接超时，请重新开始。',
  PROVIDER_PROTOCOL_ERROR:'语音服务返回的数据无法处理，对话已中断。请重新开始。',
  PROVIDER_CONTEXT_FAILED:'语音服务更新失败，对话已中断。请重新开始。',
  PROVIDER_CANCEL_FAILED:'语音服务打断失败，对话已中断。请重新开始。',
  PROVIDER_DISCONNECTED:'语音服务连接已断开，请重新开始。',
  PROVIDER_TRANSPORT_ERROR:'语音服务网络异常，请重新开始。',
  TURN_FINAL_TIMEOUT:'语音识别等待超时，对话已中断。请重新开始。',
  OUTPUT_HOLD_LIMIT:'等待识别时回复缓冲已满，对话已中断。请重新开始。',
  CLIENT_BACKPRESSURE:'网络传输拥塞，对话已中断。请重新开始。',
  SESSION_DURATION_LIMIT:'本次对话已达到时长上限，可以重新开始。',
  AUTHORIZATION_REVOKED:'本次对话授权已失效，请重新开始。',
});
export function failureCode(code){return typeof code==='string'&&Object.hasOwn(messages,code)?code:'other';}
export function failureMessage(code){return messages[failureCode(code)]??'实时连接中断，请重新开始。';}
