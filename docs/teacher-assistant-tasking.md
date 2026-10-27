# 教师助教作业主题对话：实施计划与 tasking v0.2

日期：2026-10-26（Asia/Shanghai）。状态：**G0 通过，MD-01～MD-07 最小功能完成；MD-08 工程 / 真实豆包浏览器链路通过，真人走查待验。完整 TA backlog 仅完成这些最小子集。**

2026-10-26 更新：教师端 AI 前置备课的单学生子集已在隔离分支实现，覆盖 TA-04～TA-08 的必要部分；不是上述完整任务整体完成。见[当前实现 / 剩余范围](teacher-assistant-ai-planning-implementation.md)、[验收](eval-results/2026-10-26-teacher-ai-planning.md)。上述子集现已合并回主干，原 Demo 同时保留预置路径供真人走查。

输入：[PRD v0.2](prd/teacher-assigned-conversation-homework-prd-v0.2.md)、[User Journey](teacher-homework-user-journey.md)、[前置规划需求](teacher-homework-planning-design.md)、[技术方案](teacher-assistant-technical-design.md)。实际最小实现及命令见[实施说明](teacher-assistant-demo-implementation.md)，分层证据见[验收记录](eval-results/2026-10-26-teacher-assistant-demo.md)。其余完整 TA 模块仍为后续产物。

2026-10-27 优先级更新：最小 Demo 和 AI 备课单学生切片之后，优先推进[报告分析细化与首个切片](teacher-assistant-report-analysis-tasking.md)：RA-01～04、LST-01～03、SPK-01～02、AUD-01～02 映射 TA-12 / TA-15 及独立听说音频任务。当前仅有限证据 / 分析 / 双端呈现子集已实现，完整 TA-12 / TA-15 继续开放；自动等级不是这些反馈的前置条件。

2026-10-27 最新范围：深入报告的发音评测已按用户要求列为 **P0 / must-have**，见[DR-01～10 与 AUD-01～04](conversation-report-deep-analysis-tasking.md)。学生音频记录 / 对齐和专业发音验收属于整体完成门，不能仅完成文本报告后将发音排为后续可选；不回溯改变已验收最小 Demo 的历史范围。

## 1. 实施原则与阶段成果

用户已明确优先完成[最小 Demo 服务蓝图](teacher-homework-minimal-service-blueprint.md)，同时保持整体架构完整可扩展。新的执行顺序为 **G0 → G-Demo → 教师 / 学生 / Kai 分角色完善 → 完整质量与评级准入**。最小 Demo 的逐项依赖与完成条件见[MD-01～MD-08](teacher-assistant-minimal-demo-tasking.md)。

原 G1 的 AI 生成 / 四人分层不再作为 Demo 前置；原 G2 完成后也尚缺提交和双端反馈。因此从原 G1～G3 抽取必要部分组成一条纵向闭环，使用预置计划、实际对话 / 提交 / 事实反馈。PlanSource、controller、证据、提交和 ReportAnalyzer 采用可扩展的正式边界；生成器、复杂后台和评分能力后续逐步实现。

| 阶段 / Gate | 任务范围 | 可检查的阶段成果 | 放行条件 |
| --- | --- | --- | --- |
| G0 基线与最小架构契约 | TA-00、TA-01 的必要子集及点餐预置资源 / 反例 | FreeTalk 基线、actor / 版本 / 归属 / 提交 / 报告边界及新存储兼容性 | 无 teacher-as-learner、无 free 作业模式；不等待完整三主题目录 / holdout |
| G-Demo 最小完整闭环 | MD-01～MD-08 | 一位教师、一位学生、一份预置点餐计划、四页五步：发布 → 对话 → 提交 → 双端反馈 | 本地业务实际流转；真实语音 / 浏览器分层验收；无预写成功报告；FreeTalk 不变 |
| 教师端完善 | TA-04～TA-08、TA-16 等剩余部分 | AI 自动备课、多人 / 分层、编辑 / 批量发布、审阅 / 班级建议 | 不改 Demo 的计划 / 发布 / 报告语义；真实 AI 单独验收 |
| 学生端完善 | TA-13～TA-15、TA-17 等剩余部分 | 多作业、重练 / 历史、迟交 / 延期、反馈疑问和恢复 | 不破坏明确提交、本人授权和场景隔离 |
| Kai 完善与完整质量 | TA-05～TA-07、TA-10～TA-12、TA-15、TA-19、TA-21 等剩余部分 | 前置 / 逐轮规划、主题泛化、多目标、语义抽取及更可靠的反馈 | 工程 / 文本 / 语音 / 浏览器 / 教学分开通过；未知不提升成能力 |
| G-score 自动评级 | TA-20 | 目标语义 / 机会 / 支持归因经校准后，限定范围内教师专属暂评 | 独立能力证据与量表门槛满足；失败保持 grade=null，不称完整自动评级验收 |

