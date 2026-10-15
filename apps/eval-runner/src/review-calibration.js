// Reviewer-only calibration. Never imported by the Agent or voice runtime.
export const REVIEW_CALIBRATION_VERSION='kai-recorded-review-v2';
export const FINDING_ATTRIBUTIONS=Object.freeze(['content_observation','input_alignment','rubric_constraint','missing_evidence','capability_scope','unresolved']);
export const REVIEW_CALIBRATION_INSTRUCTIONS=`评审校准 ${REVIEW_CALIBRATION_VERSION}：十维、权重和0/1/2不变。
ASR差异按截至本轮的学生文本和实际前文判语义，不以当前Kai回复反推学生意图。上下文明确的拼音请求中pinion/pinn等可为可恢复转写；缺失关键条件、跨轮残段或无法确认的实体分别保留meaning_changed/uncertain。端到端模型收到音频，ASR不是模型全部输入。
自然聊天不强制每轮问问题，不为迎合作者后续脚本指定追问方向。简短肯定、耐心等待或合理话题提议可为合格推进。若调整作者要求的解释，保存原要求和校准理由，不能静默替换原标注。
收到音频、实际播放、字幕显示顺序和学生听辨是不同证据。纯文本fixture的无声音假设不能直接作为真实语音能力失败。缺少客户端证据时相关项null，不填2或0。
短回顾的换行、词条、拼音和英文中的中文引用不自动算新的教学点或完整句子；一个新的教学点、多个独立任务、明显冗长和轻微格式/预算偏差分别判断。真实长度限制与当前语言要求仍保留，不以短或正确词义代替所有指令满足。
普通邀请不等于强迫；明确结束后继续邀请可违反收束要求，但不能因此自动触发强制练习关键失败。兴趣不等于所有权、尝试不等于掌握；泛泛谈论拥有某物与明确断言学生拥有某物须区分。
每项低分或null标明content_observation/input_alignment/rubric_constraint/missing_evidence/capability_scope/unresolved；分类是观察归属，不是已验证根因。总结来源诚实和学习内容覆盖分别报告。证据不足保持null，关键失败不由均分或分类抵消。`;

export function validateCalibratedTurn(unit,judgement,validateEvidence) {
  const asr=judgement.asr_review;
  if(!asr||typeof asr.reason!=='string'||!asr.reason.trim()||asr.reason.length>500||!Array.isArray(asr.evidence)||asr.evidence.some(e=>e.role!=='student'))throw new Error('ASR_REVIEW_EVIDENCE_REQUIRED');
  validateEvidence(asr.evidence,unit);
  const expected=[...Object.entries(judgement.scores).filter(([,v])=>v<2).map(([k])=>`dimension:${k}`),...judgement.criteria.filter(c=>c.score!==2).map(c=>`criterion:${c.id}`)].sort();
  const attribution=judgement.finding_attribution;
  if(!attribution||JSON.stringify(Object.keys(attribution).sort())!==JSON.stringify(expected)||Object.values(attribution).some(v=>!FINDING_ATTRIBUTIONS.includes(v)))throw new Error('FINDING_ATTRIBUTION_REQUIRED');
  // Missing evidence / fixture incompatibility cannot be reported as a numeric
  // content verdict. A numeric dimension score always describes the reply.
  for(const [key,value]of Object.entries(attribution))if(['missing_evidence','capability_scope','input_alignment'].includes(value)) {
    if(!key.startsWith('criterion:')||judgement.criteria.find(c=>`criterion:${c.id}`===key)?.score!==null)throw new Error('UNASSESSABLE_FINDING_REQUIRES_NULL');
  }
  for(const c of judgement.criteria)if(c.score===null&&attribution[`criterion:${c.id}`]==='content_observation')throw new Error('NULL_IS_NOT_CONTENT_FAILURE');
  const notes=judgement.calibration_notes??{};
  if(Object.entries(notes).some(([key,value])=>!judgement.criteria.some(c=>c.id===key)||typeof value!=='string'||!value.trim()||value.length>500))throw new Error('INVALID_CALIBRATION_NOTE');
}
