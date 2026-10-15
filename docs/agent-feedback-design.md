# Agent reasoning 与 learner feedback

2026-10-14，基于 826f2b8 的 Agent 优先迭代。本轮完善规划判断的来源边界、实际提示范围输入及独立语义审阅，不扩展业务／主题或启用 controlled。更强 LLM 继续使用现有 PlannerPort 与 transport。

## 运行闭环

每个有效 final 先按当前目标与可信 evidence_rule 提取有限表达尝试，并单独产生 learner_feedback。当前规则只支持直接第一人称运动喜好／时间句；教师转述、引语、困难、自述会了、疑问、否定和明确自我更正不能冒充尝试。库外改述与单词返回 unassessed_input，不能理解为不会。这个步骤不是通用语义 Judge，semantic_review 保持 unverified。

feedback 绑定 source_event_id、原 goal_id、plan_revision 和 observation_ref。模型看到当前 signal、当前目标的 observed_attempts、实际前文及提示输出范围。goal_assessment 的 attempted 必须引用该目标真实 observation_id 或其 source_event_id，后端历史、目标／KP id 和普通输入本身不够。错误提案在原截止时间内修复一次，仍失败则明确规则降级，不替模型伪造正确事实。

当前两个契约共用 prompt-v6／Agent reasoning-v1，teaching-v8／context-v4：学生当前选择优先；根据学习证据选择目标，兴趣只用于内容；困难和实际尝试分开；有尝试后减少重复完整示范，主动求助仍可支持；每轮一个主要问题／任务，未知保持未知。学生可见内容与 reply directive 禁止内部来源 ID；两个同语言显式问题会被拒绝，合理双语同问保留。计数只能识别表面问号，不能证明任意指令只有一个语义任务。

## 提示与实际执行

提示范围从已实际转发的 reply ledger 读取，不能来自接受计划或 planned support。只考察最近的不同 turn 回复，避免把当前自主回复或跳过取消回复后的更早示范当作提示；外会话与终止后的迟到文本不进入账本。

matching_model_forwarded 仅说明实际转发的最近回复含同样表达。取消标为 cancelled_output，其他情况保留 unknown。输出完成与 client_reported_complete 都不证明示范先于学生实际说话；ASR final 可能迟到，因此 preceded_student_speech 永远 unknown。学习记录仍 state:attempted、support:unknown、execution_ref:null，不宣称学生听到、独立、迁移、发音或掌握。完整提示因果与播放证据未来单独建设。

feedback 留在服务端 transient state，不含原始文字，不出现在浏览器诊断或业务写回。已有学习记录 v2、原目标／版本与总结边界保留；旧观察不因后续目标改变被重标。success assessment 仍 unverified，missing 不能由 Planner 或辅助审阅清空。

## 独立评测与辅助语义审阅

新增 20 个独立作者案例，包含角色／句式对照和真实输出范围的 synthetic 事件。执行器使用正常准备、TeachingSession、PlanningState、观察与记录入口；期望只在执行之后检查，不进入 Planner 或 provider。原 12 案／18 轮和旧十维评测不修改。

八项独立 rubric：goal_fidelity、current_intent、action_focus、learner_claims、support_adaptation、workload、natural_surface、uncertainty。PlanningSemanticReviewer 仅供离线／显式模型评测，独立于运行决策与写回。评估对象是已接受业务提案及实际此前上下文，不是尚未生成的语音。transport 可替换，rubric 不依赖 M3；结果每项必须给 pass／fail／unknown／not_applicable、有限原因码及可用来源块，重复／遗漏维度或捏造引用拒绝。

当前显式 --semantic-review 使用已配置 M3 做 auxiliary model review，不等于独立校准 Judge。人工校准与 semantic_quality_accepted 始终 false，即使所有模型评分通过。审阅不进入生产音频链，不增加运行 10 秒／5 秒预算；评测审阅每案单次、独立 12 秒截止，超时和未审阅保留完整分母。

## 运行

- npm run eval:agent：20 案纯离线规则／边界检查，不调用模型或豆包。
- npm run eval:agent -- --live --case=difficulty-report,teacher-full-forwarded,teacher-reported：限定案例真实 M3 规划；每案初始化＋当轮，至多一次有界修复。
- 上述 --live 再加 --semantic-review：每个已接受提案最多新增一次 12 秒辅助审阅，规则／LLM 提案分开报告；无真人材料、豆包或 Judge 外部配置的隐式调用。

输出仅版本、来源哈希、有限状态／错误码、各项判定与 HTTP／usage 元数据，不保存原始响应、思维链或真实逐字稿。真实模型、synthetic peer 与浏览器音频分别报告。

当前 review:planning 要求原始 snapshot-v2：与冻结作者输入／eval session、原始计划／epoch／版本和 hash 对应；旧不完整输入拒绝，不根据评测期望重构上下文。--preflight 只检查绑定。规则提案不进入此命令的 LLM 分母。结果见 [本轮验证](eval-results/2026-10-14-agent-feedback.md)。

后续 snapshot、shadow ObservationPort、降级与长会话已实现，当前版本以 [四项工程](agent-four-tasks.md) 为准；前文 prompt-v6／reasoning-v1 保留为 6b7e4cf 的历史。
