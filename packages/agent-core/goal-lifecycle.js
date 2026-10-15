import { immutable } from '../contracts/planning.js';
import { controlText } from './natural-teaching.js';

export const GOAL_POLICY_VERSION='kai-goal-lifecycle-v2';
export const SUCCESS_RULES=Object.freeze({
  'likes-independent-session-v1':{kp_id:'likes-expression',minimum_opportunities:2,required:['semantic_review','prompt_scope','different_contexts','independent_expression']},
  'time-independent-session-v1':{kp_id:'time-expression',minimum_opportunities:2,required:['semantic_review','prompt_scope','different_contexts','independent_expression']}
});
// These recognize explicit controls, not learner competence or arbitrary intent.
export function goalChoice(text,resource) {
  const t=controlText(text);
  if(/(?:怎么(?:说|讲)|什么意思)|\b(?:what does|how (?:do|can|would).*say)\b/iu.test(t))return {kind:'none',goal_id:null};
  if(/^(?:取消|移除|不再练)(?:这个|当前|原来的)?(?:目标|练习)[。！!\s]*$/u.test(t)||/^cancel (?:this |the )?(?:goal|practice)[.!\s]*$/iu.test(t))return {kind:'retire',goal_id:null};
  const willing=/(?:我(?:现在)?(?:想|要|愿意)(?:继续)?|继续|改为|改成|换成|换个|换一个|想换成|想改成)(?:再)?(?:练习|练|学习|学)|\b(?:i want to (?:practice|learn)|let['’]?s (?:practice|learn)|switch to practicing)\b/iu.test(t);
  if(willing&&!/(?:不想|不要|不愿意|不练|不学)|\b(?:don['’]?t|do not|not want)\b/iu.test(t)) {
    const likes=/(?:喜好|喜欢(?:的表达|这个词)?|express(?:ing)? likes|preferences)/iu.test(t),time=/(?:时间(?:表达)?|运动安排|time expressions?)/iu.test(t);
    if(['topic-pack-v1','communication-skills-v1'].includes(resource?.schema_version)) {
      const phrases={'frequency-expression':['频率','每周次数'],'narrative-organization':['复杂经历','信息取舍'],'supporting-opinions':['具体论据','观点依据'],'qualified-claims':['限定观点','限定范围','观点范围'],'register-and-nuance':['措辞','语域'],'event-sequence':['事件顺序'],'comparison':['比较选项'],'simple-reasons':['说明原因']};
      const matches=resource.goals.filter(g=>t.includes(g.label)||t.includes(g.id)||g.kp_ids.some(id=>t.includes(id)||(phrases[id]??[]).some(p=>t.includes(p))));
      if(matches.length===1)return {kind:'select',goal_id:matches[0].id};
      if(likes!==time){const kp=likes?'likes-expression':'time-expression',goal=resource.goals.find(g=>g.kp_ids.includes(kp));if(goal)return {kind:'select',goal_id:goal.id};}
    } else if(likes!==time)return {kind:'select',goal_id:likes?'express-likes':'express-time'};
  }
  if(/^(?:这个(?:目标|练习)?(?:对我)?太难了|(?:这个|这句|这个练习)我(?:还是)?不会|这个练习我(?:还是)?说不出来)[。！!\s]*$/u.test(t)||/^(?:this (?:goal|practice) is too hard|i still can['’]?t do this practice)[.!\s]*$/iu.test(t))return {kind:'difficulty',goal_id:null};
  return {kind:'none',goal_id:null};
}
export function eligibleGoal(goal,context,resource,{explicit=false}={}) {
  if(!goal||!resource)return false;
  if(!explicit&&context.learning_history.some(h=>h.declined_goal_ids.includes(goal.id)))return false;
  return goal.kp_ids.every(id=>resource.key_points.find(k=>k.id===id)?.prerequisites.every(prior=>context.learning_profile.kp_states.some(s=>s.kp_id===prior&&['demonstrated_independent','demonstrated_transfer'].includes(s.evidence_state))));
}
export function assessGoal(goal,observations=[]) {
  const rule=SUCCESS_RULES[goal?.success_rule_ref];
  const rows=observations.filter(o=>o.goal_id===goal?.id);
  // Attempted ASR facts never satisfy independent semantic/context evidence.
  return immutable({goal_id:goal?.id??null,success_rule_ref:goal?.success_rule_ref??'unassessed',status:'unverified',attempt_count:rows.length,observation_refs:rows.slice(-12).map(o=>o.observation_id),missing:rule?[...(rows.length<rule.minimum_opportunities?['minimum_opportunities']:[]),...rule.required]:['supported_success_rule'],mastery_assessed:false});
}
export function checkGoalPatch(patch,{plan,context,resource,choice,policy,input,review}) {
  if(patch===null)return;
  const op=typeof patch==='string'?patch:patch.op;
  if(op==='pause')return;
  if(op==='resume') {
    if(!plan.primary_goal||plan.goal_status!=='paused'||policy.teaching_paused||!['student_requested_practice','student_requested_help'].includes(policy.reason)||!eligibleGoal(plan.primary_goal,context,resource,{explicit:true}))throw new Error('GOAL_RESUME_REQUIRES_CHOICE');
    return;
  }
  if(!patch.refs.includes(input.source_event_id))throw new Error('GOAL_PATCH_REQUIRES_CURRENT_INPUT');
  if(op==='retire') {
    if(choice.kind!=='retire'||!plan.primary_goal||patch.goal_id!==plan.primary_goal.id)throw new Error('GOAL_RETIRE_REQUIRES_CHOICE');
    return;
  }
  if(op==='replace') {
    const goal=resource?.goals.find(g=>g.id===patch.goal_id);
    const explicit=choice.kind==='select'&&choice.goal_id===patch.goal_id;
    const easier=choice.kind==='difficulty'&&review.difficulty_count>=2&&plan.primary_goal?.kp_ids.some(id=>resource.key_points.find(k=>k.id===id)?.prerequisites.some(kp=>goal?.kp_ids.includes(kp)));
    if(policy.action==='CLOSE'||policy.teaching_paused&&!explicit&&!easier||!explicit&&!easier)throw new Error('GOAL_REPLACEMENT_REQUIRES_CHOICE');
    if(!explicit&&review.session_declined_goal_ids?.includes(goal?.id))throw new Error('SESSION_DECLINED_GOAL_FORBIDDEN');
    if(!eligibleGoal(goal,context,resource,{explicit}))throw new Error('GOAL_REPLACEMENT_RESOURCE_OR_PREREQUISITE');
    return;
  }
  throw new Error('INVALID_GOAL_PATCH');
}
