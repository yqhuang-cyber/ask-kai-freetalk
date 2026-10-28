const node=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text??'';if(cls)el.className=cls;return el;};
const previews=new Set();let previewEpoch=0;
export function clearAudioPreviews(){previewEpoch++;for(const {audio,url} of previews){audio.pause();audio.removeAttribute('src');URL.revokeObjectURL(url);}previews.clear();}
function wav(base64){
  const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),header=new ArrayBuffer(44),v=new DataView(header);
  const str=(offset,text)=>{for(let i=0;i<text.length;i++)v.setUint8(offset+i,text.charCodeAt(i));};
  str(0,'RIFF');v.setUint32(4,data.length+36,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,data.length,true);
  return new Blob([header,data],{type:'audio/wav'});
}
function preview(parent,{api,submissionId,segmentId,onError}){
  const button=node('button','回听这段录音','secondary');button.type='button';parent.append(button);
  button.onclick=async()=>{button.disabled=true;const epoch=previewEpoch;try{const result=await api('audio_preview',{submission_id:submissionId,segment_id:segmentId});if(!button.isConnected||epoch!==previewEpoch){button.disabled=false;return;}const audio=document.createElement('audio'),url=URL.createObjectURL(wav(result.pcm_base64));audio.controls=true;audio.preload='metadata';audio.src=url;audio.setAttribute('aria-label','本次练习录音片段');previews.add({audio,url});button.replaceWith(audio);}catch(error){if(button.isConnected){button.disabled=false;onError(error);}}};
}
const toneName=n=>({0:'标记 0',1:'第一声',2:'第二声',3:'第三声',4:'第四声',5:'轻声'}[n]??'未提供');
export function renderAudioAssessment(root,report,{api,submissionId,onError}){
  if(!report.clips)return;
  root.append(node('p',`已评测 ${report.assessed_segments} 段录音；另有 ${report.unassessed_segments} 段未评。以下只描述这些片段，结果需要听原音核对。`));
  if(report.dimensions.tone==='unavailable')root.append(node('p','本次没有可靠的声调评测结果；自然对话模式不会提供逐字声调诊断。','small'));
  if(report.dimensions.phones==='unavailable')root.append(node('p','本次未提供可用的音素测量，不推断声母或韵母问题。','small'));
  for(const [index,clip] of report.clips.entries()){
    const card=node('article','','audio-clip');card.dataset.audioSegment=clip.segment_id;
    card.append(node('h4',`录音 ${index+1} · ${(clip.duration_ms/1000).toFixed(1)} 秒`),node('p',clip.mode===1?'已核对短句评测 · 声学候选待核对':'自然对话评测 · 声学候选待核对','small'));
    if(clip.reference_text)card.append(node('p','核对参考：“'+clip.reference_text+'”'));
    preview(card,{api,submissionId,segmentId:clip.segment_id,onError});
    const tones=clip.words.filter(w=>w.tone&&w.tone.reference!==w.tone.hypothesis);
    if(tones.length){for(const word of tones.slice(0,4))card.append(node('p',`“${word.word}”：参考为${toneName(word.tone.reference)}，腾讯返回${toneName(word.tone.hypothesis)}，请先回听核对。`));card.append(node('p','核对后可以把这些词放回原短句，慢速说一次，再用自然速度说一次。','practice-step'));}
    else if(clip.words.some(w=>w.tone))card.append(node('p','有可核对的声调测量，本片段未返回参考与候选声调不一致的情况；不据此判断已经掌握。'));
    const words=clip.words.filter(w=>w.word&&w.accuracy!==null).slice().sort((a,b)=>a.accuracy-b.accuracy).slice(0,3);
    if(words.length)card.append(node('p','可优先回听：'+words.map(w=>'“'+w.word+'”').join('、')+'。这些是本片段中服务指标相对较低的词，不直接判为发音错误。','small'));
    const details=node('details'),summary=node('summary','查看腾讯原始指标');details.append(summary,node('p','以下是服务测量值，不是学生评分，也没有映射为等级。','small'));
    if(clip.accuracy!==null)details.append(node('p',`片段精准度指标：${clip.accuracy.toFixed(2)} / 100`));
    if(clip.fluency!==null)details.append(node('p',`片段流利度指标：${clip.fluency.toFixed(3)} / 1`));
    for(const word of clip.words){const line=node('div','','audio-word');line.append(node('p',word.word+(word.range_ms?` · ${(word.range_ms.start/1000).toFixed(2)}–${(word.range_ms.end/1000).toFixed(2)} 秒`:' · 无有效词级时间定位')));if(word.accuracy!==null)line.append(node('p',`精准度指标 ${word.accuracy.toFixed(2)}`,'small'));if(word.tone)line.append(node('p',`声调：参考${toneName(word.tone.reference)} / 候选${toneName(word.tone.hypothesis)}`,'small'));if(word.phones.length)line.append(node('p','音素测量：'+word.phones.map(p=>p.phone+(p.accuracy===null?'（无有效值）':` ${p.accuracy.toFixed(2)}`)).join('；'),'small'));details.append(line);}
    card.append(details);root.append(card);
  }
}
export function renderAudioReview(root,{api,submissionId,onSaved,onError,open=false,isCurrent=()=>true}){
  const panel=node('details','','audio-review'),summary=node('summary','教师核对录音来源与质量');panel.open=open;panel.append(summary,node('p','先回听，再逐项确认。无法确认的片段保持“不确定”，不会交给腾讯评测。人工核对不等于专业声学验收。','small'));
  const body=node('div'),status=node('p','','small'),save=node('button','保存核对并重新评测');save.type='button';save.hidden=true;
  const load=node('button','查看本次录音','secondary'),recover=node('button','核对保存状态','secondary');load.type=recover.type='button';recover.hidden=true;status.setAttribute('role','status');panel.append(load,body,status,save,recover);root.append(panel);
  let current,rows=[],saving=false,pendingSave=null,savedConfirmed=false,needsReload=false;
  const live=()=>panel.isConnected&&isCurrent();
  const controls=()=>{load.disabled=saving||!!pendingSave||savedConfirmed;save.disabled=saving||!!pendingSave||savedConfirmed||needsReload;recover.disabled=saving;for(const row of rows)for(const input of [row.speaker,...Object.values(row.quality),row.reference])input.disabled=saving||!!pendingSave||savedConfirmed;};
  const finishSaved=async()=>{
    pendingSave=null;savedConfirmed=true;recover.hidden=true;status.textContent='核对内容已保存，正在更新处理进度。';controls();
    try{await onSaved();}catch{/* A saved review must never be resubmitted when only its progress query failed. */}
    if(live()){status.textContent='核对内容已保存，暂未取得最新进度，可以稍后查询。';recover.textContent='刷新处理进度';recover.hidden=false;}
  };
  const checkSave=async()=>{
    const pending=pendingSave;if(!pending||!live())return;
    try{
      const result=await api('audio_review_manifest',{submission_id:submissionId,offset:pending.offset});if(!live())return;
      const sourceMatches=result.submission_id===submissionId&&result.manifest_hash===pending.request.manifest_hash;
      const pairs=pending.request.decisions.map(decision=>[decision,result.segments.find(segment=>segment.id===decision.segment_id)]);
      const saved=sourceMatches&&pairs.every(([decision,segment])=>segment?.source_metadata_hash===decision.source_metadata_hash&&segment.revision===decision.expected_revision+1&&segment.review?.speaker===decision.speaker&&segment.review.reference_text===decision.reference_text&&Object.entries(decision.quality).every(([key,value])=>segment.review.quality[key]===value));
      if(saved){await finishSaved();return;}
      const unchanged=sourceMatches&&pairs.every(([decision,segment])=>segment?.source_metadata_hash===decision.source_metadata_hash&&segment.revision===decision.expected_revision);
      pendingSave=null;recover.hidden=true;
      if(unchanged){status.textContent='本次核对尚未保存，填写内容已保留，可以检查后重试。';onError(pending.error);}
      else{needsReload=true;status.textContent='录音或核对记录已更新，请重新查看本次录音后再核对。';}
    }catch{if(live()){status.textContent='暂时无法确认核对是否保存。填写内容已保留，请先核对保存状态。';recover.textContent='核对保存状态';recover.hidden=false;}}
  };
  const select=(label,options,value,changed)=>{const wrapper=node('label',label),input=node('select');input.setAttribute('aria-label',label);for(const [key,text] of options){const option=node('option',text);option.value=key;input.append(option);}input.value=value;input.onchange=changed;wrapper.append(input);return {wrapper,input};};
  const read=async(offset=0)=>{if(!live()||saving||pendingSave||savedConfirmed)return;load.disabled=true;try{const result=await api('audio_review_manifest',{submission_id:submissionId,offset});if(!live())return;current=result;rows=[];needsReload=false;body.replaceChildren();
    if(!result.total_segments){status.textContent='本次没有保存可核对的录音。';save.hidden=true;return;}
    status.textContent=`本页 ${result.segments.length} 段，共 ${result.total_segments} 段。每轮后台最多评测 12 段，报告会注明实际覆盖。`;
    for(const [index,segment] of result.segments.entries()){
      const card=node('article','','audio-review-row'),row={segment,dirty:false,quality:{}};rows.push(row);card.dataset.reviewSegment=segment.id;card.append(node('h4',`片段 ${offset+index+1} · ${(segment.duration_ms/1000).toFixed(1)} 秒`));preview(card,{api,submissionId,segmentId:segment.id,onError});const changed=()=>{row.dirty=true;};
      const source=select('这是谁的声音？',[['unknown','暂不能确认'],['learner_verified','确认是本次学生'],['other','其他声音，排除']],segment.review?.speaker??'unknown',changed);row.speaker=source.input;card.append(source.wrapper);
      for(const [key,label] of [['noise','影响辨听的噪声'],['clipping','削波或失真'],['missing_frames','缺音或不连续'],['overlap','其他人声或 Kai 回声重叠']]){const quality=select(label,[['unknown','暂不确定'],['not_detected','未发现'],['detected','有，排除']],segment.review?.quality[key]??'unknown',changed);row.quality[key]=quality.input;card.append(quality.wrapper);}
      const label=node('label','已听音核对的准确短句（可选，最多 30 字）'),reference=document.createElement('input');reference.maxLength=60;reference.placeholder='仅在确认与原音一致时填写，不直接采用识别文本';reference.value=segment.review?.reference_text??'';reference.oninput=changed;row.reference=reference;label.append(reference);card.append(label);body.append(card);
    }
    if(offset>0||result.next_offset!==null){const nav=node('div','','actions');for(const [text,next] of [['上一页',offset-12],['下一页',result.next_offset]]){const button=node('button',text,'text');button.type='button';button.disabled=next===null||next<0;button.onclick=()=>{if(saving||pendingSave||savedConfirmed)return;if(rows.some(r=>r.dirty)){status.textContent='请先保存本页核对，再翻页。';return;}void read(next);};nav.append(button);}body.append(nav);}save.hidden=false;
  }catch(error){if(live()){status.textContent='本次录音当前不可读取，可能尚未记录、已撤回或已到期。';onError(error);}}finally{controls();}};
  load.onclick=()=>void read();
  recover.onclick=async()=>{if(saving||!live())return;saving=true;controls();try{if(savedConfirmed)await finishSaved();else await checkSave();}finally{saving=false;if(live())controls();}};
  save.onclick=async()=>{
    if(!live()||saving||pendingSave||savedConfirmed||needsReload)return;
    const decisions=rows.filter(r=>r.dirty).map(r=>({segment_id:r.segment.id,source_metadata_hash:r.segment.source_metadata_hash,expected_revision:r.segment.revision,speaker:r.speaker.value,quality:Object.fromEntries(Object.entries(r.quality).map(([key,value])=>[key,value.value])),reference_text:r.reference.value.trim()||null}));
    if(!decisions.length){status.textContent='请先回听并核对至少一段录音。';return;}
    const request={submission_id:submissionId,manifest_hash:current.manifest_hash,decisions};saving=true;status.textContent='正在保存核对内容…';controls();
    try{
      try{await api('audio_review',request);}catch(error){if(!live())return;pendingSave={request,offset:current.offset,error};status.textContent='正在核对保存结果…';await checkSave();return;}
      if(live())await finishSaved();
    }finally{saving=false;if(live())controls();}
  };
}
