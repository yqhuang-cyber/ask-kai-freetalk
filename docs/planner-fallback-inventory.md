# Planner 降级点与替代规则清单

更新于 2026-10-15。依据当前工作区运行代码，自适应回复策略为 `kai-reply-v5`、Planner prompt 为 `kai-planner-v9`、fallback policy 为 `kai-planning-fallback-v3`。主题初始化现为 `kai-initial-teaching-v2`：准备成功必须有教学目标、知识点及表达任务；本文 I-T 已同步最新规则。评估和改进建议另列。

## 1. 降级替代的是什么

当前真正的规则回退主要发生在**会话初始化和会中逐轮规划**：规划 LLM 没有提供可接受的提案时，Agent Core（负责教学决策和会话状态的服务端模块）按预先编写的规则生成会话计划或下一步回应任务。

替代范围包括目标选择、支持方式、行动及回复任务，**不是把豆包的回复正文或音频换成规则生成的固定答案**。普通 Web 仍由豆包实时全双工生成回复，逐轮计划为 `next_turn_advisory`，在安全回复边界更新后续输入；不能根据规则提案已接受，就认定当轮实际语音执行了它。

Topic Pack 生成失败、资料读取失败、取消过期结果、正常语言策略和总结模板不能全部称为“LLM 降级”。下文分别说明。

<a id="triggers"></a>

## 2. 触发场景清单

表中的 I-T／I-M／I-F 对应第 3 节初始化规则，T 对应第 4 节逐轮规则。规则结果仍须通过 Validator、时效和归属检查；生成了规则候选，不保证最终接受。

| 编号 | 发生位置／场景 | 什么情况触发 | 是否请求／修复 LLM | 实际替代方式 | 当前记录 |
| --- | --- | --- | --- | --- | --- |
| F-01 | 三入口初始化或逐轮：规划器未配置 | `configuredPlanner()` 在 MiniMax key 未配置时返回 null；也包括调用方显式未注入 planner | 不请求 | 初始化按入口执行 I-T／I-M／I-F；逐轮执行 T | `planner_kind:rule`；`planner_unconfigured` |
| F-02 | Topic 初始化：缺少专用规划能力 | 注入的 planner 没有 `planTopicConversation` 方法，Initializer 将本次 planner 视为 null | 不请求通用方法替代 | I-T | 同样记录 `planner_unconfigured`，当前不能单靠原因码与 F-01 区分 |
| F-03 | 初始化或逐轮：服务／传输不可用 | 请求网络异常、非成功 HTTP 状态、无响应 body、供应商业务错误，或 body 读取异常等 | 已请求；`PLANNER_UNAVAILABLE` 不再修复重试 | 对应初始化规则或 T | 通常为 `planner_unavailable`；若前面已有格式／校验失败，最终可能归为 `planner_validation_failed` |
| F-04 | 初始化或逐轮：请求／输出不能解析 | 输入超出适配器上限、响应过大、响应结构不合法、未完整生成、内容不是合法 JSON；draft 协议还检查字段及枚举 | 剩余期限允许时最多再请求一次；不重置期限 | 两次均不可用或修复来不及时，执行对应规则 | 通常为 `planner_validation_failed`；耗尽期限则 `planner_timeout` |
| F-05 | 初始化或逐轮：提案不符合业务约束 | 引用／目标无效、先修不足、违反明确偏好／拒绝、越权改变目标、无依据评估尝试、字段或当前策略冲突等，详见第 2.1 节 | 剩余期限内最多修复一次；修复仍须完整验证 | 当前是整份提案回退，尚未实现保留其中合法部分 | `planner_validation_failed`，attempts 保存有限错误码与阶段 |
| F-06 | 初始化或逐轮：模型、修复或校验耗时超限 | 共用期限不足；返回或校验结束时已越过内部 deadline，即使 timeout 回调尚未执行也拒绝 | 中止本次工作；不接受迟到模型结果 | 在外层仍有提交时间时执行对应规则 | `planner_timeout`；若外层已取消／过期则不接受规则计划，见第 5 节 |
| F-07 | 逐轮：模型开始前已接近总期限 | 从 accepted final 起累计用时后，剩余时间不超过提交预留窗口 | 跳过模型请求 | T | `planner_timeout`，attempts 为空；整轮已经过期则直接丢弃 |
| F-08 | 主题会中：已发布资源复核失败 | 当前包被撤销、服务不可用、读取／校验异常、hash 不符或复核超时；代码以同一 catch 处理这些情况 | 本轮及该 PlanningState 后续输入跳过模型 | 停止并清空原目标／局部帮助，设 `resourceUnavailable`，再执行 T；资源恢复不会自动清除此标志 | **现状缺口：** `planner_kind:rule`，但 `degraded_reason:null`；目标变更 reason 为 `topic_unavailable` |
| N-01 | 正常控制：学生明确结束 | Agent Core 的即时控制规则判定 `policy.action:CLOSE` | 有意跳过模型 | T-01 告别；不新增练习 | `planner_kind:rule`、`degraded_reason:null`；**不属于故障降级** |

