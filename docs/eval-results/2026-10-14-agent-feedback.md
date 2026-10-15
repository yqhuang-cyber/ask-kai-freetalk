# Agent 优先完善：reasoning 与 feedback 验证

2026-10-14，基于 main 的 826f2b8。完成本轮来源判断、实际提示输入、指令校验与辅助规划语义审阅。当前为独立 mock HSKai POC，仍使用 M3 和豆包 next_turn_advisory；这不是完整动态 Agent 或语义质量验收完成的声明。

## 运行变化

- 有限表达规则要求直接第一人称运动喜好／时间句；教师转述、引语、自述会了、困难、疑问、否定和明确自我更正不冒充尝试。未知改述、单词或库外表达返回 unassessed，不推断不会。
- learner_feedback 绑定原目标／计划版本／输入来源；困难单独作为 difficulty_report，实际尝试引用 observation_ref。下一轮 Planner 看当前反馈、当前目标的 observed_attempts 与实际前文。
- attempted assessment 必须引用该目标的真实 observation_id 或其 source_event_id；后端历史、目标／KP ID 和普通输入本身不能证明本会话的新尝试。暂停／停止后的旧观察不进入新目标判断。
- 只从实际转发账本提取最近不同话轮的匹配示范；取消／迟到／当前自主回复隔离。匹配转发、completed 和客户端完成报告都不证明先于学生实际说话，不能升级提示程度、独立、理解或掌握。
- 可见内容／回复任务中的已知内部来源 ID 拒绝，两个同语言显式问题拒绝，合理双语同问允许。问号表面检查不能验证所有隐含多任务或翻译等价。
- 两种 Planner 契约共用 Agent reasoning-v1、prompt-v6；full_contract_v3 仍为默认，Draft 仍 opt-in。自然教学升为 v8、Context policy 升为 v4，原始 v3 adapter 留作冻结评测。

写回仍 learning-record-v2、attempted-only、support:unknown、execution_ref:null；semantic review 与 prompt 因果缺口不自动清空。不将计划、辅助评分或后端 mock 独立表现变成本轮学习事实。完整设计见 [Agent feedback](../agent-feedback-design.md)。

## Synthetic 与浏览器

npm run verify：406／406 通过，无跳过／取消。新增负例验证困难／后端历史不能证明 attempted、跨目标来源隔离、外会话输出、ASR 候选更正、元数据泄漏、问题堆叠及语义审阅引用／取消／隐私边界。

npm run replay：normal／interruption／failure 三案通过，synthetic=true、provider_connected=false。

npm run eval:agent：20／20 通过，全部为明确规则规划、语义审阅 not_reviewed。案例独立编写，覆盖角色／句式、实际转发／部分／取消／客户端报告、同轮自主输出、暂停和 free 无目标。原 eval:goals 的 12 案／18 轮离线行为检查继续全部通过，数据未改。期望只在执行后检查，不进入模型输入。

Chromium 合成设备回归通过：持续采音、字幕、打断、准备／偏好、目标历史与总结检查通过，page_errors=0，无移动端横向溢出。没有真实供应商／麦克风／AEC／听感验证。

元数据：[20 案反馈](2026-10-14-agent-feedback-offline.json)、[原目标离线回归](2026-10-14-agent-feedback-goals-offline.json)、[浏览器](2026-10-14-agent-feedback-browser.json)。

## 真实 M3 规划与辅助语义审阅

输入只有固定作者合成资料，没有真人材料或豆包调用。保持原初始化 10 秒／逐轮 5 秒；格式修复至多一次，共享截止。各批分别记录源码／数据哈希，阶段差异不合并成最终全量语义验收。

| 批次 | 初始化 LLM／规则／失败 | 逐轮 LLM／规则 | 自动行为 | 辅助语义审阅 |
| --- | --- | --- | --- | --- |
| 三个 feedback 定向案例 | 3／0／0 | 0／3 | 3/3 | 3/3 返回；0/3 全维通过，含 1 项 current_intent fail 与多个 unknown |
| 原冻结 12 案／18 轮完整矩阵 | 8／4／0 | 3／15 | 初始 12/12；逐轮 18/18，LLM 3/3 | 另行审阅三个已接受 LLM 提案，见下文 |

定向案例全部逐轮超时降级；困难案例首次模型返回被 LOCAL_HELP_SCOPE_CONFLICT 拒绝，修复未赶上截止。辅助语义审阅只评价实际接受的规则提案，不把规则算为 M3 通过；teacher-reported 的泛化回应被判意图不贴合，仍需人工核对。

完整矩阵有 18 次超时降级、1 次最终校验降级，八个已完成拒绝尝试包括初始形状／原因／来源、逐轮契约、policy 及已拒绝初始目标。初始化接受更多，但逐轮仅 3/18；与上一轮 5/18 的单次样本相比不能宣称可靠性提升或统计回归结论。

三个已接受 LLM 提案为 switch 两轮与 declined 一轮：实际喜好尝试的 assessment 正确引用真实 observation_id，保留语义／不同情境缺口；另一个 switch 指令提出喜好与时间内容，是否偏离明确练习选择仍需审阅，不能由自动动作检查证明合格。

npm run review:planning 单独审阅这三个提案。仅接受与固定作者输入及 eval session 对应的本地业务计划，不保存原始响应。2/3 有效返回，1/3 因无效或不可用结果未评；一个全维 pass、一个含 unknown，未评项不补成通过。其输入缺少原整体计划、实际教师前文、learner feedback 与学习画像，因此明确 limited_context=true；没有凭重新构造上下文掩盖缺口。

八项 rubric 为 goal_fidelity、current_intent、action_focus、learner_claims、support_adaptation、workload、natural_surface、uncertainty。每项需有限判定与有效来源块；漏维度、重复项和捏造引用拒绝。当前 Judge 与 Planner 都是 M3，只是独立运行步骤的 auxiliary review，未人工校准；即使全维 pass，semantic_quality_accepted 仍 false。审阅最多一次、独立 12 秒截止，仅在显式评测调用，不进入生产或改变运行预算。

M3 各批、HTTP／usage 与审阅元数据见 [真实结果](2026-10-14-agent-feedback-m3.json)。只包含有限状态、错误码、大小、时长与引用块，无正文、思维链、真实逐字稿、音频或密钥。取消请求成本仍未知，旧十维数据／分数不变。

## 真实语音与后续

本轮没有新增豆包真实检查；上一轮 FC 的有限等待样本保持历史证据，controlled 未开启。新增提示范围对照全部来自 synthetic 事件，不能外推为真实播放或独立表达验证。

本轮完成 Agent 判断与反馈边界的工程迭代。下一步是通用语义观察器与教研／独立 Judge 校准，再用后续指定的更强 LLM 在相同数据与预算下比较目标、动作、支架及等待可靠性。运行未知、真实执行遵循、提示因果与学习达成继续分开验收。
