import {mkdir,writeFile} from 'node:fs/promises';
import {HomeworkConversationController} from '../../packages/teacher-assistant/controller.js';
import {PresetPlanSource} from '../../packages/teacher-assistant/preset.js';
import {configuredHomeworkTurnPlanner} from '../../packages/teacher-assistant/turn-planner.js';

if(!process.argv.includes('--live'))console.log(JSON.stringify({live:false,model_calls:0,requires:'--live and a configured MiniMax; authored text only, no audio or learner data'}));
else{
  const planner=configuredHomeworkTurnPlanner({...process.env,ASK_KAI_TA_TURN_PROVIDER:'minimax'}),results=[];
  const plan=await new PresetPlanSource().prepare({topic:'dining'},{learner_id:'author-test-fixture'});
  let n=0;
  const controller=()=>new HomeworkConversationController({sessionId:'authored-probe-session-'+ ++n,homework:{attempt_id:'authored-probe-attempt',plan},turnPlanner:planner,authorizeTurn:async()=>({source:'authored_probe_only'})});
  const turn=async(c,name,text,expected,{action}={})=>{
    const e={type:'user.final',session_id:c.sessionId,event_id:'authored-'+ ++n,turn_id:'authored-turn-'+n,payload:{text}},started=Date.now();c.accept(e);await c.planTurn(e);const progress=c.view().goal_progress,observed=progress.goals.filter(g=>g.status==='observed').map(g=>g.goal_id).sort();
    const result={case:name,elapsed_ms:Date.now()-started,review_state:progress.review_state,failure:c.planning.records.at(-1)?.reason??null,output_shape:progress.review_state==='degraded'?planner.lastOutputShape:undefined,observed,expected:[...expected].sort(),next_action:progress.next_action,accepted:progress.review_state==='reviewed'&&JSON.stringify(observed)===JSON.stringify([...expected].sort())&&(!action||progress.next_action===action)};results.push(result);console.log(JSON.stringify(result));
  };
  const forward=(c,text)=>{const response_id='authored-reply-'+ ++n,turn_id='authored-question-'+n;for(const [type,payload] of [['response.started',{}],['response.text.delta',{text}],['response.done',{}]]){const packet={type:'event',event:{type,session_id:c.sessionId,event_id:'authored-forward-'+ ++n,turn_id,response_id,payload}};c.forward(packet);c.planning.observe(packet);}};
  const c=controller();await turn(c,'food_choice','我要一碗面条',['order_food']);forward(c,'口味有什么要求？');await turn(c,'taste_and_finish_choice','不要辣',['order_food','taste_preference']);await turn(c,'retract_reported_speech','我刚才说错了，我不是在点餐，是在帮朋友翻译这句话。',[]);
  await turn(controller(),'english_not_chinese','I would like noodles, not spicy please.',[]);
  await turn(controller(),'quoted_model_not_own_output','老师说“我要面条，不要辣”。',[]);
  const short=controller();forward(short,'你想吃什么？');await turn(short,'contextual_short_answer','饺子',['order_food']);
  await turn(controller(),'help_before_eliciting','我不知道怎么说，可以帮我吗？',[],{action:'support'});
  await turn(controller(),'natural_variant','给我来份西红柿鸡蛋面，口味清淡一些。',['order_food','taste_preference']);
  const result={kind:'actual_minimax_goal_turn_probe',input:'authored_text_only',budget_ms:planner.budgetMs,cases:results,accepted:results.every(r=>r.accepted),raw_provider_trace_saved:false,real_audio_checked:false,teaching_quality_accepted:false};
  await mkdir('.local/teacher-goal-checks',{recursive:true});await writeFile('.local/teacher-goal-checks/live-goals-'+Date.now()+'.json',JSON.stringify(result,null,2));await writeFile('.local/teacher-goal-checks/live-goals.json',JSON.stringify(result,null,2));if(!result.accepted)process.exitCode=1;
}
