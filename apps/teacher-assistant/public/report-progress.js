const finished=stage=>['complete','partial'].includes(stage?.state);
const failure={deadline:'请求超时，分析已停止',provider_failed:'服务请求失败，分析已停止',output_rejected:'结果未通过检查',external_outcome_unknown:'连接中断，未能确认结果'};
export function reportProgress(submission,{now=Date.now()}={}){
  const deep=submission.deep_analysis;if(!deep)return null;
  const text=deep.stages.text,audio=deep.stages.audio,p=text.progress,active=deep.processing;
  const textReady=finished(text),failed=submission.report_state==='failed';
  const needsReview=audio.review_required||audio.state==='awaiting_review',ready=submission.report_state==='complete'&&!needsReview;
  const audioOff=audio.provider==='none'||['disabled','not_authorized'].includes(audio.state)||audio.reason==='not_enabled';
  const row=(id,label,state,detail)=>({id,label,state,detail});
  let textState=textReady?'complete':text.state==='failed'?'failed':text.state==='running'?'running':text.state==='pending'&&active?'waiting':'unavailable';
  let textDetail=textReady?(text.state==='partial'?'部分内容已完成分析，报告会注明覆盖范围':'对话文本分析完成'):text.state==='failed'?(failure[text.reason]??'本次分析已停止'):textState==='waiting'?(submission.report_state==='pending'?'正在排队，等待后台开始':'正在准备本次对话文本'):textState==='unavailable'?'本次没有可分析的文本':'正在分析本次对话';
  if(text.state==='running'&&p){
    textDetail=p.phase==='repairing'?'首次结果未通过检查，正在请求修复':p.phase==='checking'?'模型已返回，正在检查引用与结论':p.phase==='processed'?'本组内容已处理，正在整理结果':'正在分析本次对话';
    if(p.current)textDetail+=` · 第 ${p.current} / ${p.total} 组`;
  }
  if(p?.total)textDetail+=`；已处理 ${p.processed} / ${p.total} 组`;
  const checking=text.state==='running'&&['checking','processed'].includes(p?.phase);
  const audioStarted=audio.state==='running'||finished(audio)||!!audio.started_at;
  const audioDetail=audio.state==='running'?`正在评测${audio.progress?.current?`第 ${audio.progress.current} / ${audio.progress.total} 段录音`: '已核对的学生录音'}`:finished(audio)?'音频结果已保存，报告会注明实际覆盖':audio.state==='failed'?(failure[audio.reason]??'音频评测已停止'):needsReview?'老师核对后继续，无需在页面等待':audio.reason==='review_inconclusive'?'核对后仍无可靠片段，本次保留未评估':audioOff?'本次不进行音频评测':audio.state==='pending'?'等待检查可用录音':'本次没有符合条件的录音，不作发音判断';
  const steps=[
    row('submitted','练习已提交','complete','本次练习已保存，无需重复提交'),
    row('text','理解与口语表达',textState,textDetail),
    row('validation','核对引用与保存文本结果',textReady?'complete':text.reason==='output_rejected'?'failed':checking?'running':!active?'blocked':'waiting',textReady?'文本结果已通过检查并保存':checking?'正在核对原文引用、结论范围与记录来源':!active?'本次未保存可用的文本分析结果':'文本分析返回后进行，不会提前发布未核对结果'),
    row('review','核对录音来源与质量',needsReview?(active?'waiting':'action'):audioStarted?'complete':audioOff?'skipped':!active?'unavailable':'waiting',needsReview?(active?'本轮分析结束后，老师回听并核对录音':'等待老师回听，确认学生声音和录音质量'):audioStarted?'仅使用已确认来源和质量的片段':audioOff?'本次不需要核对录音':audio.reason==='review_inconclusive'?'已核对，仍不足以支持可靠评测':!active?'本次没有可核对的录音':'后台先检查是否有可评测片段'),
    row('audio','音频评测',audio.state==='running'?'running':finished(audio)?'complete':audio.state==='failed'?'failed':audioOff?'skipped':needsReview||audio.state==='pending'?'waiting':'unavailable',audioDetail),
    row('report','生成深入报告',ready?'complete':failed||!active&&!needsReview?'blocked':'waiting',ready?'深入报告已可查看':failed?'修复失败的分析后继续，作业无需重交':needsReview?'文本与录音进度分别保存，核对和评测结束后生成报告':!active?'本次未生成可用报告':'各项处理结束后自动显示报告')
  ];
  const started=text.started_at,ended=text.finished_at;
  const elapsed=started?Math.max(0,Math.floor(((ended??now)-started)/1000)):null;
  return {steps,summary:ready?'报告已生成':failed?'分析已停止，可以重试':needsReview?(active?'文本处理中 · 录音待核对':'等待老师核对录音'):submission.report_state==='pending'?'已提交，正在排队':active?'正在后台处理':'本次未生成报告',elapsed,live:active,textFinished:!!ended};
}
const node=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text??'';if(cls)el.className=cls;return el;};
export function renderReportProgress(root,submission){
  const progress=reportProgress(submission);if(!progress)return;
  const panel=node('div','','report-progress');panel.dataset.reportProgress=submission.id;
  const head=node('div','','progress-heading'),title=node('h3','报告生成进度'),summary=node('p',progress.summary,'progress-summary');summary.setAttribute('role','status');head.append(title,summary);panel.append(head);
  if(progress.elapsed!==null)panel.append(node('p',`文本分析${progress.textFinished?'用时':'已用时'} ${progress.elapsed} 秒`,'small progress-time'));
  const labels={complete:'已完成',running:'进行中',waiting:'等待中',action:'需要老师操作',failed:'已停止',skipped:'本次跳过',unavailable:'本次未评估',blocked:'暂未生成'};
  const list=node('ol','','progress-steps');list.setAttribute('aria-label','报告分析阶段');
  for(const step of progress.steps){
    const item=node('li','','progress-step');item.dataset.progressStep=step.id;item.dataset.state=step.state;
    const dot=node('span',step.state==='complete'?'✓':step.state==='failed'?'!':'','progress-dot');dot.setAttribute('aria-hidden','true');
    const body=node('div','','progress-step-body'),heading=node('div','','progress-step-heading');heading.append(node('h4',step.label),node('span',labels[step.state],'progress-state'));body.append(heading,node('p',step.detail));item.append(dot,body);list.append(item);
  }
  panel.append(list,node('p',progress.live?'进度会自动更新；可以离开页面，稍后从历史报告继续查看。':'以上为实际处理状态；未评估的内容不会被当作已完成分析。','small progress-note'));
  if(submission.report_state==='complete'&&progress.steps.at(-1).state==='complete'){const details=node('details','','report-progress-archive');details.append(node('summary','查看报告生成过程'),panel);root.append(details);}else root.append(panel);
}
