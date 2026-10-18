# 学习者自适应交流与中文难度：详细设计

日期：2026-10-18（Asia/Shanghai）。状态：待实现的技术设计。对应[需求修订版](planner-speaking-difficulty-v2.md)和[验收案例](planner-speaking-difficulty-cases.md)。文中的字段、事件与错误码凡未在代码中存在，均为拟新增内部契约，不是豆包协议事件。

## 1. 范围和设计决定

目标是让自由对话的内容、交流方式、表达支持和 Kai 自身中文难度随学习者及当前需要变化。主要决策仍由现有大模型 Planner 完成。

本版作以下决定，避免实现时重新猜测：

1. 内容与交流方式沿用 `conversation_purpose/content_focus/opening_options/reply_directive.task`，支持强度沿用 `support_level`；只增加独立的说话难度对象，不新增四人固定人设分支。
2. 难度对象同时进入初始计划和每轮计划。使用既有一次规划调用及其修复机会，开场现有 15 秒、逐轮现有 2 秒总预算不变。
3. 词汇上限由已授权画像派生，模型只能在范围内选择。语法组织、信息步幅和词义是否合适仍需要语义判断。
4. 当前入口只实施 free。共享 Planner 路径必须兼容，但不扩展主题、Mission 或外部 HSKai 集成。
5. 维持当前全双工及 `next_turn_advisory` 边界。新增字段不等于建立了逐句生成前门控；验收必须显示实际应用归属。
6. 普通主动用词严格封顶，只有当前明确问词可局部例外。不从兴趣或历史出现推导超纲词豁免，不增加长期能力判定或画像写回。

## 2. 现状与缺口

`ConversationInitializer` 已读三类授权资料；`FullContractPlanner`、Draft 和可选 Pi 可以生成计划。`PlanningState` 已有输入版本、取消、过期和修复／兜底。`TeachingSession` 将它们编译成上下文，网关在回复安全边界串行下发并等待确认。

目前初始 `strategy` 只有语言支架、支持级别、纠错、语速；逐轮 `reply_directive` 只有任务、支持级别、新点数量和预算版本。`reply-policy.js` 里的“初学者用容易理解的词句”属于笼统提示，没有独立难度决策。已有听说分项能力、近期实例和 HSK 累计摘要可供模型使用，无须新增个人资料采集。

不能通过把 `course_level` 复制进回复策略就完成本需求：同等级的两个人也应因听力、交流偏好、当场反馈得到不同选择。

## 3. 数据与字段契约

### 3.1 宿主派生的范围：`speaking_constraints`

这是 Planner 输入及宿主接受计划中的绑定数据；模型不输出、不修改这些字段。与上下文快照及授权版本关联。

```json
{
  "policy_version": "kai-speaking-v1",
  "catalog_version": "hsk-2025-syllabus-v1",
  "profile_level": 3,
  "verified_through_level": 3,
  "advanced_band_status": "not_applicable",
  "request_scope": "none",
  "required_simplification": false,
  "requested_term": null,
  "source_refs": ["ctx-mock-maya-hsk3-1"]
}
```

- `profile_level` 从可信 `learning_profile.course_level` 严格解析，禁止模型或任意字符串设置上限；不把下一学习阶段当作已达级别。
- 本 POC 四人取 1/3/5/7；正常 1～6 级的 `verified_through_level` 等于该级。七级为 6，`advanced_band_status:shared_7_to_9_unresolved`；这说明目录精度，不是降低学习者能力标签。
- `request_scope` 为 `none/reply/session`。会话简化约束与当前问词可以同时存在；该字段表示当前最具体覆盖，内部另保留会话设置，不能用一个覆盖值丢失会话状态。
- `requested_term` 为 null 或 `{text, source_event_id}`，只由当前有依据的学生词义／翻译请求绑定。可以是尚未翻译的原词，例如 `swimming`；模型不能改写来源。中文答案是否确为该词的翻译仍需语义复核。
- `source_refs`、目录哈希和资料版本绑定由宿主补齐。新输入不允许复用旧词例外；权限失效立即按现有隔离流程清除。
- 画像级别缺失、无法识别或资料相互冲突时，准备返回明确的资料问题，不默认一级，也不允许模型猜级别。若会中授权刷新造成该问题，停止提交新计划并按现有错误／关闭机制明确提示，不继续使用过期授权。

