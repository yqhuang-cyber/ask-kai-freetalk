const titles={
  'preparation.started':'开始准备','preparation.ready':'初始计划已采用','preparation.failed':'准备失败',
  'planning.triggered':'触发 Planner','planning.attempt':'开始模型请求／修复','planner.request':'发给规划模型的请求',
  'planner.http_response':'规划模型 HTTP 状态','planner.response':'规划模型返回','planner.transport_failed':'规划模型连接失败',
  'planning.proposal':'编译后的提案','planning.validated':'提案通过校验','planning.rejected':'提案被拒绝',
  'planning.fallback':'采用规则计划／降级','planning.started':'开始逐轮规划','planning.committed':'逐轮计划已采用',
  'planning.accepted':'逐轮规划完成','planning.cancelled':'规划取消／失效','conversation_plan.revised':'会话计划修订',
  'student.input.accepted':'接受学生表达','voice.context.prepared':'编译语音指令','voice.context.waiting':'等待可更新配置的时机',
  'voice.context.requested':'准备更新语音指令','voice.request.sent':'已发送语音模型请求',
  'voice.cancel.requested':'请求打断旧回复','voice.cancel.sent':'打断请求实际已发出','voice.cancel.ack':'收到打断确认',
  'voice.cancel.skipped':'旧回复取消已跳过','voice.cancel.ignored':'忽略重复打断','voice.cancel.timeout':'等待打断确认超时','voice.event.dropped':'供应商事件未通过归属检查',
  'voice.ready':'语音连接就绪','voice.context.confirmed':'语音模型已确认配置',
  'voice.reply.started':'观察到语音回复开始','voice.reply.forwarded':'已转发的回复文字','session.ended':'会话结束'
};
export class PlanningObserver {
  constructor(panel,{enabled=false,limit=160,maxBytes=2097152}={}) {
    Object.assign(this,{panel,enabled,limit,maxBytes});this.rows=[];this.bytes=0;this.seen=0;this.traceId=null;this.discarded=0;
    this.list=panel.querySelector('ol');this.status=panel.querySelector('[data-observation-status]');this.filter=panel.querySelector('select');
    panel.querySelector('[data-observation-content]').hidden=!enabled;
    panel.querySelector('[data-observation-enable]').hidden=enabled;
    panel.open=enabled;
    panel.querySelector('[data-observation-clear]').addEventListener('click',()=>this.clear(false));
    this.filter.addEventListener('change',()=>this.applyFilter());
    panel.querySelector('[data-observation-export]').addEventListener('click',()=>{
      const report={version:1,contains_text:true,contains_audio:false,storage:'memory_only',trace_id:this.traceId,discarded:this.discarded,rows:this.rows.map(x=>x.row)};
      const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');
      link.href=url;link.download='ask-kai-planning-observation.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    this.refresh();
  }
  clear(reset=true){this.rows=[];this.bytes=0;this.discarded=0;this.list.replaceChildren();if(reset){this.traceId=null;this.seen=0;}this.refresh();}
  snapshot(report){if(!this.enabled||!report?.trace_id)return;if(this.traceId!==report.trace_id){this.clear();this.traceId=report.trace_id;}for(const row of report.rows??[])this.record(row);this.discarded=Math.max(this.discarded,report.discarded??0);this.refresh();}
  record(row) {
    if(!this.enabled||!row?.trace_id||!Number.isSafeInteger(row.seq)||typeof row.stage!=='string')return;
    if(this.traceId!==row.trace_id){this.clear();this.traceId=row.trace_id;}
    if(row.seq<=this.seen)return;
    if(row.seq>this.seen+1)this.discarded+=row.seq-this.seen-1;
    this.seen=row.seq;
    const serialized=JSON.stringify(row),bytes=new TextEncoder().encode(serialized).length;
    if(bytes>this.maxBytes){this.discarded++;this.refresh();return;}
    const li=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
    const kind=row.data?.kind==='conversation'?'初始规划':row.data?.kind==='turn'?'逐轮规划':'';
    const identity=[kind,row.data?.turn_id?`轮次 ${row.data.turn_id}`:'',row.data?.attempt?`尝试 ${row.data.attempt}`:'',row.data?.context_version?`配置 v${row.data.context_version}`:''].filter(Boolean).join(' · ');
    summary.textContent=`#${row.seq} +${row.at_ms}ms ${titles[row.stage]??row.stage}${identity?' · '+identity:''}`;
    pre.textContent=JSON.stringify(row.data,null,2);details.append(summary,pre);li.append(details);
    li.dataset.category=row.stage.startsWith('voice.')?'voice':row.stage.startsWith('student.')?'input':row.data?.kind==='conversation'||row.stage.startsWith('preparation.')?'initial':'turn';
    this.rows.push({row,li,bytes});this.bytes+=bytes;this.list.append(li);
    while(this.rows.length>this.limit||this.bytes>this.maxBytes){const removed=this.rows.shift();this.bytes-=removed.bytes;removed.li.remove();this.discarded++;}
    this.applyFilter();this.refresh();
  }
  applyFilter(){for(const {li} of this.rows)li.hidden=this.filter.value!=='all'&&li.dataset.category!==this.filter.value;}
  refresh(){this.status.textContent=this.enabled?`已记录 ${this.rows.length} 项${this.discarded?`；有 ${this.discarded} 项已清理或未送达`:''}。${this.rows.some(x=>x.row.truncated)?'部分内容超过大小上限，已标记省略。':''}`:'观测默认关闭。开启后重新准备对话，才会记录请求内容。';this.panel.querySelector('[data-observation-export]').disabled=!this.rows.length;}
}
