// Shared checks: pass a CUA Playwright locator facade, or a Playwright Page in CI.
// Browser mutations are clicks/selects/reload only; all authored wire faults use the test host.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
export function ordinaryWebChecks({page,reload,control}){
  const text=selector=>page.locator(selector).textContent();
  const click=selector=>page.locator(selector).click();
  const inspect=()=>control({command:'inspect'});
  const current=async()=>(await inspect()).sessions.at(-1);
  async function until(check,message,ms=12000){const end=Date.now()+ms;do{if(await check())return;await sleep(40);}while(Date.now()<end);throw new Error('WEB_CHECK_TIMEOUT: '+message);}
  const expectText=(selector,expected)=>until(async()=>String(await text(selector)).includes(expected),selector+'='+expected);
  async function finish(){if(await page.locator('#end').isEnabled())await click('#end');await until(()=>page.locator('#connect').isEnabled(),'connection released');}
  async function start(values={}){
    await finish();await control({command:'faults',values:{holdCommands:false,dropAck:false,dropAllReceipts:false,holdContext:false,deckUnavailable:false,rejectSynthetic:false,holdPlanner:false,...values}});
    await click('#connect');await expectText('#connection-status','合成联调中');
    if(!values.deckUnavailable)await expectText('.slides-counter','第 3 / 3 页');
    assert((await text('main > p.preview:first-child')).includes('豆包未连接'),'SYNTHETIC_MUST_STAY_VISIBLE');
  }
  const scenario=name=>control({command:'scenario',name});
  const cases={
    async manual_voice(){
      await start();await click('.slides-previous');await expectText('.slides-counter','第 2 / 3 页');await scenario('review');
      await expectText('.slides-counter','第 1 / 3 页');await expectText('#caption','合成确认：已到第1页');
      const state=await current();assert(state.commands.length===5&&state.results[0].page===1,'MANUAL_AND_VOICE_SHARED_STATE');
      assert((await page.locator('.slides-pages option').allTextContents()).length===1,'NO_FORWARD_PAGE_ENTRY');assert(state.frames>0,'PCM_CONTINUES');
    },
    async append(){
      await start();await scenario('queue_add');assert((await current()).state.queued===1,'SECOND_REVIEW_QUEUED');
      await control({command:'release_commands'});await expectText('.slides-counter','第 1 / 3 页');await until(async()=>(await current()).results.length===2,'both review results');
      assert((await current()).results.every(result=>result.status==='applied'),'TWO_DISTINCT_REQUESTS_APPLY');await scenario('settle');
    },
    async cancel(){
      await start();await scenario('queue_cancel');await until(async()=>(await current()).results.length===2,'queued cancel results');
      assert((await current()).results.some(result=>result.cancelled_count===1&&result.in_flight===true),'CANCEL_ONLY_QUEUED');
      await control({command:'release_commands'});await expectText('.slides-counter','第 2 / 3 页');await until(async()=>(await current()).results.length===3,'original finishes');
      assert((await current()).commands.length===4,'NO_ROLLBACK_OR_SECOND_COMMAND');await scenario('settle');
    },
    async correction(){
      await start();await scenario('queue_correct');await until(async()=>(await current()).results.some(result=>result.reason==='REQUEST_REPLACED'),'queued replaced');
      await control({command:'release_commands'});await expectText('.slides-counter','第 1 / 3 页');await until(async()=>(await current()).results.length===3,'correction result');
      assert((await current()).commands.slice(3).map(command=>command.page).join(',')==='2,1','CORRECTION_PRESERVES_DISPATCHED');await scenario('settle');
    },
    async late_confirmation(){
      await start();await scenario('late_old_reply');await control({command:'release_commands'});await until(async()=>(await current()).results.length===1,'old action applied');
      await scenario('finish_late_reply');await expectText('#caption','新问题回应：next page');
      assert(!(await text('#caption')).includes('旧翻页确认'),'OLD_CONFIRMATION_FENCED');assert((await current()).native_cancels===0,'NO_WAITING_TOOL_CANCEL_ACK');
      await expectText('.slides-counter','第 2 / 3 页');
    },
    async pace(){
      await start();await scenario('pace_review');await until(async()=>(await current()).speech_phase==='complete','pace completes');
      await expectText('.slides-counter','第 2 / 3 页');await expectText('#speech-pace-hint','更慢');
      assert((await current()).contexts.some(context=>context.page==='2'&&context.speed===-40&&context.tool_count===2),'PACE_AND_SLIDES_SAME_UPDATE');
    },
    async planner_race(){
      await start({holdPlanner:true});await scenario('planner_input');await until(async()=>(await inspect()).pending_plans>=1,'old planner held');
      await click('.slides-previous');await expectText('.slides-counter','第 2 / 3 页');await scenario('review');await expectText('.slides-counter','第 1 / 3 页');
      await until(async()=>(await inspect()).pending_plans>=2,'new planner held');await control({command:'release_planner'});
      await until(async()=>(await current()).contexts.at(-1)?.latest_input_advisory===true,'latest planner only');
      const last=(await current()).contexts.at(-1);assert(last.page==='1'&&last.tool_count===1,'LATE_PLANNER_CANNOT_RESTORE_OLD_PAGE');
    },
    async lost_ack(){
      await start({dropAck:true});await scenario('review');await expectText('.slides-counter','第 2 / 3 页');
      await until(async()=>(await current()).results.length===1,'snapshot reconciliation');
      const session=await current();assert(session.results[0].status==='applied'&&session.commands.length===4,'ACK_LOSS_NO_REEXECUTION');
    },
    async unknown_freeze(){
      await start({dropAllReceipts:true});await scenario('review');await expectText('.slides-counter','第 2 / 3 页');
      await until(async()=>(await current()).results.some(result=>result.status==='unknown'),'unknown result');
      await expectText('.slides-hint','待确认');assert(!(await page.locator('.slides-previous').isEnabled()),'UNKNOWN_DISABLES_REVIEW');
      assert((await current()).commands.length===4,'UNKNOWN_NO_BLIND_RETRY');
    },
    async reconnect_switch(){
      await start();await scenario('review');await expectText('.slides-counter','第 2 / 3 页');await control({command:'disconnect'});
      await until(()=>page.locator('#connect').isEnabled(),'disconnected');await start();await expectText('.slides-counter','第 3 / 3 页');await finish();
      const options=await page.locator('#mock-learner-select option').allTextContents();assert(options.some(value=>value.includes('Maya')),'MOCK_LEARNER_OPTIONS');
      await page.locator('#mock-learner-select').selectOption({label:options.find(value=>value.includes('Maya'))});await expectText('#learner-level','HSK3');
      await start();assert((await current()).commands.map(command=>command.page).join(',')==='1,2,3','NEW_VIEWER_HISTORY_ISOLATED');
    },
    async deck_fallback(){
      await start({deckUnavailable:true});await expectText('#courseware-source','继续自由聊天');assert((await current()).commands.length===0,'NO_TOOLS_WITHOUT_VIEWER');
      assert((await current()).frames>0,'FALLBACK_CHAT_CAPTURES');
    },
    async real_ready_guard(){
      await finish();await control({command:'faults',values:{deckUnavailable:false,rejectSynthetic:true}});await reload();await until(()=>page.locator('#connect').isEnabled(),'reload ready');
      await click('#connect');await expectText('#session-message','服务未完成真实就绪验证');assert((await current()).frames===0,'SYNTHETIC_NEVER_PASSES_SHIPPED_GATE');
      await control({command:'faults',values:{rejectSynthetic:false}});await reload();
    }
  };
  return {ids:Object.keys(cases),async run(ids=Object.keys(cases)){
    const outcomes=[];for(const id of ids){const at=Date.now();try{if(!cases[id])throw new Error('UNKNOWN_WEB_CASE');await cases[id]();outcomes.push({id,passed:true,elapsed_ms:Date.now()-at});}
      catch(error){outcomes.push({id,passed:false,elapsed_ms:Date.now()-at,error:error.message});return outcomes;}}
    return outcomes;
  },finish};
}
