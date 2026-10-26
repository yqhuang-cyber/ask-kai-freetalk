// Shared CUA/Playwright checks against ordinary Web and the explicit synthetic host.
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function pinyinBrowserChecks({page,control,observe=async()=>{}}){
 const results=[];const assert=(v,code)=>{if(!v)throw Error(code);};
 const until=async(check,code)=>{const deadline=Date.now()+12000;while(!await check()){if(Date.now()>deadline)throw Error('PINYIN_UI_TIMEOUT_'+code);await delay(40);}};
 const read=()=>page.locator('#caption').evaluate(root=>{const plain=n=>n.nodeType===3?n.textContent:n.nodeName==='RT'?'':[...n.childNodes].map(plain).join('');return {text:plain(root),ruby:root.querySelectorAll('ruby').length,hidden:root.hidden,overflow:root.scrollWidth>root.clientWidth};});
 const set=async(selector,value)=>{await observe();await page.locator(selector).setChecked(value);await observe();};
 const scenario=name=>control({command:'scenario',name});
 const run=async(id,task)=>{const at=Date.now();await task();results.push({id,passed:true,elapsed_ms:Date.now()-at});};
 try{
 await run('default_and_mixed_source',async()=>{
  if(await page.locator('#end').isEnabled()){await page.locator('#end').click();await until(()=>page.locator('#connect').isEnabled(),'OLD_SESSION_END');}
  await control({command:'faults',values:{rejectSynthetic:false,deckUnavailable:false,dropAllReceipts:false,dropAck:false,holdCommands:false,holdContext:false,holdPlanner:false}});
  await page.locator('#connect').click();await until(async()=>(await page.locator('#connection-status').textContent()).includes('合成联调中'),'READY');
  await scenario('caption_sentence');await until(async()=>(await read()).text==='我喜欢音乐，也很快乐。 I like music!','SOURCE');const r=await read();assert(r.ruby===9&&!r.overflow,'DEFAULT_RUBY_MIXED_SOURCE');
 });
 await run('manual_hide',async()=>{await set('#show-pinyin',false);await until(async()=>(await read()).ruby===0,'MANUAL_HIDE');assert((await read()).text==='我喜欢音乐，也很快乐。 I like music!','HIDE_MUST_PRESERVE_TEXT');});
 await run('later_reply_stays_hidden',async()=>{await scenario('caption_sentence');await until(async()=>(await read()).text==='我喜欢音乐，也很快乐。 I like music!','LATER_SOURCE');assert((await read()).ruby===0,'PREFERENCE_MUST_PERSIST');});
 await run('manual_restore',async()=>{await set('#show-pinyin',true);await until(async()=>(await read()).ruby===9,'MANUAL_RESTORE');});
 await run('voice_disable_with_rendered_confirmation',async()=>{await scenario('caption_off');await until(async()=>(await read()).text.includes('已关闭字幕拼音'),'VOICE_OFF');const r=await read();assert(r.ruby===0,'VOICE_OFF_ANNOTATIONS');await until(async()=>(await control({command:'inspect'})).sessions.at(-1).caption_phase==='complete','OFF_PLAYBACK');});
 await run('voice_enable_with_annotated_confirmation',async()=>{await scenario('caption_on');await until(async()=>(await read()).text.includes('已打开字幕拼音'),'VOICE_ON');assert((await read()).ruby>0,'VOICE_ON_ANNOTATIONS');await until(async()=>(await control({command:'inspect'})).sessions.at(-1).caption_phase==='complete','ON_PLAYBACK');});
 await run('hide_all_subtitles',async()=>{const original=(await read()).text;await set('#show-subtitles',false);assert((await read()).hidden,'HIDE_PARENT');await set('#show-subtitles',true);assert(!(await read()).hidden&&(await read()).text===original,'RESTORE_SOURCE');});
 await run('new_session_defaults_on',async()=>{await set('#show-pinyin',false);await until(async()=>(await read()).ruby===0,'FINAL_HIDE');await page.locator('#end').click();await until(()=>page.locator('#connect').isEnabled(),'END');await page.locator('#connect').click();await until(async()=>(await page.locator('#connection-status').textContent()).includes('合成联调中'),'RECONNECT');await scenario('caption_sentence');await until(async()=>(await read()).ruby===9,'NEW_DEFAULT');});
 }catch(error){results.push({id:'failure',passed:false,error:error.message});}
 return results;
}
