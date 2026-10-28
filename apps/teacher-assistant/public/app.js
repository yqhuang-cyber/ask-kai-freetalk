import {CAPTURE_PROTOCOL,encodeCaptureFrame} from '/capture-protocol.js';
import {renderAudioAssessment,renderAudioVerification,renderAudioReview,clearAudioPreviews} from '/audio-assessment.js';
import {renderReportProgress} from '/report-progress.js';
import {TeacherPlanningPanel,setBilingualText} from '/teacher-planning.js';
import {AudioIO} from '/audio.js';import {Presentation} from '/presentation.js';import {ClosingPlayback} from '/closing-playback.js';import {SpeechPlayback} from '/speech-playback.js';import {voiceReadiness} from '/voice-readiness.js';import {CaptionAnnotations} from '/caption-annotations.js';import {CaptionSettingsView} from '/caption-settings.js';
const $=id=>document.getElementById(id);let actor,plan,config,io,ws,current,sessionId,generation=0,ending=false,publishing=false,submitting=false,identityBusy=false,reportTimer,reportRequest=0,studentView='practice',studentNavigation=0,activeReportId=null,activeReportAttemptId=null,taskItems=[],historyPage=0,starting=false;
let publishKey=sessionStorage.getItem('ta-publish-key')??crypto.randomUUID();sessionStorage.setItem('ta-publish-key',publishKey);
const errorLabels={AUDIO_NOT_ELIGIBLE:'该片段未通过录音检查，本次保留未评估。',INVALID_AUDIO_REFERENCE:'参考短句必须与原音一致，且不超过 30 字。',SOURCE_CHANGED:'记录来源已变化，请重新打开这次报告。',RECORD_NOT_AUTHORIZED:'本次记录已撤回或当前无权查看。',REPORT_ANALYSIS_ACTIVE:'报告仍在分析，请完成后再核对录音。',INVALID_AUDIO_REVIEW:'请逐项核对录音来源和质量。',AUDIO_REVIEW_CONTRADICTS_MEASUREMENT:'该片段已检测到音频缺陷，不能标为无缺陷。',DEEP_REPORT_NOT_CONFIGURED:'深入报告服务尚未配置完成，请稍后再开始练习。',RECORD_NOTICE_CHANGED:'练习说明已更新，请刷新页面后重新开始。',VOICE_NOT_CONFIGURED:'真实语音尚未配置，教师发布和报告仍可查看。',HOMEWORK_SERVICE_UNAVAILABLE:'本地业务服务暂不可用，请稍后查询状态。',NO_SUBMITTABLE_EVIDENCE:'本次没有足够的有效对话记录，尚不能提交。',ASSIGNMENT_EXPIRED:'作业已过截止时间，当前不能开始或提交。',UNAUTHORIZED:'演示身份已过期，请重新选择身份。',ALREADY_SUBMITTED:'这份作业已经提交，请查看反馈。',ATTEMPT_NOT_ACTIVE:'本次练习已失效，请重新开始。',VERSION_CONFLICT:'练习状态已更新，请先查询状态。'};
function message(text){$('message').textContent=text;}
async function api(op,input={}){const response=await fetch(`/api/ta/${op}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw new Error(value.error);return value;}
function showError(error){message(errorLabels[error.message]??`操作暂未完成（${error.message}），可以刷新查询真实状态。`);}
function node(tag,text,className){const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e;}
function action(label,fn,secondary=false){const b=node('button',label,secondary?'secondary':'');b.onclick=()=>{b.disabled=true;Promise.resolve().then(fn).catch(showError).finally(()=>b.disabled=false);};return b;}
function send(packet){if(ws?.readyState!==WebSocket.OPEN)return false;ws.send(JSON.stringify(packet));return true;}
let progressChoiceDismissed=false;
function renderPracticeProgress(packet,item){
  const progress=packet.goal_progress;
  if(ending||packet.session_id!==sessionId||packet.plan_hash!==item.plan.hash||progress?.plan_hash!==item.plan.hash)return;
  const root=$('practice-progress');root.replaceChildren();root.hidden=false;
  if(progress.review_state==='not_authorized'){root.hidden=true;$('practice-choice').hidden=true;return;}
  const labels={observed:'已练到',not_yet:'待尝试',uncertain:'再确认一下'};
  for(const goal of item.plan.goals){const observed=progress.goals.find(g=>g.goal_id===goal.id),tag=node('span',`${observed?.status==='observed'?'✓ ':''}${goal.label} · ${labels[observed?.status]??'待尝试'}`,'practice-goal');tag.dataset.observed=String(observed?.status==='observed');root.append(tag);}
  if(progress.review_state==='degraded')root.append(node('p','进展暂未确认，可以继续聊，也可以随时结束。','small'));
  if(progress.review_state==='reviewed'&&!progress.all_observed)progressChoiceDismissed=false;
  $('practice-choice').hidden=!progress.all_observed||progress.next_action==='support'||progressChoiceDismissed;
}
$('continue-practice').onclick=()=>{progressChoiceDismissed=true;$('practice-choice').hidden=true;};
$('finish-practice').onclick=()=>{if(!ending)$('end').click();};
const planningPanel=new TeacherPlanningPanel({api,onPublished:refresh,onError:showError,onStatus:message});
const annotations=new CaptionAnnotations($('caption'));
const captionSettings=new CaptionSettingsView({annotations,toggle:$('show-pinyin'),hint:$('pinyin-hint'),send});
const presentation=new Presentation({render:(text,parts)=>annotations.render(text,parts),play:(audio,rate,id)=>io?.play(audio,rate,id),getPlayback:id=>io?.playback(id),stopAudio:()=>io?.stopPlayback(),onMode:mode=>{if(mode==='complete'){closing.check();speech.check();captionPlayback.check();}}});
const playbackOptions={presentation,getPlayback:id=>io?.playback(id),isMuted:()=>false,send};
const closing=new ClosingPlayback(playbackOptions),speech=new SpeechPlayback(playbackOptions),captionPlayback=new SpeechPlayback({...playbackOptions,send:packet=>send({...packet,type:'caption.playback'})});
$('show-pinyin').onchange=()=>{if(sessionId&&!ending)send({type:'caption.set',session_id:sessionId,pinyin_enabled:$('show-pinyin').checked});else captionSettings.apply($('show-pinyin').checked);};
function remember(){if(current)sessionStorage.setItem('ta-attempt',JSON.stringify({...current,actor_id:actor.id}));}
async function stopMedia(){presentation.stop();closing.reset();speech.reset();captionPlayback.reset();await io?.close();io=null;}
async function cleanup(){clearAudioPreviews();planningPanel.deactivate();generation++;clearTimeout(reportTimer);const old=ws;ws=null;if(old){old.onclose=null;old.onerror=null;old.close();}await stopMedia();sessionId=null;captionSettings.reset();}
const HISTORY_PAGE_SIZE=6;
function studentBusy(){return starting||!!ws;}
function setStudentView(view,{scroll=false}={}){
  if(actor?.role!=='learner')return;
  if(studentBusy()&&view!=='conversation')return;
  if(studentView!==view){studentNavigation++;clearTimeout(reportTimer);}
  studentView=view;sessionStorage.setItem('ta-view-'+actor.id,JSON.stringify({view,report_id:view==='report'?activeReportId:null,history_page:historyPage}));
  for(const [id,selected] of [['learner-practice',view==='practice'],['learner-current',view==='conversation'],['learner-history',view==='history'||view==='report']]){
    if(selected)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');
  }
  $('learner-practice').disabled=studentBusy();$('learner-history').disabled=studentBusy();
  $('learner-current').hidden=!starting&&(!current||current.submitted);
  $('learner-heading').hidden=view!=='practice';$('tasks').hidden=!['practice','history'].includes(view);
  $('recording-notice').hidden=view!=='practice'||!$('recording-notice').dataset.noticeVersion;
  $('record-management').hidden=!current||!(view==='conversation'||view==='report'&&activeReportAttemptId===current.id);$('conversation').hidden=view!=='conversation';$('report').hidden=view!=='report';$('report-back').hidden=view!=='report';
  $('learner-resume').hidden=view!=='practice'||!current||current.submitted;
  $('learner-resume-text').textContent=current?.state==='ended'?'上次练习已结束，提交后即可生成报告。':'你还有一次练习，可以查看当前保存状态。';
  if(['practice','history'].includes(view))renderTasks(taskItems);
  if(scroll)$('learner-nav').scrollIntoView({block:'start',behavior:'instant'});
}
$('learner-practice').onclick=()=>setStudentView('practice',{scroll:true});
$('learner-history').onclick=()=>{historyPage=0;setStudentView('history',{scroll:true});};
$('learner-current').onclick=$('learner-resume-open').onclick=()=>setStudentView('conversation',{scroll:true});
$('report-back').onclick=()=>setStudentView('history',{scroll:true});
$('history-previous').onclick=()=>{historyPage--;renderTasks(taskItems);};
$('history-next').onclick=()=>{historyPage++;renderTasks(taskItems);};
async function refresh(){if(!actor)return;const epoch=generation,identity=actor.id;const tasks=await api('list');if(epoch!==generation||actor.id!==identity)return;taskItems=tasks;renderTasks(tasks);if(current&&!current.submitted&&!ws)await queryAttempt({openReport:actor.role==='learner'&&studentView==='conversation'});if(actor.role==='learner')setStudentView(studentView);}
function reportLabel(s){if(actor.role==='teacher'&&s.deep_analysis?.stages.audio.review_required&&!s.deep_analysis.processing)return '核对录音并继续';if(s.deep_analysis&&['pending','running','awaiting_audio_review'].includes(s.report_state))return '查看报告生成进度';if(actor.role==='teacher')return '查看本次提交与报告';return !s.deep_analysis||s.report_state==='unavailable'?'查看说明':s.report_state==='failed'?'查看分析状态':'查看我的深入报告';}
function teacherTaskState(submission){const state=submission?.report_state;if(submission?.deep_analysis?.stages.audio.review_required&&!submission.deep_analysis.processing)return '录音待核对';return !submission?'待学生完成':state==='awaiting_audio_review'?'录音待核对':['pending','running'].includes(state)?'报告生成中':state==='failed'?'分析待重试':state==='complete'&&submission.deep_analysis?'报告已生成':'已提交';}
function teacherTaskEnglish(submission){if(submission?.deep_analysis?.stages.audio.review_required&&!submission.deep_analysis.processing)return 'Review audio';return !submission?'Assigned':({awaiting_audio_review:'Review audio',pending:'Analyzing',running:'Analyzing',failed:'Retry analysis',complete:submission.deep_analysis?'Report ready':'Submitted'}[submission.report_state]??'Submitted');}
function labelReportButton(button,submission){if(actor.role==='teacher')setBilingualText(button,reportLabel(submission),submission.deep_analysis?.stages.audio.review_required&&!submission.deep_analysis.processing?'Review audio':['pending','running','awaiting_audio_review'].includes(submission.report_state)?'View progress':'View report');else button.textContent=reportLabel(submission);}
function updateSubmissionState(submission){
  for(const task of taskItems){
    if(!task.submissions.some(sub=>sub.id===submission.id))continue;
    task.submissions=task.submissions.map(sub=>sub.id===submission.id?submission:sub);
    if(actor.role==='teacher'){
      const badge=[...$('task-list').querySelectorAll('.task')].find(card=>card.dataset.assignmentId===task.id)?.querySelector('.task-state');
      if(badge){setBilingualText(badge,teacherTaskState(submission),teacherTaskEnglish(submission));badge.dataset.state=submission.deep_analysis?.stages.audio.review_required&&!submission.deep_analysis.processing?'awaiting_audio_review':submission.report_state??'submitted';}
    }
  }
}
function renderTasks(tasks){
  const teacher=actor.role==='teacher',history=!teacher&&studentView==='history';
  $('list-label').textContent=teacher?`已发布 · ${tasks.length} 份`:history?'练习回顾':'下一次开口';
  if(teacher)setBilingualText($('list-title'),'作业与报告','Assignments & reports');else $('list-title').textContent=history?'历史报告':'老师布置的练习';
  $('tasks').dataset.view=teacher?'teacher':history?'history':'practice';
  $('task-list').replaceChildren();$('task-list').dataset.view=teacher?'teacher':history?'history':'practice';$('history-pagination').hidden=true;
  if(teacher){$('teacher-pending-count').textContent=String(tasks.filter(t=>!t.submissions.length).length);$('teacher-submitted-count').textContent=String(tasks.filter(t=>t.submissions.length).length);}
  if(!teacher){for(const [id,label,count] of [['learner-practice','待练习',tasks.filter(t=>!t.submissions.length).length],['learner-history','历史报告',tasks.filter(t=>t.submissions.length).length]])$(id).replaceChildren(document.createTextNode(label),node('span',String(count),'nav-count'));}
  let visible=teacher?[...tasks]:tasks.filter(t=>history?t.submissions.length:!t.submissions.length);
  if(!teacher)visible.sort((a,b)=>history?Math.max(...b.submissions.map(s=>s.submitted_at))-Math.max(...a.submissions.map(s=>s.submitted_at)):new Date(a.due_at)-new Date(b.due_at));
  if(history){const pages=Math.max(1,Math.ceil(visible.length/HISTORY_PAGE_SIZE));historyPage=Math.max(0,Math.min(historyPage,pages-1));visible=visible.slice(historyPage*HISTORY_PAGE_SIZE,(historyPage+1)*HISTORY_PAGE_SIZE);$('history-pagination').hidden=pages===1;$('history-page').textContent=`${historyPage+1} / ${pages}`;$('history-previous').disabled=historyPage===0;$('history-next').disabled=historyPage===pages-1;}
  if(!visible.length){$('task-list').append(node('p',teacher?'还没有发布练习。':history?'完成练习并提交后，报告会收在这里。':'暂时没有待练习的作业。完成的练习可以在“历史报告”里找到。','empty-state'));return;}
  for(const item of visible){
    const card=node('article','','task');card.dataset.assignmentId=item.id;
    if(teacher){
      const top=node('div','','teacher-task-top'),submission=item.submissions.at(-1),state=submission?.report_state;
      const stateLabel=teacherTaskState(submission);
      const status=node('span',stateLabel,'badge task-state');setBilingualText(status,stateLabel,teacherTaskEnglish(submission));status.dataset.state=submission?.deep_analysis?.stages.audio.review_required&&!submission.deep_analysis.processing?'awaiting_audio_review':submission?state??'submitted':'assigned';top.append(node('h3',item.plan.pack.topic),status);
      card.append(top,node('p',item.plan.goals.map(g=>g.task??g.label).join('；'),'teacher-task-goals'),node('p',`${item.learner_name} · ${item.submissions.length}/1 已提交`,'teacher-task-learner'),node('p',`${item.teacher_name} 布置 · 截止 ${new Date(item.due_at).toLocaleString('zh-CN',{timeZone:item.timezone,dateStyle:'medium',timeStyle:'short'})}`,'small'));
      const source=item.plan.pack.source==='synthetic'?'合成备课草案 · 工程测试'+(item.plan.source==='teacher_edited'?' · 教师已编辑':''):item.plan.source==='authored_fixture'?'预置教学计划':item.plan.source==='teacher_edited'?'AI 草案 · 教师已编辑':'AI 备课计划';
      card.append(node('p',source,'small teacher-task-source'));
      const version=node('details','','task-version');version.append(node('summary','查看计划版本'),node('code',`计划 ${item.plan.hash.slice(0,16)} · v${item.plan.version}`));card.append(version);
    }
    else{
      const content=history?card:node('div','','task-content');
      if(!history){const icon=node('span','','task-icon');icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg width="29" height="29" viewBox="0 0 32 32" fill="none"><path d="M7 5h18a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H13l-8 5V8a3 3 0 0 1 2-3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="11" cy="14" r="1.3" fill="currentColor"/><circle cx="17" cy="14" r="1.3" fill="currentColor"/><circle cx="23" cy="14" r="1.3" fill="currentColor"/></svg>';card.append(icon,content);content.append(node('p','主题对话','task-kicker'));}
      content.append(node('h3',item.plan.pack.topic));
      if(item.plan.pack.source==='synthetic')content.append(node('span','合成测试练习',history?'small task-provenance':'badge'));
      if(history){const submission=item.submissions.at(-1),labels={pending:'报告生成中',running:'报告生成中',complete:submission.deep_analysis?'报告已生成':'暂无深入报告',failed:submission.deep_analysis?.stages.text.reason==='deadline'?'分析超时': '分析失败',unavailable:'暂无深入报告',awaiting_audio_review:'录音等待核对'};card.append(node('p',new Date(submission.submitted_at).toLocaleString('zh-CN',{timeZone:item.timezone}),'small'),node('span',labels[submission.report_state]??'状态待确认','badge'));}
      else content.append(node('p',item.plan.goals.map(g=>g.task??g.label).join('；'),'task-description'),node('p',`${item.teacher_name} 布置 · 截止 ${new Date(item.due_at).toLocaleString('zh-CN',{timeZone:item.timezone,dateStyle:'medium',timeStyle:'short'})}`,'small task-meta'));
    }
    if(!teacher&&!item.submissions.length){const reportReady=!config.deep_report_required||$('recording-notice').dataset.textAnalysis==='true'&&$('recording-notice').dataset.textCollection==='true';const b=action(!config.voice_configured?'真实语音未配置':!reportReady?'深入报告服务未就绪':'开始主题对话',()=>start(item));b.disabled=!config.voice_configured||!reportReady||studentBusy();card.append(b);}
    for(const sub of item.submissions){const b=action(reportLabel(sub),async()=>{if(await loadReport(sub.id)&&actor?.role==='teacher'&&!$('report').hidden)$('report').scrollIntoView({block:'start',behavior:'instant'});},true);labelReportButton(b,sub);b.dataset.reportSubmission=sub.id;card.append(b);}
    $('task-list').append(card);
  }
}
async function showRecordingNotice({root,api,isCurrent}){
  root.hidden=true;root.replaceChildren();delete root.dataset.noticeVersion;root.dataset.textCollection='false';root.dataset.textAnalysis='false';root.dataset.audioRequired='false';
  let notice;try{notice=await api('recording_notice');}catch{return;}
  if(!isCurrent())return;
  root.dataset.noticeVersion=notice.version;
  let target=root;const add=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;target.append(e);};
  add('p',notice.capabilities?.text_analysis?(notice.capabilities.audio_required?(notice.capabilities.audio_auto_verification?'对话文本和录音会保存；提交后由腾讯自动识别与评测，生成深入报告。':'对话文本和录音会保存，提交后生成深入报告；核对后的音频交腾讯评测。'):'对话文本会保存，提交后由 MiniMax 生成深入报告。'):'深入报告服务暂未就绪，请稍后开始练习。');
  root.dataset.textCollection=String(notice.capabilities?.text_collection===true);root.dataset.textAnalysis=String(notice.capabilities?.text_analysis===true);root.dataset.audioRequired=String(notice.capabilities?.audio_required===true);
  const details=document.createElement('details');root.append(details);target=details;add('summary','记录与分析说明');add('p',notice.current);
  if(notice.capabilities?.audio_collection&&!notice.capabilities.audio_required){add('p',notice.audio.purpose);const label=node('label','','check'),check=document.createElement('input');check.type='checkbox';check.id='recording-audio';label.append(check,document.createTextNode(notice.capabilities.pronunciation_analysis?'保存测试录音并将合格片段交腾讯评测':'保存下一次练习的测试录音'));details.append(label);}
  for(const [kind,label] of [['text','对话文本'],['audio','学生语音']]){
    add('h3',label);add('p',notice[kind].purpose);add('p',notice[kind].recipient);
    add('p',`启用后的本地保留期：${notice[kind].retention_days} 天。`);
  }
  add('p',notice.choice);add('p',notice.deletion);root.hidden=false;
}

async function enter(){config=await fetch('/api/ta/config').then(r=>r.json());const me=await api('me');actor=me.actor;let previousView;try{previousView=JSON.parse(sessionStorage.getItem('ta-view-'+actor.id));}catch{}document.body.dataset.role=actor.role;$('welcome').hidden=true;$('teacher-heading').hidden=actor.role!=='teacher';$('learner-nav').hidden=actor.role!=='learner';$('learner-heading').hidden=actor.role!=='learner';$('tasks').hidden=false;studentView='practice';studentNavigation++;activeReportId=null;activeReportAttemptId=null;taskItems=[];historyPage=0;starting=false;$('login').hidden=true;$('workspace').hidden=false;$('actor-label').textContent=`${actor.name} · 演示${actor.role==='teacher'?'教师':'学生'}`;$('view-title').textContent=actor.role==='teacher'?'教师端':'学生端';$('teacher').hidden=actor.role!=='teacher';$('record-management').hidden=true;$('learner-resume').hidden=true;$('conversation').hidden=true;$('report').hidden=true;
  $('recording-notice').hidden=true;
  if(actor.role==='learner'){const identity=actor.id,epoch=generation;await showRecordingNotice({root:$('recording-notice'),api,isCurrent:()=>actor?.id===identity&&generation===epoch});}
  current=null;try{const saved=JSON.parse(sessionStorage.getItem('ta-attempt'));if(saved?.actor_id===actor.id&&actor.role==='learner')current=saved;}catch{/* invalid local hint is not authority */}
  if(actor.role==='teacher'){const learner=me.learners[0];await planningPanel.activate(actor,learner);if(!$('ai-due').value)$('ai-due').value=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,16);$('recipient').value=[learner.name,learner.level].filter(Boolean).join(' · ');plan=await api('preview',{topic:'dining',learner_id:learner.id});$('plan-ref').textContent=`${plan.id} · ${plan.hash.slice(0,16)}`;if(!$('due').value){const local=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,16);$('due').value=local;}}
  if(current){$('recording-revoke').hidden=current.recording_state!=='enabled';$('audio-recording-revoke').hidden=current.audio_recording_state!=='enabled'&&!current.audio_deletion_pending;$('recording-status').textContent=current.recording_state==='enabled'?'本次对话文本用于提交后的深入报告。':current.recording_state==='revoked'?'本次对话文本已撤回。':'';}
  if(current&&!current.submitted){studentView='conversation';$('conversation').hidden=false;$('voice-state').textContent='恢复本地练习记录，查询服务端状态';$('query-attempt').hidden=false;$('recording-revoke').hidden=current.recording_state!=='enabled';$('audio-recording-revoke').hidden=current.audio_recording_state!=='enabled'&&!current.audio_deletion_pending;if(current.audio_deletion_pending){$('audio-recording-revoke').textContent='重试删除测试录音';$('audio-recording-status').textContent='录音授权已撤回，删除尚未完成，请重试。';}}
  await refresh();if(actor.role==='learner'){if(previousView?.view==='report'&&previousView.report_id)await loadReport(previousView.report_id);else if(previousView?.view==='history'){historyPage=previousView.history_page??0;setStudentView('history');}else setStudentView(studentView);message('');return;}message(config.voice_configured?'语音已配置，每次对话仍需等待实际就绪。':'真实语音尚未配置。可以发布任务；开始对话将在配置后开放。');
}
for(const b of document.querySelectorAll('[data-login]'))b.onclick=async()=>{if(identityBusy)return;identityBusy=true;for(const button of document.querySelectorAll('[data-login]'))button.disabled=true;try{await cleanup();await api('login',{actor_id:b.dataset.login});await enter();}catch(e){showError(e);}finally{identityBusy=false;for(const button of document.querySelectorAll('[data-login]'))button.disabled=false;}};
$('switch').onclick=async()=>{try{await cleanup();await api('logout');sessionStorage.removeItem('ta-view-'+actor.id);actor=null;current=null;starting=false;studentNavigation++;taskItems=[];delete document.body.dataset.role;$('welcome').hidden=false;$('teacher-heading').hidden=true;$('learner-nav').hidden=true;$('learner-resume').hidden=true;sessionStorage.removeItem('ta-attempt');$('workspace').hidden=true;$('login').hidden=false;$('actor-label').textContent='';message('已退出当前演示身份，尚未提交的练习不会自动提交。');}catch(e){showError(e);}};
$('refresh').onclick=()=>refresh().catch(showError);
$('new-assignment').onclick=()=>{publishKey=crypto.randomUUID();sessionStorage.setItem('ta-publish-key',publishKey);$('confirm').checked=false;$('publish-result').textContent='已创建新的发布请求，请重新确认练习要求和截止时间。';message('确认后会发布另一份独立练习，历史任务保持原版本。');};
$('publish').onclick=async()=>{if(publishing)return;if(!$('confirm').checked){message('请先确认对象、要求和截止时间。');return;}publishing=true;$('publish').disabled=true;try{const due_at=new Date($('due').value+':00+08:00').toISOString();const result=await api('publish',{topic:'dining',learner_id:plan.learner_id,plan_hash:plan.hash,due_at,timezone:'Asia/Shanghai',idempotency_key:publishKey});$('publish-result').textContent=`已发布 · ${result.id} · 计划 ${result.plan_hash.slice(0,16)}`;message('发布已由本地服务确认。切换到 Maya 可打开任务。');await refresh();}catch(e){showError(e);}finally{publishing=false;$('publish').disabled=false;}};
async function start(item){if(studentBusy())return;starting=true;try{await cleanup();}catch(e){starting=false;throw e;}studentNavigation++;progressChoiceDismissed=false;$('practice-progress').hidden=true;$('practice-progress').replaceChildren();$('practice-choice').hidden=true;$('conversation-title').textContent=item.plan.pack.topic+' · 与 Kai 练习';$('conversation-goals').textContent='练习目标：'+item.plan.goals.map(g=>g.task??g.label).join('；')+'。可以求助，也可以随时结束。';const epoch=generation;ending=false;current=null;setStudentView('conversation',{scroll:true});$('submit').hidden=true;$('query-attempt').hidden=true;$('attempt-state').textContent='';$('student-text').textContent='';$('caption').textContent='正在连接 Kai…';document.querySelector('.conversation-settings').open=false;$('record-management').open=false;$('conversation').hidden=false;$('report').hidden=true;$('voice-state').textContent='准备作业对话……';$('end').disabled=false;$('interrupt').disabled=true;
  try{let captureSequence=0,captureProtocol=null,captureAec=null;const sessionIo=new AudioIO({onObserve:(name,fields)=>{if(name==='audio.capture.started')captureAec=fields.echo_cancellation===true;},onFrame:bytes=>{if(epoch!==generation||ending||ws?.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>65536){void failVoice('网络上传拥塞，已停止采音。');return;}const sequence=captureSequence++;ws.send(captureProtocol===CAPTURE_PROTOCOL?encodeCaptureFrame(bytes,{sequence,sampleStart:sequence*320,aec:captureAec,playback:sessionIo.sources.size>0}):bytes);},onFailure:text=>{if(epoch===generation)void failVoice(text);}});io=sessionIo;await sessionIo.prepare();if(epoch!==generation)return;const ticket=await api('prepare',{capture_protocol:config.audio_auto_verification?CAPTURE_PROTOCOL:undefined,assignment_id:item.id,recording_text:$('recording-notice').dataset.textCollection==='true',recording_audio:$('recording-notice').dataset.audioRequired==='true'||$('recording-audio')?.checked===true,recording_notice_version:$('recording-notice').dataset.noticeVersion});if(epoch!==generation)return;captureProtocol=ticket.capture_protocol;current={id:ticket.attempt_id,assignment_id:item.id,submit_key:crypto.randomUUID(),recording_state:ticket.recording_state,audio_recording_state:ticket.audio_recording_state};remember();sessionId=ticket.session_id;captionSettings.reset(sessionId);$('query-attempt').hidden=true;$('recording-revoke').hidden=ticket.recording_state!=='enabled';$('audio-recording-revoke').hidden=ticket.audio_recording_state!=='enabled';$('audio-recording-status').textContent=ticket.audio_recording_state==='enabled'?(config.audio_auto_verification?'本次录音已开启，提交后自动核验与评测。':'本次测试录音已开启，声音来源和质量尚待核对。'):ticket.audio_recording_state==='failed'?'本次测试录音未能开启。':'';$('recording-status').textContent=ticket.recording_state==='enabled'?'本次对话文本将用于提交后的深入报告。':ticket.recording_state==='failed'?'本次对话文本记录未能开启；你仍可继续练习。':'本次未选择保存完整对话文本。';
    starting=false;ws=new WebSocket(`${location.origin.replace('http:','ws:')}${ticket.websocket_path}`,[ticket.protocol,`ticket.${ticket.ticket}`]);setStudentView('conversation');const socket=ws;let audioConfig;
    socket.onmessage=async event=>{if(epoch!==generation||socket!==ws)return;try{const packet=JSON.parse(event.data);
      if(packet.type==='session.config'){audioConfig=packet.audio;return;}
      if(packet.type==='teaching.state'){renderPracticeProgress(packet,item);return;}
      if(packet.type==='homework.attempt.receipt'){if(packet.audio_recording?.state==='sealed')$('audio-recording-status').textContent=config.audio_auto_verification?(packet.audio_recording.queue_incomplete||packet.audio_recording.missing_segments?'录音部分保存；提交后将自动核验可用片段。':'录音已保存；提交后将自动核验与评测。'):packet.audio_recording.queue_incomplete||packet.audio_recording.missing_segments?'测试录音部分保存；声音来源和质量尚待核对。':'测试录音已保存；声音来源和质量尚待核对，尚未进行发音评测。';else if(packet.audio_recording?.state==='unavailable')$('audio-recording-status').textContent='本次没有可保存的测试录音，尚未进行发音评测。';else if(packet.audio_recording?.state==='failed'&&current.audio_recording_state==='enabled')$('audio-recording-status').textContent='测试录音保存未完成。';current.receipt=packet.state;remember();$('attempt-state').textContent=packet.state==='ended'?'练习已保存，尚未提交。':'保存状态待确认，请查询。';if(packet.recording?.state==='sealed')$('recording-status').textContent=packet.recording.coverage==='complete'?'对话文本已保存。':'对话文本部分保存，存在缺失。';else if(packet.recording?.state==='failed'&&current.recording_state==='enabled')$('recording-status').textContent='对话文本保存未完成。';return;}
      if(packet.type==='session.closing'){closing.update(packet,sessionId);if(packet.phase==='finalizing_record')io?.stopCapture();$('voice-state').textContent='正在结束练习；尚未提交';return;}
      if(packet.type==='speech.state'){speech.update(packet);return;}
      if(packet.type==='caption.settings'){await captionSettings.receive(packet);return;}
      if(packet.type==='caption.state'){captionSettings.state(packet);captionPlayback.update(packet);return;}
      if(packet.type==='output.stop'){presentation.stop(packet.response_id);return;}
      if(packet.type==='safety.notice'){message(packet.message);await failVoice('本次练习已停止，不能形成有效提交。');return;}
      if(['session.closed','session.failed'].includes(packet.type)){socket.onclose=null;socket.onerror=null;ws=null;ending=true;await stopMedia();$('end').disabled=true;$('interrupt').disabled=true;$('voice-state').textContent=packet.type==='session.failed'?`连接未完成或已中断（${packet.code}）`:'练习已结束';await queryAttempt();return;}
      const e=packet.type==='event'?packet.event:null;if(!e)return;
      if(e.type==='session.ready'){const ready=voiceReadiness(packet,audioConfig);if(!ready){await failVoice('工程合成连接不作为真实语音就绪，未开启麦克风。');return;}if(ending)return;await sessionIo.start(audioConfig);if(epoch!==generation||ending){sessionIo.stopCapture();return;}$('voice-state').textContent=ready.real_provider?'已连接真实语音 · 麦克风开启':'合成语音 · 仅工程测试设备';$('interrupt').disabled=false;return;}
      if(ending)return;
      if(e.type==='response.started')presentation.begin(e.response_id);
      if(e.type==='response.text.delta')presentation.append(e.response_id,e.payload.text);
      if(e.type==='response.audio.chunk'&&packet.audio)presentation.audio(e.response_id,packet.audio,packet.sample_rate);
      if(e.type==='response.done'){presentation.done(e.response_id);closing.check();speech.check();captionPlayback.check();}
      if(e.type==='response.cancelled')presentation.stop(e.response_id);
      if(e.type==='user.final')$('student-text').textContent='你：'+e.payload.text;
    }catch{if(epoch===generation)await failVoice('语音或呈现发生异常，已停止采音。');}};
    socket.onerror=()=>{if(epoch===generation)void failVoice('无法连接语音服务，请查询本次保存状态。');};socket.onclose=()=>{if(epoch===generation)void failVoice('连接已断开；不会自动提交作业。');};await refresh();
  }catch(e){if(epoch===generation)await failVoice(errorLabels[e.message]??'无法开始对话，请检查语音配置和麦克风权限。');}
}
async function failVoice(text){starting=false;ending=true;$('practice-choice').hidden=true;const old=ws;ws=null;if(old){old.onclose=null;old.onerror=null;old.close();}await stopMedia();$('voice-state').textContent=text;$('end').disabled=true;$('interrupt').disabled=true;if(current){$('query-attempt').hidden=false;try{await queryAttempt();}catch{/* query button stays available */}}if(actor?.role==='learner')setStudentView(studentView);}
$('interrupt').onclick=()=>{const response_id=presentation.current;presentation.stop();send({type:'response.cancel',...(response_id?{response_id}:{})});};
$('end').onclick=async()=>{ending=true;$('practice-choice').hidden=true;$('end').disabled=true;$('interrupt').disabled=true;await stopMedia();$('voice-state').textContent='已停止采音与播放，正在确认保存……';send({type:'session.end'});const epoch=generation;setTimeout(()=>{if(epoch===generation&&current)queryAttempt({openReport:studentView==='conversation'}).catch(showError);},3000);};
async function queryAttempt({openReport=true}={}){if(!current||actor?.role!=='learner')return;const requested=current.id,epoch=generation,navigation=studentNavigation;let a;try{a=await api('attempt',{attempt_id:requested});}catch(e){if(epoch!==generation)return;throw e;}if(epoch!==generation||current?.id!==requested)return;current.version=a.version;current.state=a.state;remember();$('submit').hidden=a.state!=='ended';$('query-attempt').hidden=false;$('attempt-state').textContent=a.state==='ended'?'本次记录已保存。点击“提交这次练习”后老师才能看到提交。':a.state==='active'?'记录仍在处理中或连接尚未结束，请稍后查询。':`本次记录状态：${a.state}。可以重新开始练习。`;
  try{const s=await api('submission',{attempt_id:requested});if(epoch!==generation)return;$('submit').hidden=true;current.submitted=true;remember();$('attempt-state').textContent='已提交，深入报告会在后台分析完成后显示。';if(openReport&&navigation===studentNavigation)await showReport(s);else if(actor.role==='learner'&&studentView==='conversation')setStudentView('practice');}catch(e){if(e.message!=='NOT_FOUND')throw e;}
  if(actor?.role==='learner')setStudentView(studentView);
}
$('recording-revoke').onclick=async()=>{if(!current)return;try{const choice=await api('recording_choice',{attempt_id:current.id});await api('recording_choice_update',{attempt_id:current.id,notice_version:choice.notice_version,expected_revision:choice.revision,text:false,audio:choice.audio.allowed});current.recording_state='revoked';$('practice-progress').hidden=true;$('practice-choice').hidden=true;remember();$('recording-revoke').hidden=true;$('recording-status').textContent='已撤回并删除本次保存的对话文本。';for(const card of document.querySelectorAll('[data-practice-requirements]'))card.remove();if(studentView==='report'&&activeReportAttemptId===current.id)await loadReport(activeReportId);}catch(e){$('recording-status').textContent='撤回尚未确认，请重试。';showError(e);}};
$('audio-recording-revoke').onclick=async()=>{if(!current)return;clearAudioPreviews();try{let result;if(current.audio_recording_state==='revoked')result=await api('recording_audio_delete',{attempt_id:current.id});else{const choice=await api('recording_choice',{attempt_id:current.id});result=await api('recording_choice_update',{attempt_id:current.id,notice_version:choice.notice_version,expected_revision:choice.revision,text:choice.text.allowed,audio:false});current.audio_recording_state='revoked';remember();result={state:result.audio_deletion};}const done=result.state==='deleted';current.audio_deletion_pending=!done;remember();$('audio-recording-revoke').hidden=done;$('audio-recording-revoke').textContent='重试删除测试录音';$('audio-recording-status').textContent=done?'已撤回并删除本次测试录音。':'录音授权已撤回，删除尚未完成，请重试。';for(const clip of document.querySelectorAll('[data-deep-dimension="audio"] .audio-clip'))clip.remove();if(studentView==='report'&&activeReportAttemptId===current.id)await loadReport(activeReportId);}catch(e){$('audio-recording-status').textContent='撤回或删除尚未确认，请重试。';showError(e);}};
$('query-attempt').onclick=()=>queryAttempt().catch(showError);
$('submit').onclick=async()=>{if(submitting||!current)return;submitting=true;$('submit').disabled=true;$('attempt-state').textContent='提交中，等待服务确认……';const epoch=generation;try{const receipt=await api('submit',{attempt_id:current.id,expected_version:current.version,idempotency_key:current.submit_key});if(epoch!==generation)return;$('submit').hidden=true;$('attempt-state').textContent='已提交，正在准备深入报告。';await showReport(receipt);await refresh();}catch(e){if(epoch!==generation)return;$('attempt-state').textContent='提交尚未确认，请查询状态；重复提交使用相同请求标识。';showError(e);}finally{submitting=false;$('submit').disabled=false;}};
async function loadReport(id,{refresh=false}={}){
  if(actor?.role==='learner'&&studentBusy())return;
  const selected=activeReportId===id&&(actor?.role!=='learner'||studentView==='report');
  if(refresh&&!selected)return false;
  if(!selected){studentNavigation++;activeReportId=id;activeReportAttemptId=null;clearTimeout(reportTimer);clearAudioPreviews();if(actor?.role==='learner')setStudentView('report',{scroll:true});$('report').hidden=false;$('report-title').textContent='正在打开报告';$('report-body').replaceChildren();$('report-body').dataset.reportState='loading';}
  const epoch=generation,navigation=studentNavigation,request=++reportRequest;
  const isCurrent=()=>epoch===generation&&navigation===studentNavigation&&request===reportRequest&&activeReportId===id&&(actor?.role!=='learner'||studentView==='report');
  try{const s=await api('submission',{submission_id:id});if(!isCurrent())return false;await showReport(s);return true;}catch(error){if(isCurrent())throw error;return false;}
}
function reportScope(id){const epoch=generation,navigation=studentNavigation;return ()=>epoch===generation&&navigation===studentNavigation&&activeReportId===id&&!$('report').hidden;}
async function retryCurrentReport(id){const isCurrent=reportScope(id);try{await api('retry_report',{submission_id:id});if(isCurrent())await loadReport(id,{refresh:true});}catch(error){if(isCurrent())throw error;}}
function scheduleReportRefresh(id){const isCurrent=reportScope(id);reportTimer=setTimeout(()=>{if(isCurrent())loadReport(id,{refresh:true}).catch(showError);},1200);}
function renderDeepReport(root,s,{reviewShown=false}={}){
  const deep=s.deep_analysis;if(!deep)return;
  const states={pending:'等待分析',running:'正在分析',complete:'分析已生成 · 待核对',partial:'已生成部分分析 · 待核对',failed:'分析未完成',disabled:'尚未开启',unavailable:'本次未评估',not_authorized:'记录或分析授权已不可用'};
  const reasons={asr_not_enabled:'腾讯录音文件识别尚未开通；本次发音评测未完成，其他分析照常生成。',review_inconclusive:'已核对的片段仍不足以支持可靠发音判断，本次保留未评估。',not_configured:'服务尚未配置',not_enabled:'该分析尚未开启',not_authorized:'未授权或已撤回',source_unavailable:'来源已不可用或已过期',no_eligible_audio:'本次没有符合条件的录音片段，发音维度保留未评估。',restricted_content:'本次内容不进入普通学习报告',deadline:'分析超时',provider_failed:'分析服务未完成请求',output_rejected:'结果未通过检查',external_outcome_unknown:'外部请求结果未知，需要显式重试'};
  root.append(node('h3','本次深入分析'),node('p','模型解读需要核对原文；识别文本可能有错，不能据此判断纯听力、独立完成或整体等级。','small'));
  if(s.report?.goals?.length){
    const targets=node('article','','analysis-card');targets.dataset.practiceRequirements='true';targets.append(node('h3','这次练习的中文表达'));
    for(const goal of s.report.goals){const row=node('div','','practice-requirement');row.append(node('h4',goal.label),node('p','用中文说出口：'+(goal.task??goal.label)));if(goal.output_requirement?.acceptance)row.append(node('p',goal.output_requirement.acceptance,'small'));const observed=s.report.practice_progress?.goals.find(g=>g.goal_id===goal.id);if(observed){row.append(node('p',observed.status==='observed'?'会中已观察到相关中文表达，供本次回看核对。':'会中尚未确认这项表达，不表示不会。','small'));for(const ref of observed.evidence.filter(r=>r.role==='learner'))row.append(node('p',`${actor.role==='teacher'?'学生原话':'你说过'}：“${ref.quote}”`,'analysis-evidence'));}targets.append(row);}
    targets.append(node('p','会中进展用于引导练习；下方深入分析另行核对原文，两者都不代表掌握或评级。','small'));root.append(targets);
  }
  for(const [kind,label] of [['text','理解与口语表达'],['audio','发音、声调与语流']]){
    const stage=deep.stages[kind],card=node('article','','analysis-card');card.dataset.deepDimension=kind;card.append(node('h3',label+' · '+(states[stage.state]??'状态待确认')));
    if(stage.reason)card.append(node('p',kind==='audio'&&stage.verification_mode==='automatic'&&stage.reason==='no_eligible_audio'?'本次没有足够可靠的可评测语音，保留未评估；这不表示你的发音能力差。':kind==='audio'&&stage.reason==='source_unavailable'?'本次没有可用录音，尚未进行发音评测。':kind==='audio'&&stage.reason==='not_enabled'?'这次提交没有启用音频评测。':reasons[stage.reason]??'本维度暂未完成。'));
    if(kind==='text'&&stage.result){
      const result=stage.result,c=result.coverage;card.append(node('p',`${c.windows.every(w=>w.state==='complete')&&!c.unprocessed_windows?'已分析本次保存的对话文本':'已分析部分保存内容，还有内容未完成分析'}；原始记录${c.source_state==='complete'?'完整':'有缺口'}。`,'small'));
      if(!result.candidates.length)card.append(node('p','本次没有生成足够可靠的具体观察，不表示不会。'));
      for(const observation of result.candidates){const row=node('div','','analysis-observation');row.append(node('h4',(observation.dimension==='context_understanding'?'情境理解':'口语表达')+' · 待核对'),node('p',observation.observation),node('p',observation.explanation));for(const ref of observation.evidence_refs)row.append(node('p',`原文：“${ref.quote}”`,'analysis-evidence'));row.append(node('p',observation.uncertainty,'small'),node('p','下次可以试试：'+observation.suggestion));card.append(row);}
    }
    if(kind==='audio'){if(stage.verification_mode==='automatic')renderAudioVerification(card,stage,{api,submissionId:s.id,onError:showError,teacher:actor.role==='teacher'});if(stage.result)renderAudioAssessment(card,stage.result.report??stage.result,{api,submissionId:s.id,onError:showError});if(actor.role==='teacher'&&stage.provider==='tencent_soe_v2'&&!reviewShown)renderAudioReview(card,{api,submissionId:s.id,automatic:stage.verification_mode==='automatic',isCurrent:reportScope(s.id),onSaved:()=>loadReport(s.id,{refresh:true}),onError:showError});}
    root.append(card);
  }
  if(deep.retryable)root.append(action('重试未完成的分析',()=>retryCurrentReport(s.id)));
  if(deep.processing)scheduleReportRefresh(s.id);
}
async function showReport(s){
  activeReportId=s.id;
  updateSubmissionState(s);
  if(actor?.role==='learner'){
    if(current?.id===s.attempt_id){current.submitted=true;remember();}
    activeReportId=s.id;activeReportAttemptId=s.attempt_id;const changed=studentView!=='report';setStudentView('report',{scroll:changed});
  }else $('report-back').hidden=true;
  clearAudioPreviews();clearTimeout(reportTimer);for(const b of document.querySelectorAll('[data-report-submission]'))if(b.dataset.reportSubmission===s.id)labelReportButton(b,s);$('report').hidden=false;$('report-role').textContent=actor.role==='teacher'?'教师端 · 深入报告':'我的深入报告';
  const root=$('report-body');root.replaceChildren();const deep=s.deep_analysis,awaitingReview=s.report_state==='awaiting_audio_review',pending=deep&&['pending','running','awaiting_audio_review'].includes(s.report_state);
  const teacherReview=actor.role==='teacher'&&deep?.stages.audio.review_required&&!deep.processing;
  $('report-title').textContent=awaitingReview||teacherReview?'录音等待核对':pending?'正在分析这次对话':s.report_state==='complete'&&deep?'这次对话的深入报告':s.report_state==='failed'?(deep?.stages.text.reason==='deadline'?'深入分析超时':'深入分析失败'):'深入报告尚未生成';
  if(teacherReview){const review=node('div','','teacher-review-prompt');review.append(node('h3','请先核对这次录音'),node('p','回听并确认学生声音和录音质量，保存后系统会继续评测。','small'));renderAudioReview(review,{api,submissionId:s.id,isCurrent:reportScope(s.id),onSaved:()=>loadReport(s.id,{refresh:true}),onError:showError,open:true});root.append(review);}
  renderReportProgress(root,s);
  if(pending){
    root.dataset.reportState='processing';
    scheduleReportRefresh(s.id);return;
  }
  if(!deep||s.report_state!=='complete'||!deep.stages.text.result){
    root.dataset.reportState=s.report_state==='failed'?'failed':'unavailable';const reason=deep?.stages.text.reason;
    const messages={deadline:'本次文本分析已超时停止，继续等待不会生成报告。可以重试，作业无需重新提交。',provider_failed:'分析服务请求失败，本次分析已停止。可以重试，作业无需重新提交。',output_rejected:'分析结果未通过检查，本次分析已停止。可以重试，作业无需重新提交。',external_outcome_unknown:'分析连接中断，未能确认结果。可以重试，作业无需重新提交。',not_authorized:'本次文本记录已撤回或处理授权已不可用，无法生成深入报告。',source_unavailable:'本次缺少可用对话文本，无法生成深入报告。请新建一次练习。',not_configured:'深入分析服务尚未配置完成。',not_enabled:'本次未启用深入分析。',restricted_content:'这次对话不生成普通学习报告。'};
    root.append(node('p',messages[reason]??(s.report_state==='failed'?'练习已提交，深入分析暂未完成。可以重试，作业无需重新提交。':'这次练习没有可用的深入报告。请新建一次练习，系统会自动记录文本并在提交后分析。')));
    if(deep?.retryable)root.append(action('重试深入分析',()=>retryCurrentReport(s.id)));return;
  }
  root.dataset.reportState='ready';renderDeepReport(root,s,{reviewShown:teacherReview});
}
window.addEventListener('pagehide',()=>{clearAudioPreviews();generation++;clearTimeout(reportTimer);ws?.close();void stopMedia();});
enter().catch(e=>{if(e.message!=='UNAUTHORIZED')showError(e);});
