// Project only actual provider measurements. No uncalibrated score threshold is
// used to label a pronunciation error or infer a learner level.
export function audioReport(result){
  const clips=result.assessments.map(a=>({segment_id:a.audio.id,mode:a.mode,reference_text:a.reference?.text??null,duration_ms:(a.audio.sample_end-a.audio.sample_start)/16,
    accuracy:a.accuracy,fluency:a.fluency,reference_basis:a.reference?.basis??null,source_basis:a.audio.source_verification_hash?'automatic_mic_checks':a.audio.source_review_hash?'teacher_listening_declaration':'verified_test_source',
    words:a.words.slice(0,60).map(w=>({word:w.word,accuracy:w.accuracy,fluency:w.fluency,tone:w.tone,phones:w.phones.map(p=>({phone:p.phone,accuracy:p.accuracy})),range_ms:w.range?{start:(w.range.start-a.audio.sample_start)/16,end:(w.range.end-a.audio.sample_start)/16}:null}))}));
  const words=clips.flatMap(c=>c.words),tones=words.filter(w=>w.tone),phones=words.flatMap(w=>w.phones);
  return {schema_version:'audio-report-v1',status:'review_required',assessed_segments:clips.length,unassessed_segments:result.skipped.length,clips,
    dimensions:{accuracy:clips.some(c=>c.accuracy!==null)||words.some(w=>w.accuracy!==null)?'measured':'unavailable',fluency:clips.some(c=>c.fluency!==null)||words.some(w=>w.fluency!==null)?'measured':'unavailable',tone:tones.length?'measured':'unavailable',phones:phones.length?'measured':'unavailable'},
    tone_candidates:tones.length,unassessed_reasons:[...new Set(result.skipped.map(s=>s.reason))]};
}
