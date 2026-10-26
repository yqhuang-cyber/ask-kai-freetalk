import { ObservationReportsPanel } from './observation-reports.js';
import { PlanningObserver } from './planning-observer.js';
import { ClosingPlayback } from './closing-playback.js';
import { SpeechPlayback, speechStateMessage } from './speech-playback.js';
import { AudioIO } from './audio.js';
import { voiceReadiness } from './voice-readiness.js';
import { Presentation } from './presentation.js';
import { ExperienceTrace } from './diagnostics.js';
import { SummaryCards } from './summary-cards.js';
import { PreparationClient,preparationReadyMessage } from './preparation-client.js';
import { failureCode,failureMessage } from './failure-messages.js';
const observationEnabled=new URLSearchParams(location.search).get('observe')==='1';
const planningObserver=new PlanningObserver(document.querySelector('#planning-observation'),{enabled:observationEnabled});
const diagnosticsEnabled=new URLSearchParams(location.search).get('diagnostics')==='1';
const trace=diagnosticsEnabled?new ExperienceTrace():null;
let selectedLearner='poc-learner',learnerEpoch=0,learnerSwitching=false,authorizationQueue=Promise.resolve();
const runtimeReady=fetch('/api/runtime').then(r=>{if(!r.ok)throw new Error('RUNTIME_UNAVAILABLE');return r.json();}).then(runtime=>{
  if(runtime.backend==='mock_hskai') {
    document.querySelector('#backend-note').hidden=false;document.querySelector('#session-record-note').hidden=false;
    document.querySelector('footer').textContent='Ask Kai 自由对话 · 学习者资料使用本地 mock；语音状态单独显示。';
  }
  return runtime;
}).catch(()=>({backend:'unconfigured'}));
function authorizedFetch(path,options={}) {
  const uid=selectedLearner,epoch=learnerEpoch;
  const work=authorizationQueue.then(async()=> {
    if(epoch!==learnerEpoch)throw new Error('LEARNER_CHANGED');options.signal?.throwIfAborted();
    const mock=(await runtimeReady).backend==='mock_hskai';
    if(mock) {
      const launch=await fetch('/api/poc/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid}),signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(3000)]):AbortSignal.timeout(3000)});
      if(!launch.ok)throw new Error('MOCK_HSKAI_UNAVAILABLE');
    }
    if(epoch!==learnerEpoch)throw new Error('LEARNER_CHANGED');
    const headers=new Headers(options.headers);if(mock)headers.set('X-Ask-Kai-Mock-Uid',uid);
    const response=await fetch(path,{...options,headers});if(epoch!==learnerEpoch)throw new Error('LEARNER_CHANGED');return response;
  });
  // The launch cookie is shared: serialize authorization + request so pending
  // preparation, profile and session requests cannot borrow another learner's cookie.
  authorizationQueue=work.catch(()=>{});return work;
}
const observationReports=new ObservationReportsPanel(document.querySelector('#observation-reports'),{fetcher:authorizedFetch});
const diagnosticPanel=document.querySelector('#diagnostics'),caseSelect=document.querySelector('#diagnostic-case'),outcomeSelect=document.querySelector('#diagnostic-outcome');
let diagnosticCase='unselected';
diagnosticPanel.hidden=!diagnosticsEnabled;
function refreshDiagnostics() {if(trace){document.querySelector('#diagnostic-count').textContent=`已记录 ${trace.rows.length} 条元数据事件${trace.discarded?'（已截断）':''}。`;document.querySelector('#diagnostic-export').disabled=!trace.rows.length;}}
const observe=(name,fields)=>{trace?.record(name,fields);refreshDiagnostics();};
if(diagnosticsEnabled) {
  void fetch('/experience-cases.json').then(r=>r.json()).then(data=>{
    for(const item of data.cases){const option=document.createElement('option');option.value=item.id;option.textContent=`${item.id} · ${item.title}`;caseSelect.append(option);}
    caseSelect.addEventListener('change',()=>{const item=data.cases.find(c=>c.id===caseSelect.value);document.querySelector('#diagnostic-guide').textContent=item?`${item.action} ${item.check}`:'每次选择一个场景，开始新会话后测试。';});
  }).catch(()=>{document.querySelector('#diagnostic-guide').textContent='测试场景加载失败，请刷新。';});
  document.querySelector('#diagnostic-export').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(trace.snapshot({caseId:diagnosticCase,outcome:outcomeSelect.value}),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`ask-kai-baseline-${diagnosticCase}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
}
const closePhases={preparing_close:'开始收束',presenting_close:'正在说收束',awaiting_playback:'等播放完再结束',interrupted:'收束被打断',cancelled:'收束取消了',finalizing_record:'正在写入小结'};
function appendCloseLog(title,note,body) {
  const list=document.querySelector('#close-log-list');if(!list)return;
  const item=document.createElement('li');
  const heading=document.createElement('strong');heading.textContent=title;item.append(heading);
  if(note){const line=document.createElement('p');line.textContent=note;item.append(line);}
  if(body){const block=document.createElement('pre');block.textContent=JSON.stringify(body,null,2);item.append(block);}
  list.append(item);item.scrollIntoView({block:'nearest'});
}
function clearCloseLog() {document.querySelector('#close-log-list')?.replaceChildren();}
const modes=[...document.querySelectorAll('[data-mode]')];
const goal=document.querySelector('#goal'),promptTitle=document.querySelector('#prompt-title'),promptHint=document.querySelector('#prompt-hint');
const connect=document.querySelector('#connect'),status=document.querySelector('#connection-status'),message=document.querySelector('#session-message');
const summaryCards=new SummaryCards({root:document.querySelector('#session-summary'),link:document.querySelector('#summary-jump'),onRestart:()=>connect.click(),onReadRecord:async(id,label)=>{try{const r=await authorizedFetch(`/api/conversations/${id}`);if(!r.ok)throw new Error('NOT_SAVED');const result=await r.json();label.textContent=result.record?`服务端已保存本次小结（版本 ${result.record.summary.revision}）；本地 mock 内存，重启重置。`:'服务端已创建会话，小结尚未保存。';}catch{label.textContent='暂未查到本次保存结果，请稍后重试。';}}});
const mute=document.querySelector('#mute'),end=document.querySelector('#end'),caption=document.querySelector('#caption'),student=document.querySelector('#student-caption');
const paceSelect=document.querySelector('#speech-pace'),paceHint=document.querySelector('#speech-pace-hint');
const learnerSelect=document.querySelector('#mock-learner-select'),learnerHint=document.querySelector('#mock-learner-hint');
let paceSupported=false;
let mode='free',ws,io,generation=0,config,muted=false,safetyMessage=null;
let slidesViewer=null,slidesEpoch=0;
let entryPreviews={},dynamicPlanning=false,preparationPromise=null,preparationEpoch=0;
const saveLearning=document.querySelector('#save-learning');
const interrupt=document.querySelector('#interrupt');
const captionHint=document.querySelector('#caption-hint');
const presentation=new Presentation({render:(text,parts)=>{
  const previous=document.createElement('span'),current=document.createElement('strong');
  previous.className=parts?.complete?'caption-complete':'caption-previous';previous.textContent=parts?.previous??text;
  current.className='caption-current';current.textContent=parts?.current??'';caption.replaceChildren(previous,current);
},play:(audio,rate,id)=>io?.play(audio,rate,id),getPlayback:id=>io?.playback(id),stopAudio:()=>io?.stopPlayback(),onMode:(mode,details)=>{
  if(mode==='complete'){closingPlayback.check();speechPlayback.check();}
  captionHint.textContent=mode==='complete'?(details.has_text?details.text_only?'本轮仅有文字回复，已显示完毕。':'本轮回复已显示。':'本轮没有收到字幕。'):({idle:'字幕会随回复逐段出现。',waiting_audio:'等待语音开始……',playing:'当前字幕短语已加深显示。',paused:'播放已暂停，字幕会随播放继续。',text_only:'本轮未收到语音，正在显示文字回复。'})[mode];
},onObserve:diagnosticsEnabled?observe:undefined});
const closingPlayback=new ClosingPlayback({presentation,getPlayback:id=>io?.playback(id),isMuted:()=>muted,send:packet=>{if(ws?.readyState!==WebSocket.OPEN)return false;ws.send(JSON.stringify(packet));return true;}});
const speechPlayback=new SpeechPlayback({presentation,getPlayback:id=>io?.playback(id),isMuted:()=>muted,send:packet=>{if(ws?.readyState!==WebSocket.OPEN)return false;ws.send(JSON.stringify(packet));return true;}});
function learning(packet) {
  goal.textContent=packet.goal;promptHint.textContent=packet.start_tip;
  const details=packet.goal_details;
  clearGoalDetails();
  if(details){document.querySelector('#goal-details').hidden=false;document.querySelector('#goal-state').textContent=details.status==='active'?'已准备；交流中可以调整或暂停。':'该练习已暂停。';document.querySelector('#goal-expression-task').textContent=details.expression_task;document.querySelector('#goal-key-points').replaceChildren(...details.key_points.map(k=>{const li=document.createElement('li');li.textContent=k.label;return li;}));}
  if(packet.prompt_title)promptTitle.textContent=packet.prompt_title;
  const card=packet.cards[0];document.querySelector('.word-card').hidden=!card;
  if(card)for(const [key,id] of Object.entries({word:'word-chinese',pinyin:'word-pinyin',english:'word-english',example:'word-example'}))document.getElementById(id).textContent=card[key];
  const count=packet.attempt_count??packet.attempts.length;
  document.querySelector('#learning-attempts').textContent=count ? `本轮记录 ${count} 次表达尝试。未评估掌握或发音。` : '本轮尚未记录目标表达尝试。';
}
function clearGoalDetails(){document.querySelector('#goal-details').hidden=true;document.querySelector('#goal-key-points').replaceChildren();document.querySelector('#goal-expression-task').textContent='';document.querySelector('#goal-state').textContent='';}
const entry=()=>({mode:'free',...(paceSupported?{speech_pace:paceSelect.value}:{})});
const preparer=new PreparationClient({fetcher:authorizedFetch,observe:true,onObservation:report=>planningObserver.snapshot(report),onView:learning,onStatus:(state,details)=> {
  if(state==='preparing'){clearGoalDetails();goal.textContent='正在规划本次对话……';promptHint.textContent='';document.querySelector('.word-card').hidden=true;message.textContent='正在准备对话……';}
  else if(state==='ready')message.textContent=preparationReadyMessage(details);
  else if(state==='failed'){clearGoalDetails();goal.textContent='本次对话尚未准备完成。';message.textContent='对话准备失败，请重新开始。';}
}});
function prepareSelected(){if(!dynamicPlanning)return;const epoch=++preparationEpoch;preparationPromise=preparer.prepare(entry()).then(id=>epoch===preparationEpoch?id:null);}
function suppressLearning(reason){summaryCards.suppress(reason);clearGoalDetails();goal.textContent='';promptHint.textContent='';document.querySelector('.word-card').hidden=true;document.querySelector('#learning-attempts').textContent='本轮没有可展示的学习记录。';}
void runtimeReady.then(runtime=>{entryPreviews=runtime.entry_previews??{};dynamicPlanning=runtime.planning?.available===true;saveLearning.hidden=!dynamicPlanning||runtime.planning.mode==='shadow';if(entryPreviews[mode])learning(entryPreviews[mode]);});
function controls(active) {connect.disabled=active||learnerSwitching;learnerSelect.disabled=active||learnerSwitching;caseSelect.disabled=active;paceSelect.disabled=active||learnerSwitching || !paceSupported;if(!active)paceHint.textContent=paceSupported?'开聊前选择，结束后可切换。':'当前服务暂不支持选择语速。';for(const button of modes)button.disabled=active||learnerSwitching;end.disabled=!active;mute.disabled=!active;interrupt.disabled=!active;}
async function loadSpeechPaces() {
  try {
    const response=await fetch('/api/speech-paces');if(!response.ok)throw new Error('PACE_UNAVAILABLE');
    const result=await response.json();paceSupported=result.supported===true;
    if(paceSupported){paceSelect.replaceChildren();for(const item of result.options){const option=document.createElement('option');option.value=item.id;option.textContent=item.label;paceSelect.append(option);}paceSelect.value=result.default;}
    paceSelect.disabled=connect.disabled || !paceSupported;
    paceHint.textContent=paceSupported?'开聊前选择，结束后可切换。':'当前服务暂不支持选择语速。';
  }catch{paceSelect.disabled=true;paceHint.textContent='语速选项暂不可用。';}
}
void loadSpeechPaces();
async function stop(text='对话已结束。',failed=false) {
  closingPlayback.reset();speechPlayback.reset();summaryCards.finish();slidesEpoch++;slidesViewer?.close();
  const stopped=++generation;const previous=ws;ws=null;previous?.close();
  preparationEpoch++;preparer.cancel();preparationPromise=null;
  status.textContent=failed?'连接中断':'未连接';message.textContent=text;message.dataset.state=failed?'failed':'idle';
  const audio=io;io=null;audio?.stopCapture();await audio?.drain();
  presentation.reset();caption.textContent='';student.textContent='';
  await audio?.close();
  observe('session.end',{state:'closed'});
  if(stopped!==generation)return;
  controls(false);void observationReports.finish();
  document.querySelector('.preview').textContent='Web 对话 · 豆包未连接';
  muted=false;mute.setAttribute('aria-pressed','false');mute.textContent='静音';
}
connect.addEventListener('click',async()=> {
  clearCloseLog();
  summaryCards.reset();
  trace?.reset();diagnosticCase=caseSelect.value;outcomeSelect.value='not_run';refreshDiagnostics();
  const current=++generation;controls(true);status.textContent='检查连接';message.textContent='正在检查实时服务……';message.dataset.state='idle';
  const selectedPace=paceSupported?paceSelect.value:undefined;
  safetyMessage=null;
  document.querySelector('#learning-attempts').textContent='本轮尚无对话记录。';
  try {
    io=new AudioIO({onFrame:bytes=> {
      if(ws?.readyState===WebSocket.OPEN){if(ws.bufferedAmount>65536){void stop('网络上传拥塞，请重新开始。',true);return;}ws.send(bytes);}
    },onFailure:text=>{observe('browser.failed',{code:'other'});void stop(text,true);},onObserve:diagnosticsEnabled?observe:undefined});
    await io.prepare();
    const runtime=await runtimeReady;
    let preparationId;
    if(dynamicPlanning&&runtime.voice_configured) {
      status.textContent='准备对话';
      // Prepare anew at start: displayed results may have expired or preferences
      // may have changed while the learner was reviewing the entry.
      preparationEpoch++;preparationId=await preparer.prepare(entry());
      if(current!==generation)return;
      if(!preparationId){await stop(message.textContent);return;}
    }
    const response=await authorizedFetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...entry(),...(selectedPace?{speech_pace:selectedPace}:{}),...(preparationId?{preparation_id:preparationId}:{})}),signal:AbortSignal.timeout(8000)});
    const result=await response.json();if(current!==generation)return;
    if(!response.ok){await stop(response.status===501?'实时语音尚未开通。需完成豆包协议和服务端连接验证。':'会话无法创建，请检查授权或服务容量。');return;}
    summaryCards.begin(result.session_id,'free');observationReports.begin(result.session_id);
    config=null;status.textContent='连接中';
    ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${result.websocket_path}`,[result.protocol,`ticket.${result.ticket}`]);
    ws.onopen=()=>{if(current===generation && diagnosticsEnabled)ws.send(JSON.stringify({type:'diagnostics.enable'}));};
    ws.onmessage=async event=> {
      if(current!==generation)return;
      try {
        const packet=JSON.parse(event.data);
        if(packet.type==='observation.report.saved'){observationReports.receipt(packet);return;}
        if(packet.type==='planning.observation'){planningObserver.record(packet.row);return;}
        if(packet.type==='diagnostics.event'){trace?.gateway(packet.row);refreshDiagnostics();return;}
        if(packet.type==='slides.bind'){
          const viewerEpoch=++slidesEpoch;
          try{const [{SlidesViewer},deck]=await Promise.all([import('/slides-viewer.js'),fetch('/slides/demo-deck.json').then(response=>{if(!response.ok)throw new Error('SLIDES_DECK_UNAVAILABLE');return response.json();})]);
          if(current!==generation||viewerEpoch!==slidesEpoch)return;
          slidesViewer?.close();document.querySelector('#courseware').hidden=false;
          document.querySelector('#courseware-source').textContent=packet.demo_history?'作者演示课件 · 正在依次展示三页以建立测试历史；不代表已经学习。':'作者演示课件 · 只可回看已展示内容。';
          slidesViewer=new SlidesViewer(document.querySelector('#slides-container'),deck);
          const socket=ws;slidesViewer.bind(packet,value=>{if(current===generation&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));});}catch{if(current!==generation||viewerEpoch!==slidesEpoch)return;slidesViewer?.close();document.querySelector('#courseware-source').textContent='演示课件暂不可用，本次继续自由聊天。';}return;
        }
        if(packet.type==='slides.unavailable'){slidesEpoch++;slidesViewer?.close();document.querySelector('#courseware-source').textContent='演示课件暂不可用，本次继续自由聊天。';return;}
        if(packet.type?.startsWith('slides.')){await slidesViewer?.receive(packet);return;}
        if(packet.type==='session.config'){config=packet.audio;paceHint.textContent=packet.speech?.supported && ['slow','normal'].includes(packet.speech.pace)?`本次语速：${packet.speech.pace==='slow'?'慢速':'正常'}；可以说“慢一点”“快一点”或“恢复正常”。`:'本次使用服务默认语速。';return;}
        if(packet.type==='speech.state'){paceHint.textContent=speechStateMessage(packet);speechPlayback.update(packet);return;}
        if(packet.type==='close.trace'){appendCloseLog(packet.title??'收束',packet.note??'',packet.body);return;}
        if(packet.type==='session.closing'){
          if(packet.session_id!==summaryCards.state.sessionId)return;
          appendCloseLog(closePhases[packet.phase]??packet.phase,packet.phase==='cancelled'?'这一轮没有结束。':'');
          if(packet.phase==='cancelled'){closingPlayback.reset();summaryCards.clearPreview();message.textContent='继续交流。';return;}
          closingPlayback.update(packet,summaryCards.state.sessionId);status.textContent=packet.phase==='finalizing_record'?'正在保存':'正在收尾';message.textContent=packet.phase==='finalizing_record'?'正在更新本次对话小结……':'Kai 正在总结本次对话，播完后自动结束。';
          if(packet.phase==='finalizing_record')io?.stopCapture();else closingPlayback.check();return;
        }
        if(packet.type==='teaching.summary.preview'){summaryCards.preview(packet);return;}
        if(packet.type==='conversation.record.receipt'){summaryCards.record(packet);return;}
        if(packet.type==='teaching.state'){if(!summaryCards.state.suppressed)learning(packet);return;}
        if(packet.type==='teaching.summary'){appendCloseLog('页面小结已送到',packet.summary?.headline?.zh??'');if(summaryCards.accept(packet))learning(packet);return;}
        if(packet.type==='learning.record.receipt'){document.querySelector('#learning-attempts').textContent=packet.status==='accepted'?'本轮尝试已保存到本地 mock 内存；重启后重置。':'本轮记录未保存，请保留当前小结。';return;}
        if(packet.type==='session.failed'){if(['AUTHORIZATION_REVOKED','SAFETY_RESTRICTED'].includes(packet.code))suppressLearning(packet.code);observe('browser.failed',{code:packet.code});await stop(safetyMessage ?? failureMessage(packet.code),true);return;}
        if(packet.type==='safety.notice'){suppressLearning('safety');safetyMessage=packet.message;message.textContent=safetyMessage;presentation.stop();await io?.close();return;}
        if(packet.type==='safety.handoff'){safetyMessage+=(packet.mocked?' POC 已记录 mock 安全事件，没有真人接手。':packet.delivered?' 已提交给人工处理队列。':' 人工处理服务暂不可用，请直接联系可信任的大人。');message.textContent=safetyMessage;return;}
        if(packet.type==='session.closed'){await stop();return;}
        if(packet.type==='output.stop'){presentation.stop(packet.response_id);return;}
        if(packet.type!=='event')return;
        if(safetyMessage)return;
        const value=packet.event;
        if(value.type==='session.ready') {
          const readiness=voiceReadiness(packet,config);
          if(!readiness){await stop('服务未完成真实就绪验证。');return;}
          status.textContent=readiness.status;document.querySelector('.preview').textContent=readiness.preview;message.textContent=readiness.opening;
          observe('session.ready',{provider_ready:readiness.real_provider});
          await io.start(config);if(current===generation && !safetyMessage)message.textContent=readiness.capture;
        } else if(value.type==='response.started'){observe('response.started',{response_id:value.response_id,turn_id:value.turn_id});presentation.begin(value.response_id);}
        else if(value.type==='response.text.delta')presentation.append(value.response_id,value.payload.text);
        else if(value.type==='user.partial' || value.type==='user.final')student.textContent=value.payload.text;
        else if(value.type==='response.audio.chunk' && packet.audio)presentation.audio(value.response_id,packet.audio,packet.sample_rate);
        else if(value.type==='response.done'){presentation.done(value.response_id);closingPlayback.check();speechPlayback.check();}
      } catch(error) {const code=failureCode(error?.message);observe('browser.failed',{code});await stop(safetyMessage ?? failureMessage(code),true);}
    };
    ws.onerror=()=>{if(current===generation)void stop(safetyMessage ?? '无法连接实时服务，请重试。',true);};
    ws.onclose=()=>{if(current===generation)void stop(safetyMessage ?? '连接已断开，请重新开始。',true);};
  } catch {if(current===generation)await stop('无法开始对话。请检查麦克风权限及本地服务。');}
});
mute.addEventListener('click',()=>{muted=!muted;io?.mute(muted);mute.setAttribute('aria-pressed',String(muted));mute.textContent=muted?'取消静音':'静音';});
end.addEventListener('click',()=>{
  if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:'session.end',save_learning:true}));const current=generation;message.textContent='正在结束对话……';void io?.close();setTimeout(()=>{if(current===generation)void stop();},5500);}
  else void stop();
});
interrupt.addEventListener('click',()=> {
  const response_id=presentation.current;observe('manual.interrupt',{response_id});presentation.stop();
  if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'response.cancel',response_id:response_id ?? undefined}));
});
document.querySelector('#show-subtitles').addEventListener('change',event=>{caption.hidden=!event.target.checked;student.hidden=!event.target.checked;captionHint.hidden=!event.target.checked;});
document.querySelector('#subtitle-size').addEventListener('change',event=>{caption.dataset.size=event.target.value;student.dataset.size=event.target.value;});
window.addEventListener('pagehide',()=>{void stop();});
const memoryStatus=document.querySelector('#memory-status');
async function loadMemory() {
  const epoch=learnerEpoch;
  const response=await authorizedFetch('/api/memory');if(!response.ok)throw new Error('MEMORY_UNAVAILABLE');
  const result=await response.json(),list=document.querySelector('#memory-list');if(epoch!==learnerEpoch)return;list.replaceChildren();
  document.querySelector('#memory-save').disabled=!result.writable;document.querySelector('#memory-delete').disabled=!result.can_delete;
  const names={interest:'兴趣',correction_preference:'纠错偏好',support_language:'语言支架',chinese_comprehension:'中文理解情况（自述）',known_expressions:'已知表达（自述或授权画像）'};
  for(const record of result.records){const item=document.createElement('li');item.textContent=`${names[record.field]}：${record.value}（来源：${record.source}；更新：${record.updated_at.slice(0,10)}）`;list.append(item);}
  memoryStatus.textContent=result.records.length?'只使用与你当前练习相关、仍有效的偏好。':'目前没有有效偏好。';
}
async function bootstrap() {
  const epoch=learnerEpoch;
  try {
    const response=await authorizedFetch('/api/bootstrap');if(!response.ok){await loadMemory();return;}const result=await response.json();
    if(epoch!==learnerEpoch)return;
    document.querySelector('#memory-save').disabled=!result.memory_writable;document.querySelector('#memory-delete').disabled=!result.memory_writable;
    await loadMemory();
    if(epoch!==learnerEpoch)return;
    if((await runtimeReady).backend==='mock_hskai')await loadLearnerProfile(epoch,{setPace:true});
    if(epoch!==learnerEpoch)return;
    if(dynamicPlanning)prepareSelected();else if(entryPreviews[mode])learning(entryPreviews[mode]);
    void observationReports.refresh();
  }catch{if(epoch===learnerEpoch)memoryStatus.textContent='画像或偏好服务暂不可用。';}
}
document.querySelector('#memory-form').addEventListener('submit',async event=> {
  event.preventDefault();
  const field=document.querySelector('#memory-field').value,raw=document.querySelector('#memory-value').value;
  const value=field==='known_expressions'?raw.split(/[,，、]/u).map(v=>v.trim()).filter(Boolean):raw;
  try{const response=await authorizedFetch('/api/memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({field,value})});if(!response.ok)throw new Error('WRITE_FAILED');await loadMemory();if((await runtimeReady).backend==='mock_hskai')await loadLearnerProfile(learnerEpoch);memoryStatus.textContent='偏好已更正；后续回合将使用新偏好。';}
  catch{memoryStatus.textContent='更正未成功，请检查授权或偏好值。';}
});
document.querySelector('#memory-delete').addEventListener('click',async()=> {
  try{const response=await authorizedFetch('/api/memory',{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error('DELETE_FAILED');suppressLearning('authorization');await loadMemory();if((await runtimeReady).backend==='mock_hskai')await loadLearnerProfile(learnerEpoch);await stop('偏好已删除，当前对话已结束。');}
  catch{memoryStatus.textContent='删除未成功，请检查授权或服务。';}
});
async function loadLearnerProfile(epoch,{setPace=false}={}) {
  const parts=await Promise.all(['personal-profile','learning-profile','learning-history'].map(async part=>{
    const response=await authorizedFetch(`/api/learner/${part}`);if(!response.ok)throw new Error('PROFILE_UNAVAILABLE');return response.json();
  }));
  if(epoch!==learnerEpoch)return;
  if(parts.some(p=>p.uid!==selectedLearner||p.revision!==parts[0].revision||p.snapshot_id!==parts[0].snapshot_id||p.fixture_version!==parts[0].fixture_version))throw new Error('PROFILE_CHANGED');
  const [personal,learning,history]=parts.map(p=>p.data),root=document.querySelector('#learner-profile-content');
  const title=document.createElement('p');title.textContent=`${personal.preferred_name??'示例学习者'} · ${learning.course_level} · UID ${selectedLearner} · Mock 资料版本 ${parts[0].revision}`;
  root.replaceChildren(title);
  const section=(heading,rows)=>{const h=document.createElement('h3');h.textContent=heading;const list=document.createElement('ul');for(const text of rows){const li=document.createElement('li');li.textContent=text;list.append(li);}root.append(h,list);};
  section('个人画像',[`成年学习者；母语：${personal.native_language==='en'?'英语':personal.native_language}；兴趣：${personal.interests.map(i=>i.label).join('、')}`,`语速：${personal.conversation_preferences.pace==='slow'?'慢速':'正常'}；纠错：${personal.conversation_preferences.correction==='gentle'?'温和':'按请求'}`, ...Object.values(personal.background??{}).map(v=>Array.isArray(v)?v.join('、'):v)]);
  const statusNames={mock_mastered:'模拟掌握',practicing:'练习中',introduced:'已接触',not_started:'尚未开始'};
  const inventory=parts[1].inventory;
  section('学习画像',[learning.ability_summary??'当前为合成测试场景',`语言支架：${({auto:'按需',zh:'中文',zh_en:'双语'})[learning.language_support]}；理解情况：${({beginner:'初学者',comfortable:'能理解熟悉交流',unknown:'未知'})[learning.comprehension]}`,...(inventory?[`已模拟通过 HSK${inventory.completed_level}；正在学习 ${inventory.current_study_scope==='7-9'?'高级共同范围':`HSK${inventory.current_study_scope}`}`,`累计模拟掌握 ${inventory.grammar_mastered} 项大纲语法细目；完整目录 ${inventory.grammar_total} 项（含下一阶段）`, `大纲词汇参照：${inventory.vocabulary.reference_cumulative} 条${inventory.completed_level===7?'（七至九级共同范围，未宣称全部掌握）':''}；模拟已知范围 ${inventory.vocabulary.estimated_known_range.join('～')}，未经真实测量`]:[])]);
  if(learning.skill_profile)section('听、说、读、写、译的模拟能力',Object.entries(learning.skill_profile).map(([k,v])=>`${({listening:'听',speaking:'说',reading:'读',writing:'写',translation:'译'})[k]}：${v}`));
  if(inventory) {
    const heading=document.createElement('h3');heading.textContent='完整累计知识目录（按等级展开）';root.append(heading);
    for(const [level,counts] of Object.entries(inventory.per_level)) {
      const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');
      summary.textContent=`HSK${level}：${counts.total} 项；模拟掌握 ${counts.mastered} 项`;
      for(const k of inventory.grammar_points.filter(k=>k.introduced_level===level)){const li=document.createElement('li');li.textContent=`${k.label} · ${statusNames[k.mastery_status]} · 大纲第 ${k.source_page} 页`;list.append(li);}
      details.append(summary,list);root.append(details);
    }
  }
  section('交流技能摘要（供规划选取，不是全部知识点）',(learning.knowledge_points??[]).map(k=>`${k.label}：${statusNames[k.mastery_status]}；示例：${k.examples.join(' / ')}`));
  section(`近期学习记录${parts[2].history_page.truncated?'（最近 10 项，已截断）':''}`,history.map(h=>`${new Date(h.updated_at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})} · ${({ask_kai:'对话',lesson:'课程',mission:'任务'})[h.activity_type]} · ${h.observations.join(' ')}`));
  document.querySelector('#learner-profile').hidden=false;
  document.querySelector('#learner-level').textContent=`${learning.course_level} · Mock 学习者`;
  learnerHint.textContent=`当前：${personal.preferred_name??'示例学习者'}。结束对话后可切换；画像和记录按 UID 隔离。`;
  if(setPace&&paceSupported)paceSelect.value=personal.conversation_preferences.pace;
}
learnerSelect.addEventListener('change',async()=> {
  if(learnerSwitching||ws||connect.disabled)return;
  const next=learnerSelect.value;if(next===selectedLearner)return;
  learnerSwitching=true;clearGoalDetails();goal.textContent='正在切换学习者……';promptHint.textContent='';controls(false);
  try {
    await stop('正在切换学习者……');
    const revoked=await authorizedFetch('/api/authorization/revoke',{method:'POST'});if(!revoked.ok)throw new Error('REVOKE_FAILED');
    learnerEpoch++;planningObserver.clear();observationReports.reset();selectedLearner=next;summaryCards.reset();entryPreviews=(await runtimeReady).entry_previews??{};
    document.querySelector('#save-learning-input').checked=false;document.querySelector('#memory-list').replaceChildren();document.querySelector('#learner-profile-content').replaceChildren();document.querySelector('#learner-profile').hidden=true;document.querySelector('#learner-level').textContent='正在加载画像';
    goal.textContent='正在为当前学习者准备对话。';promptHint.textContent='';document.querySelector('.word-card').hidden=true;
    await bootstrap();
  }catch{learnerSelect.value=selectedLearner;learnerHint.textContent='学习者切换未完成，请重试或刷新。';}
  finally{learnerSwitching=false;controls(false);}
});
void (async()=> {
  if((await runtimeReady).backend==='mock_hskai') {
    learnerSwitching=true;controls(false);document.querySelector('#mock-learner-switch').hidden=false;
    try {
      const response=await fetch('/api/poc/learners');if(!response.ok)throw new Error('LEARNERS_UNAVAILABLE');const data=await response.json();
      learnerSelect.replaceChildren();for(const learner of data.learners){const option=document.createElement('option');option.value=learner.uid;option.textContent=`${learner.name} · ${learner.course_level}`;learnerSelect.append(option);}
      selectedLearner=learnerSelect.value;await bootstrap();
    }catch{learnerHint.textContent='Mock 学习者资料加载失败，请刷新。';}
    finally{learnerSwitching=false;controls(false);}
  }else await bootstrap();
})();
document.querySelector('#memory-export').addEventListener('click',async event=>{
  event.preventDefault();
  try{const response=await authorizedFetch('/api/memory/export');if(!response.ok)throw new Error('EXPORT_FAILED');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='ask-kai-preferences.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch{memoryStatus.textContent='偏好导出失败，请检查本地服务。';}
});