G-Demo 是本轮首要交付，不是先做原 G1 / G2 的别名。其工程预览门 G-Demo-E 与真实可运行门 G-Demo-L 分开；只通过 synthetic 不称真实语音 Demo 完成。Demo 不做等级或完整教师审阅。原 G1～G4 保留为下面完整 TA backlog 的能力验收标号，不再表示必须按该顺序走完才有 Demo。

不预设未经验证的日历工期。Demo 前置风险是 FreeTalk 兼容、最小存储 / 授权和真实语音链路；通用语义、提示因果与 AI 生成可靠性不阻塞无评级的固定任务 Demo。其未知仍由完整 TA-10 / TA-19 / TA-20 处理，不能记为通过。每项实现按独立可审阅变更完成，共享 realtime seam 保持在独立文件 diff 中供审阅。

## 2. 当前执行清单与完整 backlog

### 2.1 G0 后优先执行的最小 Demo

| ID | 当前任务 | 最小依赖 |
| --- | --- | --- |
| MD-01 | 独立应用、本地身份 / 授课关系及必要持久化 | G0 |
| MD-02 | 预置计划、教师页面 A 与发布 | MD-01 |
| MD-03 | 共享 realtime 最小扩展与旧行为兼容 | G0 |
| MD-04 | 固定作业 Kai controller 与基本证据 | MD-01、MD-02、MD-03 |
| MD-05 | 学生页面 B / C、准备与真实语音 | MD-01～MD-04 |
| MD-06 | 结束、明确提交、查询与最小报告 job | MD-01、MD-04、MD-05 |
| MD-07 | 当场事实生成学生反馈与教师报告 D | MD-02、MD-04、MD-06 |
| MD-08 | 五步闭环、关键故障与 FreeTalk 隔离验收 | MD-01～MD-07 |

详细范围、架构不变量和 G-Demo-E / L 见[Demo tasking](teacher-assistant-minimal-demo-tasking.md)。只执行这些最小子集，不为一个 Demo 自动拉入下面父任务的全部依赖。MD 完成不代表对应 TA 已完成；剩余能力继续保留并追踪。

### 2.2 完整能力 backlog（保留原编号与验收条件）

所有任务当前状态均为“未开始”。下列依赖是逻辑依赖，不授权创建多个聊天、Agent 或工作区。

| ID | 完整任务 | 完整交付依赖 | 原能力验收标号 |
| --- | --- | --- | --- |
| TA-00 | 固定 FreeTalk 基线、隔离用例与新运行时预检 | 无 | G0 |
| TA-01 | 新领域契约、角色 / 授权、状态与错误模型 | TA-00 | G0 |
| TA-02 | SQLite repository、迁移与关键原子事务 | TA-00、TA-01 | G1 |
| TA-03 | 本地 Mock 作业授权服务与 HomeworkPort | TA-01、TA-02 | G1 |
| TA-04 | 持久后台任务、委托、取消和恢复 | TA-02、TA-03 | G1 |
| TA-05 | 能力 / 材料准入与独立评测输入 | TA-01 | G0 / G1 |
| TA-06 | TopicPack 生成 / 复用 / 版本与准入 | TA-04、TA-05 | G1 |
| TA-07 | 按学生前置 Planner 与计划校验 | TA-03、TA-05、TA-06 | G1 |
| TA-08 | 教师页面、草稿编辑、预览与发布 | TA-03、TA-04、TA-06、TA-07 | G1 |
| TA-09 | 共享 realtime 的最小注入点与兼容性 | TA-00、TA-01 | G2 前置 |
| TA-10 | 提示因果 / 输入输出归属的真实协议实验 | TA-00、TA-05、TA-09 | G2 前置 |
| TA-11 | 作业 controller、主题 / 多目标状态与编译 | TA-07、TA-09 | G2 |
| TA-12 | 全任务账本、异步最小证据抽取与封口 | TA-02、TA-03、TA-05、TA-09、TA-11 | G2 |
| TA-13 | 学生独立入口、准备 / 开聊与音频控件 | TA-03、TA-08、TA-09、TA-11、TA-12 | G2 |
| TA-14 | 提交 / 查询 / 重练 / 迟交及分析任务原子化 | TA-02、TA-03、TA-12、TA-13 | G3 |
| TA-15 | 目标分析、双端反馈投影及教师专属评价存储 | TA-04、TA-05、TA-12、TA-14 | G3 |
| TA-16 | 教师审阅、班级概览与后续教学建议 | TA-08、TA-15 | G3 |
| TA-17 | 撤回 / 权限失效 / 删除全链路收束 | TA-03、TA-04、TA-11～TA-15 | G3 |
| TA-18 | 合成 E2E、故障矩阵与 FreeTalk 无回归 | TA-08、TA-13～TA-17 | G3 |
| TA-19 | 真实模型、Doubao、浏览器与真人音频分层验证 | TA-10、TA-18 | G4 |
| TA-20 | 教学量表校准及自动等级能力准入 | TA-05、TA-10、TA-15、TA-19 | G-score |
| TA-21 | 三任务泛化、发布检查与交接 | TA-18、TA-19；声明自动评分时另需 TA-20 | G4 |

