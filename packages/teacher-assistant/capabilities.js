export const CAPABILITIES=Object.freeze([
  {id:'order_food',label:'表达点单意图',kinds:['dining'],rule:'dining-order-v1'},
  {id:'taste_preference',label:'表达口味要求',kinds:['dining'],rule:'dining-taste-v1'},
  {id:'describe_appearance',label:'描述外观特征',kinds:['description','freeform'],rule:'unassessed'},
  {id:'describe_environment',label:'交流环境或习性',kinds:['description','freeform'],rule:'unassessed'},
  {id:'narrate_experience',label:'讲述一段经历',kinds:['story','freeform'],rule:'unassessed'},
  {id:'use_target_pattern',label:'在情境中尝试指定句式',kinds:['story'],rule:'unassessed'},
  {id:'ask_clarify',label:'提问或请求澄清',kinds:['dining','description','story','freeform'],rule:'unassessed'},
  {id:'express_preference',label:'表达个人选择和理由',kinds:['dining','description','story','freeform'],rule:'unassessed'}
]);
