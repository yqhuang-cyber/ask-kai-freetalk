import {TeacherPlanningPanel} from '/teacher-planning.js';
import {AudioIO} from '/audio.js';import {Presentation} from '/presentation.js';import {ClosingPlayback} from '/closing-playback.js';import {SpeechPlayback} from '/speech-playback.js';import {voiceReadiness} from '/voice-readiness.js';import {CaptionAnnotations} from '/caption-annotations.js';import {CaptionSettingsView} from '/caption-settings.js';
const $=id=>document.getElementById(id);let actor,plan,config,io,ws,current,sessionId,generation=0,ending=false,publishing=false,submitting=false,identityBusy=false,reportTimer;
let publishKey=sessionStorage.getItem('ta-publish-key')??crypto.randomUUID();sessionStorage.setItem('ta-publish-key',publishKey);
const errorLabels={VOICE_NOT_CONFIGURED:'真实语音尚未配置，教师发布和报告仍可查看。',HOMEWORK_SERVICE_UNAVAILABLE:'本地业务服务暂不可用，请稍后查询状态。',NO_SUBMITTABLE_EVIDENCE:'本次没有足够的有效对话记录，尚不能提交。',ASSIGNMENT_EXPIRED:'作业已过截止时间，当前不能开始或提交。',UNAUTHORIZED:'演示身份已过期，请重新选择身份。',ALREADY_SUBMITTED:'这份作业已经提交，请查看反馈。',ATTEMPT_NOT_ACTIVE:'本次练习已失效，请重新开始。',VERSION_CONFLICT:'练习状态已更新，请先查询状态。'};
function message(text){$('message').textContent=text;}
async function api(op,input={}){const response=await fetch(`/api/ta/${op}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw new Error(value.error);return value;}
function showError(error){message(errorLabels[error.message]??`操作暂未完成（${error.message}），可以刷新查询真实状态。`);}
function node(tag,text,className){const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e;}
function action(label,fn,secondary=false){const b=node('button',label,secondary?'secondary':'');b.onclick=()=>{b.disabled=true;Promise.resolve().then(fn).catch(showError).finally(()=>b.disabled=false);};return b;}
function send(packet){if(ws?.readyState!==WebSocket.OPEN)return false;ws.send(JSON.stringify(packet));return true;}
const planningPanel=new TeacherPlanningPanel({api,onPublished:refresh,onError:showError,onStatus:message});
const annotations=new CaptionAnnotations($('caption'));
const captionSettings=new CaptionSettingsView({annotations,toggle:$('show-pinyin'),hint:$('pinyin-hint'),send});
const presentation=new Presentation({render:(text,parts)=>annotations.render(text,parts),play:(audio,rate,id)=>io?.play(audio,rate,id),getPlayback:id=>io?.playback(id),stopAudio:()=>io?.stopPlayback(),onMode:mode=>{if(mode==='complete'){closing.check();speech.check();captionPlayback.check();}}});
const playbackOptions={presentation,getPlayback:id=>io?.playback(id),isMuted:()=>false,send};
const closing=new ClosingPlayback(playbackOptions),speech=new SpeechPlayback(playbackOptions),captionPlayback=new SpeechPlayback({...playbackOptions,send:packet=>send({...packet,type:'caption.playback'})});
$('show-pinyin').onchange=()=>{if(sessionId&&!ending)send({type:'caption.set',session_id:sessionId,pinyin_enabled:$('show-pinyin').checked});else captionSettings.apply($('show-pinyin').checked);};
function remember(){if(current)sessionStorage.setItem('ta-attempt',JSON.stringify({...current,actor_id:actor.id}));}
async function stopMedia(){presentation.stop();closing.reset();speech.reset();captionPlayback.reset();await io?.close();io=null;}
async function cleanup(){planningPanel.deactivate();generation++;clearTimeout(reportTimer);const old=ws;ws=null;if(old){old.onclose=null;old.onerror=null;old.close();}await stopMedia();sessionId=null;captionSettings.reset();}
async function refresh(){if(!actor)return;const epoch=generation,identity=actor.id;const tasks=await api('list');if(epoch!==generation||actor.id!==identity)return;renderTasks(tasks);if(current&&!ws)await queryAttempt();}
function renderTasks(tasks){const teacher=actor.role==='teacher';$('list-label').textContent=teacher?'作业记录':'B · 我的课后练习';$('list-title').textContent=teacher?'已发布的练习':'老师留给你的开口机会';$('task-list').replaceChildren();if(!tasks.length){$('task-list').append(node('p',teacher?'还没有发布练习。':'老师还没有发布练习，发布后刷新即可看到。'));return;}
  for(const item of tasks){const card=node('article','', 'task');card.append(node('h3',item.plan.pack.topic+' · '+item.plan.goals.map(g=>g.label).join('，')),node('p',`${item.teacher_name} → ${item.learner_name} · 截止 ${new Date(item.due_at).toLocaleString('zh-CN',{timeZone:item.timezone})}（上海）`,'small'),node('p',`${item.plan.pack.source==='synthetic'?'合成备课草案 · 工程测试'+(item.plan.source==='teacher_edited'?' · 教师已编辑':''):item.plan.source==='authored_fixture'?'预置教学计划':item.plan.source==='teacher_edited'?'AI 草案 · 教师已编辑':'AI 备课计划'} · ${item.submissions.length}/1 已提交`,'small'),node('code',`计划 ${item.plan.hash.slice(0,16)} · v${item.plan.version}`));
    if(!teacher&&!item.submissions.length){const b=action(config.voice_configured?'开始主题对话':'真实语音未配置',()=>start(item));b.disabled=!config.voice_configured||!!ws;card.append(b);}
    for(const s of item.submissions){card.append(action(teacher?'查看本次提交与报告':'查看我的反馈',()=>loadReport(s.id),true));}
    $('task-list').append(card);
  }
}
async function enter(){config=await fetch('/api/ta/config').then(r=>r.json());const me=await api('me');actor=me.actor;$('login').hidden=true;$('workspace').hidden=false;$('actor-label').textContent=`${actor.name} · Mock ${actor.role==='teacher'?'教师':'学生'}`;$('view-title').textContent=actor.role==='teacher'?'教师端':'学生端';$('teacher').hidden=actor.role!=='teacher';$('conversation').hidden=true;$('report').hidden=true;
  current=null;try{const saved=JSON.parse(sessionStorage.getItem('ta-attempt'));if(saved?.actor_id===actor.id&&actor.role==='learner')current=saved;}catch{/* invalid local hint is not authority */}
  if(actor.role==='teacher'){const learner=me.learners[0];await planningPanel.activate(actor,learner);if(!$('ai-due').value)$('ai-due').value=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,16);$('recipient').value=[learner.name,learner.level].filter(Boolean).join(' · ');plan=await api('preview',{topic:'dining',learner_id:learner.id});$('plan-ref').textContent=`${plan.id} · ${plan.hash.slice(0,16)}`;if(!$('due').value){const local=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,16);$('due').value=local;}}
  if(current){$('conversation').hidden=false;$('voice-state').textContent='恢复本地练习记录，查询服务端状态';$('query-attempt').hidden=false;}
  await refresh();message(config.voice_configured?'语音已配置，每次对话仍需等待实际就绪。':'真实语音尚未配置。可以发布任务；开始对话将在配置后开放。');
}
for(const b of document.querySelectorAll('[data-login]'))b.onclick=async()=>{if(identityBusy)return;identityBusy=true;for(const button of document.querySelectorAll('[data-login]'))button.disabled=true;try{await cleanup();await api('login',{actor_id:b.dataset.login});await enter();}catch(e){showError(e);}finally{identityBusy=false;for(const button of document.querySelectorAll('[data-login]'))button.disabled=false;}};
$('switch').onclick=async()=>{try{await cleanup();await api('logout');actor=null;current=null;sessionStorage.removeItem('ta-attempt');$('workspace').hidden=true;$('login').hidden=false;$('actor-label').textContent='';message('已退出当前演示身份，尚未提交的练习不会自动提交。');}catch(e){showError(e);}};
$('refresh').onclick=()=>refresh().catch(showError);
$('new-assignment').onclick=()=>{publishKey=crypto.randomUUID();sessionStorage.setItem('ta-publish-key',publishKey);$('confirm').checked=false;$('publish-result').textContent='已创建新的发布请求，请重新确认练习要求和截止时间。';message('确认后会发布另一份独立练习，历史任务保持原版本。');};
$('publish').onclick=async()=>{if(publishing)return;if(!$('confirm').checked){message('请先确认对象、要求和截止时间。');return;}publishing=true;$('publish').disabled=true;try{const due_at=new Date($('due').value+':00+08:00').toISOString();const result=await api('publish',{topic:'dining',learner_id:plan.learner_id,plan_hash:plan.hash,due_at,timezone:'Asia/Shanghai',idempotency_key:publishKey});$('publish-result').textContent=`已发布 · ${result.id} · 计划 ${result.plan_hash.slice(0,16)}`;message('发布已由本地服务确认。切换到 Maya 可打开任务。');await refresh();}catch(e){showError(e);}finally{publishing=false;$('publish').disabled=false;}};
async function start(item){await cleanup();$('conversation-title').textContent=item.plan.pack.topic+' · 与 Kai 练习';$('conversation-goals').textContent='练习目标：'+item.plan.goals.map(g=>g.task??g.label).join('；')+'。可以求助，也可以随时结束。';const epoch=generation;ending=false;current=null;$('submit').hidden=true;$('query-attempt').hidden=true;$('attempt-state').textContent='';$('student-text').textContent='';$('conversation').hidden=false;$('report').hidden=true;$('voice-state').textContent='准备作业对话……';$('end').disabled=false;$('interrupt').disabled=true;
  try{const sessionIo=new AudioIO({onFrame:bytes=>{if(epoch!==generation||ending||ws?.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>65536){void failVoice('网络上传拥塞，已停止采音。');return;}ws.send(bytes);},onFailure:text=>{if(epoch===generation)void failVoice(text);}});io=sessionIo;await sessionIo.prepare();if(epoch!==generation)return;const ticket=await api('prepare',{assignment_id:item.id});if(epoch!==generation)return;current={id:ticket.attempt_id,assignment_id:item.id,submit_key:crypto.randomUUID()};remember();sessionId=ticket.session_id;captionSettings.reset(sessionId);$('query-attempt').hidden=false;
    ws=new WebSocket(`${location.origin.replace('http:','ws:')}${ticket.websocket_path}`,[ticket.protocol,`ticket.${ticket.ticket}`]);const socket=ws;let audioConfig;
    socket.onmessage=async event=>{if(epoch!==generation||socket!==ws)return;try{const packet=JSON.parse(event.data);
      if(packet.type==='session.config'){audioConfig=packet.audio;return;}
      if(packet.type==='homework.attempt.receipt'){current.receipt=packet.state;remember();$('attempt-state').textContent=packet.state==='ended'?'练习已保存，尚未提交。':'保存状态待确认，请查询。';return;}
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
async function failVoice(text){ending=true;const old=ws;ws=null;if(old){old.onclose=null;old.onerror=null;old.close();}await stopMedia();$('voice-state').textContent=text;$('end').disabled=true;$('interrupt').disabled=true;if(current){$('query-attempt').hidden=false;try{await queryAttempt();}catch{/* query button stays available */}}}
$('interrupt').onclick=()=>{const response_id=presentation.current;presentation.stop();send({type:'response.cancel',...(response_id?{response_id}:{})});};
$('end').onclick=async()=>{ending=true;$('end').disabled=true;$('interrupt').disabled=true;await stopMedia();$('voice-state').textContent='已停止采音与播放，正在确认保存……';send({type:'session.end'});const epoch=generation;setTimeout(()=>{if(epoch===generation&&current)queryAttempt().catch(showError);},3000);};
async function queryAttempt(){if(!current||actor?.role!=='learner')return;const requested=current.id,epoch=generation;let a;try{a=await api('attempt',{attempt_id:requested});}catch(e){if(epoch!==generation)return;throw e;}if(epoch!==generation||current?.id!==requested)return;current.version=a.version;current.state=a.state;remember();$('submit').hidden=a.state!=='ended';$('query-attempt').hidden=false;$('attempt-state').textContent=a.state==='ended'?'本次记录已保存。点击“提交这次练习”后老师才能看到提交。':a.state==='active'?'记录仍在处理中或连接尚未结束，请稍后查询。':`本次记录状态：${a.state}。可以重新开始练习。`;
  try{const s=await api('submission',{attempt_id:requested});if(epoch!==generation)return;$('submit').hidden=true;$('attempt-state').textContent='服务端已确认提交。';await showReport(s);}catch(e){if(e.message!=='NOT_FOUND')throw e;}
}
$('query-attempt').onclick=()=>queryAttempt().catch(showError);
$('submit').onclick=async()=>{if(submitting||!current)return;submitting=true;$('submit').disabled=true;$('attempt-state').textContent='提交中，等待服务确认……';const epoch=generation;try{const receipt=await api('submit',{attempt_id:current.id,expected_version:current.version,idempotency_key:current.submit_key});if(epoch!==generation)return;$('submit').hidden=true;$('attempt-state').textContent='已提交 · 本地服务回执 '+receipt.id;await showReport(receipt);await refresh();}catch(e){if(epoch!==generation)return;$('attempt-state').textContent='提交尚未确认，请查询状态；重复提交使用相同请求标识。';showError(e);}finally{submitting=false;$('submit').disabled=false;}};
async function loadReport(id){const epoch=generation,s=await api('submission',{submission_id:id});if(epoch!==generation)return;await showReport(s);}
function renderAnalysis(root,a){
  const coverage=a.coverage;
  root.append(node('p',`本次接受 ${coverage.accepted_turns} 轮表达；其中 ${coverage.expression_turns} 轮有可分析的目标表达，${coverage.matched_responses} 次有语义相符的问答观察。未命中的表达保持未知。`,'small'));
  if(coverage.truncated)root.append(node('p','证据已达到保留上限，以下只反映保留片段，不代表整场表现。','notice'));
  if(coverage.legacy_evidence)root.append(node('p','这次使用旧版证据，没有收集问答关系；新练习提交后可生成更细的分析。','small'));
  for(const [key,label] of [['listening','情境理解 · 听懂情况观察'],['speaking','口语表达 · 信息与组织'],['support','沟通策略 · 求助与支持']]){
    const s=a[key],card=node('article','','analysis-card');card.dataset.dimension=key;
    card.append(node('h3',label),node('p',s.summary));
    for(const observation of s.observations){
      const row=node('div','','analysis-observation');row.append(node('p',observation.description));
      if(observation.example)row.append(node('p',`本次表达：“${observation.example}”`,'example'));
      for(const ref of observation.evidence??[])row.append(node('p',`${ref.role==='kai_question'?'Kai 问题':ref.role==='student_answer'?'学生回答':'学生观察'}${ref.excerpt?`：“${ref.excerpt}”`:''} · 轮次 ${ref.turn_id}${ref.response_id?` · 回复 ${ref.response_id}`:''} · 事件 ${ref.event_id}`,'analysis-evidence'));
      card.append(row);
    }
    for(const limitation of s.limitations)card.append(node('p',limitation,'small'));
    root.append(card);
  }
  const audio=node('article','','analysis-card');audio.dataset.dimension='audio';audio.append(node('h3','发音与语流 · 未评估'),node('p',a.audio.summary),node('p',a.audio.reason,'small'));root.append(audio);
  root.append(node('h3',actor.role==='teacher'?'建议跟进 · 最多两项':'下次可以试试'));
  for(const step of a.next_steps){const card=node('article','','practice-step');card.append(node('p',step.basis==='extension'?'拓展练习':'探索练习','small'),node('p',step.reason),node('p',step.activity),node('p',`下次观察：${step.success_criteria}`,'small'));root.append(card);}
}
async function showReport(s){clearTimeout(reportTimer);$('report').hidden=false;$('report-role').textContent=actor.role==='teacher'?'D · 教师报告':'B · 我的反馈';const root=$('report-body');root.replaceChildren();
  if(s.report_state!=='complete'||!s.report){root.append(node('p',s.report_state==='failed'?'作业已提交；报告生成失败，可由老师重试。':'作业已提交；报告正在生成。'));if(s.report_state==='failed'&&actor.role==='teacher')root.append(action('重试生成报告',async()=>{await api('retry_report',{submission_id:s.id});await loadReport(s.id);}));else if(s.report_state!=='failed'){const epoch=generation;reportTimer=setTimeout(()=>{if(epoch===generation)loadReport(s.id).catch(showError);},800);}return;}
  const r=s.report;root.append(node('p',r.headline),node('p',`语音来源：${r.voice_source==='doubao'?'真实 Doubao 会话':'合成 provider · 工程预览'} · 提交 ${s.id}`,'small'));
  for(const goal of r.goals){const card=node('div','','goal');card.append(node('h3',goal.label+' · '+(goal.status==='attempt_observed'?'观察到表达尝试':'尚未评估')),node('p',goal.description));for(const ref of goal.evidence??[])card.append(node('p',`识别片段：“${ref.excerpt}” · 轮次 ${ref.turn_id} · 支持归因未知`,'evidence'));root.append(card);}
  if(r.analysis)renderAnalysis(root,r.analysis);else root.append(node('h3',actor.role==='teacher'?'下一次教学建议':'下次可以试试'),node('p',r.suggestion));for(const limitation of r.limitations)root.append(node('p',limitation,'small'));const details=node('details','');details.append(node('summary','查看本次记录标识'),node('code',`Attempt ${r.attempt_id} · Session ${r.session_id} · Plan ${r.plan_hash.slice(0,16)}`));root.append(details);
}
window.addEventListener('pagehide',()=>{generation++;clearTimeout(reportTimer);ws?.close();void stopMedia();});
enter().catch(e=>{if(e.message!=='UNAUTHORIZED')showError(e);});