TA-10 未取得可靠支持归因不阻止 Demo 的保守描述反馈，但阻止自动评级。TA-17 的完整组合和治理后移，基本授权 epoch / 删除屏障、停止采音和迟到写入拒绝从 MD-01 / MD-04 / MD-06 就保留，不能为缩小 Demo 省掉这些不变量。

## 3. 逐项实施说明

### TA-00：基线、隔离与运行时预检

- **输入：**当前 HEAD 与工作区状态、既有测试 / 浏览器入口、用户确认的 FreeTalk 不变要求。
- **范围：**新增 `scripts/teacher-assistant/baseline.js`、隔离测试输入和 manifest。固定原启动、API / 页面模块、Free 初始 / 逐轮 prompt、无 resource 输入、目标 / 小结 / 调速 / 拼音行为及当前失败。
- **工作：**跑原 verify / replay 和相关浏览器基线；验证 Node 22.19 与当前 Node 的 SQLite 加载、事务、重启、进程锁和 WAL；只对新应用加载 SQLite。
- **完成条件：**基线有实际版本 / 结果；规范化只处理随机 ID / 时间，不能删除目标、策略、未知或失败字段来掩盖回归；新 SQLite 方案在最低版本有实证，若不支持先修订新应用存储方案，不抬高 FreeTalk 运行门槛。
- **报告：**`docs/eval-results/<实际日期>-teacher-assistant-baseline.md`，分开记录本机 / CI、已知失败和未覆盖。当前仅 Node24 可加载检查不是本项完成。

### TA-01：领域契约、状态与授权边界

- **范围：**`packages/teacher-assistant/contracts/`；不改旧 planning / learning-record schema。
- **工作：**定义 TeacherBrief、TopicPack、HomeworkPlan、Publication、Attempt、Ledger、Submission、Report、Review、actor / grant / epoch；固定 scenario、大小限制、引用及状态转移。
- **完成条件：**teacher 不需要假 learner_id；生成 / 发布、结束 / 提交、状态 / 等级分开；每个写操作的 CAS / 幂等规则明确；目标、版本、scope 注入均拒绝。
- **验证：**独立正反例覆盖伪 teacher、跨 learner、客户端目标 / prompt 注入、非法目标数、未准入材料、缺来源与 grade=null；对象不能接受模型填写 published / authorized / mastered。

### TA-02：持久化与事务

- **范围：**`apps/hskai-mock/src/teacher-assistant/{migrations,repository,store}.js`。
- **工作：**落实技术方案表组；实现单 writer、migration version、revision CAS、幂等结果、事务 outbox、活动尝试租约、auth / deletion epoch。
- **完成条件：**发布全体可见或全体不可见；提交与 current 指针 / report job 原子；重启恢复；重复与冲突可辨；DB 不含 token / 密钥 / raw trace。
- **验证：**在事务提交前 / 后模拟崩溃、两个发布 / 提交竞争、提交成功后响应丢失、旧 lease 提交、DB 被占用、坏 migration 及重复幂等键不同请求。
- **边界：**旧 ConversationStore 仍是原内存语义，不把作业改存旧接口，不宣称支持多实例。

### TA-03：本地业务授权服务与端口

- **范围：**`apps/hskai-mock/src/teacher-assistant/{backend,server,authorization,fixtures}.js`、`packages/hskai-bridge/homework-port.js`、新应用 bootstrap。
- **工作：**一位 Mock teacher、四位成年 learner、显式授课关系；新 actor 签名 / audience / scopes；内部服务委托；按权限读取三类最小资料；独立 cookie / Origin / Host。
- **完成条件：**教师只能访问授课范围，学生只能访问本人任务；teacher 不获代学生开麦；新旧 token / cookie / WS 票据不能互用；角色切换清楚标 Mock。
- **验证：**同 owner 无关系拒绝、撤关系后的历史 / 缓存访问、跨角色重放、篡改 learner、过期授权、CSRF / DNS rebinding、混版资料重读或失败。
- **边界：**不连接外部 HSKai，不把 Mock 授课 / 安全 ACK 写成真人身份或真人处理证明。

### TA-04：后台任务与恢复

