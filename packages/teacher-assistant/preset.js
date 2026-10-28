import {VERSION,SCENARIO,digest,validPlan,requireThat,id} from './contracts.js';
import {GOAL_CONTRACT_VERSION,authoredOutputRequirement} from './output-requirements.js';
export class PresetPlanSource {
  async prepare(brief,learnerContext){
    requireThat(brief.topic==='dining','UNSUPPORTED_TOPIC');id(learnerContext.learner_id);
    const plan={schema_version:VERSION,scenario:SCENARIO,id:'dining-v1',version:1,source:'authored_fixture',learner_id:learnerContext.learner_id,
      pack:{id:'dining-pack',version:1,source:'authored_fixture',topic:'点餐',role:'餐厅服务员',menu:['面条','米饭','饺子'],opening:'欢迎光临！你想吃什么？'},
      goal_contract_version:GOAL_CONTRACT_VERSION,goals:[{id:'order_food',label:'点一种食物',task:'用中文点一种食物',criterion:'观察学生是否用中文表达了自己要点的食物。',output_requirement:authoredOutputRequirement('order_food'),observation_rule:'dining-order-v1'},{id:'taste_preference',label:'说明一种口味要求',task:'用中文说明一种口味要求',criterion:'观察学生是否用中文表达了自己的口味要求。',output_requirement:authoredOutputRequirement('taste_preference'),observation_rule:'dining-taste-v1'}],
      support:{allowed:['澄清','短句示范','按需简短英文'],independent_use_assessment:'unassessed'},planning_strategy:'fixed_task',assessment:'attempts_only',grade:null};
    plan.hash=digest(plan);return validPlan(plan);
  }
}
