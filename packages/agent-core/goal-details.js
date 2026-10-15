import { boundedText } from '../contracts/planning.js';

// Compile learner-visible details from the accepted plan and its pinned resource.
// IDs remain on the plan; labels must come from the same authorized resource.
export function goalDetails(plan,resource) {
  const goal=plan.primary_goal;
  if(!goal)return null;
  const ids=plan.key_points;
  const points=ids?.map(id=>resource?.key_points.find(k=>k.id===id));
  const task=plan.teaching_decision?.task??plan.goal_instance?.task??goal.start_tip;
  if(!points?.length||ids.length!==goal.kp_ids.length||!goal.kp_ids.every(id=>ids.includes(id))||!points.every(k=>k&&boundedText(k.label,100))||!boundedText(task,200))throw new Error('INCOMPLETE_GOAL_DETAILS');
  return {goal_id:goal.id,status:plan.goal_status,key_points:points.map(({id,label})=>({id,label})),expression_task:task};
}
