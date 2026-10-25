const copy=v=>v==null?null:structuredClone(v);
const text=(v,n=16000)=>typeof v==='string'?v.slice(0,n):null;
const reference=v=>({version:v.context_version??null,hash:v.context_hash??null});
const expectation=plan=>plan?{
  source:plan.proposal_id?'planner_turn':'planner_initial',proposal_id:plan.proposal_id??null,source_turn_id:plan.turn_id??null,
  action:plan.action??null,task:plan.reply_directive?.task??plan.conversation_purpose??null,
  speaking_difficulty:copy(plan.reply_directive?.speaking_difficulty??plan.strategy?.speaking_difficulty),
  speaking_constraints:copy(plan.speaking_constraints),support_level:plan.reply_directive?.support_level??plan.strategy?.support_level??null,
  expected_observation:copy(plan.expected_observation),example_response:null
}:null;

// An incremental summary, independent of the rolling raw-event display.
// Only the first five accepted student turns are retained. Plans are captured
// with their actual context version; a late plan never rewrites an expectation.
export class ObservationSummary {
  constructor({traceId,createdAt=new Date().toISOString(),turnLimit=5}={}) {
    this.traceId=traceId;this.createdAt=createdAt;this.turnLimit=turnLimit;this.turns=[];this.replies=new Map();this.providerReplyIds=new Map();this.contexts=new Map();this.plans=new Map();this.incidents=[];this.omittedTurns=0;this.omittedReplies=0;
    this.provider={kind:null,synthetic:null,model:null,log_id:null,log_id_source:null,session_id:null};
    this.state='active';this.code=null;this.initial=null;this.learner=null;
  }
  at(row){return new Date(Date.parse(this.createdAt)+row.at_ms).toISOString();}
  consume(row) {
    const d=row.data??{},stage=row.stage;
    if(stage==='preparation.ready')this.initial=expectation(d.plan);
    if(stage==='planning.triggered'&&!this.learner){const profile=d.input?.student_profile;this.learner={name:text(profile?.preferred_name??profile?.display_name??profile?.name,100),profile_level:d.input?.speaking_constraints?.profile_level??null};}
    if(stage==='voice.context.prepared'){this.sessionId=d.session_id;this.startedAt=this.at(row);this.provider.kind=d.provider_kind;this.provider.synthetic=d.synthetic;}
    if(stage==='voice.connection'){this.provider.log_id=d.log_id??null;this.provider.log_id_source=d.log_id?'websocket_upgrade.x-tt-logid':null;}
    if(stage==='voice.ready'&&d.provider_session_id)this.provider.session_id=d.provider_session_id;
    if(stage==='voice.provider.identity'){if(d.provider_session_id)this.provider.session_id=d.provider_session_id;if(d.response_id&&this.providerReplyIds.size<20)this.providerReplyIds.set(d.response_id,d.provider_response_id);}
    if(stage==='planning.committed') {
      if(this.plans.size<12||this.plans.has(d.turn_id))this.plans.set(d.turn_id,expectation(d.proposal));
      const turn=this.turns.find(t=>t.turn_id===d.turn_id);if(turn)turn.planner_proposal=expectation(d.proposal);
    }
    if(['voice.context.prepared','voice.context.requested'].includes(stage)&&this.contexts.size<32){
      const expected=copy(d.advisory_proposal_id?this.plans.get(d.advisory_turn_id):this.initial);
      if(expected&&d.speaking_constraints)expected.speaking_constraints=copy(d.speaking_constraints);
      this.contexts.set(d.context_version,{...reference(d),instructions:text(d.instructions),sent:false,confirmed:false,expected});
    }
    if(stage==='voice.request.sent'&&typeof d.body?.session?.instructions==='string') {
      this.provider.model=d.body.session.model??this.provider.model;
      const context=this.contexts.get(d.context_version);
      if(context&&context.hash===d.context_hash){context.sent=true;context.instructions=text(d.body.session.instructions);}
    }
    if(['voice.context.confirmed','voice.ready'].includes(stage)) {
      const context=this.contexts.get(d.context_version);if(context&&context.hash===d.context_hash)context.confirmed=true;
    }
    if(stage==='student.input.accepted') {
      if(this.turns.some(t=>t.turn_id===d.turn_id))return;
      if(this.turns.length>=this.turnLimit){this.omittedTurns++;return;}
      this.turns.push({number:this.turns.length+1,turn_id:d.turn_id,source_event_id:d.source_event_id,input:text(d.text,2000),at:this.at(row),planner_proposal:copy(this.plans.get(d.turn_id))});
    }
    if(stage==='voice.reply.started') {
      const tracked=this.turns.some(t=>t.turn_id===d.turn_id);
      if((this.turns.length>=this.turnLimit&&!tracked)||this.replies.size>=20){this.omittedReplies++;return;}
      const context=this.contexts.get(d.applied_context_version),matched=context?.hash===d.applied_context_hash;
      this.replies.set(d.response_id,{response_id:d.response_id,provider_response_id:d.provider_response_id??this.providerReplyIds.get(d.response_id)??null,turn_id:d.turn_id,started_at:this.at(row),
        instruction_ref:{version:d.applied_context_version??null,hash:d.applied_context_hash??null,snapshot_found:!!matched,confirmation_at_start:!!matched&&context.confirmed,pending_update_at_start:d.pending_context===true},
        expected:matched?copy(context.expected):null,actual_response:{text:'',state:'incomplete',complete:false,truncated:false},
        observed_effect:{generation_basis:'unknown',playback:'unknown',compliance:'not_evaluated'},review:{expected_response:null,expected_effect:null,notes:null}});
    }
    if(stage==='voice.reply.forwarded') {
      const reply=this.replies.get(d.response_id);if(reply){reply.actual_response={text:text(d.text)??'',state:d.status,complete:d.status==='response.done',truncated:d.truncated===true};reply.ended_at=this.at(row);}
    }
    if(stage==='voice.playback.report') {
      const reply=this.replies.get(d.response_id);if(reply)reply.observed_effect.playback=d.state;
    }
    if(stage.startsWith('voice.cancel.')||stage==='voice.event.dropped') {
      this.incidents.push({stage,at:this.at(row),...copy(d)});this.incidents=this.incidents.slice(-20);
    }
    if(stage==='session.ended'){this.state=d.state;this.code=d.code??null;this.endedAt=this.at(row);}
  }
  snapshot() {
    const turns=this.turns.map(turn=>({...copy(turn),responses:[...this.replies.values()].filter(r=>r.turn_id===turn.turn_id).map(copy)}));
    const unassigned=[...this.replies.values()].filter(r=>!this.turns.some(t=>t.turn_id===r.turn_id)).slice(0,2).map(copy);
    const refs=new Set([...turns.flatMap(t=>t.responses),...unassigned].map(r=>r.instruction_ref.version));
    return {schema_version:'conversation-observation-v1',id:this.sessionId??null,trace_id:this.traceId,created_at:this.createdAt,started_at:this.startedAt??null,ended_at:this.endedAt??null,
      state:this.state,error_code:this.code,learner:copy(this.learner),provider:copy(this.provider),turn_limit:this.turnLimit,turns,unassigned_responses:unassigned,
      instruction_versions:[...this.contexts.values()].filter(c=>refs.has(c.version)).map(copy),incidents:copy(this.incidents),
      coverage:{omitted_turns:this.omittedTurns,omitted_responses:this.omittedReplies,unassigned_are_not_verified_openings:true,contains_audio:false,raw_provider_packets:false,semantic_effect_evaluated:false}};
  }
}