- **范围：**`apps/teacher-assistant/src/worker.js`、业务 jobs / job_attempts / outbox 服务。
- **工作：**持久生成 / 个人规划 / 证据抽取 / 报告任务；原子 claim、阶段 deadline、并发 / token 限制、最多一次格式修复；输入依赖 hash 与授权委托复核。
- **完成条件：**刷新不重复生成；旧 brief / 名单 / epoch 的结果不覆盖新稿；部分失败按人显示；取消后忽略迟到成功；重启不自动重发未知收费请求。
- **验证：**忽略 AbortSignal 的模型、排队超时、body 卡住、修改 / 移出学生时任务返回、权限 / 删除时结果返回、重复 claim、lease 过期、外呼中进程终止。
- **输出：**元数据 job report；不默认落完整模型输入 / 输出或画像。根任务预算和各子阶段花费分别报告。

### TA-05：能力与材料准入、评测准备

- **范围：**`packages/teacher-assistant/{capability-catalog,material-admission,assessment-capabilities}.js`、`docs/eval-datasets/teacher-homework-v1/`。
- **工作：**有限的点餐、昆虫主题、指定句式 / 剧情能力定义；区分练习可用与评分可用；准备四种背景 × 三类任务的至少 12 个基础设计输入，以及边界 / 对照 / holdout。
- **完成条件：**AI 不能自建正式 KP / 先修 / 评估能力；生成例句、作者素材与教师私有材料来源和权限明确；“再也不”的未定含义不变成不可迁移业务类型。
- **验证：**输入 / oracle / 参考答案分开；参考目标不进被测模型；只改姓名 / 等级标签不得制造新能力需要，只改真实需要应有合理响应；同需要允许同目标。
- **注意：**12 个是最低设计覆盖，不是已有模型通过数，也不构成官方 HSK 教学标准。

### TA-06：主题资源包

- **范围：**`packages/teacher-assistant/topic-packs/`、原仓库受限 pack import adapter。
- **工作：**定义主题 → 缓存复用或后台生成 → 结构 / 内容检查 → 字段准入 → 不可变版本；缓存键包含材料作用范围和 policy。
- **完成条件：**生成输入 / 包存储无 learner 身份或记录；教师私有材料不能跨教师复用；旧 context / opening 包不冒充完整词卡 / 例句教材；学生读路径生成调用数为零。
- **验证：**两个主题同机制、缺资源、撤销、缓存命中但授权变化、生成失败 / 取消 / 重启、旧包适配字段、错误 source / hash、材料包含指令注入。
- **真实检查：**单独记录真实文本生成 / 辅助审阅的全部尝试和失败；合成包只证明管道。

### TA-07：按学生的前置 HomeworkPlanner

- **范围：**`packages/teacher-assistant/planning/{planner,input,validator,compiler}.js`、新 role transport 配置。
- **工作：**教师 brief + 准入包 + 三类一致资料 → 需要假设、1～3 核心 / 0～1 选做目标、表达任务、机会、材料 / 提示、难度、观察标准；宿主补编号 / 版本 / hash。
- **完成条件：**只给主题可以形成可预览的具体任务；目标与当堂方向相关且先修允许；缺资料不虚构薄弱点；无合适能力显示缺口，不默默改主题 / 回选第一目标。
- **验证：**四人共用包、同级不同需要、完全已知基础的新情境应用、未知 / 冲突 / 截断、指定句式不受支持、计划修改 / 取消晚到；逐项校验合法 refs 及语义复核。
- **边界：**未配置真实模型时草稿明确失败，或仅在显式 synthetic / teacher_authored 模式演示，不把规则兜底记成 AI 个性化成功。

### TA-08：教师起草、预览与发布

- **范围：**新应用 `/teacher` 页面与 teacher API，业务发布事务。
- **工作：**选学生、主题 / 截止 / 可选要求，前置任务进度、共同方向 / 个人差异预览、批量采用、有限结构编辑、发布 / 修改 / 延期。
- **完成条件：**教师不必逐人手写；一次发布绑定所有所选计划 / 包 / rubric；部分失败不静默漏发；修改仅重做相关依赖；发布后标准不追溯改历史。
- **验证：**双窗口编辑冲突、重复发布、名单变更、时区与日期歧义明确输入、重启后草稿 / publication 恢复、教师越权、重新发布时活动尝试仍用旧版本。
- **阶段成果 G1：**可从教师主题走到四份已发布任务；此时尚不宣称真实语音或报告闭环通过。

### TA-09：共享 realtime 注入点与旧行为兼容

- **范围：**现有 `apps/realtime-gateway/src/realtime.js`、新 controller / lifecycle 接口适配及专项测试。
- **工作：**按技术方案注入 conversationFactory、path / protocol、sessionLifecycle、authorizeSession、observeTransport；整理全部 teaching / planning / recap / speech 调用面。
- **完成条件：**旧配置完全走原 TeachingSession 及原持久化分支；新应用使用新 controller 和作业生命周期；不放宽旧 mode / event 校验，不复制整份 realtime.js，不改变事件门与时序。
- **验证：**默认 / 显式旧 factory 同输入差分、最小自定义 controller、跨实例票据、错误协议 / path、旧回复迟到、cancel / context ACK、收尾 / 调速 / 拼音 / Slides 受影响回归。
- **提交门：**独立 commit + 原 verify / replay / 浏览器检查；未通过不接正式新场景。