默认时限：初始化总期限 **15 秒**，包含资料／资源读取等准备过程，模型回退路径预留 **50ms**；逐轮总期限 **2 秒**，从服务端接受学习者最终识别结果（final）开始计时，包含等待、资源复核、请求、修复、校验及提交，默认预留 **200ms**。这些是规划期限，不是 Tutor 发言长度或首音承诺。初始化资料读取本身失败／外层超时，不会自动进入 F-06 的规则选目标路径。

修复成功且未超时的结果仍是 `planner_kind:llm`，不应算作规则降级；修复调用次数应独立统计。规则候选本身验证失败时，当前会让初始化失败，或让逐轮返回无新计划，不能假设仍有第二层规则兜底。

依据：[boundedProposal 与模型配置](../packages/agent-core/planner-port.js)、[MiniMax transport](../packages/provider-minimax/planner.js)、[Initializer](../packages/agent-core/conversation-initializer.js)、[PlanningState](../packages/agent-core/planning-state.js)。

### 2.1 哪些校验可能触发 F-05

以下均是校验失败后才尝试修复／回退，并非检测到关键词就立刻停止使用 LLM。

| 校验对象 | 当前拒绝的典型情况 |
| --- | --- |
| 初始化结构与偏好 | 缺字段、类型／枚举／长度不符；语言支持、纠错或语速与授权策略冲突 |
| 初始化目标与来源 | 目标／KP 不在资源中、目标与 KP 不匹配、先修无证据、选择已拒绝目标、引用不存在；Free 初始安排正式目标；旧 Mission／课程路径存在合法候选却无目标 |
| Topic 初始化教学决策 | 空目标 `TOPIC_GOAL_REQUIRED`、needs 引用不合法、无来源目标、缺表达任务、忽略已识别的明确选择、宣称掌握／发音等。已有稳定能力允许安排新情境应用，不应被描述成新发现的薄弱点；主要教学校验错误码已加入规划修复 allowlist |
| 逐轮结构与执行归属 | 行动／支持枚举无效、回复策略版本不符、引用错误、先前执行状态不一致、过期提案、内部标识泄漏或任务包含多个问题 |
| 逐轮教学与目标控制 | 与暂停／冷却／澄清限制冲突、未经学生选择恢复／替换／停止目标、已拒绝目标自动恢复、未结束却告别、正确表达被强制纠错、局部求助扩成正式任务、无实际观察却评 attempted |

依据：[Plan Validator](../packages/agent-core/plan-validator.js)、[Topic 初始化校验](../packages/agent-core/topic-initialization.js)、[目标生命周期](../packages/agent-core/goal-lifecycle.js)、[draft 编译](../packages/agent-core/planner-draft.js)。固定的提案字段长度限制约束的是规划数据，不是 Tutor 回复字数。

