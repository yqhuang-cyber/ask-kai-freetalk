// Internal, bounded session recap. This is neither provider wire nor mastery data.
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const line=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function validateSessionRecap(v,sessionId) {
  const fail=()=>{throw new Error('INVALID_SESSION_RECAP');};
  if(!exact(v,['schema_version','session_id','revision','objective','knowledge_points','topics','coverage'])||v.schema_version!=='session-recap-v1'||v.session_id!==sessionId||!id(sessionId)||!Number.isSafeInteger(v.revision)||v.revision<1)fail();
  const o=v.objective;
  if(!exact(o,['purpose','initial_goal','goals','progress'])||!line(o.purpose,200)||o.initial_goal!==null&&!line(o.initial_goal,100)||!Array.isArray(o.goals)||o.goals.length>8||o.progress!=='unverified'||!o.goals.every(g=>exact(g,['id','label','status','plan_revision'])&&id(g.id)&&line(g.label,100)&&['active','paused','retired'].includes(g.status)&&Number.isSafeInteger(g.plan_revision)&&g.plan_revision>0))fail();
  if(!Array.isArray(v.topics)||v.topics.length>8||!v.topics.every(t=>line(t,80))||!Array.isArray(v.knowledge_points)||v.knowledge_points.length>24)fail();
  if(!v.knowledge_points.every(k=>exact(k,['id','type','text','meaning_or_usage','example','occurrence','source_refs'])&&id(k.id)&&['vocabulary','expression','usage'].includes(k.type)&&line(k.text,100)&&(k.meaning_or_usage===null||line(k.meaning_or_usage,160))&&(k.example===null||line(k.example,100))&&['discussed','teacher_demonstrated'].includes(k.occurrence)&&Array.isArray(k.source_refs)&&k.source_refs.length>0&&k.source_refs.length<=3&&k.source_refs.every(r=>exact(r,['turn_id','source_event_id','response_id'])&&id(r.turn_id)&&id(r.source_event_id)&&(r.response_id===null||id(r.response_id)))))fail();
  if(new Set(v.knowledge_points.map(k=>k.id)).size!==v.knowledge_points.length||!exact(v.coverage,['complete_inventory','truncated','mastery_assessed'])||v.coverage.complete_inventory!==false||typeof v.coverage.truncated!=='boolean'||v.coverage.mastery_assessed!==false)fail();
  return structuredClone(v);
}
export function validateConversationRecord(v) {
  if(!exact(v,['schema_version','session_id','summary','outcome','end_reason','summary_delivery'])||v.schema_version!=='conversation-record-v1'||!id(v.session_id)||!['ended','partial'].includes(v.outcome)||!['student_end','provider_closed','transport_closed','service_failure','session_limit'].includes(v.end_reason)||!['played','text_only','skipped','incomplete','advisory_played'].includes(v.summary_delivery))throw new Error('INVALID_CONVERSATION_RECORD');
  validateSessionRecap(v.summary,v.session_id);return structuredClone(v);
}