### TA-10：支持因果与协议可证明范围

- **范围：**`scripts/teacher-assistant/support-attribution-probe.js`、作者合成用例、去敏能力结论。
- **工作：**真实适配器与浏览器分别记录学生音频 / 转写归属、响应 / 播放声明、示范与学生说话重叠、final 晚到、取消和静音，确定可验证的来源与时间范围。
- **完成条件：**明确哪些字段能支撑提示归因、哪些只能 unknown；没有可靠证据时 capability 关闭。不能用宿主收到 final 的先后推断学生听到提示，也不能杜撰供应商 wire event。
- **验证：**学生先说完但 final 晚到、完整示范被打断、局部提示后输出、muted / text-only、语音仍在排队、跨回复 / turn 混入、重连旧回执。
- **报告：**实际配置 / 版本、所有尝试与失败、CLI / 浏览器来源分开。无新 ASR / TTS 依赖；controlled 不因此启用。

### TA-11：作业 controller 与逐轮状态

- **范围：**`packages/teacher-assistant/realtime/{controller,planning-state,context-compiler,validator}.js`。
- **工作：**实现 TA-09 兼容面；固定 publication / plan / pack，主题范围、核心目标集合和 active_goal 分离；调用新 turn planner，复用语言 / 调速 / 拼音基础规则。
- **完成条件：**单轮一项主要任务，发布核心标准不可改；暂停练习保留主题，拒绝后不自动激活；允许结束；上下文 / 页面引用同 plan hash；无老师等级进入语音。
- **验证：**同主题选题 / 相关联想 / 换题、目标次序、求助和困难、未知支持、过期提案、2 秒预算含排队 / 修复 / 校验、材料不可用、同源 task card / instructions。
- **边界：**默认 next_turn_advisory，不能把 context ACK 写成实际当轮按计划生成。

### TA-12：账本、证据窗口与封口

- **2026-10-27 优先子计划：**[完整文本记录与模型分析 DR-01～DR-10](conversation-report-deep-analysis-tasking.md)；该计划尚未实施。

- **范围：**`packages/teacher-assistant/evidence/`、业务 ledger / evidence tables、后台 extractor。
- **工作：**在实际接受 / 安全 / 输出门边界记账；全任务事件覆盖与语义覆盖分开；异步抽取最小必要上下文与候选；有界缓存 / 持久化、末尾 flush 和 end_fence。
- **完成条件：**第六轮以后目标有来源；新旧目标 / 会话 / generation 不串；控制语音不记成果；取消 / 未完整 / 过期输出不能变成示范事实；最终快照可追溯并标缺口。
- **验证：**长会话上限、慢 / 失败 extractor、反例与自我更正、窗口截断、封口后迟到事件、进程重启丢失未抽取原文、写入队列 timeout、durable / semantic gap 及 unsafe 内容抑制。
- **留存：**不默认归档整场逐字稿 / 音频；不能通过“片段”名称把所有原文重新拼成默认档案。必要片段有范围、TTL、权限及删除路径。

### TA-13：学生独立入口与语音界面

- **范围：**新应用 `/homework` 页面、HomeworkPreparation / session API，复用既有音频与字幕组件。
- **工作：**本人待办 / 任务卡 / 材料、准备 / 取消、voice readiness、开始、求助、调速 / 拼音、结束 / 暂存及结果状态；不导入旧 web.js 的页面业务。
- **完成条件：**开始只消费发布计划；错资料 / 版本 / 权限不启动；真实就绪后才申请麦克风；新票据 / cookie 不影响 FreeTalk；退出立即停止本地采集 / 残余播放。
- **验证：**快速换人换任务、准备与开始竞态、同一 learner 双窗口、permission denied、voice 不可用、切后台 / 重连、旧字幕、移动布局；新服务关闭时旧首页和 FreeTalk 仍可用。
- **阶段成果 G2：**点餐任务可沿新入口练习并保留可核验覆盖；当前阶段不宣称已完成报告或真实教学质量验收。

### TA-14：明确提交、查询、重练与截止

- **范围：**submissions API / repository、客户端提交协调器、report outbox。
- **工作：**结束并提交意图 → 停采音 / 有界封口 → 原子 submission / current pointer / report job；pending 查询、幂等重试、历史 / 再练和迟交策略。
- **完成条件：**只有 submitted 回执确认后显示成功；关页 / 告别 / 断线不自动提交；报告失败不撤提交；新练未提交不清旧结果；按最新明确提交而非最高等级选择。
- **验证：**提交时断网、DB commit 后响应丢失、重复 / 冲突 key、双窗口抢交、撤回后提交、末尾 flush timeout、旧报告晚到、截止时仍在对话、延期重算、客户端时钟偏差。
- **首版选择：**重连另开新 attempt，保留旧 partial；不做跨 provider session 的隐式证据合并。