<a id="initial-rules"></a>

## 3. 初始化降级后如何选择会话目标

### I-T：已发布 Topic Pack 的主题式对话

候选只来自当前已发布且固定版本的包，规则不会临时生成新能力、目标或 Topic Pack。执行顺序如下。

| 步骤 | 输入与判断 | 当前输出／限制 |
| --- | --- | --- |
| 1. 识别当前选择 | 用有限的 `goalChoice` 匹配 `opening_request` 中的目标意愿；另用明确拒绝表达匹配只想聊天等 | 这是固定表达／标签匹配，不是通用语义理解 |
| 2. 生成 need 候选 | 遍历学习画像 `kp_states`；目标包里存在对应能力，且该能力未有稳定独立／迁移表现，才形成一般支持需要 | `review_candidates` 中项目优先级为 2，其他为 1；姓名／HSK 不参与排序 |
| 3. 特定能力映射 | `event-sequence` 已稳定、同时被列为待复习时，映射到 `narrative-organization`，包里须有该能力 | 当前是一个人工特例，不代表模型理解了全部近期困难 |
| 4. 过滤与排序目标 | 排除历史拒绝，逐项检查先修有独立／迁移证据；优先匹配 need | need 优先级降序、再按目标 ID 排序；未命中 need 时按先修数量、目标 ID 选合法目标。已有稳定能力安排新情境应用，否则安排探索性表达；不把缺证据解释成能力不足 |
| 5. 当前明确选择覆盖 | 能被第 1 步识别的明确目标请求优先；使用 explicit 先修校验，并允许本次明确选择覆盖历史拒绝 | 仍不跳过先修；请求目标不合格时准备失败，返回 `TOPIC_REQUESTED_GOAL_UNAVAILABLE`，不偷偷改练另一个目标 |
| 6. 当前拒绝覆盖 | 学生明确不练习／只想聊天 | 准备失败 `TOPIC_PRACTICE_DECLINED`，提示选择 free；不以无目标的 ready 状态启动主题会话 |
| 7. 填写支持与内容 | 有目标时取对应 need 的 support；明确选目标时为 unknown。内容先取当前请求，否则取同主题兴趣，否则取包内第一个 subtopic | 有目标时 task 使用该目标 `start_tip`，开场取包内 opening；语言、纠错和语速来自授权资料及入口设置 |
| 8. 没有合法目标 | 所有候选被拒绝或先修均不满足 | 准备失败 `TOPIC_NO_ELIGIBLE_GOAL`，提示更换主题或 free。主题成功结果固定一个目标，`no_goal_reason:null`，知识点与目标匹配，task 非空；不产生空目标 ready |

need 引用包括当前知识状态及最近最多两条相关学习历史；探索／新情境应用引用授权学习快照。近期记录主要提供来源和拒绝信息，规则**不深入解释自由文本中的困难**；兴趣决定内容，不证明能力。缺某项 coverage 并不是统一的“禁止选目标”开关，仍须满足先修与拒绝限制。这些规则选择不能计为模型自适应规划成功。

例：同一个运动包，学生兴趣是跑步，画像中频率表达未稳定且列为待复习，先修已验证，规则可能选频率目标并从跑步切入。这是规则适配，不能计为 LLM 教学决策成功。

依据：[assessNeeds／topicFallback](../packages/agent-core/topic-initialization.js)、[eligibleGoal／goalChoice](../packages/agent-core/goal-lifecycle.js)。

### I-M：Mission／旧课程资源

1. 只使用当前授权资源里的目标，排除历史拒绝及先修没有独立／迁移证据的目标。
2. 在过滤后的资源原顺序中，先选包含待复习 KP 的第一个目标。
3. 没有则选“并非所有 KP 都已有独立／迁移表现”的第一个目标。
4. 仍没有则选第一个合法目标，可能包含已经稳定的目标；并非统一的“已会就不教”。
5. Mission 无合法目标时可为空；旧资源用于主题入口时同样必须有目标，无合法候选则准备失败。支持取匹配 KP 状态，否则 unknown，语言／纠错／语速来自授权设置。候选列表、可选开场均为空。

