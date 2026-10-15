import { immutable } from '../contracts/planning.js';
// General communication capabilities, independent of topics and learner grades.
export const SKILL_CATALOG_VERSION='kai-communication-v2';
const skills=[
  ['likes-expression','表达喜好',[]],['time-expression','表达时间',[]],
  ['frequency-expression','表达频率',[]],['past-experience','叙述经历',[]],
  ['event-sequence','组织事件顺序',['past-experience']],
  ['narrative-organization','选择关键信息并组织复杂经历',['event-sequence']],
  ['simple-reasons','说明原因',[]],['comparison','比较选项',[]],
  ['pros-and-cons','权衡利弊',['comparison']],
  ['supporting-opinions','用具体理由和例子支持观点',['simple-reasons']],
  ['conditional-reasoning','说明条件',['simple-reasons']],
  ['qualified-claims','限定观点的适用范围',['supporting-opinions']],
  ['counterargument','回应不同意见',['supporting-opinions']],
  ['register-and-nuance','调整语域与措辞',['supporting-opinions']],
  ['tradeoff-argument','解释取舍',['pros-and-cons']]
];
export const SKILL_CATALOG=immutable(skills.map(([id,label,prerequisites])=>({id,label,prerequisites,evidence_rule:'unassessed'})));
export const skillById=id=>SKILL_CATALOG.find(s=>s.id===id);

// Host-owned capabilities are not a curriculum or a Topic Pack. Free practice
// uses the live conversation for content; unsupported observations stay unknown.
export const FREE_PRACTICE_CATALOG=immutable({
  schema_version:'communication-skills-v1',id:'kai-communication-skills',
  version:SKILL_CATALOG_VERSION,source:'host_policy',kind:'skills',
  key_points:SKILL_CATALOG,cards:[],
  goals:SKILL_CATALOG.map(skill=>({
    id:skill.id==='likes-expression'?'express-likes':skill.id==='time-expression'?'express-time':skill.id,
    label:skill.label,kp_ids:[skill.id],
    start_tip:`结合当前交流内容练习${skill.label}；需要时提供最小提示。`,
    card_ids:[],success_rule_ref:'unassessed'
  }))
});
export const planningCapabilities=(plan,resource)=>plan.mode==='free'?FREE_PRACTICE_CATALOG:resource;
