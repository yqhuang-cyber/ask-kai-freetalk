import {chromium} from 'playwright';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {HomeworkService} from '../../apps/hskai-mock/src/teacher-assistant/service.js';
import {createTeacherApp} from '../../apps/teacher-assistant/src/server.js';
import {AIPlanSource} from '../../packages/teacher-assistant/ai-plan-source.js';
import {HomeworkTurnPlanner} from '../../packages/teacher-assistant/turn-planner.js';
import {ConversationReportAnalyzer} from '../../packages/teacher-assistant/deep-analysis/semantic.js';
import {reportConfiguration} from '../../packages/teacher-assistant/deep-analysis/config.js';
import {runClaimedAnalysis} from '../../apps/learning-analysis-worker/src/run-analysis.js';
import {TestProvider,until} from '../../tests/helpers/realtime.js';
import {AuthoredHomeworkTransport} from '../../tests/helpers/homework-planning.js';
import {syntheticReportEnv} from '../../tests/helpers/deep-analysis.js';

// This transport scripts only the authored browser scenario, not production
// semantic inference. The real-model matrix is a separate probe.
const turnTransport={provider:'synthetic',async completeJSON(request){
  const input=JSON.parse(request.messages[1].content),goals=input.goals.map(g=>{const text=g.id==='order_food'?'我要一碗面条':'不要辣',source=input.sources.find(s=>s.role==='learner'&&s.text===text);return {goal_id:g.id,status:source?'observed':'not_yet',refs:source?[{source_id:source.id,start:0,end:text.length,quote:text}]:[]};});
  const next=goals.find(g=>g.status!=='observed');return {goals,next_goal_id:next?.goal_id??null,next_action:next?'elicit':'offer_finish'};
}};
const service=new HomeworkService({analysisConfig:reportConfiguration({...syntheticReportEnv,ASK_KAI_PRONUNCIATION_PROVIDER:'none'}),aiPlanSource:new AIPlanSource({source:'synthetic',transport:new AuthoredHomeworkTransport()})}),providers=[];
const textAnalyzer=new ConversationReportAnalyzer({transport:{provider:'minimax',model:'MiniMax-M3',async completeJSON(){return {observations:[]};}}});
let busy=false;const backgroundErrors=[];
const timer=setInterval(async()=>{if(busy)return;busy=true;try{await service.preparations.run();const job=service.analysisDelegation.claim();if(job.state==='claimed')await runClaimedAnalysis({job,call:async(op,input)=>service.analysisDelegation.call(op,input),textAnalyzer});}catch(e){backgroundErrors.push(e.message);}finally{busy=false;}},25);
const server=createTeacherApp({port:{call:(...args)=>service.call(...args)},transcriptEnabled:true,turnPlanner:new HomeworkTurnPlanner({transport:turnTransport}),providerKind:'test',providerFactory:()=>{const p=new TestProvider();p.updateContext=value=>{p.contexts.push(value);queueMicrotask(()=>p.control('context.updated',{version:value.version}));};providers.push(p);return p;}});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/voice-readiness.js',route=>route.fulfill({contentType:'text/javascript',body:"export function voiceReadiness(packet,audio){return packet?.event?.type==='session.ready'&&audio?{real_provider:false}:null;}"}));
  await page.addInitScript(()=>{window.testTracks=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await original(...args);window.testTracks.push(...stream.getTracks());return stream;};});
  await page.goto(origin);await page.locator('[data-login="mock-teacher-lin"]').click();await page.locator('#ai-kind').selectOption('dining');await page.locator('#ai-topic').fill('点餐');await page.locator('#ai-direction').fill('用中文点一种食物并说明一种口味要求');await page.locator('#ai-generate').click();await page.locator('#ai-stage').filter({hasText:'草案已准备好'}).waitFor();
  assert.equal(await page.locator('#ai-goals [data-field="acceptance"]').count(),2);
  const acceptance='用中文表达食物选择；接受“面条”等有上下文的短答，不要求照读。';await page.locator('#ai-goals [data-field="acceptance"]').first().fill(acceptance);await page.locator('#ai-save').click();await page.waitForFunction(()=>document.getElementById('ai-save').disabled);await page.locator('#ai-confirm').check();await page.locator('#ai-publish').click();await page.locator('#ai-stage').filter({hasText:'已确认发布'}).waitFor();
  const publication=service.repo.all('publications')[0];assert.equal(publication.plan.goals[0].output_requirement.acceptance,acceptance);
  await page.locator('#switch').click();await page.locator('[data-login="mock-maya-hsk3"]').click();await page.locator('#recording-notice').filter({hasText:'进展'}).waitFor();await page.getByRole('button',{name:'开始主题对话',exact:true}).click();await until(()=>providers[0]?.input);const p=providers[0];p.emit('session.ready');await page.locator('#voice-state').filter({hasText:'合成语音'}).waitFor();await until(()=>p.frames.length>2);
  const emitTurn=(text,id)=>{p.emit('user.final',{text},{turn_id:id});p.emit('response.started',{}, {turn_id:id,response_id:'r-'+id});p.emit('response.text.delta',{text:'你想要什么口味？'},{turn_id:id,response_id:'r-'+id});p.emit('response.done',{}, {turn_id:id,response_id:'r-'+id});};
  emitTurn('I would like noodles.','english');await page.locator('#practice-progress').filter({hasText:'待尝试'}).waitFor();assert.equal(await page.locator('#practice-choice').isVisible(),false);
  emitTurn('我要一碗面条','order');await page.locator('#practice-progress [data-observed="true"]').waitFor();assert.equal(await page.locator('#practice-progress [data-observed="true"]').count(),1);assert.equal(await page.locator('#practice-choice').isVisible(),false);
  emitTurn('不要辣','taste');await page.locator('#practice-choice').waitFor();assert.equal(await page.locator('#practice-progress [data-observed="true"]').count(),2);assert.equal(service.repo.all('submissions').length,0);assert.equal(await page.locator('#submit').isVisible(),false);assert.ok(await page.evaluate(()=>window.testTracks.some(t=>t.readyState==='live')));
  await page.locator('#continue-practice').click();assert.equal(await page.locator('#practice-choice').isVisible(),false);assert.ok(await page.evaluate(()=>window.testTracks.some(t=>t.readyState==='live')));
  emitTurn('我还想再聊一会儿','continue');await page.locator('#student-text').filter({hasText:'再聊一会儿'}).waitFor();assert.equal(await page.locator('#practice-choice').isVisible(),false);assert.equal(service.repo.all('submissions').length,0);
  await mkdir('.local/teacher-goal-checks',{recursive:true});await page.screenshot({path:'.local/teacher-goal-checks/conversation.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.local/teacher-goal-checks/conversation-mobile.png',fullPage:true});
  await page.locator('#end').click();await page.locator('#submit').waitFor();assert.ok(await page.evaluate(()=>window.testTracks.every(t=>t.readyState==='ended')));assert.equal(service.repo.all('submissions').length,0);
  const attempt=service.repo.all('attempts')[0];assert.equal(attempt.evidence.goal_progress,undefined);assert.equal(service.repo.get('deep_records',attempt.id).live_goal_progress.goals.filter(g=>g.status==='observed').length,2);
  await page.locator('#submit').click();await page.locator('#report-body[data-report-state="ready"]').waitFor();assert.match(await page.locator('[data-practice-requirements]').textContent(),/我要一碗面条/);assert.match(await page.locator('[data-practice-requirements]').textContent(),/上下文/);await page.screenshot({path:'.local/teacher-goal-checks/report-mobile.png',fullPage:true});
  await page.locator('#record-management summary').click();await page.locator('#recording-revoke').click();await page.locator('#recording-status').filter({hasText:'已撤回并删除'}).waitFor();assert.equal(service.repo.get('deep_records',attempt.id),null);assert.ok(!JSON.stringify(service.repo.all('attempts')).includes('live_goal_progress'));assert.ok(!JSON.stringify(service.repo.all('reports')).includes('practice_progress":{"'));
  assert.deepEqual(errors,[]);assert.deepEqual(backgroundErrors,[]);
  const result={source:'synthetic_transports_and_chromium_microphone',business:'actual_mock_sqlite',teacher_output_requirement_edit_published:true,english_not_counted:true,goal_specific_progress:true,all_observed_choice:true,continue_keeps_microphone:true,no_automatic_end_or_submit:true,explicit_end_stops_capture:true,explicit_submit_required:true,report_uses_same_criteria_and_quotes:true,progress_uses_transcript_ttl_and_revocation:true,mobile_overflow:false,page_errors:0,real_audio_checked:false,teaching_quality_accepted:false};await writeFile('.local/teacher-goal-checks/browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();clearInterval(timer);server.stopRealtime();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});service.close();}
