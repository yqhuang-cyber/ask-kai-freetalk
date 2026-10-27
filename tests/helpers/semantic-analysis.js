// Authored synthetic outputs; never a claim of real model connectivity.
export const semanticPlan={pack:{topic:'昆虫'},goals:[{label:'描述颜色和位置',task:'分享观察',criterion:'表达实际信息'}]};
export function semanticResponse(messages){
  const input=JSON.parse(messages.find(m=>m.role==='user').content),rows=input.window,student=rows.filter(s=>s.role==='learner'&&s.kind==='content').at(-1);
  if(!student)return {observations:[]};const kai=rows.filter(s=>s.role==='kai'&&s.kind==='content'&&s.sequence<student.sequence).at(-1),ref=s=>({source_id:s.source_id,start:s.start,end:s.end,quote:s.text});
  const observations=[{dimension:'oral_expression',observation:'这次表达补充了颜色和位置的信息。',explanation:'学生用自己的句子把观察对象和所在位置连在一起。',uncertainty:'识别可能有误，帮助和真实听到的内容未知。',suggestion:'下次描述另一只昆虫，再补充它正在做什么，例如“它停在叶子上”。',evidence_refs:[ref(student)]}];
  if(kai)observations.push({dimension:'context_understanding',observation:'学生对前一句问题作出了相关回应。',explanation:'问题与回答涉及同一个观察对象。',uncertainty:'可能参考了字幕或翻译，不能确定实际听到的内容。',suggestion:'换一个对象再问颜色和位置，观察回答能否提供对应信息。',evidence_refs:[ref(kai),ref(student)]});
  return {observations};
}
export function syntheticSemanticTransport(transform=value=>value){return {provider:'minimax',model:'MiniMax-M3',completeJSON:async({messages})=>transform(semanticResponse(messages),messages)};}
