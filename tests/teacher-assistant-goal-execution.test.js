import test from 'node:test';
import assert from 'node:assert/strict';
import {PresetPlanSource} from '../packages/teacher-assistant/preset.js';
import {HomeworkConversationController} from '../packages/teacher-assistant/controller.js';
import {HomeworkTurnPlanner,validateTurnProposal} from '../packages/teacher-assistant/turn-planner.js';
import {validEvidence,digest,validPlan} from '../packages/teacher-assistant/contracts.js';
import {ReportAnalyzer,projectReport} from '../packages/teacher-assistant/report.js';
import {validateSemanticResult,ConversationReportAnalyzer} from '../packages/teacher-assistant/deep-analysis/semantic.js';
import {AIPlanSource} from '../packages/teacher-assistant/ai-plan-source.js';
import {validBrief} from '../packages/teacher-assistant/planning-contract.js';
import {AuthoredHomeworkTransport} from './helpers/homework-planning.js';
import {outputRequirement} from '../packages/teacher-assistant/output-requirements.js';
import {deepFixture} from './helpers/deep-analysis.js';

export function proposalFor(input,observed={},action){
  const goals=input.goals.map(g=>{const ids=observed[g.id]??[];return {goal_id:g.id,status:ids==='uncertain'?'uncertain':ids.length?'observed':'not_yet',refs:ids==='uncertain'?[]:ids.map(id=>{const source=input.sources.find(s=>s.id===id||s.event_id===id);return {source_id:source.id,start:0,end:source.text.length,quote:source.text};})};});
  const next=goals.find(g=>g.status!=='observed');return {goals,next_goal_id:next?.goal_id??null,next_action:action??(next?'elicit':'offer_finish')};
}
async function fixture({propose,budgetMs=2000,authorize=async()=>({grant:1})}={}){
  const plan=await new PresetPlanSource().prepare({topic:'dining'},{learner_id:'mock-maya-hsk3'}),calls=[];
  const transport={provider:'synthetic',async completeJSON(request){const input=JSON.parse(request.messages[1].content);calls.push(input);return propose?propose(input,request):proposalFor(input);}};
  const controller=new HomeworkConversationController({sessionId:'s1',homework:{attempt_id:'a1',plan},turnPlanner:new HomeworkTurnPlanner({transport,budgetMs}),authorizeTurn:authorize});
  let n=0;
  const input=(text,id='e'+ ++n)=>({type:'user.final',session_id:'s1',event_id:id,turn_id:'t-'+id,payload:{text}});
  const turn=async(text,id)=>{const e=input(text,id);assert.equal(controller.accept(e),true);await controller.planTurn(e);return e;};
  const reply=(text,{turn_id=controller.decision.turn_id,response_id='r'+ ++n,cancelled=false}={})=>{for(const [type,payload] of [['response.started',{}],['response.text.delta',{text}],[cancelled?'response.cancelled':'response.done',{}]]){const packet={type:'event',event:{type,session_id:'s1',event_id:'f'+ ++n,turn_id,response_id,payload}};controller.forward(packet);controller.planning.observe(packet);controller.completeReply(packet.event);}};
  return {plan,controller,calls,input,turn,reply};
}
test('new preset and generated plans require published spoken Chinese criteria; old publications stay immutable',async()=>{
  const f=await fixture();assert.equal(f.plan.goal_contract_version,'chinese-output-v1');assert.equal(f.plan.goals.every(g=>g.output_requirement.language==='zh'&&g.output_requirement.modality==='spoken'),true);
  const brief=validBrief({topic:'昆虫',kind:'description',direction:'描述颜色和环境'}),base=new AuthoredHomeworkTransport();
  const plan=await new AIPlanSource({transport:base,source:'synthetic'}).prepare(brief,{learner_id:'student'});validPlan(plan);assert.ok(plan.goals.every(g=>g.output_requirement.acceptance));
  for(const defect of ['missing','english','typing']){const transport={async completeJSON(req){const value=await base.completeJSON(req);if(req.kind==='homework_planning'){if(defect==='missing')delete value.goals[0].output_requirement;else value.goals[0].output_requirement[defect==='english'?'language':'modality']=defect==='english'?'en':'text';}return value;}};await assert.rejects(new AIPlanSource({transport,source:'synthetic'}).prepare(brief,{learner_id:'student'}),/REJECTED/);}
  const old=structuredClone(f.plan);delete old.goal_contract_version;old.goals.forEach(g=>{delete g.output_requirement;delete g.task;delete g.criterion;});old.hash=digest({...old,hash:undefined});const before=JSON.stringify(old);validPlan(old);assert.equal(outputRequirement(old.goals[0]).source,'legacy_runtime_default');assert.equal(JSON.stringify(old),before);
});
test('two Chinese outputs across turns drive one remaining goal then a choice, with matching report criteria and sources',async()=>{
  const f=await fixture({propose:input=>proposalFor(input,{order_food:['order'],...(input.sources.some(s=>s.event_id==='taste')?{taste_preference:['taste']}:{})})});
  await f.turn('我要一碗面条','order');assert.equal(f.controller.view().goal_progress.active_goal_id,'taste_preference');assert.equal(f.controller.view().goal_progress.next_step.output_requirement.language,'zh');assert.equal(f.controller.view().goal_progress.next_step.expected_chinese_output,f.plan.goals[1].task);assert.equal(f.controller.view().goal_progress.all_observed,false);
  f.reply('口味有什么要求？');await f.turn('不要辣','taste');const progress=f.controller.view().goal_progress;assert.equal(progress.all_observed,true);assert.equal(progress.next_action,'offer_finish');assert.equal(f.controller.decision.action,'RESPOND');assert.match(f.controller.contextSnapshot().instructions,/邀请选择继续拓展或结束/);
  f.controller.finalize({outcome:'ended',endReason:'student_end',ready:true,providerKind:'test'});validEvidence(f.controller.evidence,{id:'a1',session_id:'s1',plan_hash:f.plan.hash},f.plan);
  const report=new ReportAnalyzer().analyze(f.plan,f.controller.evidence,{id:'a1',session_id:'s1',plan_hash:f.plan.hash});assert.equal(report.practice_progress.all_observed,true);assert.equal(report.goals[0].output_requirement.acceptance,f.plan.goals[0].output_requirement.acceptance);
  assert.equal(projectReport(report,'learner').practice_progress.sources,undefined);assert.equal(projectReport(report,'learner').grade,undefined);assert.equal(report.grade,null);assert.equal(report.mastery,'unassessed');
  const wrong=structuredClone(f.controller.evidence);wrong.goal_progress.goals[0].evidence[0].quote='不是学生原话';assert.throws(()=>validEvidence(wrong,{id:'a1',session_id:'s1',plan_hash:f.plan.hash},f.plan),/INVALID_GOAL_PROGRESS/);
});
test('English, quoted demonstrations, invented references and Kai-only evidence cannot manufacture observed Chinese output',async()=>{
  for(const text of ['I want noodles','老师说“我要一碗面条”','怎么说我要一碗面条']){const f=await fixture({propose:input=>proposalFor(input,{order_food:['bad']})});await f.turn(text,'bad');assert.equal(f.controller.view().goal_progress.all_observed,false);assert.equal(f.controller.view().goal_progress.review_state,'degraded');}
  const f=await fixture();await f.turn('你好','hello');f.reply('我要一碗面条');const input=f.calls[0];input.sources=f.controller.planning.sourceWindow();const kai=input.sources.find(s=>s.role==='kai');assert.throws(()=>validateTurnProposal(proposalFor(input,{order_food:[kai.id]}),input),/SOURCE/);
  const value=proposalFor(input);value.goals[0]={goal_id:'order_food',status:'observed',refs:[{source_id:'invented',start:0,end:2,quote:'面条'}]};assert.throws(()=>validateTurnProposal(value,input),/SOURCE/);
});
test('contextual short answers can count after a completed question; cancelled and control output are absent',async()=>{
  const f=await fixture({propose:input=>proposalFor(input,input.sources.some(s=>s.event_id==='short')?{order_food:[input.sources.find(s=>s.role==='kai').id,'short']}:{})});
  await f.turn('你好','hello');f.reply('你想吃什么？');await f.turn('面条','short');assert.equal(f.controller.view().goal_progress.goals[0].status,'observed');
  f.reply('口味有什么要求？',{cancelled:true});assert.ok(!f.controller.planning.sourceWindow().some(s=>s.text==='口味有什么要求？'));
});
test('help first and a later correction replace progress rather than accumulating permanent completion',async()=>{
  const f=await fixture({propose:input=>input.latest_text.includes('说错')?proposalFor(input,{taste_preference:['taste']}):input.latest_text.includes('帮我')?proposalFor(input,{},'support'):proposalFor(input,{order_food:['order'],...(input.sources.some(s=>s.event_id==='taste')?{taste_preference:['taste']}:{})})});
  await f.turn('请帮我','help');assert.equal(f.controller.view().goal_progress.next_action,'support');
  await f.turn('我要面条','order');await f.turn('不要辣','taste');assert.equal(f.controller.view().goal_progress.all_observed,true);
  await f.turn('刚才说错了，我不要面条了','correct');assert.equal(f.controller.view().goal_progress.all_observed,false);assert.equal(f.controller.view().goal_progress.goals[0].status,'not_yet');assert.match(f.controller.contextSnapshot().instructions,/主要围绕目标 order_food/);
});
test('uncooperative late model results cannot cross a new turn or a finalization fence',async()=>{
  const releases=[];const f=await fixture({propose:input=>new Promise(resolve=>releases.push(()=>resolve(proposalFor(input,{order_food:[input.sources.find(s=>s.role==='learner').id]}))))});
  const e1=f.input('我要面条','old');f.controller.accept(e1);const first=f.controller.planTurn(e1);await new Promise(r=>setImmediate(r));
  const e2=f.input('帮我再说一次','new');f.controller.accept(e2);releases[0]();assert.equal(await first,null);assert.equal(f.controller.view().goal_progress.all_observed,false);
  const second=f.controller.planTurn(e2);await new Promise(r=>setImmediate(r));f.controller.finalize({outcome:'ended',endReason:'student_end',ready:true});const sealed=JSON.stringify(f.controller.evidence);releases[1]();assert.equal(await second,null);assert.equal(JSON.stringify(f.controller.evidence),sealed);
});
test('one deadline includes authorization and transport; failures never offer completion or block voice',async()=>{
  for(const authorizationSlow of [true,false]){let calls=0;const f=await fixture({budgetMs:25,authorize:authorizationSlow?()=>new Promise(()=>{}):async()=>({grant:1}),propose:()=>{calls++;return new Promise(()=>{});}});const started=Date.now();await f.turn('我要面条','timeout');assert.ok(Date.now()-started<250);assert.equal(calls,authorizationSlow?0:1);assert.equal(f.controller.view().goal_progress.review_state,'degraded');assert.equal(f.controller.decision.action,'RESPOND');assert.equal(f.controller.view().goal_progress.all_observed,false);}
});
test('authoritative permission is checked before external calls and again before committing results',async()=>{
  for(const revokeAt of [1,2]){let checks=0,calls=0;const f=await fixture({authorize:async()=>{if(++checks===revokeAt)throw new Error('RECORD_AUTHORIZATION_CHANGED');return {grant:1};},propose:input=>{calls++;return proposalFor(input,{order_food:['own']});}});await f.turn('我要面条','own');assert.equal(calls,revokeAt-1);assert.equal(f.controller.view().goal_progress.review_state,'not_authorized');assert.deepEqual(f.controller.planning.sources,[]);assert.equal(f.controller.planning.acceptedSources.length,0);}
});
test('long conversations retain minimal older goal witnesses while bounding context and progress memory',async()=>{
  const f=await fixture({propose:input=>proposalFor(input,{order_food:['first'],...(input.sources.some(s=>s.event_id==='last')?{taste_preference:['last']}:{})})});
  await f.turn('我要面条','first');for(let i=0;i<45;i++)await f.turn('我想再看看菜单','middle-'+i);await f.turn('不要辣','last');assert.equal(f.controller.view().goal_progress.all_observed,true);assert.ok(f.controller.planning.sources.length<=10);assert.ok(f.controller.planning.records.length<=32);assert.ok(f.calls.every(i=>i.sources.length<=20));assert.equal(f.controller.view().goal_progress.coverage.truncated,true);
});
test('student end and safety finalization suppress pending planning without an automatic submit',async()=>{
  const f=await fixture();await f.turn('结束练习','end');assert.equal(f.calls.length,0);assert.equal(f.controller.decision.action,'CLOSE');f.controller.finalize({outcome:'failed',endReason:'safety_restricted',ready:true});assert.equal(f.controller.evidence.goal_progress,undefined);assert.equal(f.controller.evidence.final_turns,0);
});
test('offline semantic analysis receives the exact published output criteria and plan hash',async t=>{
  const f=await deepFixture(t,{audio:false});let request;const transport={provider:'synthetic',model:'authored',async completeJSON(value){request=JSON.parse(value.messages[1].content);return {observations:[]};}};
  const record=f.service.transcriptStore.read(f.service.actor(f.learner),{attempt_id:f.attempt.id});const result=await new ConversationReportAnalyzer({transport}).analyze(f.plan,record);validateSemanticResult(result,record,{provider:'synthetic',model:'authored'});assert.equal(request.plan.plan_hash,f.plan.hash);assert.deepEqual(request.plan.goals[0].output_requirement,outputRequirement(f.plan.goals[0]));
});

test('a conservative retraction may discard its explanatory refs without creating positive evidence',async()=>{
  const f=await fixture();await f.turn('我刚才说错了','correction');const input=f.calls[0],proposal=proposalFor(input);proposal.goals[0].refs=[{source_id:input.sources[0].id,quote:input.sources[0].text}];const checked=validateTurnProposal(proposal,input);assert.equal(checked.goals[0].status,'not_yet');assert.deepEqual(checked.goals[0].refs,[]);
});
test('oversized current input is not sent as a misleading partial source and finalization is immutable',async()=>{
  const f=await fixture();await f.turn('我要面条'.repeat(120),'oversized');assert.equal(f.calls.length,0);assert.equal(f.controller.view().goal_progress.review_state,'degraded');assert.equal(f.controller.view().goal_progress.all_observed,false);
  const options={outcome:'ended',endReason:'student_end',ready:true,providerKind:'test'},summary=f.controller.finalize(options),evidence=JSON.stringify(f.controller.evidence);assert.deepEqual(f.controller.finalize({...options,endReason:'service_failure'}),summary);assert.equal(JSON.stringify(f.controller.evidence),evidence);
});
