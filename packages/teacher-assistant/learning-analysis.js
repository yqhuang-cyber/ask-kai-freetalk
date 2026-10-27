import {ANALYSIS_VERSION,expressionFeatures,ORGANIZATION_RULES} from './report-observations.js';

export function analyzeLearning(evidence,eligible,plan){
  const facts=eligible?evidence.observations:[],pairs=eligible?(evidence.interactions??[]):[],help=eligible?evidence.help_requests:[];
  const features=expressionFeatures(facts);
  const organization=eligible?(evidence.organization_observations??[]):[];
  const clarifications=organization.filter(o=>o.feature_id==='clarification');
  const supportTurns=new Set([...help,...clarifications].map(o=>o.turn_id)).size;
  for(const id of Object.keys(ORGANIZATION_RULES)){
    const refs=organization.filter(o=>o.feature_id===id);
    if(refs.length)features.push({id,description:ORGANIZATION_RULES[id].description,evidence:refs});
  }
  const expressionTurns=new Set([...facts,...organization].map(f=>f.turn_id)).size;
  const steps=[];
  const has=id=>features.some(f=>f.id===id);
  if(!has('order_structure'))steps.push({id:'explore_order',basis:'practice_suggestion',reason:'现有证据未覆盖可分析的完整点单表达；不表示不会。',activity:'试着点一种自己想吃的食物，例如“我要一碗面条”。',success_criteria:'下次留下包含点单意图和食物名称的有效表达。',evidence:[]});
  else if(!has('quantity_phrase'))steps.push({id:'add_quantity',basis:'extension',reason:'已观察到点单表达，可以尝试补充份量信息。',activity:'在点单时加入数量和量词，例如“我要一份炒饭”。',success_criteria:'表达想吃的食物，同时说明份量。',evidence:features.find(f=>f.id==='order_structure').evidence});
  if(!has('taste_detail'))steps.push({id:'explore_taste',basis:'practice_suggestion',reason:'现有记录未覆盖可分析的口味要求；不作为薄弱点诊断。',activity:'练习补充一个真实口味要求，例如“不要辣”。',success_criteria:'在合适语境下说明口味偏好或限制。',evidence:[]});
  else if(!has('connected_information'))steps.push({id:'connect_order',basis:'extension',reason:'已观察到口味要求，可以尝试把点单信息组织在同一轮表达中。',activity:'试着连起来说：“我要一碗面条，不要辣。”',success_criteria:'同一轮表达包含食物和口味要求。',evidence:features.find(f=>f.id==='taste_detail').evidence});
  if(!steps.length)steps.push({id:'transfer_order',basis:'extension',reason:'同一轮已经表达食物和口味，可继续尝试新的沟通情境。',activity:'练习想吃的食物售罄时，询问并选择替代食物。',success_criteria:'在新情境中表达替代选择；下次另行观察，不预判已掌握。',evidence:features.find(f=>f.id==='connected_information').evidence});
  const dining=plan.pack.topic==='点餐'&&(plan.schema_version==='homework-v1'||plan.brief?.kind==='dining');
  if(!dining){steps.length=0;for(const goal of plan.goals.slice(0,2))steps.push({id:`explore_${goal.id}`,basis:'practice_suggestion',reason:'此目标的通用语义分析尚未准入，现有证据不用于判断不会。',activity:`围绕“${goal.label}”继续尝试：${goal.task??goal.label}`,success_criteria:goal.criterion??'下次留下与目标相关、可核对的表达证据。',evidence:[]});}
  return {
    version:ANALYSIS_VERSION,scope:`本次${plan.pack.topic}对话的有限文本观察`,
    listening:{status:pairs.length?'context_response_observed':'unassessed',summary:pairs.length?`观察到 ${pairs.length} 次回答与此前发出的点餐问题语义相符。`:'没有足够的可归属问答证据，暂不判断理解表现。',observations:pairs.map((p,i)=>({id:`response_${i+1}`,description:p.interpretation,example:p.answer.excerpt,evidence:[{...p.prompt,role:'kai_question'},{...p.answer,role:'student_answer'}]})),limitations:['这里只观察问题与回答的语义关系；事件到达顺序不证明学生先听后答。','实际播放、字幕、拼音、英文与此前示范的帮助无法确认，不作为纯听力或独立理解结论。']},
    speaking:{status:features.length?'observed':'unassessed',summary:features.length?`在 ${expressionTurns} 个不同轮次观察到可分析的表达组织。`:'当前规则未覆盖足够的表达，不能据此判断口语能力。',observations:features.map(f=>({...f,example:f.evidence[0].excerpt})),limitations:['观察限于识别文本中的信息与句式组织，未知改述不判错误。','词汇广度、通用语法准确度、发音与流利度尚未评估；不能推断整体口语等级。']},
    support:{status:supportTurns?'help_observed':'unknown',summary:supportTurns?`记录到 ${supportTurns} 个不同轮次的明确求助或澄清请求；求助是沟通策略，不直接代表能力不足。`:'现有证据无法判断是否需要帮助，也不能据此认定独立完成。',observations:[...(help.length?[{id:'help_request',description:'学生主动请求表达帮助或示范。',evidence:help}]:[]),...(clarifications.length?[{id:'clarification_request',description:'学生明确请求重复或澄清，以维持交流。',example:clarifications[0].excerpt,evidence:clarifications}]:[])],limitations:['提示是否实际听到、提示与表达的因果关系及独立完成程度均未知。']},
    audio:{status:'unassessed',summary:'发音、声调与语流尚未评估。',reason:'尚未接入通过验证的专项音频评测能力；本报告不采集或保存评测音频。',dimensions:['声母与韵母','声调','停顿与流畅程度']},
    next_steps:steps.slice(0,2),
    coverage:{accepted_turns:evidence.final_turns,expression_turns:expressionTurns,matched_responses:pairs.length,recognized_questions:eligible?(evidence.recognized_questions??null):0,truncated:evidence.truncated,legacy_evidence:evidence.analysis_version===undefined,complete_inventory:false}
  };
}

// Student data is explicitly projected; no source IDs, private drafts or grades.
export function projectAnalysis(analysis,teacher){
  if(!analysis)return undefined;
  const section=s=>({status:s.status,summary:s.summary,limitations:s.limitations,observations:s.observations.map(o=>({id:o.id,description:o.description,...(o.example?{example:o.example}:{}),...(teacher?{evidence:o.evidence}:{})}))});
  const c=analysis.coverage;
  return {version:analysis.version,scope:analysis.scope,listening:section(analysis.listening),speaking:section(analysis.speaking),support:section(analysis.support),audio:{status:analysis.audio.status,summary:analysis.audio.summary,reason:analysis.audio.reason,dimensions:[...analysis.audio.dimensions]},next_steps:analysis.next_steps.map(s=>({id:s.id,basis:s.basis,reason:s.reason,activity:s.activity,success_criteria:s.success_criteria,...(teacher?{evidence:s.evidence}:{})})),coverage:{accepted_turns:c.accepted_turns,expression_turns:c.expression_turns,matched_responses:c.matched_responses,recognized_questions:c.recognized_questions,truncated:c.truncated,legacy_evidence:c.legacy_evidence,complete_inventory:c.complete_inventory}};
}
