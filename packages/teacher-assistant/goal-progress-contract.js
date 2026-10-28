import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const check=value=>{if(!value)throw new Error('INVALID_GOAL_PROGRESS');};
// This validates a host-created progress snapshot against its retained sources.
// It does not turn a model's semantic interpretation into a formal assessment.
export function validateGoalProgress(progress,plan,evidence){
  check(progress&&progress.policy_version==='homework-goal-turn-v1'&&progress.plan_hash===evidence.plan_hash&&(!plan||plan.hash===progress.plan_hash));
  check(progress.path==='next_turn_advisory'&&progress.controlled_execution===false&&progress.mastery==='unassessed'&&progress.pronunciation==='unassessed');
  check(['not_started','pending','control','reviewed','degraded'].includes(progress.review_state));
  check(Array.isArray(progress.sources)&&progress.sources.length<=9&&progress.source_hash===hash(progress.sources));
  const sources=new Map();
  for(const s of progress.sources){
    check(s&&typeof s.id==='string'&&!sources.has(s.id)&&typeof s.event_id==='string'&&typeof s.turn_id==='string'&&typeof s.text==='string'&&s.text.length<=400&&!s.truncated&&s.kind==='content');
    check(s.role==='learner'?s.status==='final':s.role==='kai'&&s.status==='completed');sources.set(s.id,s);
  }
  check([...sources.values()].filter(s=>s.role==='learner').length<=evidence.final_turns);
  check(Array.isArray(progress.goals)&&progress.goals.length>=1&&progress.goals.length<=3&&new Set(progress.goals.map(g=>g.goal_id)).size===progress.goals.length&&(!plan||progress.goals.length===plan.goals.length));
  for(const g of progress.goals){
    check((!plan||plan.goals.some(p=>p.id===g.goal_id))&&['observed','not_yet','uncertain'].includes(g.status)&&g.support_basis==='unknown'&&Array.isArray(g.evidence)&&g.evidence.length<=3);
    check(g.status==='observed'?g.evidence.some(r=>r.role==='learner'):g.evidence.length===0);
    for(const ref of g.evidence){const s=sources.get(ref.source_id);check(s&&ref.role===s.role&&ref.event_id===s.event_id&&ref.turn_id===s.turn_id&&Number.isSafeInteger(ref.start)&&Number.isSafeInteger(ref.end)&&ref.start>=0&&ref.end>ref.start&&ref.end<=s.text.length&&ref.end-ref.start<=160&&ref.quote===s.text.slice(ref.start,ref.end));if(s.role==='learner')check(/\p{Script=Han}/u.test(ref.quote));}
  }
  check(progress.all_observed===(progress.review_state==='reviewed'&&progress.goals.every(g=>g.status==='observed')));
  check(progress.active_goal_id===null||progress.goals.some(g=>g.goal_id===progress.active_goal_id));
  check(['elicit','support','offer_finish','extend'].includes(progress.next_action));
  return progress;
}
export function projectGoalProgress(progress){
  if(!progress)return null;
  const {sources,source_hash,...view}=progress;return structuredClone(view);
}
