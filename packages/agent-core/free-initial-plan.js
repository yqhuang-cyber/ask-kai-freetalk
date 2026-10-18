import { isObject,immutable } from '../contracts/planning.js';

export const FREE_INITIAL_FIELDS=Object.freeze(['conversation_purpose','content_focus','opening_options','strategy','selection_basis']);
export const FREE_INITIAL_GOAL_FIELDS=Object.freeze(['primary_goal_id','candidate_goal_ids','key_points']);
const INPUT_FIELDS=['entry','student_profile','learning_profile','learning_history','coverage','history_page','snapshot_ref','speaking_constraints','required_strategy'];

// Keep authored learner evidence without offering the turn-only skill catalogue
// as candidates to the initial conversation planner.
export function freeInitialInput(input) {
  const initial=Object.fromEntries(INPUT_FIELDS.filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]));
  const available_refs=[input.snapshot_ref,...(input.entry?.opening_request?['initial-choice']:[]),...(input.student_profile?.interests??[]).map(row=>row.record_id),...(input.learning_profile?.kp_states??[]).map(row=>row.record_id),...(input.learning_history??[]).map(row=>row.record_id)].filter(id=>typeof id==='string');
  return {...initial,available_refs:[...new Set(available_refs)]};
}

export function assertNoFreeInitialGoalFields(proposal) {
  if(!isObject(proposal))return;
  const fields=FREE_INITIAL_GOAL_FIELDS.filter(key=>Object.hasOwn(proposal,key));
  if(fields.length){const error=new Error('FREE_INITIAL_GOAL_FORBIDDEN');error.invalid_fields=fields;throw error;}
}

// Shared host compiler: never silently discard a model's goal, even if empty.
export function compileFreeInitialPlan(proposal) {
  assertNoFreeInitialGoalFields(proposal);
  if(!isObject(proposal)||Object.keys(proposal).length!==FREE_INITIAL_FIELDS.length||!FREE_INITIAL_FIELDS.every(key=>Object.hasOwn(proposal,key)))throw new Error('INVALID_CONVERSATION_PROPOSAL');
  return immutable({...proposal,primary_goal_id:null,candidate_goal_ids:[],key_points:[]});
}

export const FREE_INITIAL_RULES='当前只规划 free 自由聊天的交流方式。只输出 conversation_purpose、content_focus、opening_options、strategy、selection_basis 五个字段，子字段严格服从当前契约。按兴趣和近期实例选择有来源的交流入口，按听力和当前需要选择帮助程度与说话难度。没有选正式教学目标的任务，不输出 primary_goal_id、candidate_goal_ids、key_points，即使值为 null 或空数组也不输出；这些由宿主固定补齐。学习困难用于调整交流方式，不能变成必做练习。开场最多两个候选，实际只选一个。语言支架、纠错和语速必须遵守 required_strategy；仅在契约声明这三个子字段时逐字复制，否则由宿主绑定。support_level 只选 none/partial/model/unknown。';
export const FREE_INITIAL_REASONING='未知或历史截断不等于不会，课程完成不等于已认识所有词。画像兴趣只说明内容，不是学生同意练习。开场、内容和理由使用自然语言，不朗读内部标识，不宣称掌握、独立表现或发音准确。所有 refs 只填写 available_refs 清单中的实际 ID 值，不填 student_profile 或 learning_profile 等字段名。没有分项 record_id 时引用 snapshot_ref 的实际值。开场给学生接话空间，不重复教已稳定基础，不把高等级理解为必须堆生词。';
export function freeInitialRepairHint(code) {
  return `上次校验失败，原因：${code}。按当前输出契约重新生成；移除 primary_goal_id、candidate_goal_ids、key_points 三个字段，宿主会补齐空目标，不要再挑一个目标。refs 使用输入中现有的实际来源 ID，继续保留完整说话难度。`;
}
