// Readiness remains conservative even after adapter implementation. No network or audio access here.
export const TENCENT_PROFILE='tencent-soe-v2-zh-validation-v1';
export const TENCENT_CASES=Object.freeze([
  {id:'natural-free',mode:3,reference:'none',question:'自然语音准确度、流利度及可用定位字段',required:true},
  {id:'verified-sentence',mode:1,reference:'author_verified',question:'核对参考短句后，音素与有效声调字段',required:true},
  {id:'wrong-asr-reference',mode:1,reference:'deliberately_wrong',question:'错误 ASR 参考对诊断的污染；必须拒绝直接反馈',required:true},
  {id:'tone-sandhi-neutral',mode:1,reference:'author_verified',question:'声调、轻声、变调，与专业标注分别核对',required:true},
  {id:'noise-clipping-overlap',mode:3,reference:'none',question:'低质量与重叠声音是否正确降为待核对 / 不评',required:true},
  {id:'silence-format-limit',mode:3,reference:'none',question:'无声、编码、时长边界及失败回执',required:true}
]);
export function tencentReadiness(env={}){
  const credentials=Object.fromEntries(['TENCENT_SOE_APP_ID','TENCENT_SOE_SECRET_ID','TENCENT_SOE_SECRET_KEY'].map(k=>[k,typeof env[k]==='string'&&env[k].trim().length>0]));
  return {profile:TENCENT_PROFILE,source:'adapter_implemented_live_validation_pending',credentials_present:credentials,service_enabled:'unverified',author_audio:'not_provided',
    live_call_performed:false,acoustic_validation:'pending',ready_for_learner_reports:false,
    missing_configuration:Object.keys(credentials).filter(k=>!credentials[k]),
    format:{sample_rate:16000,bits:16,channels:1},
    modes:{free_speech:{eval_mode:3,reference_required:false,phoneme:'unverified',tone:'unverified',fluency:'documented_not_validated'},sentence:{eval_mode:1,max_hanzi:30,phoneme:'documented_not_validated',tone:'documented_not_validated',reference:'must_be_independently_verified'}},
    transport:{recording_mode_max_seconds:60,mode_combination:'requires_live_test',streaming:'paced_40ms_frames_not_instant_upload'},
    cases:TENCENT_CASES,decision:'Stage C adapter implemented; credentials, author audio and AUD-01 / AUD-02 live admission remain required'};
}
