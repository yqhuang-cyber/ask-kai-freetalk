// Authored expectations are evaluation-only. Never import this into Agent Core.
export function checkPlanningBehavior(actual,expect) {
  const checks=[];
  const check=(name,passed)=>checks.push({name,passed});
  if(Object.hasOwn(expect,'goal'))check('goal_selection',actual.goal===expect.goal);
  if(expect.goals)check('eligible_goal_selection',expect.goals.includes(actual.goal));
  if(expect.status)check('goal_status',actual.status===expect.status);
  if(expect.actions)check('next_action',expect.actions.includes(actual.action));
  if(Object.hasOwn(expect,'new_points'))check('teaching_density',actual.new_points===expect.new_points);
  if(Object.hasOwn(expect,'local_help'))check('local_help_scope',actual.local_help===expect.local_help);
  return {checks,passed:checks.every(c=>c.passed),semantic_review:'pending',provider_compliance:'not_tested'};
}