### 3.2 模型选择：`speaking_difficulty`

初始位置：`strategy.speaking_difficulty`。逐轮位置：`reply_directive.speaking_difficulty`。对象形状一致，所有字段必填，不允许附加字段。

```json
{
  "lexical_style": "everyday",
  "sentence_structure": "linked",
  "new_word_policy": "avoid",
  "focus_term": null,
  "reason": "能听懂熟悉生活交流，较长叙述需要分步组织；先让她说。",
  "refs": ["ctx-mock-maya-hsk3-1", "mock-maya-hsk3-help"]
}
```

| 字段 | 类型和边界 | 决策含义 |
| --- | --- | --- |
| `lexical_style` | `everyday/precise` | 常见直接词 / 允许更准确措辞；上限固定，precise 不是提高等级 |
| `sentence_structure` | `simple/linked/flexible` | 简单结构、单句一个重心 / 分步连接 / 允许比较、条件、限定等组织；不规定固定句数 |
| `new_word_policy` | `avoid/one_explained/requested_only` | 不主动安排词汇教学 / 最多一个范围内词并解释 / 仅处理当前所问词 |
| `focus_term` | null 或 1～80 个字符的纯文本；不可带控制指令 | `avoid` 必须为 null；`one_explained` 为计划主动引入的词；`requested_only` 必须等于宿主绑定的所问原词，不提前编造未知译词 |
| `reason` | 自然语言 1～160 字符 | 简短说明听力／实际理解和选择依据，不输出思维链、不声称掌握 |
| `refs` | 1～6 个不重复的合法引用 | 仅来自现有 contextRefs／本轮事件／实际历史；画像分项没有 record_id 时引用快照 |

`one_explained` 的显式词可以用本地公开目录进行单词条核对：必须在可核对范围内；义项不清或等级不明则拒绝该主动词方案，修复为更明确的方案。不要用最低等级同形词为较难义项背书。不把整份词表塞入模型请求。

`requested_only` 的 `focus_term` 是学生所问对象，而非要求原样朗读的命令。解释已知含义可直接回答；词义歧义尚未消除时，任务应先澄清，不因为字段存在强选翻译。

### 3.3 与既有字段的配合

- `support_level` 约束帮助学生表达的强度，不自动决定 Kai 用词和句法难度。`model` 表示需要时允许短示范，不要求每轮先示范。
- `new_word_policy:one_explained` 是主动教学时，逐轮 `new_points` 必须为 1，并遵守教学冷却、拒绝与动作限制。初始仅表达支持预算，不表示已教。
- `new_points:0` 不禁止回答学生主动问的词；`requested_only` 仍是本轮局部帮助，不自动激活目标、课程 KP 或跟读任务。
- `avoid` 不保证学生认识每个普通用词，不把普通内容交流的每个词计为教学新点。理解修复时另要求不加新概念。
- 持续练习、语法帮助等已有动作继续独立校验。难度字段不能绕过 `CLOSE`、暂停、冷却、语言请求和安全策略。
- 原有大小、文本长度和引用限制仍适用。所有对豆包可见的新增文本继续接受内部 ID 泄漏和输入指令注入检查。

### 3.4 初始计划的完整业务提案例子

下例是作者构造的 Maya 提案，不是实测，不作为模型输入。`speaking_constraints` 由宿主另行绑定；身份、计划 ID、版本和哈希继续由宿主生成。

