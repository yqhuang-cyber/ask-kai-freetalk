import {SlidesViewer} from '/slides-viewer.js';
import {AudioIO} from '/audio.js';
const $=selector=>document.querySelector(selector),buttons=[...document.querySelectorAll('[data-input]')];
let ws,viewer,io,active=false,inputPcm=null,offset=0,timer,audioChunks=0,currentReply=null;
const log=text=>{const item=document.createElement('li');item.textContent=text;$('#log').append(item);};
const controls=enabled=>buttons.forEach(button=>{button.disabled=!enabled;});
async function stop(){active=false;clearTimeout(timer);controls(false);if(ws?.readyState===1)ws.close();viewer?.close();await io?.close();$('#start').disabled=false;$('#end').disabled=true;}
$('#start').addEventListener('click',async()=>{
  $('#start').disabled=true;$('#status').textContent='连接中…';$('#reply').textContent='';audioChunks=0;
  try{
    io=new AudioIO({onFailure:text=>{log(text);void stop();},onObserve:(name)=>{if(name==='audio.drained')$('#audio').textContent=`音频队列已播放完（${audioChunks} 个片段）；未验证真人听感`;}});await io.prepare();
    const ticket=await(await fetch('/start',{method:'POST'})).json();
    ws=new WebSocket(`ws://${location.host}${ticket.websocket_path}`,[ticket.protocol,`ticket.${ticket.ticket}`]);
    ws.onmessage=async event=>{
      try{
        const packet=JSON.parse(event.data);
        if(packet.type==='slides.bind'){
          const deck=await(await fetch('/demo-deck.json')).json();viewer=new SlidesViewer($('#viewer'),deck);viewer.bind(packet,value=>ws.send(JSON.stringify(value)));log('组件连接；作者演示依次展示三页建立测试历史。');return;
        }
        if(packet.type.startsWith('slides.')){await viewer?.receive(packet);if(packet.type==='slides.state'&&packet.confirmed&&!packet.pending)log(`组件确认：第${packet.page}页，revision=${packet.revision}`);return;}
        if(packet.type==='output.stop'){io.stopPlayback();currentReply=null;$('#reply').textContent='';return;}
        if(packet.type==='session.failed'){log('检查失败：'+packet.code);$('#status').textContent=packet.code;await stop();return;}
        if(packet.type==='session.closed'){await stop();$('#status').textContent='已结束';return;}
        const value=packet.event;if(!value)return;
        if(value.type==='session.ready'){
          if(!packet.provider_connected||packet.synthetic)throw new Error('REAL_PROVIDER_NOT_READY');
          active=true;controls(true);$('#end').disabled=false;$('#status').textContent='真实语音已就绪 · 作者录音输入 · 麦克风未开启';
          const pump=()=>{if(!active||ws.readyState!==1)return;let frame=new Uint8Array(640);if(inputPcm){frame.set(inputPcm.subarray(offset,offset+640));offset+=640;if(offset>=inputPcm.length){inputPcm=null;offset=0;}}ws.send(frame);timer=setTimeout(pump,20);};pump();return;
        }
        if(value.type==='user.final'){$('#input').textContent='识别：'+value.payload.text;return;}
        if(value.type==='response.started'){currentReply=value.response_id;$('#reply').textContent='';}
        if(value.type==='response.text.delta'&&currentReply===value.response_id)$('#reply').textContent+=value.payload.text;
        if(value.type==='response.audio.chunk'&&packet.audio){io.play(packet.audio,packet.sample_rate,value.response_id);audioChunks++;$('#audio').textContent=`已收到并排入播放：${audioChunks} 个音频片段`;}
        if(value.type==='response.done'){log('原生回复输出结束；展示框状态见上方。');controls(true);}
      }catch{log('浏览器检查失败');void stop();}
    };
    ws.onclose=()=>{void stop();};ws.onerror=()=>{log('连接错误');void stop();};
  }catch{log('无法开始检查');await stop();}
});
for(const button of buttons)button.addEventListener('click',async()=>{
  if(!active||inputPcm)return;controls(false);$('#reply').textContent='等待原生回应…';
  try{const response=await fetch('/author/'+button.dataset.input);if(!response.ok)throw new Error('AUTHOR_INPUT_MISSING');inputPcm=new Uint8Array(await response.arrayBuffer());offset=0;log(button.textContent);}
  catch{log('作者录音不可用');controls(true);}
});
$('#end').addEventListener('click',()=>{controls(false);active=false;clearTimeout(timer);if(ws?.readyState===1)ws.send(JSON.stringify({type:'session.end'}));});
window.addEventListener('pagehide',()=>{ws?.close();void stop();});
