export class ObservationReportsPanel {
  constructor(root,{fetcher}={}) {
    this.root=root;this.fetcher=fetcher;this.epoch=0;this.active=false;this.report=null;this.rows=[];
    this.select=root.querySelector('select');this.status=root.querySelector('[data-report-status]');this.content=root.querySelector('[data-report-content]');
    this.exportButton=root.querySelector('[data-report-export]');this.refreshButton=root.querySelector('[data-report-refresh]');
    this.select.addEventListener('change',()=>{if(this.select.value)void this.load(this.select.value);});
    this.refreshButton.addEventListener('click',()=>void this.refresh());this.exportButton.addEventListener('click',()=>void this.export());this.controls();
  }
  controls(){this.select.disabled=this.active||this.busy||!this.rows.length;this.exportButton.disabled=this.active||this.busy||!this.report;this.refreshButton.disabled=this.active||this.busy;}
  reset(){this.epoch++;this.active=false;this.busy=false;this.sessionId=null;this.saveFailed=false;this.report=null;this.rows=[];this.select.replaceChildren();this.content.replaceChildren();this.status.textContent='尚无会话观测总结。';this.controls();}
  begin(id){this.epoch++;this.busy=false;this.report=null;this.content.replaceChildren();this.saveFailed=false;this.sessionId=id;this.active=true;this.status.textContent='正在记录本场前 5 轮；结束或中断后可汇总导出。';this.controls();}
  async finish(){this.active=false;this.controls();const sessionId=this.sessionId;await this.refresh();if(this.sessionId===sessionId&&!this.active&&this.saveFailed)this.status.textContent='本场观测总结未保存成功；当前列表仅为历史记录，请勿当成本场记录。';}
  async refresh(){
    const epoch=++this.epoch;this.busy=true;this.controls();
    try{
      const response=await this.fetcher('/api/observation-reports');if(!response.ok)throw new Error('UNAVAILABLE');const result=await response.json();if(epoch!==this.epoch)return;
      this.rows=result.reports??[];this.select.replaceChildren();
      for(const row of this.rows){const option=document.createElement('option');option.value=row.id;option.textContent=`${new Date(row.ended_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · ${row.learner?.name??'当前学习者'} · ${row.turn_count} 轮${row.state==='failed'?' · 中断':''}`;this.select.append(option);}
      this.persistent=result.persistent;
      if(this.sessionId&&!this.rows.some(r=>r.id===this.sessionId)){
        this.report=null;this.content.replaceChildren();const option=document.createElement('option');option.value='';option.textContent='本场总结尚未保存';this.select.prepend(option);this.select.value='';this.status.textContent='本场总结尚未保存，请稍后刷新；历史记录需手动选择。';
      }
      else if(this.rows.length)await this.load(this.sessionId??this.rows[0].id,epoch);
      else{this.report=null;this.content.replaceChildren();this.status.textContent='尚无会话观测总结。结束一场对话后会自动生成；刚断线时可稍后刷新。';}
    }catch{if(epoch===this.epoch){this.report=null;this.status.textContent='观测总结暂不可用，请稍后刷新。';}}
    finally{if(epoch===this.epoch){this.busy=false;this.controls();}}
  }
  async load(id,existingEpoch){
    const epoch=existingEpoch??++this.epoch;this.busy=true;this.controls();
    try{const response=await this.fetcher(`/api/observation-reports/${id}`);if(!response.ok)throw new Error('UNAVAILABLE');const result=await response.json();if(epoch!==this.epoch)return;this.report=result.report;this.select.value=id;this.render();}
    catch{if(epoch===this.epoch){this.report=null;this.content.replaceChildren();this.status.textContent='该场总结未读取成功，请刷新。';}}
    finally{if(epoch===this.epoch){this.busy=false;this.controls();}}
  }
  render(){
    const report=this.report;this.content.replaceChildren();
    this.status.textContent=`已整理 ${report.turns.length}/5 轮${report.state==='failed'?`；会话中断：${report.error_code??'未知原因'}`:''}。${this.persistent?'保存在本机，刷新和重启后仍可查看。':'当前服务仅保留在内存。'}`;
    const metadata=document.createElement('p');metadata.textContent=`豆包 Log ID：${report.provider.log_id??'未取得（不会用本地编号替代）'}；模型：${report.provider.model??'未记录'}；${report.provider.synthetic===true?'合成测试连接':report.provider.synthetic===false?'真实供应商连接':'连接类型未知'}。`;this.content.append(metadata);
    const renderReply=reply=>{
      const section=document.createElement('section');section.className='observation-report-reply';section.dataset.responseId=reply.response_id;
      const actual=document.createElement('p');actual.textContent=`实际回复${reply.actual_response.complete?'':'（未完整结束）'}：${reply.actual_response.text||'未收到文字'}`;
      const expected=document.createElement('p');expected.textContent=`预期回应要求：${reply.expected?.task??'没有可关联的计划'}。生成时是否采用该计划：未知。`;
      const difficulty=reply.expected?.speaking_difficulty,constraints=reply.expected?.speaking_constraints;
      const effects=[constraints?.verified_through_level!=null?`普通主动用词不超过 HSK${constraints.verified_through_level}`:null,({everyday:'使用常用表达',precise:'使用更准确的表达'})[difficulty?.lexical_style],({simple:'句子简单',linked:'按顺序连接表达',flexible:'可灵活组织表达'})[difficulty?.sentence_structure],({avoid:'不主动引入新词',one_explained:'可解释一个范围内的新词',requested_only:'仅解释学生主动询问的词'})[difficulty?.new_word_policy]].filter(Boolean);
      const effect=document.createElement('p');effect.textContent=`预期效果：${effects.join('；')||'未设置具体语言难度要求'}。语义符合度尚未自动评估。`;
      section.append(actual,expected,effect);
      for(const [key,label] of [['expected_response','预期 response（可选补充）'],['expected_effect','预期效果（可选补充）'],['notes','观察备注（可选）']]){
        const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('textarea');input.maxLength=3000;input.dataset.reviewField=key;input.value=reply.review[key]??'';input.rows=2;wrapper.append(input);section.append(wrapper);
      }
      const ref=document.createElement('p');ref.textContent=`指令版本：v${reply.instruction_ref.version??'未知'}；完整 instructions 随导出文件附带。`;section.append(ref);return section;
    };
    for(const turn of report.turns){const details=document.createElement('details'),title=document.createElement('summary');title.textContent=`第 ${turn.number} 轮 · ${turn.input}`;details.append(title);for(const reply of turn.responses)details.append(renderReply(reply));if(!turn.responses.length){const missing=document.createElement('p');missing.textContent='未记录到本轮回复。';details.append(missing);}this.content.append(details);}
    if(report.unassigned_responses.length){const details=document.createElement('details'),title=document.createElement('summary');title.textContent='尚未关联到学生输入的回复';details.append(title,...report.unassigned_responses.map(renderReply));this.content.append(details);}
  }
  receipt(packet){this.saveFailed=packet.status!=='saved';if(this.saveFailed)this.status.textContent='本场观测总结保存失败，请保留当前详细观测并检查本地存储。';}
  async export(){
    if(!this.report||this.active||this.busy)return;
    const id=this.report.id,epoch=this.epoch;this.busy=true;this.controls();
    const reviews=[...this.content.querySelectorAll('[data-response-id]')].map(section=>({response_id:section.dataset.responseId,...Object.fromEntries([...section.querySelectorAll('[data-review-field]')].map(input=>[input.dataset.reviewField,input.value.trim()||null]))}));
    try{
      const saved=await this.fetcher(`/api/observation-reports/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviews})});if(!saved.ok)throw new Error('SAVE_FAILED');
      const response=await this.fetcher(`/api/observation-reports/${id}/export`);if(!response.ok)throw new Error('EXPORT_FAILED');const blob=await response.blob();if(epoch!==this.epoch)return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`ask-kai-observation-${id}.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.status.textContent='已汇总导出：包含前 5 轮、Log ID、instructions、实际回复与预期；补充内容也已保存。';
    }catch{if(epoch===this.epoch)this.status.textContent='汇总导出失败，填写内容仍在页面中，请重试。';}
    finally{if(epoch===this.epoch){this.busy=false;this.controls();}}
  }
}