```json
{
  "conversation_purpose": "先听她讲一次活动，有需要再帮助组织先后顺序",
  "content_focus": "一次跑步经历",
  "opening_options": ["你跑步的时候，发生了什么？"],
  "primary_goal_id": null,
  "candidate_goal_ids": [],
  "key_points": [],
  "strategy": {
    "language_support": "auto",
    "support_level": "partial",
    "correction": "gentle",
    "pace": "slow",
    "speaking_difficulty": {
      "lexical_style": "everyday",
      "sentence_structure": "linked",
      "new_word_policy": "avoid",
      "focus_term": null,
      "reason": "熟悉叙述可独立表达，较长信息需要分步组织。",
      "refs": ["ctx-mock-maya-hsk3-1", "mock-maya-hsk3-help"]
    }
  },
  "selection_basis": [
    {"reason": "按兴趣切入，用近期叙述实例决定局部支持", "refs": ["ctx-mock-maya-hsk3-1", "mock-maya-hsk3-help"]}
  ]
}
```

逐轮沿用完整 turn 提案，`reply_directive` 新增同形难度对象。例如“刚才那句没听懂”时，任务变成重述同一意思，难度为 `everyday/simple/avoid`、`focus_term:null`，引用本轮事件；其余 prior_outcome、goal_assessment、expected_observation 等字段仍严格沿用现有契约。

## 4. 模型输入与选择规则

初始输入继续带三类资料、覆盖状态和 `required_strategy`，增加宿主范围。逐轮输入增加范围与有来源的难度工作状态；只给已发生的真实前文和当前输入，不给参考答案、未来回合或验收期望。

模型选择顺序：

1. 先理解当前交流意图，保留学生选题、拒绝与结束控制。
2. 再看可听懂的中文：当前明确请求优先，其次近期理解反馈、`skill_profile.listening`，再结合能力摘要与当前级别。`speaking` 主要帮助判断表达支持，不直接当作听力分数。
3. 在固定词汇范围内选择用词方式和句子组织；按是否请求词义决定新词策略。
4. 给出有来源的理由。不能因为说了一次中文、模型示范过、ASR 成功或课程完成，就认定理解或独立掌握。

对未知理解情况使用有标记的保守选择；未知不写成能力缺失。四人的名字、UID 和固定期望表不进入生产系统提示词。兴趣只影响内容选择，不提高词汇权限。

理由建议短写，避免新增字段把逐轮输出撑大。真实验证必须同时报告初始与逐轮的模型接受率、修复率、规则降级率和时延；不能只证明开场能生成，而逐轮始终因 2 秒预算退规则。预算不足时优先精简输入／输出及实现开销，不静默扩大 deadline，也不另加一次难度模型调用。

初始开场候选也是可能被说出的中文，必须服从难度要求。`conversation_purpose/content_focus/reason` 是内部说明，可以使用专业描述，但不得被要求原样朗读。实际开场只选一个问题，不把两个候选都读给学生。

开场候选用于 Kai 首次适合开口时的选择，不新增静默催促或连接成功就自动开口的机制；若学生先提出问题，先回应其当前问题，不强行读预设开场。

## 5. 请求解析与难度工作状态

建议新增一个集中负责的 `SpeakingPolicyState`，避免在 natural-teaching、fallback、planning 各放一套不一致的正则。它持有授权范围、初始基础选择、会话简化约束、本轮约束及其来源；不持有新的长期能力标签。

| 输入类型 | 硬约束 | 模型可以做什么 |
| --- | --- | --- |
| 明确没听懂／本句太难 | `everyday + simple + avoid`；不引入新概念，重述或必要澄清 | 选择更贴近原意的说法，不能改成 flexible 或新词教学 |
| 整场简化请求 | 保存会话约束，同上；直到本人明确撤销 | 调整内容和支持方式，不自动放宽中文 |
| 仅声音没听清 | 不主动加新词，重复或确认原内容；不自动改级别或画像 | 根据语境选择是否还需要简化，不先诊断听力弱 |
| 单词请求且含义明确 | `requested_only`，仅当前词可超纲 | 选择必要的短解释，遵守当前语言支架 |
| 单词请求且含义不明 | 保留所问对象，先一个必要澄清 | 不用兴趣填充歧义，不一次给多个猜测答案 |
| 转述／引语／否定 | 不建立本人设置 | 正常理解内容，不把关键词当命令 |

