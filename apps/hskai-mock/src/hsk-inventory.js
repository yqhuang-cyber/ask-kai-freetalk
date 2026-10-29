import grammar from '../data/hsk-2025-grammar.json' with {type:'json'};
import vocabulary from '../data/hsk-2025-vocabulary.json' with {type:'json'};
import { immutable } from '../../../packages/contracts/planning.js';
export const HSK_REFERENCE=immutable({version:grammar.version,source_url:grammar.source_url,source_sha256:grammar.source_sha256,grammar_counts:grammar.counts_by_level,vocabulary_counts:vocabulary.counts_by_level});
const advancedMastered=new Set([7,10,11,12,13,14,15,16,17,20,21,22,23,24,27,28,30,34,37,38,43,44,45,46,47,48,49,51,55,56,57,60,62,63,64,72,79,86,88,92,95,97,98,99,100,101,102,103,104,105,106,107,109,110,111,112,114,116,119,121,123,124,125,126,127,128,129,130,131,132,133,134].map(n=>`hsk2025-g7-${String(n).padStart(3,'0')}`));
const advancedPractice=new Set([6,18,19,50,65,66,78,90,96,108,113,117,118,120,122].map(n=>`hsk2025-g7-${String(n).padStart(3,'0')}`));
export function syllabusInventory(identity,level,{fixtureAt=Date.now()}={}) {
  const completed=Number(level.replace('HSK','')),lower=completed===7?6:completed;
  const prior=Array.from({length:lower},(_,i)=>i+1),next=lower<6?String(lower+1):'7-9';
  const id=g=>`${identity.learner_id}-course-hsk${g}`;
  const offsets=({1:[20],3:[450,200,25],4:[900,500,180,40],5:[1250,1000,760,430,30],7:[2600,2200,1800,1300,900,450]})[completed];
  const evidence=prior.map(g=>({record_id:id(g),source:'mock_hskai',evidence_origin:'authored_fixture',level:String(g),result:'mock_completed',scope:'knowledge_recognition_and_controlled_use',updated_at:new Date(fixtureAt-offsets[g-1]*86400000).toISOString()}));
  if(completed===7)evidence.push({record_id:id(7),source:'mock_hskai',evidence_origin:'authored_fixture',level:'7-9',result:'mock_completed',scope:'authored_hsk7_subset_only',updated_at:new Date(fixtureAt-20*86400000).toISOString()});
  const selected=grammar.entries.filter(k=>k.introduced_level==='7-9'?completed>=6:Number(k.introduced_level)<=lower+1);
  const entries=selected.map(k=> {
    const advanced=k.introduced_level==='7-9',inherited=!advanced&&Number(k.introduced_level)<=lower;
    const state=inherited||completed===7&&advancedMastered.has(k.kp_id)?'mock_mastered':completed===7&&advancedPractice.has(k.kp_id)?'practicing':completed!==7&&k.introduced_level===next&&k.source_row<=8?'practicing':'not_started';
    return {...k,mastery_status:state,evidence_origin:'authored_fixture',evidence_refs:state==='mock_mastered'?[id(advanced?7:k.introduced_level)]:[]};
  });
  const perLevel=Object.fromEntries([...new Set(entries.map(k=>k.introduced_level))].map(g=>[g,{total:entries.filter(k=>k.introduced_level===g).length,mastered:entries.filter(k=>k.introduced_level===g&&k.mastery_status==='mock_mastered').length}]));
  const vocabularyCumulative=Object.entries(vocabulary.counts_by_level).filter(([g])=>g!=='7-9'&&Number(g)<=lower).reduce((s,[,n])=>s+n,0);
  return immutable({schema_version:'hsk-inventory-v1',catalog_version:grammar.version,source_url:grammar.source_url,source_sha256:grammar.source_sha256,grammar_unit:'syllabus_table_detail',completed_level:completed,completed_lower_levels:prior.filter(g=>g<completed),current_study_scope:completed===7?'7-9':String(completed+1),grammar_total:entries.length,grammar_mastered:entries.filter(k=>k.mastery_status==='mock_mastered').length,per_level:perLevel,vocabulary:{reference_cumulative:completed===7?11000:vocabularyCumulative,reference_scope:completed===7?'shared_7_to_9':'through_completed_level',completed_lower_level_entries:vocabularyCumulative,estimated_known_range:completed===7?[6500,7500]:[Math.round(vocabularyCumulative*.9),vocabularyCumulative],estimate_origin:'authored_fixture_not_measurement',catalog_ref:'hsk-2025-vocabulary'},course_evidence:evidence,grammar_points:entries});
}
export function inventorySummary(inventory) {
  const {grammar_points,course_evidence,...summary}=inventory;
  return {...summary,inventory_scope:'full_service_catalog',conversation_kp_limit:20};
}
