export const DEFAULT_SPEECH_PACE = 'slow';
export const SPEECH_PACE_VERSION = 'kai-speech-v1';
export const isSpeechPace = value => value === 'slow' || value === 'normal';
export function speechPaceInstructions(pace) {
  if (pace === undefined) return '';
  if (!isSpeechPace(pace)) throw new Error('INVALID_SPEECH_PACE');
  const style = pace === 'slow' ? '适合初学者的慢速、清楚且自然的语气，不拖长单个字。' : '自然、清楚的正常语速。';
  return `语音风格版本：${SPEECH_PACE_VERSION}；档位：${pace}。使用${style}在短句和意群边界自然停顿，避免一口气连续讲解。不要朗读语速设置或停顿指令。`;
}
