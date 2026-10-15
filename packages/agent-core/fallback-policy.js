import { eligibleGoal } from './goal-lifecycle.js';
export const FALLBACK_POLICY_VERSION='kai-planning-fallback-v3';
export function fallbackDecision(input) {
  const resource=input.skill_catalog??input.resource;
  const p=input.policy,close=p.action==='CLOSE',clarify=p.action==='CLARIFY_INTENT';
  const declined=input.goal_review?.session_declined_goal_ids??[];
  const easier=!close&&!p.teaching_paused&&input.goal_review?.difficulty_count>=2?resource?.goals.find(g=>!declined.includes(g.id)&&eligibleGoal(g,{learning_profile:input.learning_profile,learning_history:input.learning_history??[]},resource)&&input.plan.primary_goal?.kp_ids.some(id=>resource.key_points.find(k=>k.id===id).prerequisites.some(kp=>g.kp_ids.includes(kp)))):null;
  const choice=(code,task,support='none',action='RESPOND')=>({code,task,support,action,localHelp:false,easier:null});
  if(close)return choice('student_end_rule','简短告别，不追加提问、复盘或练习','none','CLOSE');
  if(clarify)return choice('fallback_necessary_clarification','只问一个必要的短澄清问题，依据实际前文；不猜词义或能力','choice','CLARIFY');
  if(easier)return {...choice('repeated_explicit_difficulty','承认当前练习困难，给一个更小的低压选择；不强制跟读或声称学生不会','choice'),easier};
  if(input.learner_feedback?.signal==='difficulty_report'||input.goal_review?.difficulty_count>0)return choice('fallback_student_difficulty','承认学生觉得当前练习困难，降低这一轮负担；最多一个低压选择，不要求重说完整句','choice');
  if(['student_declined','student_changed_topic'].includes(p.reason))return choice('fallback_respect_current_choice','接住学生当前选择的话题，暂停旧练习；不要求理由、不邀请重试或恢复旧目标');
  if(p.reason==='student_understanding_help')return choice('fallback_understanding_help','只解释学生当前所问的一处含义，依据实际前文；不追加新示范、跟读或新问题','partial');
  if(p.reason==='student_requested_help')return {...choice('fallback_local_expression_help','只帮助本轮请求的一个表达，给最小可用支架；不扩成整场任务、不自动恢复旧练习','partial'),localHelp:true};
  if(p.reason==='student_requested_practice')return choice(input.plan?.goal_status==='active'?'fallback_requested_practice':'fallback_unverified_practice_choice',input.plan?.goal_status==='active'?'接住学生明确练习意愿，围绕当前已确认目标给一个低压入口；不提高目标或强制跟读':'承接学生的练习意愿，只确认一个必要选择；不恢复原目标或擅自改练其他目标','choice');
  if(p.reason==='student_continuation_help')return choice('fallback_continuation_help','复用实际前文给一个最小话题入口或短承接；不增加句型或安排新练习','choice');
  if(/^(?:老师|他|她|Kai)(?:说|告诉我)/iu.test(input.turn.text?.trim()??''))return choice('fallback_reported_content','承接学生转述的当前内容，不把转述句记为学生本人的喜好、能力或目标尝试');
  if(input.learner_feedback?.signal==='supported_attempt')return choice('fallback_follow_observed_content','接住学生刚表达的具体内容，给有内容的回应，再按语境补充观察或自然追问；不重复完整示范，不称独立或掌握，可以不提问','none','FOLLOW_UP');
  if(p.teaching_paused)return choice('fallback_paused_conversation','先回应当前交流的具体内容，再按语境补充或自然追问，保留旧目标暂停；关键词不构成恢复许可');
  return choice('conservative_planner_fallback','先接住学生当前的具体内容、问题或感受，再按语境补充相关观察、解释或自然追问；不只泛泛确认，不新增目标或强制练习；不确定时低压承接','none',input.goal_review?.assessment?.attempt_count>0?'FOLLOW_UP':'RESPOND');
}
