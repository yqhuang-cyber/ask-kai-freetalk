import { ObservationReports } from '../apps/realtime-gateway/src/observation-reports.js';
import { ObservationSummary } from '../packages/agent-core/observation-summary.js';
import { chromium } from 'playwright';
import { EventEmitter, once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGateway } from '../apps/realtime-gateway/src/server.js';
import { createDoubaoProvider } from '../packages/provider-doubao/seeduplex.js';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { summaryFixture } from '../tests/helpers/summary.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
const server=createGateway({paceMs:1});server.listen(0,'127.0.0.1');await once(server,'listening');
const servers=[server];
const backends=[];
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.ASK_KAI_BROWSER_EXECUTABLE,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=> {window.microphoneRequests=0;const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{window.microphoneRequests++;return original(...args);};});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.locator('#diagnostics').isVisible(),false);
  assert.equal(await page.locator('#session-summary').isVisible(),false);
  await page.getByText('当前服务暂不支持选择语速。',{exact:true}).waitFor();assert.equal(await page.locator('#speech-pace').isDisabled(),true);
  await page.getByRole('button',{name:'自由聊天',exact:true}).click();assert.match(await page.locator('#goal').textContent(),/感兴趣/);
  assert.equal(await page.locator('[data-mode]').count(),1);
  await page.locator('#connect').click();await page.getByText('实时语音尚未开通。需完成豆包协议和服务端连接验证。',{exact:true}).waitFor();
  assert.equal(await page.locator('#connection-status').textContent(),'未连接');assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mkdir('.local/browser-check',{recursive:true});await page.screenshot({path:'.local/browser-check/mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.local/browser-check/desktop.png',fullPage:true});
  await page.goto(`http://127.0.0.1:${server.address().port}/?diagnostics=1`);
  await page.waitForFunction(()=>document.querySelector('#diagnostic-case').options.length===10);
  await page.locator('#diagnostics summary').click();await page.locator('#diagnostic-case').selectOption('E01');
  await page.locator('#connect').click();await page.getByText('实时语音尚未开通。需完成豆包协议和服务端连接验证。',{exact:true}).waitFor();
  const downloaded=page.waitForEvent('download');await page.locator('#diagnostic-export').click();
  const download=await downloaded;assert.equal(download.suggestedFilename(),'ask-kai-baseline-E01.json');
  const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const report=JSON.parse(Buffer.concat(chunks).toString());assert.equal(report.kind,'not_connected');assert.equal(report.real_experience_accepted,false);assert.equal(report.case_id,'E01');
  assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
  // Exercise actual native AudioWorklet/AudioContext with Chromium's synthetic device, independently of provider readiness.
  await page.evaluate(async()=> {
    const {AudioIO}=await import('/audio.js');window.framesObserved=[];
    const {ExperienceTrace}=await import('/diagnostics.js');window.audioTrace=new ExperienceTrace();window.audioTrace.gateway({name:'session.config',at_ms:0,fields:{synthetic:true}});
    window.audioFailure=null;window.testAudio=new AudioIO({onFrame:bytes=>window.framesObserved.push(bytes.length),onFailure:error=>window.audioFailure=error,onObserve:(name,fields)=>window.audioTrace.record(name,fields)});
    await window.testAudio.prepare();await window.testAudio.start({input_rate:16000,output_rate:24000});
  });
  await page.waitForFunction(()=>window.framesObserved.length>=6);
  assert.equal(await page.evaluate(()=>window.framesObserved.every(size=>size===640)),true);
  // Production caption module + native playback clock; authored text/silent PCM
  // are a synthetic fixture, never a provider-ready or listening-quality result.
  const fixtureFrames=await page.evaluate(async()=> {
    const {Presentation}=await import('/presentation.js');
    window.captionFixtureText='你好。 Hello. 我喜欢足球。 I like football.';window.captionReveals=[];
    window.captionFixture=new Presentation({render:(text,parts)=>{
      window.captionReveals.push({text,current:parts.current,at:performance.now()});
      const caption=document.querySelector('#caption');caption.replaceChildren();
      const previous=document.createElement('span');previous.textContent=parts.previous;previous.className='caption-previous';caption.append(previous);
      if(parts.current){const active=document.createElement('strong');active.textContent=parts.current;active.className='caption-current';caption.append(active);}
    },play:(pcm,rate,id)=>window.testAudio.play(pcm,rate,id),stopAudio:()=>window.testAudio.stopPlayback(),
      getPlayback:id=>window.testAudio.playback(id),onObserve:(name,fields)=>window.audioTrace.record(name,fields)});
    window.captionFixture.begin('synthetic-caption');window.captionFixture.append('synthetic-caption',window.captionFixtureText);
    const pcm=btoa(String.fromCharCode(...new Uint8Array(28800))); // 600ms @ 24kHz
    // 7.2 seconds arrive in one burst: this previously closed the conversation
    // at the three-second playback guard. Verify full native drain and captions.
    for(let i=0;i<12;i++)window.captionFixture.audio('synthetic-caption',pcm,24000);
    if(Math.abs(window.testAudio.playback('synthetic-caption').received_ms-7200)>.01)throw new Error('PCM_BURST_LOST');
    window.captionFixture.done('synthetic-caption');
    if(document.querySelector('#caption').textContent!=='')throw new Error('CAPTION_BURST');
    return window.framesObserved.length;
  });
  await page.waitForFunction(()=>window.captionFixture.visible.length>0);
  assert.equal(await page.evaluate(()=>window.captionFixture.visible.length<window.captionFixtureText.length),true);
  assert.equal(await page.locator('#caption .caption-current').count(),1);
  const pausedText=await page.evaluate(async()=>{await window.testAudio.context.suspend();return window.captionFixture.visible;});
  await page.waitForFunction(()=>window.captionFixture.mode==='paused');
  await page.waitForTimeout(420);assert.equal(await page.evaluate(()=>window.captionFixture.visible),pausedText);
  await page.evaluate(()=>window.testAudio.context.resume());
  await page.waitForFunction(()=>window.captionFixture.mode==='complete');
  assert.equal(await page.evaluate(()=>window.captionFixture.visible===window.captionFixtureText),true);
  assert.equal(await page.evaluate(()=>window.framesObserved.length>window.captionReveals.length && window.framesObserved.length>0),true);
  assert.ok(await page.evaluate(()=>window.framesObserved.length)>fixtureFrames+5);
  const reveals=await page.evaluate(()=>window.captionReveals.filter(r=>r.current));assert.equal(reveals.length,4);
  assert.ok(reveals.slice(1).every((r,i)=>r.at-reveals[i].at>=310));
  await page.locator('#subtitle-size').selectOption('large');assert.equal(await page.locator('#caption').evaluate(el=>getComputedStyle(el).fontSize),'25px');
  await page.locator('#show-subtitles').uncheck();assert.equal(await page.locator('#caption').isVisible(),false);assert.equal(await page.locator('#caption-hint').isVisible(),false);
  await page.locator('#show-subtitles').check();assert.equal(await page.locator('#caption').isVisible(),true);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'.local/browser-check/captions-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>window.captionFixture.reset());
  const before=await page.evaluate(()=>{window.testAudio.play(btoa(String.fromCharCode(...new Uint8Array(640))),16000);window.testAudio.mute(true);window.testAudio.stopPlayback();return window.framesObserved.length;});
  await page.waitForFunction(count=>window.framesObserved.length>count+5,before);
  await page.waitForFunction(()=>window.audioTrace.rows.some(r=>r.name==='audio.capture.progress'));
  await page.evaluate(async()=>{await window.testAudio.close();await window.testAudio.close();});
  assert.equal(await page.evaluate(()=>window.audioFailure),null);
  const audioReport=await page.evaluate(()=>window.audioTrace.snapshot());assert.equal(audioReport.kind,'synthetic');
  assert.ok(audioReport.timeline.some(r=>r.name==='audio.capture.started'));assert.ok(audioReport.timeline.some(r=>r.name==='audio.stopped'));assert.equal(audioReport.contains_audio,false);
  assert.ok(audioReport.timeline.some(r=>r.name==='caption.playback' && r.played_pcm_ms>0));
  assert.equal(JSON.stringify(audioReport).includes('我喜欢足球'),false);
  // Real summary builder and production DOM renderer, authored synthetic data.
  // This fixture does not activate the app's provider or microphone path.
  await page.evaluate(async()=> {
    const {SummaryCards}=await import('/summary-cards.js');window.summaryRestarts=0;
    window.summaryFixture=new SummaryCards({root:document.querySelector('#session-summary'),link:document.querySelector('#summary-jump'),onRestart:()=>window.summaryRestarts++});
  });
  const showSummary=async packet=>page.evaluate(packet=> {
    window.summaryFixture.begin(packet.session_id,packet.summary.mode);
    if(!window.summaryFixture.accept(packet))throw new Error('SUMMARY_FIXTURE_REJECTED');
    if(!document.querySelector('#session-summary').hidden)throw new Error('SUMMARY_RENDERED_BEFORE_END');
    window.summaryFixture.finish();
  },packet);
  for(const mode of ['sports','mission','free']) {
    const packet=summaryFixture({mode,sessionId:`browser-${mode}`});await showSummary(packet);
    assert.equal(await page.locator('#session-summary .summary-learning-grid .summary-card').count(),1);
    assert.equal(await page.locator('#session-summary .summary-learning-grid h3').textContent(),'我喜欢足球');
    assert.match(await page.locator('#session-summary .summary-learning-grid .pinyin').textContent(),/wǒ xǐ huān zú qiú/);
    assert.equal(await page.locator('#session-summary .summary-learning-grid [lang=en]').textContent(),'I like football.');
    assert.equal(await page.locator('#session-summary .summary-recap h4').textContent(),'我喜欢足球');
    assert.match(await page.locator('#session-summary .summary-topics').textContent(),/运动/);
    assert.match(await page.locator('#session-summary .summary-label').textContent(),/表达尝试 · 1 次/);
    assert.equal(await page.locator('#session-summary .summary-review').count(),1);
    assert.match(await page.locator('#session-summary').textContent(),/工程测试数据/);
    assert.ok(!(await page.locator('#session-summary').textContent()).includes(packet.session_id));
    assert.equal(await page.evaluate(()=>window.summaryFixture.accept({type:'teaching.summary',session_id:'foreign'})),false);
  }
  await page.locator('#session-summary .summary-restart').click();assert.equal(await page.evaluate(()=>window.summaryRestarts),1);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#session-summary').screenshot({path:'.local/browser-check/summary-mobile.png'});
  await page.setViewportSize({width:1280,height:900});await page.locator('#session-summary').screenshot({path:'.local/browser-check/summary-desktop.png'});
  for(const options of [{mode:'free',practice:false},{empty:true},{mode:'mission',unsupported:true}]) {
    const packet=summaryFixture(options);await showSummary(packet);
    assert.equal(await page.locator('#session-summary .summary-learning-grid .summary-card').count(),0);assert.equal(await page.locator('#session-summary .summary-review').count(),0);
    if(options.unsupported)assert.match(await page.locator('#session-summary').textContent(),/当前目标暂未自动评估/);
    if(options.mode==='free'){assert.match(await page.locator('#session-summary').textContent(),/本轮以交流为主/);assert.match(await page.locator('#session-summary .summary-topics').textContent(),/天气/);}
    if(options.empty)assert.equal(await page.locator('#session-summary').getAttribute('data-focus'),'insufficient');
  }
  await showSummary(summaryFixture({mode:'free',textOnly:true}));assert.match(await page.locator('#session-summary .summary-label').textContent(),/尚无尝试记录/);
  await showSummary(summaryFixture({failed:true}));assert.match(await page.locator('#session-summary').textContent(),/对话提前结束/);
  for(const reason of ['safety','authorization']) {
    const packet=summaryFixture();await showSummary(packet);await page.evaluate(reason=>window.summaryFixture.suppress(reason),reason);
    assert.equal(await page.locator('#session-summary').isVisible(),false);
    assert.equal(await page.evaluate(packet=>window.summaryFixture.accept(packet),packet),false);
    await page.evaluate(()=>window.summaryFixture.finish());assert.equal(await page.locator('#session-summary .summary-card').count(),0);
    assert.equal(await page.locator('#session-summary').getAttribute('data-focus'),'unavailable');
  }
  const literal=summaryFixture();literal.summary.headline.zh='<img src=x onerror="window.summaryInjected=true">';await showSummary(literal);
  assert.equal(await page.locator('#session-summary img').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.summaryInjected)),false);
  await page.evaluate(()=>{window.summaryFixture.begin('summary-missing','sports');window.summaryFixture.finish();});
  assert.equal(await page.locator('#session-summary').getAttribute('data-focus'),'unavailable');
  await page.evaluate(()=>window.summaryFixture.reset());assert.equal(await page.locator('#session-summary').isVisible(),false);assert.equal(await page.locator('#summary-jump').isVisible(),false);
  await page.getByRole('link',{name:'工程回放'}).click();await page.locator('#start').click();await page.waitForFunction(()=>document.querySelector('#summary').textContent.includes('attempted'));
  // A failure packet and its subsequent socket close must keep a visible cause.
  const failureServer=createGateway({providerKind:'test',providerFactory:()=>{
    let timer;return {audio:{encoding:'pcm_s16le',input_rate:16000,output_rate:24000,frame_ms:20},
      open:({onFailure})=>{timer=setTimeout(()=>onFailure('PROVIDER_PROTOCOL_ERROR'),30);},close:()=>clearTimeout(timer)};
  }});
  servers.push(failureServer);failureServer.listen(0,'127.0.0.1');await once(failureServer,'listening');
  await page.goto(`http://127.0.0.1:${failureServer.address().port}`);await page.locator('#connect').click();
  await page.getByText('语音服务返回的数据无法处理，对话已中断。请重新开始。',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#connect').disabled);
  assert.equal(await page.locator('#connection-status').textContent(),'连接中断');
  assert.equal(await page.locator('#session-message').getAttribute('data-state'),'failed');
  assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
  // Synthetic Seeduplex transport: inspect actual Web selection -> ticket -> session.create.
  // Withhold provider ready; never expose the synthetic peer as connected or open the microphone.
  const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
  profile.reviewed=true;profile.realtime.reviewed=true;profile.realtime.ordered_acks_reviewed=true;
  const creates=[];
  const paceServer=createGateway({providerKind:'test',speechPaceSupported:true,providerFactory:ticket=>{
    const socket=new EventEmitter();Object.assign(socket,{readyState:1,bufferedAmount:0,send:value=>{const packet=JSON.parse(value);if(packet.type==='session.create')creates.push(packet);},terminate:()=>{}});
    const provider=createDoubaoProvider({profile,speechPace:ticket.speech_pace,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});
    const open=provider.open.bind(provider);provider.open=options=>{open(options);socket.emit('open');};return provider;
  }});
  servers.push(paceServer);paceServer.listen(0,'127.0.0.1');await once(paceServer,'listening');
  await page.goto(`http://127.0.0.1:${paceServer.address().port}/?diagnostics=1`);
  await page.waitForFunction(()=>!document.querySelector('#speech-pace').disabled);
  assert.equal(await page.locator('#speech-pace').inputValue(),'slow');
  await page.locator('#connect').click();await page.getByText('本次语速：慢速；可以说“慢一点”“快一点”或“恢复正常”。',{exact:true}).waitFor();
  assert.equal(await page.locator('#speech-pace').isDisabled(),true);assert.equal(creates[0].session.audio.output.speed,-20);
  assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
  await page.locator('#end').click();await page.waitForFunction(()=>!document.querySelector('#connect').disabled);
  assert.equal(await page.locator('#session-summary').isVisible(),true);assert.equal(await page.locator('#session-summary').getAttribute('data-focus'),'insufficient');
  assert.equal(await page.locator('#summary-jump').isVisible(),true);assert.equal(await page.locator('#session-summary .summary-card').count(),0);
  assert.equal(await page.locator('#speech-pace').isDisabled(),false);
  await page.locator('#diagnostics summary').click();
  const paceDownloaded=page.waitForEvent('download');await page.locator('#diagnostic-export').click();
  const paceStream=await(await paceDownloaded).createReadStream(),paceChunks=[];for await(const chunk of paceStream)paceChunks.push(chunk);
  const paceReport=JSON.parse(Buffer.concat(paceChunks).toString());assert.equal(paceReport.kind,'synthetic');
  const paceRow=paceReport.timeline.find(r=>r.clock==='gateway' && r.name==='session.config');assert.equal(paceRow.speech_pace,'slow');assert.equal(paceRow.output_speed,-20);
  await page.locator('#speech-pace').selectOption('normal');await page.locator('#session-summary .summary-restart').click();
  assert.equal(await page.locator('#session-summary').isVisible(),false);
  await page.getByText('本次语速：正常；可以说“慢一点”“快一点”或“恢复正常”。',{exact:true}).waitFor();assert.equal(creates[1].session.audio.output.speed,0);
  await page.locator('#end').click();await page.waitForFunction(()=>!document.querySelector('#connect').disabled);
  // FreeTalk has one entry. Reselecting it keeps the completed summary;
  // starting a new session above is what clears the old one.
  await page.locator('[data-mode=free]').click();assert.equal(await page.locator('#session-summary').isVisible(),true);assert.equal(await page.locator('#summary-jump').isVisible(),true);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'.local/browser-check/speech-pace-mobile.png',fullPage:true});
  // Real local mock HTTP service and signed cookies; the voice provider is absent.
  const backend=await startMockBackend();backends.push(backend);
  const pocServer=createGateway({...backend});servers.push(pocServer);pocServer.listen(0,'127.0.0.1');await once(pocServer,'listening');
  const pocOrigin=`http://127.0.0.1:${pocServer.address().port}`;
  await page.goto(pocOrigin);await page.waitForFunction(()=>!document.querySelector('#memory-save').disabled);
  assert.equal(await page.locator('#backend-note').isVisible(),true);assert.match(await page.locator('#backend-note').textContent(),/本地 mock/);
  assert.equal(await page.evaluate(()=>document.cookie.includes('ask_kai_launch')),false);
  await page.waitForFunction(()=>!document.querySelector('#mock-learner-select').disabled && !document.querySelector('#learner-profile').hidden);
  assert.equal(await page.locator('#mock-learner-select option').count(),4);
  await page.locator('#learner-profile > summary').click();
  assert.match(await page.locator('#learner-profile-content').textContent(),/Alex.*HSK1/s);
  const switchCases=[['mock-maya-hsk3','Maya','HSK3'],['mock-leo-hsk5','Leo','HSK5'],['mock-nina-hsk7','Nina','HSK7'],['poc-learner','Alex','HSK1']];
  for(const [uid,name,level] of switchCases) {
    await page.locator('#mock-learner-select').selectOption(uid);
    await page.waitForFunction(({name,level})=>!document.querySelector('#mock-learner-select').disabled && document.querySelector('#learner-profile-content').textContent.includes(name+' · '+level),{name,level});
    const content=await page.locator('#learner-profile-content').textContent();assert.match(content,/个人画像/);assert.match(content,/学习画像/);assert.match(content,/近期学习记录/);assert.match(content,/模拟掌握/);
    assert.match(content,/完整累计知识目录/);assert.match(content,/交流技能摘要/);assert.match(content,/已模拟通过/);
    if(level==='HSK3'){assert.match(content,/HSK1：70 项；模拟掌握 70 项/);assert.match(content,/HSK2：78 项；模拟掌握 78 项/);assert.match(content,/累计模拟掌握 244/);}
    if(level==='HSK7')assert.match(content,/HSK7-9：134 项；模拟掌握 72 项/);
    assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
    assert.equal(await page.locator('#connection-status').textContent(),'未连接');
  }
  await page.locator('#learner-profile').screenshot({path:'.local/browser-check/four-learners-mobile.png'});
  await page.locator('details.memory:has(#memory-form) > summary').click();
  // Expire the launch cookie without waiting 60 seconds. Each protected action refreshes it.
  await page.context().clearCookies();await page.locator('#memory-value').fill('篮球');await page.locator('#memory-save').click();
  await page.getByText('偏好已更正；后续回合将使用新偏好。',{exact:true}).waitFor();assert.match(await page.locator('#memory-list').textContent(),/篮球/);
  for(const [field,value,display] of [['known_expressions','茶，音乐','茶,音乐'],['chinese_comprehension','comfortable','comfortable'],['support_language','auto','auto']]) {
    await page.locator('#memory-field').selectOption(field);await page.locator('#memory-value').fill(value);await page.locator('#memory-save').click();
    await page.waitForFunction(display=>document.querySelector('#memory-list').textContent.includes(display),display);
  }
  await page.context().clearCookies();const memoryDownload=page.waitForEvent('download');await page.locator('#memory-export').click();
  const memoryStream=await(await memoryDownload).createReadStream(),memoryChunks=[];for await(const chunk of memoryStream)memoryChunks.push(chunk);
  const exportedMemory=JSON.parse(Buffer.concat(memoryChunks).toString()).records;
  assert.equal(exportedMemory[0].value,'篮球');assert.deepEqual(exportedMemory.find(r=>r.field==='known_expressions').value,['茶','音乐']);
  await page.locator('#connect').click();await page.getByText('实时语音尚未开通。需完成豆包协议和服务端连接验证。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.microphoneRequests),0);assert.equal(await page.locator('#connection-status').textContent(),'未连接');
  await page.locator('#memory-delete').click();await page.getByText('偏好已删除，当前对话已结束。',{exact:true}).waitFor();assert.equal(await page.locator('#memory-list li').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.local/browser-check/poc-mobile.png',fullPage:true});
  // Dynamic preparation uses synthetic learner evidence and no voice/model key.
  // It must change goals for fixture B and keep free chat empty, even after
  // rapid entry changes. This is UI/contract verification, not LLM quality.
  const dynamicBackend=await startMockBackend({fixtureVariant:'b'});backends.push(dynamicBackend);
  const dynamicServer=createGateway({...dynamicBackend,planningMode:'next_turn_advisory'});servers.push(dynamicServer);dynamicServer.listen(0,'127.0.0.1');await once(dynamicServer,'listening');
  await page.goto(`http://127.0.0.1:${dynamicServer.address().port}`);
  await page.getByText('对话已准备；规划模型尚未配置，当前使用保守策略。',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#goal').textContent==='由你选择话题，自然交流。');
  assert.equal(await page.locator('#save-learning-input').isChecked(),true);
  assert.equal(await page.locator('#save-learning-input').isDisabled(),true);
  await page.waitForTimeout(150);assert.equal(await page.locator('.word-card').isVisible(),false);assert.equal(await page.locator('#prompt-hint').textContent(),'');
  assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
  await page.locator('#connect').click();await page.getByText('实时语音尚未开通。需完成豆包协议和服务端连接验证。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.microphoneRequests),0);assert.equal(await page.locator('#connection-status').textContent(),'未连接');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.local/browser-check/dynamic-free-mobile.png',fullPage:true});
  const goalIdentity=dynamicBackend.bridge.verify(await dynamicBackend.pocPort.issue(),'session:create'),goalInitializer=new ConversationInitializer({port:dynamicBackend.planningPort});
  const goalBound=new Preparations({initializer:goalInitializer}).bind(await goalInitializer.prepare({mode:'topic',topic_id:'sports'},goalIdentity),'browser-goals');
  const goalSession=new TeachingSession({sessionId:'browser-goals',mode:'sports',planning:goalBound});
  for(const [i,text] of ['我下午打篮球。','我想练习喜好表达。','我喜欢跑步。','取消这个目标。'].entries()) {
    const e={version:1,event_id:'browser-input-'+i,session_id:'browser-goals',seq:i+1,at_ms:i,type:'user.final',turn_id:'browser-turn-'+i,payload:{text}};
    goalSession.accept(e);await goalSession.planTurn(e);
  }
  const goalSummary=goalSession.finalize({businessSource:'mock_hskai',providerKind:'test',ready:true});
  await page.evaluate(async()=>{const {SummaryCards}=await import('/summary-cards.js');window.summaryFixture=new SummaryCards({root:document.querySelector('#session-summary'),link:document.querySelector('#summary-jump')});});
  await showSummary({type:'teaching.summary',session_id:'browser-goals',summary:goalSummary});
  assert.equal(await page.locator('#session-summary .summary-goal').count(),2);
  assert.equal(await page.locator('#session-summary .summary-observation').count(),2);
  assert.match(await page.locator('#session-summary').textContent(),/已停止/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#session-summary').screenshot({path:'.local/browser-check/dynamic-goals-summary-mobile.png'});
  // Opt-in request-content observation uses the real preparation HTTP path,
  // stays separate from the metadata diagnostics, and renders text literally.
  await page.goto(`http://127.0.0.1:${dynamicServer.address().port}/?observe=1`);
  await page.getByText('对话已准备；规划模型尚未配置，当前使用保守策略。',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#planning-observation ol').textContent.includes('初始计划已采用'));
  assert.equal(await page.locator('#diagnostics').isVisible(),false);
  const observationCount=await page.locator('#planning-observation ol > li').count();
  assert.ok(observationCount>=4);await page.waitForTimeout(150);
  assert.equal(await page.locator('#planning-observation ol > li').count(),observationCount);
  await page.locator('#planning-observation select').selectOption('voice');
  assert.equal(await page.locator('#planning-observation ol > li:visible').count(),0);
  await page.locator('#planning-observation select').selectOption('all');
  const observationDownloadPromise=page.waitForEvent('download');await page.locator('[data-observation-export]').click();
  const observationDownload=await observationDownloadPromise,observationStream=await observationDownload.createReadStream(),observationChunks=[];
  for await(const chunk of observationStream)observationChunks.push(chunk);
  const observationReport=JSON.parse(Buffer.concat(observationChunks).toString());
  assert.equal(observationReport.contains_text,true);assert.equal(observationReport.contains_audio,false);
  assert.ok(observationReport.rows.some(row=>row.stage==='planning.fallback'));
  await page.locator('#mock-learner-select').selectOption('mock-maya-hsk3');
  await page.waitForFunction(()=>!document.querySelector('#mock-learner-select').disabled&&document.querySelector('#planning-observation ol').textContent.includes('初始计划已采用'));
  assert.ok(!(await page.locator('#planning-observation ol').textContent()).includes(observationReport.rows.find(row=>row.stage==='preparation.started').data.preparation_id));
  await page.evaluate(async()=>{
    const {PlanningObserver}=await import('/planning-observer.js');
    window.observationFixture=new PlanningObserver(document.querySelector('#planning-observation'),{enabled:true,limit:3});
    const row={trace_id:'authored-ui-fixture',seq:1,at_ms:1,stage:'planner.request',data:{kind:'turn',body:{messages:[{role:'user',content:'<img src=x onerror="window.observationInjected=true">'}]}}};
    window.observationFixture.record(row);window.observationFixture.record(row);
  });
  assert.equal(await page.locator('#planning-observation ol > li').count(),1);
  await page.locator('#planning-observation ol summary').click();
  assert.equal(await page.locator('#planning-observation img').count(),0);
  assert.equal(await page.evaluate(()=>Boolean(window.observationInjected)),false);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#planning-observation').screenshot({path:'.local/browser-check/planning-observation-mobile.png'});
  // The conversation report workflow needs no query switch or manual event sorting.
  const reportStore=new ObservationReports(),reportIdentity=dynamicBackend.bridge.verify(await dynamicBackend.pocPort.issue(),'session:create');
  const reportSummary=new ObservationSummary({traceId:'browser-report-trace'});let reportSeq=0;
  const reportEvent=(stage,data)=>reportSummary.consume({stage,data,seq:++reportSeq,at_ms:reportSeq});
  reportEvent('planning.triggered',{input:{student_profile:{preferred_name:'Alex'},speaking_constraints:{profile_level:1}}});
  reportEvent('preparation.ready',{plan:{conversation_purpose:'回应当天安排',strategy:{speaking_difficulty:{lexical_style:'everyday',sentence_structure:'simple',new_word_policy:'avoid'}}}});
  reportEvent('voice.context.prepared',{session_id:'browser-report-session',provider_kind:'test',synthetic:true,context_version:1,context_hash:'a'.repeat(64),instructions:'完整的合成指令：普通主动用词不超过 HSK1。'});
  reportEvent('voice.request.sent',{context_version:1,context_hash:'a'.repeat(64),body:{session:{instructions:'完整的合成指令：普通主动用词不超过 HSK1。',model:'synthetic-model'}}});
  reportEvent('voice.connection',{log_id:'synthetic-log-for-browser'});
  reportEvent('student.input.accepted',{turn_id:'browser-report-turn',source_event_id:'browser-report-input',text:'今天不踢球。'});
  reportEvent('voice.reply.started',{turn_id:'browser-report-turn',response_id:'browser-report-reply',applied_context_version:1,applied_context_hash:'a'.repeat(64)});
  reportEvent('voice.reply.forwarded',{response_id:'browser-report-reply',text:'<img src=x onerror="window.reportInjected=true">',status:'response.done'});
  reportEvent('session.ended',{state:'closed'});await reportStore.save(reportIdentity,reportSummary.snapshot());
  const reportServer=createGateway({...dynamicBackend,planningMode:'next_turn_advisory',observationReports:reportStore});servers.push(reportServer);reportServer.listen(0,'127.0.0.1');await once(reportServer,'listening');
  await page.goto(`http://127.0.0.1:${reportServer.address().port}`);
  await page.waitForFunction(()=>!document.querySelector('[data-report-export]').disabled);
  assert.match(await page.locator('[data-report-status]').textContent(),/1\/5/);
  assert.match(await page.locator('[data-report-content]').textContent(),/synthetic-log-for-browser/);
  await page.locator('[data-report-content] summary').first().click();
  assert.equal(await page.locator('[data-report-content] img').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.reportInjected)),false);
  await page.locator('[data-review-field="expected_response"]').fill('没关系。今天可以休息。');
  await page.locator('[data-review-field="expected_effect"]').fill('只用 HSK1 词汇');
  const summaryDownloadPromise=page.waitForEvent('download');await page.locator('[data-report-export]').click();
  const summaryDownload=await summaryDownloadPromise,summaryStream=await summaryDownload.createReadStream(),summaryChunks=[];for await(const chunk of summaryStream)summaryChunks.push(chunk);
  const summaryMarkdown=Buffer.concat(summaryChunks).toString();
  for(const value of ['synthetic-log-for-browser','完整的合成指令','今天不踢球','没关系。今天可以休息。','只用 HSK1 词汇'])assert.ok(summaryMarkdown.includes(value));
  assert.equal(summaryDownload.suggestedFilename(),'ask-kai-observation-browser-report-session.md');
  await page.reload();await page.waitForFunction(()=>!document.querySelector('[data-report-export]').disabled);
  assert.equal(await page.locator('[data-review-field="expected_response"]').inputValue(),'没关系。今天可以休息。');
  await page.locator('[data-report-content] summary').first().click();await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#observation-reports').screenshot({path:'.local/browser-check/observation-report-mobile.png'});
  // A missing new report must not silently export an older conversation.
  const pendingReport=await page.evaluate(async()=>{
    const {ObservationReportsPanel}=await import('/observation-reports.js');
    const panel=new ObservationReportsPanel(document.querySelector('#observation-reports').cloneNode(true),{fetcher:path=>fetch(path)});
    await panel.refresh();panel.begin('new-unpersisted-session');await panel.finish();
    const pending={disabled:panel.exportButton.disabled,selection:panel.select.value,report:panel.report,status:panel.status.textContent};
    await panel.load('browser-report-session');return {...pending,historical:panel.report.id};
  });
  assert.equal(pendingReport.disabled,true);assert.equal(pendingReport.selection,'');assert.equal(pendingReport.report,null);assert.match(pendingReport.status,/本场总结尚未保存/);assert.equal(pendingReport.historical,'browser-report-session');
  await page.locator('#mock-learner-select').selectOption('mock-maya-hsk3');
  await page.waitForFunction(()=>document.querySelector('[data-report-status]').textContent.includes('尚无会话观测总结'));
  assert.equal(await page.locator('[data-report-export]').isDisabled(),true);assert.equal(await page.locator('[data-report-content]').textContent(),'');
  assert.equal(errors.length,0);
  console.log(JSON.stringify({browser:'chromium',input:'synthetic_device',provider_connected:false,web_controls:true,mobile_overflow:false,microphone_before_readiness:false,audio_worklet_pcm:true,capture_continues_during_output_stop:true,progressive_captions:true,native_caption_clock:true,caption_pause_resume:true,caption_controls:true,diagnostics_export:true,audio_metadata:true,speech_pace_selection:true,speech_pace_session_lock:true,speech_pace_wire_payload:true,poc_mock_backend:true,four_learner_switching:true,three_learner_services:true,poc_cookie_refresh:true,poc_mission:true,poc_preferences:true,adaptive_language_preferences:true,summary_cards:true,summary_empty_partial_states:true,summary_session_isolation:true,summary_safety_revocation:true,summary_restart:true,summary_literal_text:true,observation_report_workflow:true,observation_report_authorization:true,observation_report_export:true,planning_observation:true,planning_observation_literal_text:true,dynamic_preparations:true,dynamic_evidence_goal:true,dynamic_free_empty:true,dynamic_entry_race:true,dynamic_goal_history_summary:true,replay:true,page_errors:0}));
}finally{await browser?.close();for(const item of servers){item.stopRealtime();await new Promise(resolve=>{item.close(resolve);item.closeAllConnections();});}for(const backend of backends)await backend.close();}