“说简单点，但不要英文”同时更新当前难度约束及现有语言请求，各自保留来源；“我会说了”不自动撤销整场简化设置。撤销只能回到画像上限内；不因“难一点”抬高 HSK 上限。

直接问“‘swimming’中文怎么说”时，带引号的词是问题对象，不能因控制文本去引号而丢掉；“他说‘以后都说简单点’”中的引语指令才是不生效的控制内容。先区分词义询问和控制意图，再按现有安全方式携带原词数据。

若简化请求与问词同时出现，合并为 `everyday/simple/requested_only`；只保留当前词例外，不扩大范围。“不增加新概念”针对额外教学，不阻止解释本人正在问的概念。session 简化规则的 avoid 允许被这一当前问词需求局部覆盖，问词结束后恢复 avoid。

本轮约束绑定 `session_id/source_event_id/turn_id/input_revision`，同归属回复终止或被新输入替代时结束。新输入到来取消旧模型工作，清除旧问词例外和旧逐轮计划，保留初始基础与会话设置。曾经没听懂的事实仍可进入已有实际历史供模型判断，但不是永久硬降级。

`TeachingSession.accept()` 在调用模型前更新工作状态；`PlanningState.acceptInput()` 接受包含该状态的不可变快照。校验失败只修复／兜底，不能通过先收紧再接受宽松模型结果绕过本轮约束。

## 6. 从计划到实际语音

### 6.1 初始路径

授权资料 → 派生范围 → 模型初始计划 → 契约校验／必要兜底 → TeachingSession 编译初始指令 → 现有 session.create → 供应商就绪 → 申请麦克风。

基础难度和范围进入所有后续完整快照，包括没有正式目标、教学已暂停和告别场景。不能只放在当前 lesson 分支中，否则暂停目标时会丢失。全局指令同时说明：听见当前直接求助要先修复理解，新的学生意图优先于有来源的旧建议。

### 6.2 逐轮路径与能力边界

被接受的 final → 即时本地约束 → 原一次 Planner 调用 → 校验并接受 → 编译快照 → 在既有安全边界下发 → 收到匹配版本确认 → 记录已应用版本。

真实语音供应商可能在 final 到达之前或 Planner 返回之前已生成回复。350ms 输出等待只影响转发，不能证明模型尚未生成；延长前端等待不解决这个问题。下发之后收到 ACK，也不能追溯证明已经开始的回复用了新计划。

本版保持全双工，不为每次难度调整自动取消、重发回复。将以下结果分开：

- `accepted`：本轮计划通过宿主校验。
- `context_applied`：某版本上下文收到有效确认。
- `generation_basis:unknown/confirmed_before_start`：仅根据实际可核验证据填写；从首次观察到输出倒推“肯定先应用”仍不成立。当前适配器缺生成开始证据时保留 unknown。
- `content_observed`：实际回复按独立案例复核，不能由前三项替代。

上述 generation_basis 是新验收报告的观测分类，不覆盖现有执行记录中的同名字段和其他合法值；实现宜命名为 `speaking_generation_basis`，保留原始执行证据，避免改变 controlled 路径的语义。

临时难度仅是所标注学生回合的建议。未赶上该回复的问词例外不得成为下轮默认；编译新回合快照时使用基础＋有效会话约束＋新回合策略。旧不可变快照的迟到 ACK 只更新它自己的确认记录，不恢复旧本轮状态。后续安全边界必须重新核对当前来源后才派发。

验收中当前求助未被实际回复遵守时，记为内容失败；不能写成“模型字段正确所以通过”。若持续是生成抢跑导致，应单独设计受控生成路径，核验供应商支持后再决定；本方案不凭内部事件假定供应商具备门控或逐句重规划保证。