同一层级按资源原顺序取第一个，是当前规则的局限。该路径没有 I-T 的完整 needs／无目标教学决策结构。

### I-F：Free

始终 `primary_goal_id:null`、`candidate_goal_ids:[]`、`key_points:[]`；目的为跟随学生自然交流，内容为“由学生选择话题”，可选开场为空。语言、纠错与语速仍使用授权资料／入口设置；由于无目标，目标 support 通常为 unknown。**Free 正常初始化本来就允许无目标，无目标本身不是降级证据。**

I-M／I-F 依据：[conservativeConversation](../packages/agent-core/conversation-initializer.js)。

<a id="turn-rules"></a>

## 4. 逐轮降级后的替代规则

进入 T 后，`fallbackDecision` **按下表顺序命中第一条就返回**，不对全部意图做综合评分。表中的条件来自 Agent Core 的控制规则、学习者反馈及有限文本匹配，不是规则理解任意自然表达。

| 编号／优先顺序 | 条件 | 规则给出的回复任务 | 行动／支持；reason |
| --- | --- | --- | --- |
| T-01 | Agent Core 已判定学生要结束 | 简短告别，不追加问题、复盘或练习 | CLOSE／none；`student_end_rule`。正常结束直接走此分支，不算故障降级 |
| T-02 | Agent Core 判定需要澄清 | 只问一个依据前文的必要澄清问题，不猜词义或能力 | CLARIFY／choice；`fallback_necessary_clarification` |
| T-03 | 连续至少两次明确困难，当前未暂停，存在未拒绝且先修满足的更简单目标 | 承认困难，给更小的低压入口；提议替换为当前目标先修对应的已有目标 | RESPOND／choice；`repeated_explicit_difficulty`。多个更简单目标按资源顺序取第一个 |
| T-04 | 困难自述反馈，或 difficulty_count > 0，但未命中 T-03 | 承认困难、减少当前负担，不要求重说完整句 | RESPOND／choice；`fallback_student_difficulty` |
| T-05 | Agent Core 将当前意图标记为拒绝或换题 | 接住当前选择、暂停旧练习，不要求理由或邀请重试 | RESPOND／none；`fallback_respect_current_choice` |
| T-06 | 当前是理解求助 | 只解释学生所问的一处含义，不追加新示范、跟读或新问题 | RESPOND／partial；`fallback_understanding_help` |
| T-07 | 当前是表达求助 | 帮助本轮一个表达，不扩成整场任务或恢复旧练习；填本轮 local_help_target | RESPOND／partial；`fallback_local_expression_help` |
| T-08 | 当前明确请求练习 | 已有 active 目标则给当前目标的低压入口；否则确认一个必要选择，不擅自恢复原目标 | RESPOND／choice；`fallback_requested_practice` 或 `fallback_unverified_practice_choice` |
| T-09 | 学生卡住但仍愿聊天，Agent Core 将其识别为需要帮助继续聊天（continuation help） | 复用实际前文给一个小话题入口或承接，不安排新练习 | RESPOND／choice；`fallback_continuation_help` |
| T-10 | 输入开头匹配“老师／他／她／Kai 说／告诉我” | 回应转述内容，不将其记作学生本人的喜好、能力或目标尝试 | RESPOND／none；`fallback_reported_content`，仅有限开头匹配 |
| T-11 | Agent Core 的学习者反馈为 supported_attempt | 回应具体内容，补充观察或自然追问，不重复完整示范或称独立／掌握 | FOLLOW_UP／none；`fallback_follow_observed_content` |
| T-12 | 当前教学保持暂停 | 跟随当前内容交流，可以补充／追问，不根据关键词恢复旧目标 | RESPOND／none；`fallback_paused_conversation` |
| T-13 | 以上均未命中 | 回应具体内容／问题／感受，相关补充或自然追问，不新增目标或强制练习 | 已有目标尝试数 > 0 时 FOLLOW_UP，否则 RESPOND；none；`conservative_planner_fallback` |

