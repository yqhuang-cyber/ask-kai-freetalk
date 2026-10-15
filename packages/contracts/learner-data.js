import { validateSyllabusInventory } from './hsk-inventory.js';
import { exact,isId,immutable,validateLearnerContext } from './planning.js';
export const LEARNER_PARTS=Object.freeze({
  'personal-profile':{field:'student_profile',scope:'profile:read'},
  'learning-profile':{field:'learning_profile',scope:'learning-profile:read'},
  'learning-history':{field:'learning_history',scope:'learning-history:read'}
});
const emptyProfile=()=>({preferred_name:null,age_band:null,native_language:null,interests:[],avoided_topics:[],conversation_preferences:{correction:'gentle',pace:'slow'}});
const emptyLearning=()=>({course_level:'unknown',language_support:'auto',comprehension:'unknown',kp_states:[],review_candidates:[],reported_known_expressions:[]});
export function learnerPart(context,part,fixtureVersion='legacy-fixture-v1',inventory) {
  if(!Object.hasOwn(LEARNER_PARTS,part))throw new Error('INVALID_LEARNER_PART');
  const field=LEARNER_PARTS[part].field;
  return immutable({schema_version:'learner-part-v1',part,uid:context.learner_id,owner_id:context.owner_id,learner_id:context.learner_id,snapshot_id:context.snapshot_id,revision:context.revision,fixture_version:fixtureVersion,as_of:context.as_of,source:'mock_hskai',coverage:context.coverage[field],data:context[field],...(part==='learning-history'?{history_page:context.history_page}:{}),...(inventory?{inventory}:{})});
}
export function validateLearnerPart(v,part,identity,now=Date.now()) {
  if(!Object.hasOwn(LEARNER_PARTS,part)||!exact(v,['schema_version','part','uid','owner_id','learner_id','snapshot_id','revision','fixture_version','as_of','source','coverage','data',...(part==='learning-history'?['history_page']:[]),...(part==='learning-profile'?['inventory']:[])])||v.schema_version!=='learner-part-v1'||v.part!==part||v.uid!==identity.learner_id||!isId(v.fixture_version))throw new Error('INVALID_LEARNER_PART');
  const context={schema_version:'learner-context-v1',snapshot_id:v.snapshot_id,owner_id:v.owner_id,learner_id:v.learner_id,revision:v.revision,as_of:v.as_of,source:v.source,coverage:{student_profile:'unavailable',learning_profile:'unavailable',learning_history:'unavailable'},history_page:v.history_page??{truncated:false,next_cursor:null},student_profile:emptyProfile(),learning_profile:emptyLearning(),learning_history:[]};
  const field=LEARNER_PARTS[part].field;context[field]=v.data;context.coverage[field]=v.coverage;
  validateLearnerContext(context,identity,now);
  if(part==='learning-profile'&&v.data.syllabus_summary!==undefined&&v.inventory===undefined)throw new Error('HSK_INVENTORY_REQUIRED');
  if(v.inventory!==undefined){validateSyllabusInventory(v.inventory,identity,now);const {grammar_points,course_evidence,...summary}=v.inventory;if(JSON.stringify({...summary,inventory_scope:'full_service_catalog',conversation_kp_limit:20})!==JSON.stringify(v.data.syllabus_summary))throw new Error('HSK_INVENTORY_SUMMARY_MISMATCH');}
  return immutable(v);
}
export function assembleLearnerContext(parts,identity,now=Date.now()) {
  const checked=Object.keys(LEARNER_PARTS).map(part=>validateLearnerPart(parts[part],part,identity,now));
  const first=checked[0];
  if(checked.some(p=>p.snapshot_id!==first.snapshot_id||p.revision!==first.revision||p.fixture_version!==first.fixture_version))throw new Error('LEARNER_SNAPSHOT_CHANGED');
  const history=parts['learning-history'];
  if(history.coverage==='available'&&!history.history_page.truncated) {
    const references=new Set(history.data.map(h=>h.record_id));
    if(parts['learning-profile'].data.kp_states.some(k=>k.evidence_refs.some(ref=>!references.has(ref))))throw new Error('LEARNER_EVIDENCE_REFERENCE_MISSING');
  }
  return validateLearnerContext({schema_version:'learner-context-v1',snapshot_id:first.snapshot_id,owner_id:first.owner_id,learner_id:first.learner_id,revision:first.revision,as_of:first.as_of,source:first.source,coverage:Object.fromEntries(checked.map(p=>[LEARNER_PARTS[p.part].field,p.coverage])),history_page:parts['learning-history'].history_page,...Object.fromEntries(checked.map(p=>[LEARNER_PARTS[p.part].field,p.data]))},identity,now);
}