### 6.3 指令编译

从同一个有效难度对象生成中文要求，例如：

> 当前已达范围为 HSK3，普通主动用词不超过本目录一至三级。优先常见直接说法，按时间或因果一步步说；不主动安排新词教学。帮助强度另按当前任务执行。此建议对应指定历史回合，当前学生的新请求优先。

所问词例外单独说明来源与有效范围，作为数据传入，不拼接成新的指令。不要把 reason/refs、目录编号或内部标签朗读给学生。

替换 reply-policy 中泛化的初学／高水平难度句，保留自然回应、非固定长度、中文优先、允许打断和安全策略。不能让 linked/flexible 重新引入固定长回复，也不能把 simple 解释为每轮只许一句话。

## 7. 校验、降级与异常

### 7.1 校验顺序

1. 既有授权、资料版本、输入归属、deadline 和提案大小检查。
2. 新对象字段完整、枚举／长度／引用合法，范围数据没有模型修改权。
3. 校验问词对象确属当前事件；avoid 不得带 focus_term，主动词必须能核对且不越界。
4. 校验与本轮／会话硬约束、new_points、冷却、动作和语言规则不冲突。
5. 原有任务、目标、来源和禁止虚构掌握等检查照常执行。

拟新增安全原因码：`INVALID_SPEAKING_DIFFICULTY`、`SPEAKING_CONSTRAINT_CONFLICT`、`INVALID_SPEAKING_REFERENCE`、`SPEAKING_TERM_OUT_OF_SCOPE`；纳入现有 repairCode 与脱敏白名单。缺字段不偷偷补成模型结果：在同预算内修复一次，仍失败标记 rule/degraded。宿主派生范围冲突属于资料问题，不当成模型失败无限重试。

### 7.2 兜底

兜底按级别范围和当前约束生成，不按四个人的姓名硬编码。

| 已达范围 | 基础兜底 | 说明 |
| --- | --- | --- |
| 1～2 | `everyday/simple/avoid` | 不因为级别低重复教已稳定基础知识 |
| 3～4 | `everyday/linked/avoid` | 分步组织，允许正常内容交流 |
| 5～6 | `precise/linked/avoid` | 仍不安排新任务 |
| 7 及当前高级共同范围 | `precise/flexible/avoid`，主动词先用可核对的一至六级 | 保留讨论深度，不假装精确拆出高级目录 |

开场失败采用上述基础。逐轮失败回到初始基础，再合并有效会话设置和本轮硬约束；不继承上一轮临时问词例外。单词求助仍按已有语义／必要澄清路径给最小帮助，规则不凭字面替学生选多义词译法。

保持 planner_kind/degraded_reason 的真实性。结束控制无需新增模型调用；继续使用当前有效范围和会话风格，清除上一轮词例外，不影响关闭和保存流程。

口头回顾可在词汇范围内概括实际内容，不要求逐字复述已过期的超纲问词。现有固定兜底朗读文案也必须适配，例如不能对 Alex 机械朗读超出一级的工程／教学标签。必要的安全帮助保持原有优先级，仍尽量使用可理解中文；若必要内容与范围冲突，单列安全例外及实际证据，不用它豁免普通对话。

## 8. 代码落点与兼容

以下是实现任务，不代表本次已经修改。新增文件名为建议位置。