所有 T 规则由 `conservativeTurn` 包装：`new_points:0`、`goal_assessment:null`、逐轮提案的 `active_goal_id:null`，不宣称目标达成／独立／掌握；澄清的 clarity 为 ambiguous，其余 unknown。**逐轮提案不绑定 active_goal，不代表自动删除会话原目标**；会话目标继续由 controls 和有效 patch 管理。暂停时优先生成 pause patch，否则只有 T-03 可以提议替换目标。

支持值表示给模型的指令，不证明学生实际获得支持。执行侧继续遵守当前语言偏好和自适应回复长度策略，不因降级恢复 36 字／两句限制。规则并不生成学生必须回答的固定答案。

每轮会重新尝试可用的 planner，并无完整备用 LLM 链或自动熔断／恢复策略；F-08 的资源不可用标志是例外，会持续跳过本 PlanningState 的模型调用。T 的优先级会影响结果，例如困难分支先于局部求助；不能假设所有并存意图均被保留。

依据：[fallbackDecision](../packages/agent-core/fallback-policy.js)、[conservativeTurn／controls](../packages/agent-core/planning-state.js)、[自然教学策略](../packages/agent-core/natural-teaching.js)、[自适应回复](short-replies.md)。

<a id="non-fallback"></a>

## 5. 不应误算为规则替代模型的场景

| 场景 | 当前实际处理 | 是否规则代替 LLM 生成内容 |
| --- | --- | --- |
| Topic Pack 生成失败／内容审阅不通过／超时 | 管理任务 failed／cancelled；部分格式错误可在总期限内修复一次，不自动生成或发布规则包。已有仍有效的发布版本不被失败新任务替换 | 否；没有可用发布包时主题准备失败 |
| 显式开启 synthetic Topic Generator 或 replay | 工程测试／演示主动选择合成包或 provider，始终单独标记 | 否；不是生产失败后的自动切换 |
| 初始化三类资料／资源读取失败，或外层准备期限耗尽 | 准备失败／取消；不会凭空构造学习者资料或课程。资料合法返回 partial／unavailable 与接口直接失败不同 | 否；不能与 F-06 内部规划超时混算 |
| 模型／协议／adapter 配置不合法 | 未注册 provider／protocol、错误模型或 endpoint 等报错，启动／构造失败 | 否；与缺 key 返回 null 的 F-01 不同 |
| 新输入、打断、更正、权限变化、结束或提案过期 | 取消／丢弃过时工作，不让旧结果覆盖新状态；整轮已过期时不再接受迟到规则计划 | 否；属于归属与取消控制 |
| 目标选择、拒绝、换题、语言偏好及支架减少 | 这些即时规则本来就是 Agent Core 的会话控制逻辑，通常仍允许当前轮继续请求 Planner；正常结束例外见 N-01 | 否；学生觉得难后调整支持本身是教学适应 |
| ObservationPort 未启用、超时、无效或迟到 | 默认不调用；启用时也仅 shadow。失败只记录 timeout／rejected／cancelled／stale，不用规则伪造语义结论或学习事实 | 否；既有有限表达观察规则本来独立存在 |
| 总结显示“以交流为主／记录不足／不可用” | 当前结构化总结本来由来源规则生成，不是先请求总结 LLM，失败后才使用模板 | 否；零学习成果不是降级率 |
| 字幕仅有文本，或播放时钟使用备用来源 | 仅改变已收到文字的显示／计时方式，不补造回复或语音 | 否；属于呈现 fallback |
| 豆包连接、取消／上下文更新失败，或 controlled 尚未验证 | 明确报错／停止或拒绝建连，不自动替换成规则 Tutor 或 synthetic 语音 | 否；advisory 是当前默认路径，不应每轮算成降级 |