### TA-15：分析与双端反馈

- **2026-10-27 优先子计划：**[完整文本记录与模型分析 DR-01～DR-10](conversation-report-deep-analysis-tasking.md)；模型候选与来源校验均需单独验收。

- **范围：**`packages/teacher-assistant/reports/{analyzer,validator,student-projector,teacher-projector,grade-policy}.js`、reports / feedback / assessments tables。
- **工作：**固定计划 + 证据 manifest → 目标机会 / 表现 / 支持及未知 → 来源校验 → 学生事实反馈 / 具体建议与教师专属评估；异步可重试。
- **完成条件：**学生生成输入不含等级，接口采用白名单 DTO，教师字段独立存储；关键能力未通过时 grade=null；无可靠错误不制造薄弱点，不能凭转写做发音诊断。
- **验证：**伪造来源、错目标 / learner、引用引语 / 否定 / Kai 自己说过的词、未知合理变体、残缺覆盖、队列失败 / 重启恢复、旧提交分析、学生页面 / API / 错误 / 导出 / 收尾语中的等级泄漏。
- **边界：**此项完成代表评级规则和禁用门实现，不代表自动评级质量通过；真实启用依赖 TA-20。

### TA-16：教师审阅与教学行动

- **范围：**教师个人报告 / 班级详情、reviews / questions API、聚合和建议。
- **工作：**目标证据卡、暂评 / unknown、Kai 机会覆盖与执行缺口、内部备注 / 公开评语、修订理由、学生疑问；按可比目标汇总并给出下一步练习建议。
- **完成条件：**review append-only，后台重算不覆盖教师版本；学生只读公开事实 / 评语；班级保留有效分母，不按不同分层任务排名；建议可用于下一节课。
- **验证：**并发 review 冲突、旧报告重新分析、教师关系撤销、公开评语含显式分数 / 等级、只有一人有有效机会、Kai 从未引出目标、部分报告 unavailable。
- **P1 子项：**按 TH-16 生成后续作业草稿与模板复用；无论何时交付都不得自动发布。不阻塞首版报告 / 教学建议的 P0 验收。

### TA-17：撤回、权限和删除收束

- **范围：**失效通知 / 短租约、新应用会话与 Worker 协调、业务删除 / TTL 清理及派生缓存。
- **工作：**串起基础 epoch：撤回 / 删除立即阻止新操作，通知活动会话，取消 jobs，停止采音 / 播放，屏蔽并清理必要内容与派生报告。
- **完成条件：**响应区分已撤销写权限与客户端实际终止；通知掉线靠租约 fail-closed；删除后的晚到 job 不重建内容；旧 FreeTalk 任务 / 数据不误删、不因新服务故障中断。
- **验证：**写操作与撤回同一时刻、lease 续期 / channel 断线、授权到期、正在模型外呼时删除、缓存 / 导出 / 聚合残留、SQLite WAL / 临时文件恢复、TTL 后报告覆盖变更。
- **边界：**Mock 删除 / 安全回执不证明供应商删除或真人跟进；不在普通教师报告里展示敏感安全披露。

### TA-18：合成全链路与隔离矩阵

- **范围：**`tests/teacher-assistant/`、`scripts/teacher-assistant/{e2e,browser-check,free-isolation-check}.js`，新增独立 npm scripts。
- **工作：**教师起草 / 前置生成 / 发布 → 四人选择 / 对话 → 明确提交 → 分析 / 教师审阅；覆盖两份不同任务、重启、取消、删除及跨场景竞争。
- **完成条件：**新业务故障不影响旧 FreeTalk；旧初始 / 逐轮 / 小结无新服务调用或 prompt 变化；学生等级、跨 learner 数据、旧回复串入为零；每个 TH 硬要求有断言。
- **验证：**至少三种运行组合：仅 FreeTalk、新应用独立、两者同时运行；新服务 unavailable / 超时 / 非法包 / auth 失效；真实浏览器组件与 synthetic voice / planner 分开标。
- **报告：**包含全部分母、失败与未覆盖；不能把合成 payload 注入当作真实模型会生成同样计划。

### TA-19：真实文本、语音与浏览器

- **范围：**新场景正式端口 / Gateway / Adapter，独立 live scripts 与去敏报告。
- **工作：**先真实文本 pack / 私人 plan，再点餐正式新入口语音；补真实 report candidate 与浏览器控制竞争，最后真人麦克风 / 听感与反馈走查。
- **完成条件：**记录真实 AI 采用 / 规则 / 失败、生成与首音时延、主题 / 目标机会遵循、打断 / 调速 / 拼音 / 收尾；真人设备结果不能由 CLI PCM / 合成回执替代。
- **验证：**教师要求修改后新版本、学生求助 / 拒绝、目标在后半场、取消 / late plan、同账号配额竞争；每次只声明实际覆盖的链路。
- **材料：**优先作者编写的虚构场景 / 测试音频；不把真人学习者音频 / transcript 入 Git。真实配置仅本机，原 FreeTalk profile / 默认模型配置不改。

