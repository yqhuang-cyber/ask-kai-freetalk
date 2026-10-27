import {ConversationReportAnalyzer,MiniMaxReportTransport} from '../../packages/teacher-assistant/deep-analysis/semantic.js';
import {syntheticRecord} from '../../tests/helpers/teaching-record.js';
const live=process.argv.includes('--live');
if(!live){console.log(JSON.stringify({source:'authored_synthetic_text_only',provider:'minimax',configured:!!process.env.MINIMAX_API_KEY,live_call_performed:false,learner_material_used:false}));}
else{
  try{
    const record=syntheticRecord({rounds:2}),plan={pack:{topic:'昆虫'},goals:[{label:'描述看到的昆虫',task:'分享颜色和位置',criterion:'给出与问题相关的信息'}]};
    const analyzer=new ConversationReportAnalyzer({transport:new MiniMaxReportTransport({apiKey:process.env.MINIMAX_API_KEY,baseURL:process.env.MINIMAX_BASE_URL,model:process.env.ASK_KAI_TA_REPORT_TEXT_MODEL??'MiniMax-M3'})});
    const result=await analyzer.analyze(plan,record);
    console.log(JSON.stringify({provider:result.provider,model:result.model,analyzer_version:result.analyzer_version,prompt_version:result.prompt_version,live_call_performed:true,input:'authored_synthetic_insect_dialogue',learner_material_used:false,windows:result.coverage.windows,candidate_count:result.candidates.length,dimensions:[...new Set(result.candidates.map(c=>c.dimension))],all_candidates_require_review:result.candidates.every(c=>c.status==='review_required'),duration_ms:result.duration_ms,teaching_quality_accepted:false}));
    if(!result.candidates.length||result.coverage.windows.some(w=>w.state!=='complete'))process.exitCode=1;
  }catch(e){console.error(JSON.stringify({provider:'minimax',live_call_attempted:true,input:'authored_synthetic_text_only',error:/^[A-Z_]+$/.test(e.message)?e.message:'REPORT_PROBE_FAILED'}));process.exitCode=1;}
}
