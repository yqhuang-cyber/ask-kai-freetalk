export const DEEP_VERSION='conversation-deep-v1';
export const ANALYSIS_NOTICE_VERSION='deep-report-notice-v5';
export function reportConfiguration(env={}){
  const text=env.ASK_KAI_TA_REPORT_TEXT_PROVIDER??'none',audio=env.ASK_KAI_PRONUNCIATION_PROVIDER??'none';
  if(!['none','minimax'].includes(text)||!['none','tencent_soe_v2'].includes(audio))throw new Error('INVALID_REPORT_PROVIDER');
  if(text==='minimax'&&env.ASK_KAI_TA_REPORT_TEXT_MODEL&&env.ASK_KAI_TA_REPORT_TEXT_MODEL!=='MiniMax-M3')throw new Error('INVALID_REPORT_MODEL');
  const reviewed=env.ASK_KAI_TA_REPORT_EXTERNAL_REVIEWED==='1';
  return {version:DEEP_VERSION,enabled:text!=='none'||audio!=='none',
    text:{provider:text,configured:!!env.MINIMAX_API_KEY,reviewed,model:env.ASK_KAI_TA_REPORT_TEXT_MODEL??'MiniMax-M3'},
    audio:{provider:audio,configured:['TENCENT_SOE_APP_ID','TENCENT_SOE_SECRET_ID','TENCENT_SOE_SECRET_KEY'].every(k=>!!env[k]),reviewed,manualReview:env.ASK_KAI_TA_AUDIO_REVIEW_ENABLED==='1',validated:env.ASK_KAI_TA_AUDIO_ASSESSMENT_VALIDATED==='1'}};
}
export function processingPurpose(config,kind){const c=config?.[kind];return c&&c.provider!=='none'&&c.configured&&c.reviewed&&(kind==='text'||c.validated||c.manualReview)?c.provider:'local-only';}

export const REPORT_ENV_KEYS=['ASK_KAI_TA_REPORT_TEXT_PROVIDER','ASK_KAI_TA_REPORT_TEXT_MODEL','ASK_KAI_PRONUNCIATION_PROVIDER','ASK_KAI_TA_REPORT_EXTERNAL_REVIEWED','ASK_KAI_TA_AUDIO_ASSESSMENT_VALIDATED','ASK_KAI_TA_AUDIO_REVIEW_ENABLED','MINIMAX_API_KEY','MINIMAX_BASE_URL','TENCENT_SOE_APP_ID','TENCENT_SOE_SECRET_ID','TENCENT_SOE_SECRET_KEY'];
export const reportEnvironment=env=>Object.fromEntries(REPORT_ENV_KEYS.filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