### TA-20：自动等级校准与能力准入

- **范围：**版本化评级 rubric / capability registry、独立标注与对比 runner、教师专属 feature gate。
- **工作：**教师或独立教学审阅先不看 AI 暂评标注机会、表现、帮助及等级；与实际分析比较；冻结门槛后用 holdout 复测，校准结果绑定模型 / prompt / catalog / rubric。
- **完成条件：**目标语义、机会与支持归因门槛均满足才启用适用范围；A 不因未看到提示就成立；D 满足 PRD 的充分有效尝试条件；unknown、拒绝、断线、任务不适配不会降为 D。
- **验证：**四背景、三任务、低 / 高支持、学生先说 final 晚到、所有核心目标未覆盖、同义变体、自我更正；记录错误低评、虚构独立、可评覆盖率及分歧。
- **放行：**无人工校准或可靠支持证据时保持 gate 关闭，真实 grade=null；实现教师手动评价不等于本任务完成。模型 / 量表重大变更使对应能力重新待验。

### TA-21：泛化、发布检查与交接

- **范围：**三任务运行配置、release checklist、README / implementation-plan / tasking 实际状态、独立启动与故障说明。
- **工作：**将点餐切片扩展到昆虫主题与一个句式 / 剧情任务；使用同一机制，不新增按四人姓名 / HSK 固定分支；完成冻结 holdout 与质量复查。
- **完成条件：**所有 P0 要求逐项有证据或明确未放行项；独立新入口可停用 / 回退；FreeTalk 继续原命令且无需新配置；学生反馈 / 教师报告边界可解释。
- **发布标签：**明确是 synthetic 流程演示、真实语音试用，还是已通过教学 / 自动评级门槛；若 G-score 未通过，不把描述反馈 / 人工评价试点称作完整自动助教评级。
- **交接：**每份报告列候选 commit / schema / prompt / profile、实际用例 / 分母、已知限制、下一步及回退方式，不提前写“全部通过”。

## 4. PRD 到任务的追踪

| PRD ID | 需求 | 主要任务 |
| --- | --- | --- |
| TH-01 | 教师身份与授课关系 | TA-01、TA-03、TA-17 |
| TH-02 | 教师定方向、AI 前置规划 | TA-05～TA-08 |
| TH-03 | 发布版本 | TA-02、TA-07、TA-08、TA-13 |
| TH-04 | 独立入口 / FreeTalk 不变 | TA-00、TA-09、TA-13、TA-18 |
| TH-05 | 固定任务会话 | TA-09、TA-11～TA-13 |
| TH-06 | 对话机会与实际支持 | TA-10～TA-12、TA-19 |
| TH-07 | 结束 / 明确提交 | TA-12～TA-14 |
| TH-08 | 异步报告 | TA-04、TA-12、TA-14、TA-15 |
| TH-09 | 学生等级隔离 | TA-01、TA-03、TA-11、TA-15、TA-16、TA-18 |
| TH-10 | 保守评级 | TA-05、TA-10、TA-15、TA-20 |
| TH-11 | 教师复核 | TA-02、TA-15、TA-16 |
| TH-12 | 班级概览 | TA-15、TA-16 |
| TH-13 | 重练与迟交 | TA-02、TA-13、TA-14 |
| TH-14 | 撤回 / 权限 / 删除 | TA-02～TA-04、TA-17、TA-18 |
| TH-15 | 三类任务 | TA-05～TA-07、TA-19、TA-21 |
| TH-16 | 模板 / 后续草稿（P1） | TA-16 的 P1 子项 |
| TH-17 | 共享包 / 私人计划 | TA-03、TA-05～TA-07 |
| TH-18 | 前置生成、学习端只读 | TA-04、TA-06～TA-08、TA-13、TA-18 |
| TH-19 | 生成任务一致性 | TA-01、TA-02、TA-04、TA-08 |
| TH-20 | 执行与报告同源 | TA-07、TA-11、TA-12、TA-15 |
| TH-21 | FreeTalk 依赖隔离 | TA-00、TA-03、TA-09、TA-13、TA-17～TA-19 |
| TH-22 | 新资源 / 评估准入 | TA-05、TA-06、TA-10、TA-20 |

## 5. User Journey 到切片的追踪

