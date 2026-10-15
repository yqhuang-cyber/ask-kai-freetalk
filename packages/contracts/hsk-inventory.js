const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const LEVELS=['1','2','3','4','5','6','7-9'];
const GRAMMAR_COUNTS={1:70,2:78,3:96,4:95,5:70,6:49,'7-9':134};
const VOCAB_COUNTS={1:300,2:200,3:500,4:1000,5:1600,6:1800,'7-9':5600};
const baseKeys=['schema_version','catalog_version','source_url','source_sha256','grammar_unit','completed_level','completed_lower_levels','current_study_scope','grammar_total','grammar_mastered','per_level','vocabulary'];
export function validateSyllabusSummary(v,{full=false}={}) {
  if(!exact(v,[...baseKeys,...(full?['course_evidence','grammar_points']:['inventory_scope','conversation_kp_limit'])])||v.schema_version!=='hsk-inventory-v1'||v.catalog_version!=='hsk-2025-syllabus-v1'||v.grammar_unit!=='syllabus_table_detail'||![1,3,5,7].includes(v.completed_level)||typeof v.source_url!=='string'||!v.source_url.startsWith('https://hsk.cn-bj.ufileos.com/3.0/')||!/^([a-f0-9]{64})$/.test(v.source_sha256)||!integer(v.grammar_total)||v.grammar_total>700||!integer(v.grammar_mastered)||v.grammar_mastered>v.grammar_total)throw new Error('INVALID_HSK_INVENTORY');
  const lower=v.completed_level===7?6:v.completed_level,prior=Array.from({length:v.completed_level-1},(_,i)=>i+1);
  if(JSON.stringify(v.completed_lower_levels)!==JSON.stringify(prior)||v.current_study_scope!==(v.completed_level===7?'7-9':String(v.completed_level+1)))throw new Error('INVALID_HSK_INHERITANCE');
  if(!object(v.per_level)||Object.keys(v.per_level).some(g=>!LEVELS.includes(g))||!Object.entries(v.per_level).every(([g,n])=>exact(n,['total','mastered'])&&n.total===GRAMMAR_COUNTS[g]&&integer(n.mastered)&&n.mastered<=n.total)||Object.values(v.per_level).reduce((s,n)=>s+n.total,0)!==v.grammar_total||Object.values(v.per_level).reduce((s,n)=>s+n.mastered,0)!==v.grammar_mastered)throw new Error('INVALID_HSK_COUNTS');
  for(let n=1;n<=lower;n++)if(v.per_level[n]?.mastered!==GRAMMAR_COUNTS[n])throw new Error('MISSING_LOWER_LEVEL_MASTERY');
  const words=v.vocabulary,cumulative=LEVELS.filter(g=>g!=='7-9'&&Number(g)<=lower).reduce((s,g)=>s+VOCAB_COUNTS[g],0);
  if(!exact(words,['reference_cumulative','reference_scope','completed_lower_level_entries','estimated_known_range','estimate_origin','catalog_ref'])||words.reference_cumulative!==(v.completed_level===7?11000:cumulative)||words.completed_lower_level_entries!==cumulative||words.reference_scope!==(v.completed_level===7?'shared_7_to_9':'through_completed_level')||words.estimate_origin!=='authored_fixture_not_measurement'||words.catalog_ref!=='hsk-2025-vocabulary'||!Array.isArray(words.estimated_known_range)||words.estimated_known_range.length!==2||!words.estimated_known_range.every(integer)||words.estimated_known_range[0]>words.estimated_known_range[1]||words.estimated_known_range[1]>words.reference_cumulative)throw new Error('INVALID_HSK_VOCABULARY');
  if(!full&&(v.inventory_scope!=='full_service_catalog'||v.conversation_kp_limit!==20))throw new Error('INVALID_HSK_SUMMARY');
  return v;
}
export function validateSyllabusInventory(v,identity,now=Date.now()) {
  validateSyllabusSummary(v,{full:true});
  if(!Array.isArray(v.course_evidence)||v.course_evidence.length>7||!v.course_evidence.every(e=>exact(e,['record_id','source','evidence_origin','level','result','scope','updated_at'])&&id(e.record_id)&&e.record_id.startsWith(`${identity.learner_id}-course-`)&&e.source==='mock_hskai'&&e.evidence_origin==='authored_fixture'&&LEVELS.includes(e.level)&&e.result==='mock_completed'&&['knowledge_recognition_and_controlled_use','authored_hsk7_subset_only'].includes(e.scope)&&Number.isFinite(Date.parse(e.updated_at))&&Date.parse(e.updated_at)<=now))throw new Error('INVALID_HSK_COURSE_EVIDENCE');
  const refs=new Map(v.course_evidence.map(e=>[e.record_id,e]));
  if(refs.size!==v.course_evidence.length||!Array.isArray(v.grammar_points)||v.grammar_points.length!==v.grammar_total||new Set(v.grammar_points.map(k=>k.kp_id)).size!==v.grammar_total||!v.grammar_points.every(k=>exact(k,['kp_id','introduced_level','category','label','source_page','source_row','mastery_status','evidence_origin','evidence_refs'])&&id(k.kp_id)&&LEVELS.includes(k.introduced_level)&&typeof k.category==='string'&&k.category.length<=80&&typeof k.label==='string'&&k.label.length>0&&k.label.length<=120&&integer(k.source_page)&&k.source_page>=383&&k.source_page<=403&&integer(k.source_row)&&k.source_row>0&&['mock_mastered','practicing','not_started'].includes(k.mastery_status)&&k.evidence_origin==='authored_fixture'&&Array.isArray(k.evidence_refs)&&k.evidence_refs.length<=1&&(k.mastery_status==='mock_mastered'?k.evidence_refs.length===1&&refs.get(k.evidence_refs[0])?.level===k.introduced_level:k.evidence_refs.length===0)))throw new Error('INVALID_HSK_GRAMMAR_POINTS');
  for(const [g,n] of Object.entries(v.per_level))if(v.grammar_points.filter(k=>k.introduced_level===g).length!==n.total||v.grammar_points.filter(k=>k.introduced_level===g&&k.mastery_status==='mock_mastered').length!==n.mastered)throw new Error('INVALID_HSK_COUNTS');
  for(const k of v.grammar_points)if(k.introduced_level!=='7-9'&&Number(k.introduced_level)<=Math.min(6,v.completed_level)&&k.mastery_status!=='mock_mastered')throw new Error('MISSING_LOWER_LEVEL_MASTERY');
  return v;
}
