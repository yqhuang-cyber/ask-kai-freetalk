export const DEEP_VERSION='conversation-deep-v1';
export const ANALYSIS_NOTICE_VERSION='deep-report-notice-v7';
export function reportConfiguration(env={}){
  const text=env.ASK_KAI_TA_REPORT_TEXT_PROVIDER??'none',audio=env.ASK_KAI_PRONUNCIATION_PROVIDER??'none';
  if(!['none','minimax'].includes(text)||!['none','tencent_soe_v2'].includes(audio))throw new Error('INVALID_REPORT_PROVIDER');
  if(text==='minimax'&&env.ASK_KAI_TA_REPORT_TEXT_MODEL&&env.ASK_KAI_TA_REPORT_TEXT_MODEL!=='MiniMax-M3')throw new Error('INVALID_REPORT_MODEL');
  const reviewed=env.ASK_KAI_TA_REPORT_EXTERNAL_REVIEWED==='1',autoVerification=env.ASK_KAI_TA_AUDIO_VERIFY_PROVIDER==='tencent_asr';
  if(env.ASK_KAI_TA_AUDIO_VERIFY_PROVIDER&&!['none','tencent_asr'].includes(env.ASK_KAI_TA_AUDIO_VERIFY_PROVIDER))throw new Error('INVALID_AUDIO_VERIFY_PROVIDER');
  return {version:DEEP_VERSION,enabled:text!=='none'||audio!=='none',
    text:{provider:text,configured:!!env.MINIMAX_API_KEY,reviewed,model:env.ASK_KAI_TA_REPORT_TEXT_MODEL??'MiniMax-M3'},
    audio:{autoVerification,verificationProvider:autoVerification?'tencent_asr':'none',verificationConfigured:!!(env.TENCENT_ASR_SECRET_ID??env.TENCENT_SOE_SECRET_ID)&&!!(env.TENCENT_ASR_SECRET_KEY??env.TENCENT_SOE_SECRET_KEY),provider:audio,configured:['TENCENT_SOE_APP_ID','TENCENT_SOE_SECRET_ID','TENCENT_SOE_SECRET_KEY'].every(k=>!!env[k]),reviewed,manualReview:env.ASK_KAI_TA_AUDIO_REVIEW_ENABLED==='1',validated:env.ASK_KAI_TA_AUDIO_ASSESSMENT_VALIDATED==='1'}};
}
export function processingPurpose(config,kind){const c=config?.[kind];return c&&c.provider!=='none'&&c.configured&&c.reviewed&&(kind==='text'||c.validated||c.manualReview||c.autoVerification&&c.verificationConfigured)?c.provider:'local-only';}

export const REPORT_ENV_KEYS=['ASK_KAI_TA_AUDIO_VERIFY_PROVIDER','TENCENT_ASR_SECRET_ID','TENCENT_ASR_SECRET_KEY','TENCENT_ASR_ENGINE','TENCENT_ASR_REGION','ASK_KAI_TA_REPORT_TEXT_PROVIDER','ASK_KAI_TA_REPORT_TEXT_MODEL','ASK_KAI_PRONUNCIATION_PROVIDER','ASK_KAI_TA_REPORT_EXTERNAL_REVIEWED','ASK_KAI_TA_AUDIO_ASSESSMENT_VALIDATED','ASK_KAI_TA_AUDIO_REVIEW_ENABLED','MINIMAX_API_KEY','MINIMAX_BASE_URL','TENCENT_SOE_APP_ID','TENCENT_SOE_SECRET_ID','TENCENT_SOE_SECRET_KEY'];
export const reportEnvironment=env=>Object.fromEntries(REPORT_ENV_KEYS.filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