完整 Journey 的 AI 前置准备和多人流程为后续能力；当前 Demo 用预置 PlanSource 承接相同计划契约。最小五步旅程直接对应 MD-02 → MD-05 → MD-04 / MD-05 → MD-06 → MD-07，最后由 MD-08 整体验收。下表的 G1～G3 是完整能力归属，不是 Demo 先决阶段。

| 旅程节点 | UI / 系统产物 | 任务 / Gate |
| --- | --- | --- |
| 教师确定方向、AI 前置准备、批量预览发布 | teacher brief、任务进度、按人计划、publication | TA-03～TA-08 / G1 |
| 学生从独立入口选任务、准备与角色对话 | learner task card、preparation、voice session、context | TA-09～TA-13 / G2 |
| 求助、暂停、换题 / 离开与技术失败 | 主题 / 目标分离、实际控制与覆盖限制 | TA-10～TA-13、TA-17 / G2～G3 |
| 结束、明确提交、再练与迟交 | fence、submission receipt、current pointer | TA-12～TA-14 / G3 |
| 学生看具体反馈、提出疑问 | 白名单反馈与 question | TA-15、TA-16 / G3 |
| 教师看证据 / 等级、复核及准备下节课 | report、teacher assessment、review、可比聚合 / 建议 | TA-15、TA-16 / G3；自动等级另需 TA-20 |

## 6. 验证矩阵与报告规范

| 层次 | 主要检查 | 建议脚本 / 证据（新增待实现） |
| --- | --- | --- |
| 旧工程基线 | 既有合同 / replay / 关键浏览器体验 | 现有 verify、replay、browser、closing、slides 命令与拼音 / 调速专项 |
| 新合成合同 | 鉴权、版本、幂等、lease、迟到、缺失、删数、无等级投影 | `tests/teacher-assistant/`，纳入现有 verify |
| 最小 Demo | 一位学生 / 预置计划、四页五步、当场反馈及三类故障 | 拟议 `npm run test:teacher:demo`；MD-08 分别报告工程预览 / 真实可运行结果 |
| 新全链路 synthetic | 主题到报告、重启 / 故障、四 learner 隔离 | 拟议 `npm run test:teacher:e2e` |
| FreeTalk 隔离 | 新服务关闭 / 故障 / 同时运行，prompt / API / 调用差分 | 拟议 `npm run test:teacher:isolation` |
| 浏览器合成设备 | 页面、真实控件 / 播放队列、准备竞态、打断、音频就绪 | 拟议 `npm run test:browser:teacher`，明确 voice / planner synthetic |
| 真实文本 | pack、按人 plan、分析候选的可靠性 / 语义及耗时 | 拟议 `npm run eval:teacher -- --live`，不默认发布或接真人材料 |
| 真实 provider | 正式 TA gateway 的作者音频 / 控制与计划遵循 | 拟议 `npm run probe:teacher:voice`，CLI / synthetic playback 明示 |
| 真人设备 / 教学 | 麦克风、听感、字幕、任务理解、报告帮助、量表 | 单独走查与校准记录，不由前几层替代 |

脚本默认离线 / 合成；真实模式必须显式传入 live 参数并使用本机已配置的合法 provider。真实调用失败、超时、未采用和取消都保留在分母。不能为了提高通过率删掉未完成的尝试，不能修改冻结预期迁就候选。

运行 / 合同改动后必须执行 `npm run verify` 与 `npm run replay`。浏览器依赖 / 设备缺失时明确未执行，不能将脚本存在记为通过。已有历史验收不是新候选的真实质量结果。

报告统一字段：任务 ID、候选 commit / 工作区 hash、数据 / schema / prompt / 模型 / profile / rubric 版本、实际配置、用例与分母、pass / fail / unknown / 未执行、延迟、取消 / 降级、硬缺陷、未覆盖及放行结论。Synthetic、真实文本、真实语音、浏览器合成设备与真人设备至少分别列出。

## 7. 变更范围与完成规则

允许主要新增新应用、新业务服务、新领域包、新测试 / 脚本及文档；package.json 只追加新脚本，旧 start / poc / verify / replay 行为不改；新配置使用独立 `ASK_KAI_TA_*` 命名空间，默认不加载。

共享文件的必要变更集中在 TA-09 的 realtime seam 与相关验证；若后续发现还需修改 FreeTalk 的 initializer、prompt、目标生命周期、旧学习记录或主页业务，应先说明为什么及如何保持契约，不能随新场景实现顺手改动。公共基础组件修复也需单独证据和旧功能回归。

任务只有在交付、有效验证与报告全部满足时才标完成；工程、真实质量和教学准入分开记状态。任何 grade / mastery 能力不得通过修改测试期望或提升 Mock 标签假装完成。

本轮仅调整技术方案、tasking 与文档导航，未执行这些任务；后续先完成 G0 的最小前置门，紧接 MD-01～MD-08。原 TA 任务保留作完整能力 backlog，后续按教师 / 学生 / Kai 视角逐步补齐。
