import { validateCurriculum,validateLearnerContext } from '../../../packages/contracts/planning.js';
const goals=[{id:'express-likes',label:'在交流中表达运动喜好',kp_ids:['likes-expression'],start_tip:'我喜欢……',card_ids:['likes-card'],success_rule_ref:'likes-independent-session-v1'},{id:'express-time',label:'用简单时间表达聊运动安排',kp_ids:['time-expression'],start_tip:'我下午……',card_ids:['afternoon-card'],success_rule_ref:'time-independent-session-v1'}];
const resource={schema_version:'curriculum-v1',id:'sports',version:'mock-sports-v3',kind:'topic',title:'运动',source:'mock_hskai',content:'运动喜好与日常运动安排；候选目标独立选择，学生可换题。',goals,key_points:[{id:'likes-expression',label:'表达喜好',evidence_rule:'likes-attempt-v1',prerequisites:[],examples:['我喜欢足球。','我喜欢篮球。','我喜欢跑步。']},{id:'time-expression',label:'简单时间表达',evidence_rule:'time-attempt-v1',prerequisites:['likes-expression'],examples:['我下午打篮球。','我上午跑步。']}],cards:[{id:'likes-card',word:'喜欢',pinyin:'xǐ huān',english:'to like',example:'我喜欢……。'},{id:'afternoon-card',word:'下午',pinyin:'xià wǔ',english:'afternoon',example:'我下午运动。'}]};
export const SPORTS_RESOURCE=validateCurriculum(resource);
export function missionResource(mission) {
  if(!mission)return null;
  // Only the authored mock fixture has these KP definitions. Arbitrary signed
  // course titles cannot manufacture curriculum or evidence rules.
  if(mission.id!=='poc-sports-mission')return null;
  return validateCurriculum({...resource,id:mission.id,kind:'mission',version:'mock-mission-v3',title:mission.title,content:'示例已完成 Mission；运动喜好与时间表达。活动完成不代表能力掌握。'});
}
export function learnerFixture(identity,{variant='a',revision=1,memory=[],now=Date.now(),records=[]}={}) {
  const updated_at=new Date(now).toISOString(),provenance=id=>({record_id:id,source:'mock_hskai',updated_at});
  const value=(field,fallback)=>memory.find(m=>m.field===field)?.value??fallback;
  const independent=variant==='b',empty=variant==='d',declined=variant==='e',interest=value('interest',variant==='c'?'跑步':'篮球');
  const kp_states=empty?[]:[{...provenance('kp-likes'),kp_id:'likes-expression',skill_dimension:'oral_expression',evidence_state:independent?'demonstrated_independent':'prompted_attempt',support_needed:independent?'none':'model',evidence_refs:['history-sports']}];
  if(independent)kp_states.push({...provenance('kp-time'),kp_id:'time-expression',skill_dimension:'oral_expression',evidence_state:'prompted_attempt',support_needed:'partial',evidence_refs:['history-time']});
  const history=empty?[]:[{...provenance('history-sports'),activity_type:'ask_kai',resource_id:'sports',kp_ids:['likes-expression'],observations:[independent?'合成后端证据：本次独立表达喜好':'合成后端证据：提示后尝试喜好表达'],declined_goal_ids:declined?['express-likes']:[],complete:true}];
  if(independent)history.unshift({...provenance('history-time'),activity_type:'lesson',resource_id:'sports',kp_ids:['time-expression'],observations:['时间表达需要局部支架'],declined_goal_ids:[],complete:true});
  for(const record of records)history.unshift({...provenance(record.receipt_id),activity_type:'ask_kai',resource_id:record.record.resource_ref?.id??'free',kp_ids:[...new Set(record.record.observations.map(o=>o.kp_id))],observations:['本地 mock 已保存限定会话的表达尝试；未评估掌握'],declined_goal_ids:[],complete:record.record.outcome==='ended'});
  return validateLearnerContext({schema_version:'learner-context-v1',snapshot_id:`ctx-${identity.learner_id}-${revision}`,owner_id:identity.owner_id,learner_id:identity.learner_id,revision,as_of:updated_at,source:'mock_hskai',coverage:{student_profile:'available',learning_profile:empty?'partial':'available',learning_history:empty?'unavailable':history.length>10?'partial':'available'},history_page:{truncated:history.length>10,next_cursor:history.length>10?'more-history':null},student_profile:{preferred_name:null,age_band:'adult',native_language:'en',interests:interest?[{...provenance('interest-sports'),topic_id:'sports',label:interest}]:[],avoided_topics:[],conversation_preferences:{correction:value('correction_preference','gentle'),pace:'slow'}},learning_profile:{course_level:'HSK1',language_support:value('support_language','auto'),comprehension:value('chinese_comprehension','beginner'),kp_states,review_candidates:independent?['time-expression']:[],reported_known_expressions:value('known_expressions',[])},learning_history:history.slice(0,10)},identity,now);
}