Topic 管理生成默认总期限 **60 秒**，与会话初始化 15 秒、逐轮 2 秒分开。后台成功生成的包仍需显式发布，才能供学习端读取。

依据：[Topic Manager](../apps/topic-manager/src/manager.js)、[生成器](../packages/topic-packs/generator.js)、[已发布包读取](../packages/topic-packs/port.js)、[学习者资料端口](../packages/hskai-bridge/learner-data-port.js)、[ObservationPort](../packages/agent-core/observation-port.js)、[TeachingSession](../packages/agent-core/teaching.js)、[Gateway](../apps/realtime-gateway/src/realtime.js)。

<a id="evaluation"></a>

## 6. 当前缺口与降级评估清单

以下是后续待办，**本文未修改运行行为或新增评测结果**。

| 优先项 | 需要核验／完善什么 | 应如何判断 |
| --- | --- | --- |
| E-01：分类与分母 | 区分正常控制、未配置、能力缺失、服务故障、格式／业务校验失败、超时、资源失效、取消／过期；补 F-08 未标 degraded 和 F-02 混用原因的问题 | 不以 `planner_kind:rule` 全部当降级，也不只用 `degraded_reason` 非空统计；分别报告初始化与逐轮的计划总数、LLM 接受、修复成功、规则接受、失败／取消／过期 |
| E-02：触发是否合理 | 对 F-01～08 做可控故障／边界注入；特别区分格式失败和越权／无来源决定，明确哪些必须拒绝，哪些可修复 | 检查总期限、修复次数、规则是否合法、迟到隔离；规则回退失败也必须留在分母 |
| E-03：初始化适配损失 | 固定同一资料和资源，对照 LLM 与 I-T／I-M／I-F；覆盖不同需要、相同优先级、资源顺序、明确选择／拒绝、资料不足和合理无目标 | 评估目标是否适合及来源是否充分，不能仅看目标名字不同；单列人工特例与排序影响。Free 无目标不自动扣分 |
| E-04：实际交流质量 | 覆盖 T-01～13、并存意图、分享感受、主动提问、局部求助、拒绝教学及不同支持需要 | 评实际 Tutor 回复是否接住内容、回答充分、自然继续及保留个性化；同时保存规划建议与执行关联，advisory 不冒充当轮遵循 |
| E-05：连续回退与恢复 | 覆盖单轮失败、连续多轮失败、模型恢复、新输入取代旧输入及资源恢复 | 核验目标／拒绝／话题连续性、重复澄清／示范和长期停留泛泛聊天；统计连续回退轮数。保留上一份仍有效计划、分项校验、备用模型／明确重试等均尚需设计，不写成已实现 |
| E-06：独立验证 | 工程故障注入、真实候选规划模型、真实豆包回复与浏览器音频分开报告 | 工程成功不等于教学自然度或自适应通过；规则合规不计为 LLM 规划成功。新模型确定后沿用同一案例／权限契约比较，不预先指定模型 |

已有工程保护可参考：[规划与超时](../tests/dynamic-planning.test.js)、[逐轮时限](../tests/turn-planning-budget.test.js)、[目标生命周期](../tests/goal-lifecycle.test.js)、[规则分支与长会话](../tests/agent-fallback-long.test.js)、[Topic 链路](../tests/topic-chain.test.js)、[Topic 生成失败](../tests/topic-manager.test.js)、[ObservationPort](../tests/observation-port.test.js)。其中三会话／44 轮属于合成工程序列，不证明真实 Tutor 的自然对话质量。

历史真实 M3 主题批次曾记录 8 组初始化与 8 组逐轮均使用规则回退，初始化当时约 10 秒期限；它不能作为当前 15 秒初始化／新版回复策略的重测结果，也不能外推当前 Free 全部降级。见[历史主题链路记录](topic-chain-implementation.md#当前结果与后续)。完整验收沿用[独立 Agent 评测计划](agent-evaluation-plan.md)，本清单补充其降级分类及对照范围。
