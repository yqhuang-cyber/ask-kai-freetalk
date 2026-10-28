// Isolated synthetic fixtures. No real provider or learner data is used.
import {chromium} from 'playwright';import {once} from 'node:events';import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {deepFixture,syntheticReportEnv} from '../../tests/helpers/deep-analysis.js';
import {ConversationReportAnalyzer} from '../../packages/teacher-assistant/deep-analysis/semantic.js';
import {syntheticSemanticTransport} from '../../tests/helpers/semantic-analysis.js';
import {runClaimedAnalysis} from '../../apps/learning-analysis-worker/src/run-analysis.js';
import {createTeacherApp} from '../../apps/teacher-assistant/src/server.js';
const env={...syntheticReportEnv,ASK_KAI_TA_AUDIO_ASSESSMENT_VALIDATED:'0',ASK_KAI_TA_AUDIO_REVIEW_ENABLED:'1'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),results=[];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function scenario(name,check){
  const cleanup=[],errors=[],f=await deepFixture({after:fn=>cleanup.push(fn)},{env});let context;
  await runClaimedAnalysis({job:f.service.analysisDelegation.claim(),call:f.call,textAnalyzer:new ConversationReportAnalyzer({transport:syntheticSemanticTransport()}),audioPort:{assess:async()=>{throw new Error('UNREVIEWED_AUDIO_MUST_NOT_BE_SENT');}}});
  const server=createTeacherApp({port:{call:(...args)=>f.service.call(...args)}});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    context=await browser.newContext({viewport:{width:1280,height:1000}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-login="mock-teacher-lin"]').click();await page.locator(`[data-report-submission="${f.submission.id}"]`).waitFor();
    await check({f,page});assert.deepEqual(errors,[]);results.push({name,passed:true});
  }finally{await context?.close();server.stopRealtime();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});for(const fn of cleanup)fn();}
}
async function secondReport(page,f){
  // B is a clearly synthetic UI response fixture; mutations below always use real Mock M4 submission A.
  const original=await f.service.call('submission',f.teacher,{submission_id:f.submission.id}),b='synthetic-review-B';
  await page.route('**/api/ta/list',async route=>{const response=await route.fetch(),list=await response.json(),a=list[0];await route.fulfill({json:[a,{...a,id:'synthetic-assignment-B',submissions:[{...original,id:b}]}]});});
  await page.locator('#refresh').click();await page.locator(`[data-report-submission="${b}"]`).waitFor();return {original,b};
}
async function openReview(page,f){await page.locator(`[data-report-submission="${f.submission.id}"]`).click();await page.getByRole('button',{name:'查看本次录音',exact:true}).click();await page.locator('.audio-review-row').first().waitFor();const row=page.locator('.audio-review-row').first();await row.getByLabel('这是谁的声音？',{exact:true}).selectOption('learner_verified');for(const label of ['影响辨听的噪声','削波或失真','缺音或不连续','其他人声或 Kai 回声重叠'])await row.getByLabel(label,{exact:true}).selectOption('not_detected');}
const save=page=>page.getByRole('button',{name:'保存核对并重新评测',exact:true});
try{
  await scenario('late teacher report response cannot replace the newly selected report',async({f,page})=>{
    const {original,b}=await secondReport(page,f),seen=deferred(),release=deferred();
    await page.route('**/api/ta/submission',async route=>{if(route.request().postDataJSON().submission_id===b)return route.fulfill({json:{...original,id:b}});const response=await route.fetch();seen.resolve();await release.promise;await route.fulfill({response});});
    try{await page.locator(`[data-report-submission="${original.id}"]`).click();await seen.promise;await page.locator(`[data-report-submission="${b}"]`).click();await page.locator(`[data-report-progress="${b}"]`).waitFor();release.resolve();await page.waitForFunction(id=>!document.querySelector(`[data-report-submission="${id}"]`).disabled,original.id);assert.equal(await page.locator('[data-report-progress]').getAttribute('data-report-progress'),b);}finally{release.resolve();}
  });
  await scenario('a lost save receipt is confirmed from source-bound revisions without resubmitting',async({f,page})=>{
    await openReview(page,f);let writes=0;await page.route('**/api/ta/audio_review',async route=>{writes++;await route.fetch();await route.abort('failed');});
    await save(page).click();await page.locator('#report-body[data-report-state="processing"]').waitFor();assert.equal(writes,1);assert.equal(f.service.repo.get('jobs',f.submission.id).state,'pending');assert.equal(f.service.repo.all('audio_reviews')[0].revision,1);
  });
  await scenario('offline readback preserves edits and offers a read-only recovery action',async({f,page})=>{
    await openReview(page,f);let offline=true,writes=0;await page.route('**/api/ta/audio_review',async route=>{writes++;await route.fetch();await route.abort('failed');});await page.route('**/api/ta/audio_review_manifest',route=>offline?route.abort('failed'):route.continue());
    await save(page).click();const recover=page.getByRole('button',{name:'核对保存状态',exact:true});await recover.waitFor();assert.equal(await save(page).isDisabled(),true);assert.equal(await page.getByLabel('这是谁的声音？',{exact:true}).inputValue(),'learner_verified');await recover.click();await recover.waitFor();assert.equal(writes,1);offline=false;await recover.click();await page.locator('#report-body[data-report-state="processing"]').waitFor();assert.equal(writes,1);
  });
  await scenario('a request that never reached the service can be retried after readback confirms no change',async({f,page})=>{
    await openReview(page,f);const drop=route=>route.abort('failed');await page.route('**/api/ta/audio_review',drop);await save(page).click();await page.locator('.audio-review [role="status"]').filter({hasText:'尚未保存'}).waitFor();assert.equal(await save(page).isEnabled(),true);assert.equal(f.service.repo.all('audio_reviews').length,0);await page.unroute('**/api/ta/audio_review',drop);await save(page).click();await page.locator('#report-body[data-report-state="processing"]').waitFor();assert.equal(f.service.repo.all('audio_reviews')[0].revision,1);
  });
  await scenario('a confirmed save is not repeated when its progress query fails',async({f,page})=>{
    await openReview(page,f);let writes=0;await page.route('**/api/ta/audio_review',async route=>{writes++;await route.continue();});const drop=route=>route.abort('failed');await page.route('**/api/ta/submission',drop);await save(page).click();const recover=page.getByRole('button',{name:'刷新处理进度',exact:true});await recover.waitFor();assert.equal(await save(page).isDisabled(),true);await page.unroute('**/api/ta/submission',drop);await recover.click();await page.locator('#report-body[data-report-state="processing"]').waitFor();assert.equal(writes,1);
  });
  await scenario('a late save callback cannot reopen a report the teacher already left',async({f,page})=>{
    const {original,b}=await secondReport(page,f);await page.route('**/api/ta/submission',route=>route.request().postDataJSON().submission_id===b?route.fulfill({json:{...original,id:b}}):route.continue());await openReview(page,f);
    const persisted=deferred(),release=deferred(),sent=deferred();await page.route('**/api/ta/audio_review',async route=>{const response=await route.fetch();persisted.resolve();await release.promise;await route.fulfill({response});sent.resolve();});
    try{await save(page).click();await persisted.promise;await page.locator(`[data-report-submission="${b}"]`).click();await page.locator(`[data-report-progress="${b}"]`).waitFor();release.resolve();await sent.promise;await page.waitForTimeout(100);assert.equal(await page.locator('[data-report-progress]').getAttribute('data-report-progress'),b);}finally{release.resolve();}
  });
  const report={synthetic:true,real_provider_call:false,external_audio_calls:0,cases:results};await mkdir('.local/report-recovery-checks',{recursive:true});await writeFile('.local/report-recovery-checks/browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