| 位置 | 拟改动 |
| --- | --- |
| `packages/agent-core/speaking-policy.js`（新增） | 集中定义枚举、范围派生、请求与会话状态、纯编译函数、基础兜底 |
| 公开词汇目录的共享只读访问层（新增） | 单词条核对和离线复核共用目录版本／哈希；不让 Core 依赖 mock 账号服务，也不向模型发送完整目录 |
| `planner-full-contract.js` | free 初始 strategy 与 turn directive 的形状、选择说明；非 free 保持原契约 |
| `planner-draft.js` | free 对应 schema、编译映射、字段诊断白名单；不能仅改完整契约 |
| `pi-planner.js` | free 的两个提交工具参数同步，仍经共享校验；避免新提示与旧工具 schema 冲突 |
| `planner-port.js` | 新原因码、版本描述与修复诊断；保留预算、取消和路由 |
| `conversation-initializer.js` | 派生初始范围，绑定校验与兜底，保存初始基础选择 |
| `plan-validator.js` | 两处新字段校验、硬约束和来源检查；范围与实际回复判断分开 |
| `natural-teaching.js`、`language-support.js` | 复用现有求助／控制语义，避免新增解析与既有引语／否定处理冲突；明确新状态唯一归属 |
| `planning-state.js`、`fallback-policy.js` | 输入快照和接受校验、异常兜底、当前归属与过期隔离 |
| `teaching.js`、`context-snapshot.js` | 状态生命周期和所有分支的有效难度编译，难度不随目标暂停消失 |
| `reply-policy.js` | 替换笼统难度提示，保留已有交流与安全规则 |
| `learning-summary.js` 中口头回顾／兜底文案 | 使用有效难度表达同一有来源内容，移除直接朗读教学标签的做法；不改保存证据、关闭或播放协议 |
| `apps/realtime-gateway/src/realtime.js` | 传递已应用难度元数据、关联回复证据；不改供应商 wire 名称或自动增加取消 |
| 现有 diagnostics metadata 白名单 | 仅允许枚举、哈希、来源 ID、版本和时间，不导出全文画像／ASR／raw trace |
| 现有 planner／预算／上下文／关闭测试及独立验收工具 | 新契约、映射、隔离和真实内容的分层验证 |

默认完整契约、draft_v1 与可选 Pi 三条 free 路径必须同步；若某路径没有实现，准备阶段明确报告不支持，不能假装模型成功再整场退规则。主题和 Mission 的形状按入口分派，不能因共享 exact 校验而被迫新增 free 字段。

版本方案：新增 `kai-speaking-v1` 并升级相关 prompt、context 和 fallback 版本。对 free 接受的初始／逐轮计划分别使用 `conversation-plan-v3`、`turn-plan-v2`；主题／Mission 原契约保持。显式审计 schema 判断、hash、Preparations 绑定、投影与所有消费者，改用明确的能力／入口判断，不能让新 free 版本丢失自适应人设。外部配置协议路由名保持兼容，描述中带新 prompt 和 speaking 版本，不让新旧计划在同一会话混用。执行记录仍绑定具体计划版本及哈希。

页面不必新增面向学生的工程字段；已有内容／语速显示仍来自同一计划。审阅报告另提供四人可读字段对照，不把原始 Planner 请求或真实学习者资料公开到页面。

## 9. 实施次序和验收门槛

1. **SD-01 契约与纯策略**：固定新对象、可信范围、当前／会话请求、目录边界及来源校验。验收同等级不同听力可选择不同难度，未知不伪装一级。
2. **SD-02 三条 Planner 路径**：同步完整、Draft、Pi、修复与兜底；真实模型另报。验收四人既有字段和难度选择，无隐藏规则代答。
3. **SD-03 上下文与生命周期**：接入 TeachingSession、暂停／告别分支、已应用证据；验证新输入、迟到 ACK、当前问词清理和权限隔离。
4. **SD-04 独立内容验证**：执行配对输入与分层真实检查；报告计划、应用、实际回复各自结果，确认中文难度和交流自然性没有相互牺牲。

运行／契约改动按仓库要求执行 `npm run verify`、`npm run replay`，按受影响范围执行专项合成浏览器检查。真实 Planner、真实豆包、浏览器听感各自出报告，不拿一种通过代替另一种。本次设计不执行供应商调用，也不产生新的通过率。

验收规格见[案例表](planner-speaking-difficulty-cases.md)。仅提示词正确或只通过四人字段断言，不足以宣布需求完成。
