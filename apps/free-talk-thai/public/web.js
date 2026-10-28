import {AudioIO} from '/audio.js';
import {Presentation} from '/presentation.js';
import {CaptionAnnotations} from '/caption-annotations.js';
import {CaptionSettingsView} from '/caption-settings.js';
import {ClosingPlayback} from '/closing-playback.js';
import {SpeechPlayback} from '/speech-playback.js';
import {voiceReadiness} from '/voice-readiness.js';
const el=id=>document.getElementById(id),connect=el('connect'),learner=el('learner'),pace=el('pace'),message=el('message'),status=el('status'),pinyin=el('pinyin');
let epoch=0,ws,io,sessionId=null,config=null,muted=false,busy=false,voiceConfigured=false,preparationId=null,requestControl=null,safety=false;
const send=value=>{if(ws?.readyState!==WebSocket.OPEN)return false;ws.send(JSON.stringify(value));return true;};
const annotations=new CaptionAnnotations(el('caption'));
const presentation=new Presentation({render:(text,parts)=>annotations.render(text,parts),play:(...args)=>io?.play(...args),stopAudio:()=>io?.stopPlayback(),getPlayback:id=>io?.playback(id),onMode:()=>{closing.check();speech.check();captionVoice.check();}});
const receipts={presentation,getPlayback:id=>io?.playback(id),isMuted:()=>muted,send};
const closing=new ClosingPlayback(receipts),speech=new SpeechPlayback(receipts),captionVoice=new SpeechPlayback({...receipts,send:packet=>send({...packet,type:'caption.playback'})});
const captionSettings=new CaptionSettingsView({annotations,toggle:pinyin,hint:el('pinyin-hint'),send});
function controls(active){busy=active;connect.disabled=active||!voiceConfigured;learner.disabled=active;pace.disabled=active;for(const id of ['interrupt','mute','end'])el(id).disabled=!active;}
async function api(path,{body,signal=requestControl?.signal,method=body===undefined?'GET':'POST'}={}){
  const response=await fetch(path,{method,signal,headers:{'Content-Type':'application/json','X-Ask-Kai-Mock-Uid':learner.value},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json();if(!response.ok)throw Error(value.error??'REQUEST_FAILED');return value;
}
async function stop(text='本次对话已结束。'){
  epoch++;requestControl?.abort();requestControl=null;const socket=ws;ws=null;socket?.close();
  const audio=io;io=null;presentation.clear();closing.reset();speech.reset();captionVoice.reset();captionSettings.reset();sessionId=null;config=null;preparationId=null;safety=false;muted=false;
  el('mute').textContent='静音';el('mute').setAttribute('aria-pressed','false');status.textContent='未连接';message.textContent=text;await audio?.close();controls(false);
}
function showSummary(summary){
  const root=el('summary-content');root.replaceChildren();
  if(safety||summary?.focus==='unavailable'){el('summary').hidden=true;return;}
  const add=text=>{if(typeof text!=='string'||!text)return;const p=document.createElement('p');p.textContent=text;root.append(p);};
  add(summary.headline?.zh);add(summary.headline?.th);
  const recap=summary.session_recap;add(recap?.objective?.purpose);
  for(const point of recap?.knowledge_points??[])add(`${point.text} · ${point.occurrence==='teacher_demonstrated'?'回复中示范过':'对话中提到过'}`);
  if(!recap?.knowledge_points?.length)add('本轮以交流为主，没有可核验的练习条目。');
  add('上述内容不表示已经掌握或发音准确。');el('summary').hidden=false;
}
connect.addEventListener('click',async()=>{
  if(busy)return;const current=++epoch;controls(true);safety=false;el('summary').hidden=true;el('receipt').textContent='';el('student').textContent='';presentation.reset();captionSettings.reset();
  requestControl=new AbortController();const localControl=requestControl;
  try{
    io=new AudioIO({onFrame:bytes=>{if(current!==epoch||ws?.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>65536){void stop('上传暂时拥堵，请重新开始。');return;}ws.send(bytes);},onFailure:text=>{if(current===epoch)void stop(text);}});
    await io.prepare();if(current!==epoch)return;
    status.textContent='准备对话';message.textContent='正在按本次学习者准备中泰自由聊天……';
    await api('/api/poc/launch',{body:{uid:learner.value}});if(current!==epoch)return;
    const entry={mode:'free',speech_pace:pace.value};let prepared=await api('/api/conversation-preparations',{body:entry});preparationId=prepared.preparation_id;
    while(prepared.status==='preparing'){
      await new Promise(resolve=>setTimeout(resolve,200));if(current!==epoch)return;
      prepared=await api('/api/conversation-preparations/'+preparationId);
    }
    if(prepared.status!=='ready')throw Error('PREPARATION_FAILED');
    el('plan').textContent=(prepared.view?.prompt_title??'由你选择话题，自然交流。')+(prepared.view?.planning?.degraded?'（当前使用规则计划）':'');
    const ticket=await api('/api/sessions',{body:{...entry,preparation_id:preparationId}});if(current!==epoch)return;
    sessionId=ticket.session_id;captionSettings.reset(sessionId);status.textContent='正在连接语音';
    ws=new WebSocket('ws://'+location.host+ticket.websocket_path,[ticket.protocol,'ticket.'+ticket.ticket]);
    ws.onmessage=async event=>{
      if(current!==epoch)return;
      try{
        const p=JSON.parse(event.data);
        if(p.type==='session.config'){if(p.session_id!==sessionId)return;config=p.audio;return;}
        if(p.type==='session.failed'){await stop('对话未完成，请重新开始。');return;}
        if(p.type==='session.closed'){await stop();return;}
        if(p.type==='output.stop'){presentation.stop(p.response_id);return;}
        if(p.type==='safety.restricted'){safety=true;presentation.clear();el('summary').hidden=true;message.textContent='请先保护好自己，联系身边可信任的大人。';return;}
        if(p.type==='safety.handoff'){if(safety)message.textContent='这是本地 Mock 流程，尚无真人接手；请直接联系身边可信任的大人。';return;}
        if(p.type==='caption.settings'){await captionSettings.receive(p);return;}
        if(p.type==='caption.state'){captionSettings.state(p);captionVoice.update({...p,phase:p.phase==='awaiting_after_playback'?'awaiting_after_playback':p.phase});return;}
        if(p.type==='speech.state'){speech.update(p);return;}
        if(p.type==='closing.state'){closing.update(p,sessionId);message.textContent=p.phase==='cancelled'?'继续交流。':'Kai 正在回顾本场内容，播完后结束。';return;}
        if(p.type==='teaching.summary'){if(p.session_id===sessionId)showSummary(p.summary);return;}
        if(p.type==='conversation.record.receipt'){if(p.session_id===sessionId)el('receipt').textContent=['saved','accepted'].includes(p.status)?'小结已保存到本入口的 Mock 内存。':'小结保存状态：'+p.status;return;}
        if(p.type!=='event')return;
        const e=p.event;if(e.session_id!==sessionId)return;
        if(e.type==='session.ready'){
          const readiness=voiceReadiness(p,config);if(!readiness)throw Error('NOT_REAL_READY');
          status.textContent=readiness.status;message.textContent='麦克风正在开启……';const audio=io;await audio.start(config);if(current===epoch&&!safety)message.textContent='可以开始说中文了。Kai 会按需要用泰语解释，你可以随时打断。';return;
        }
        if(safety)return;
        if(e.type==='response.started')presentation.begin(e.response_id);
        else if(e.type==='response.text.delta')presentation.append(e.response_id,e.payload.text);
        else if(e.type==='response.audio.chunk')presentation.audio(e.response_id,p.audio,p.sample_rate);
        else if(e.type==='response.done'){presentation.done(e.response_id);closing.check();speech.check();captionVoice.check();}
        else if(e.type==='response.cancelled')presentation.stop(e.response_id);
        else if(e.type==='user.partial'||e.type==='user.final')el('student').textContent=e.payload.text;
      }catch{if(current===epoch)await stop('语音连接未完成或已中断，请重新开始。');}
    };
    ws.onerror=()=>{if(current===epoch)void stop('无法连接语音服务，请重试。');};ws.onclose=()=>{if(current===epoch)void stop('连接已断开。');};
  }catch{if(current===epoch)await stop('无法开始中泰对话，请检查服务或麦克风权限。');}
  finally{if(current===epoch&&requestControl===localControl)requestControl=null;}
});
el('interrupt').addEventListener('click',()=>{const id=presentation.current;presentation.stop();send({type:'response.cancel',...(id?{response_id:id}:{})});});
el('mute').addEventListener('click',()=>{muted=!muted;io?.mute(muted);el('mute').textContent=muted?'取消静音':'静音';el('mute').setAttribute('aria-pressed',String(muted));});
el('end').addEventListener('click',()=>{if(!send({type:'session.end',save_learning:true})){void stop();return;}io?.stopCapture();message.textContent='正在结束并保存本场小结……';const current=epoch;setTimeout(()=>{if(current===epoch)void stop('本次对话已结束，小结保存状态请以回执为准。');},6000);});
pinyin.addEventListener('change',()=>{if(sessionId)send({type:'caption.set',session_id:sessionId,pinyin_enabled:pinyin.checked});else captionSettings.apply(pinyin.checked);});
window.addEventListener('pagehide',()=>void stop());
try{
  const [runtime,list]=await Promise.all([api('/api/runtime'),api('/api/poc/learners')]);
  for(const row of list.learners??[]){const option=document.createElement('option');option.value=row.uid;option.textContent=row.display_name??row.name??row.uid;learner.append(option);}
  voiceConfigured=runtime.voice_configured===true;controls(false);status.textContent=voiceConfigured?'语音已配置，尚未连接':'语音未配置';
  if(!voiceConfigured)message.textContent='当前只可预览；尚未配置真实语音，不会申请麦克风。';
}catch{status.textContent='服务暂不可用';message.textContent='请重新启动中泰入口后刷新。';}