export function observationMarkdown(report) {
  const block=value=>{const body=typeof value==='string'?value:JSON.stringify(value,null,2);const fence='`'.repeat(Math.max(3,...[...body.matchAll(/`+/g)].map(m=>m[0].length+1)));return `${fence}\n${body}\n${fence}`;};
  const present=v=>v==null||v===''?'未记录':String(v);
  const responseLines=reply=>[
    `### 回复 ${reply.response_id}`,`豆包 response ID：${present(reply.provider_response_id)}`,
    `对应配置：v${present(reply.instruction_ref.version)}；${present(reply.instruction_ref.hash)}`,
    '实际 response：',block(reply.actual_response.text||'未收到文字'),
    `回复状态：${reply.actual_response.complete?'文字输出完成':'未完整结束'}${reply.actual_response.truncated?'；文字已截断':''}`,
    '预期回应要求（来自当时配置中的 Planner 计划，不是另造的标准答案）：',block(reply.expected??'没有可关联的计划'),
    '人工补充的预期 response：',block(reply.review.expected_response??'未填写；以上方 Planner 要求为参考'),
    '预期效果：',block(reply.review.expected_effect??{speaking_difficulty:reply.expected?.speaking_difficulty??null,expected_observation:reply.expected?.expected_observation??null}),
    `实际效果：生成依据未知；播放状态 ${reply.observed_effect.playback}；语义和词汇难度尚未自动评估。`,
    '观察备注：',block(reply.review.notes??'未填写')
  ];
  const lines=['# Ask Kai 会话观测总结',`会话：${report.id}`,`开始：${present(report.started_at)}；结束：${present(report.ended_at)}`,`结果：${report.state}；错误：${present(report.error_code)}`,
    `豆包 Log ID：${present(report.provider.log_id)}${report.provider.log_id?'':'（未取得供应商返回值，不能用本地 ID 代替）'}`,
    `豆包 session ID：${present(report.provider.session_id)}；模型：${present(report.provider.model)}`,`合成连接：${report.provider.synthetic===true?'是':report.provider.synthetic===false?'否':'未知'}`,
    `记录范围：本场前 ${report.turn_limit} 轮已接受的学生表达，共 ${report.turns.length} 轮；后续省略 ${report.coverage.omitted_turns} 轮。`,
    '配置确认及回复开始时的配置关联，不证明模型生成时使用了该配置；Planner 对相同输入的后续提案单独列出，不追溯作为本轮执行要求。'];
  for(const turn of report.turns){lines.push(`## 第 ${turn.number} 轮`,'学生输入（识别文本）：',block(turn.input));for(const reply of turn.responses)lines.push(...responseLines(reply));if(!turn.responses.length)lines.push('未记录到这轮的回复。');if(turn.planner_proposal)lines.push('对该输入产生的 Planner 提案（是否用于本轮生成未确认）：',block(turn.planner_proposal));}
  if(report.unassigned_responses.length){lines.push('## 尚未关联到已接受学生表达的回复');for(const reply of report.unassigned_responses)lines.push(...responseLines(reply));}
  lines.push('## instructions 配置快照（逐项标注是否实际发送）');for(const c of report.instruction_versions)lines.push(`### 配置 v${c.version}`,`哈希：${c.hash}；已发送：${c.sent}；已确认：${c.confirmed}`,block(c.instructions??'未记录完整指令'));
  lines.push('## 打断与异常',block(report.incidents),'## 覆盖范围',block(report.coverage),'本文件含识别文本和回复文字，不含音频、密钥或原始供应商消息。');
  return lines.join('\n\n')+'\n';
}
