// The published task describes the meaning; this contract fixes language and
// modality, while accepting natural variants instead of a prescribed sentence.
export const GOAL_CONTRACT_VERSION='chinese-output-v1';
const authored={
  order_food:'用中文表达一种食物选择；在明确点单问题后，“面条”等简短回答也可。接受不同食物和合理说法，不要求照读例句。',
  taste_preference:'用中文表达一种口味要求，如“不要辣”“清淡一点”。可与点单分两轮表达，接受合理变体。'
};
export function validOutputRequirement(value){
  return !!value&&Object.keys(value).length===3&&value.language==='zh'&&value.modality==='spoken'&&typeof value.acceptance==='string'&&value.acceptance.trim().length>0&&value.acceptance.length<=240;
}
export function outputRequirement(goal){
  if(validOutputRequirement(goal.output_requirement))return {...goal.output_requirement,source:'published'};
  // Old immutable publications are read as old publications, never rewritten.
  return {language:'zh',modality:'spoken',acceptance:authored[goal.id]??'围绕已发布任务，用中文表达相关信息；接受上下文中的简短回答和合理变体，不要求机械复读。',source:'legacy_runtime_default'};
}
export function authoredOutputRequirement(id){return {language:'zh',modality:'spoken',acceptance:authored[id]};}
