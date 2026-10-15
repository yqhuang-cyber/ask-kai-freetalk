# Incremental delivery

2026-10-15 Pi 接入只新增任务清单，未改运行代码、依赖、学习者数据或冻结评测。MiniMax 的初始计划和逐轮计划可以改由 Pi 的单次工具提交来做，HTTP 仍用现有 MiniMax 配置；豆包实时全双工继续走现有语音适配器。默认规划保持现有 JSON，直到对照结果写出决定。见 [Pi 接入任务清单](pi-integration-tasking.md)。

2026-10-15 按用户最新要求恢复主题目标与页面这一项：主题初始化必须有一个合法教学目标，拒绝空目标提案并在期限内修复／回退；缺学习证据仍可选择无先修冲突的探索任务，已有稳定能力安排新情境应用，不据此虚构薄弱点。明确只想聊天、请求目标先修不足或全部候选不可用时准备失败并提示调整选择／free。页面展示同一已接受计划的目标、关联知识点和表达任务，切换／重准备／失败时清除旧内容；语音上下文使用相同 goal_details，会中暂停保留原任务、替换时同步新知识点与任务。其余主题 TODO 继续搁置，learner-data、冻结评测输入／oracle 和 Topic Pack 生成准入未修改。实施与本轮检查见[主题目标准备与展示](topic-chain-implementation.md#主题目标准备与展示)。

2026-10-15 降级清单已按当前工作区代码核对：新增[Planner 降级点与替代规则](planner-fallback-inventory.md)，列出 F-01～08 的触发条件、模型修复／时限、三入口初始化和 T-01～13 逐轮替代规则，区分正常控制、Topic 生成失败、取消／过期、观察及呈现 fallback。记录资源失效未标 degraded、规则优先级和适配局限，以及后续分层评估清单；README 已加导航和配置区链接。本项仅更新文档，未改变运行行为、学习者数据或冻结评测，未新增真实模型／豆包／浏览器检查。

2026-10-15 回复机制调整：按用户反馈取消默认一句／最多两句及固定字数预算，`kai-reply-v5` 按语境和理解需要回应；明确先接住具体内容，再相关补充或自然追问，单个主动作可以承载这一过程。同步 Planner、规则降级与语言策略，保留逐轮 2 秒时限、学生控制权与有来源证据。冻结评测数据／历史评分保持原样，本轮 `npm run verify` 461 项测试及 `npm run replay` 三个 synthetic replay 通过；未执行新真实模型／豆包调用或浏览器听感检查，新回复自然度需独立真实验证。见[当前回复策略](short-replies.md)。

2026-10-15 最新优先级：用户要求暂时搁置主题式对话入口工程链路，剩余 review／质量项保留在[主题 TODO](topic-planner-tasking.md#搁置-todo)。本轮只审查自由对话工程链路并记录完善顺序，见[free 审查](free-conversation-engineering-review.md)；未修改运行代码、学习者数据或供应商配置，未执行新真实模型／豆包调用。

2026-10-15 工程 review 第 1 项修复：free 准备／消费／逐轮路径不再请求课程或 Topic Pack；显式练习使用独立通用 Skill catalog，保持三类授权学习者资料与实际前文输入。课程引用为空，未验证观察规则不产生 attempted。页面／后续语音上下文及总结共用同一计划；其余 review 项与 Mission 默认选择留待后续。验证结果见 [主题链路实施记录](topic-chain-implementation.md)。

2026-10-15 主题式对话入口工程实施：已新增独立 Topic Manager、已发布 Topic Pack 只读端口与版本固定、通用能力目录与 GoalInstance、三类授权 mock 学习者资料驱动的需要假设、合理无目标、四份最新资料／音乐主题集成、逐轮 2 秒 deadline 与撤销后停止旧目标。管理页面、发布／回滚／撤销、本机持久化、冻结 28 案物化与主题范围 24 案合同 runner 已加入。真实 M3 与豆包／浏览器验收分别见 [主题链路实施记录](topic-chain-implementation.md)；默认语音仍 next_turn_advisory。

2026-10-15 全 Agent tasking 已补齐：[模块任务清单](agent-completion-tasking.md)与[独立评测计划](agent-evaluation-plan.md)。目标为当前 Ask Kai Web 的三个入口针对不同学习需要完成可验证的自适应对话。AC／AE 编号关联既有 TP／DP／IP／ML／TT／收尾任务，工程、语义与设备分别验收；对齐管理端提前生成／发布 TopicPack 与逐轮总预算最多 2 秒。本次只改规划与导航，不修改其他工作区运行代码或提供新增模型／provider／设备通过结论。

2026-10-15 逐轮预算运行修正：PlanningState 默认／最大预算 2000ms，从 TeachingSession 接受输入记录的宿主时间起算，包含等待、状态／资源准备、模型与修复、校验／提交；预留 200ms 提交窗口，不足时规则降级，过期输入／资源／提案不提交，模型忽略 abort 也不能覆盖规则结果。eval:planning 元数据改为实际 2000ms。verify 440 项、三个 synthetic replay、15 案离线规划契约通过，无新模型／豆包调用；TP-07 仅预算子项完成，多主题目标承接与主题服务仍待实施。会中具体链路见 [教学设计 8.1](initial-planner-teaching-design.md#81-会中逐轮的处理链路)。

2026-10-14 用户进一步确认主题式链路：独立主题管理服务提前生成、准入并发布绑定 topic_id 的 TopicPack；学习端只读发布版本，初始化／逐轮／cache miss 均不生成。补齐管理页面、持久化、发布／回滚／撤销的设计，TP-02／03 承担服务实现。新逐轮总 deadline 最多 2 秒，包含从 accepted final 起的排队、请求、修复、校验和提交，TP-07 实施；当前代码旧 5 秒未改。仅更新设计，无新模型／语音调用。见 [服务与时延设计](topic-management-service-design.md)及[最新 tasking](topic-planner-tasking.md)。

2026-10-14 动态 Planner tasking 已重新整理，尚未实施：用户确认 TopicPack 由 LLM 生成，不逐主题人工编写。TP-00～11 覆盖最新资料基线、通用能力／主题契约、生成、准入／缓存／版本、独立评测、初始化决策、首轮／逐轮承接、展示、第二主题验证及真实分层验收；分三批节点同步。原 28 案冻结，最新 mock-learners-v2 另加集成案例。仅更新设计／文档，无运行代码、learner-data 或新模型／豆包调用。见 [正式 tasking](topic-planner-tasking.md)。

2026-10-14 Mock 数据 v2 修正：按官网 2025-11 HSK 大纲建立全部 11000 条词汇编号与 592 个语法表细目索引，区分目录统计单位与官方能力指标。四个已模拟完成等级的学习者累计掌握 70／244／409／530 个语法细目，高级七至九级只标指定子集；低等级基础继承，下一阶段待学单列。完整目录留在学习画像接口，规划读取有来源累计摘要与少量交流技能。补齐四人的个人、五项能力和六条近期实例，并加入 README 顶部导航。见 [完整画像](learner-profiles.md)。

2026-10-14 初始化 Planner 教学决策设计完成，尚未实施：明确三类资料／入口到交流目的与 NeedAssessment、允许与适合分别判断、可信能力目标实例化、合理 null、能力支持到语音、反馈与目标修订边界；独立 4 个基础例子＋24 个对照／边界共 28 项设计案例，输入与 oracle 隔离并绑定哈希。仅验证文档／资料结构与物化一致性，模型／Judge／豆包调用为 0，无新质量通过率；现有两目标、运行契约、learner-data 与旧评测保持当前行为。后续 IP-01～06 均待实施，需先评审再开始。见 [完整设计](initial-planner-teaching-design.md)与[设计案例](eval-datasets/initial-planner-adaptation-v1/README.md)。

2026-10-14 四位 Mock 学习者与三接口：完成 Alex／HSK1、Maya／HSK3、Leo／HSK5、Nina／HSK7 的独立 UID、个人画像、学习画像及六项近期合成记录，v1 当时只含 8／12／16／20 项交流技能；全量累计知识已由上方 v2 修正。三个签名接口按同一 owner／UID 聚合，网页可切换和查看；旧 A～E 测试场景兼容。分层运动目标、能力到实际语音的适配及独立会话对比列为后续 ML-04～06，不代表本次已支持四档不同目标。见 [数据、接口与分阶段计划](mock-learners.md)。

2026-10-14 原始上下文／ObservationPort／降级／长会话四项工程完成：420 项测试、三个 synthetic replay、20 个反馈案例、12 案／18 轮规划和新增三会话／44 轮回归通过。原始快照在目标修订前捕获并 hash 绑定；观察仅 shadow，不写学习事实；修复困难自动恢复已停止目标的缺口。没有新模型或豆包调用，语义质量与设备验收不计完成。见 [四项结果](eval-results/2026-10-14-agent-four-tasks.md)。

2026-10-14 Agent 优先迭代：加入源于实际 final／输出的 learner_feedback、当前目标观察引用校验、内部 ID／多问题约束与八项辅助语义审阅。406 项测试、三个 synthetic replay、20 案反馈和原 12 案／18 轮离线回归、Chromium 合成设备通过。记录仍 attempted-only；通用语义、提示因果、独立／达成与 M3 质量未验收，豆包 controlled 不变。见 [Agent 验证](eval-results/2026-10-14-agent-feedback.md)。

2026-10-14 规划可靠性与控制实验第一轮：已推送 88c98f7；拆分 provider-independent Planner 与 MiniMax transport，增加严格 DraftCompiler、来源候选约束、分阶段安全诊断及冻结对照。旧契约逐轮 5/18 接受 LLM，Draft-v5 4/18，未证实可靠性提升，因此旧 prompt 保持默认。豆包独立 FC probe 已观察到真实合成样本等待工具结果，普通 Web 仍为 next_turn_advisory，controlled 未启用。394 项测试、三个 synthetic replay、Chromium 合成设备回归通过；后续换更强 LLM 复用同一业务契约／取消／数据集。见 [可靠性与控制结果](eval-results/2026-10-14-planner-reliability.md)。

2026-10-14 目标生命周期迭代：已落实有来源目标替换／停止、连续明确困难时退回可信先修目标、free 自愿练习、原目标观察来源与多目标总结；381 项测试、三个 synthetic replay、Chromium 合成设备检查通过。独立行为评测及安全拒绝原因已加入，真实 M3 仍有大量降级与选择问题；达成判断因语义／提示／呈现证据缺失而未验证，豆包保持 next_turn_advisory。见 [新验证报告](eval-results/2026-10-14-dynamic-goals.md)。

2026-10-14 动态初始化、会话计划和逐轮 MiniMax M3 规划已接入：三类 mock 数据、完整有限资源、准备版本／消费校验、actual-context 提案、迟到取消、尝试总结与自愿内存写回、Web 页面展示与语音指令。语音保持豆包全双工，当前为 next_turn_advisory；本轮生成门控未证实，controlled 关闭。工程及 Chromium 合成设备通过；真实 M3 6 组仍有降级／超时，动态初始配置连接探针收到豆包就绪，不证明双向语音或受控逐轮生成。新版本语义和设备验收继续开放。见[实施记录](dynamic-planning-implementation.md)、[DP 清单](dynamic-planning-tasking.md)与[验证报告](eval-results/2026-10-14-dynamic-planning.md)。

2026-10-13 Harness候选的现有145轮正式模型辅助评分与旧对应范围比较已完成：24/26案完整，103通过／29待复核／13失败；共同可比134轮均分94.60→96.44，37改善／18退化（2轮混合）。005缺1轮、027缺3轮，12项要求留null；没有新增关键失败，也没有本轮Agent修改、豆包或独立Judge调用。见[正式结果与采集诊断](eval-results/2026-10-13-harness-formal-comparison.md)。Task05质量验收仍开放。

2026-10-13 全量结果后的Harness修复已分类实现并推送：语言v5、教学v7、回复v4、总结v3及有界PCM音频兼容；原评分口径冻结。338测试、三个回放及最终运行版本CI浏览器检查通过。26案／149轮固定录音真实回归随后结束，现有145轮正式评分已完成；当时工作环境断连的缺口已恢复取回。见[实现与回归](eval-results/2026-10-13-harness-cross-case-regression.md)。旧评分阶段不改Agent的限制保留为历史记录，当前修改由用户明确授权。

2026-10-13 收尾Task05-09现有记录正式评分、旧基线比较及011／018独立诊断已交付：010／018固定PCM补跑完整，47/48案完整、244/255轮已评分；149通过、72待复核、23失败，24项要求及011剩余11轮留缺口。共同可比222轮均分95.98→95.17，56轮有改善、52轮有退化（8轮混合）。本轮只评审和报告，不改Agent，不新增豆包／独立Judge调用，不覆盖旧基线。见[正式对比](eval-results/2026-10-13-task05-formal-comparison.md)和[独立诊断](eval-results/2026-10-13-task05-collection-diagnosis.md)。Task05质量验收仍开放，下一阶段按已确认跨案例问题逐类修正／回归；普通Web已完成验收保留，后续只补未覆盖及改造受影响项。

2026-10-12 收尾Task05-04～05-08工程已分别推送main：暂停旧目标与告别、澄清纠正、同预算短回复、回合关联与呈现证据、合同2有来源总结。319测试、三个回放和CI通过；本地Chromium缺失，浏览器由CI安装执行。语言固定PCM两次及3个收束／4个澄清整案已真实采集，仍有明确内容问题；见[针对性回归](eval-results/2026-10-12-task05-targeted-regression.md)。当前05-09完整48案／255轮正在运行，旧基线、作者数据和评分口径不变；Task05尚未整体验收通过。

2026-10-12 收尾Task05-03已实现语言策略v2：本轮例外、会话设置与保存画像分开，一次求助在同归属回复结束后失效，明确当前只中文的确认语也只中文；状态版本与教学决策版本分开。作者评测集及独立要求未改，解除旧历史预览对候选语言代码的耦合。308测试和三个回放通过，真实语言对照待执行。此前05-02真实四轮快照诊断已完成，t04仍带英文保留为内容观察；见[诊断](eval-results/2026-10-12-task05-context-diagnostic.md)及[作用范围](scoped-language-requests.md)。下一项为05-04。

2026-10-12 收尾Task05-02已实现统一、不可变上下文快照及哈希／来源记录。待确认快照不被新输入覆盖，错误／重复确认忽略；仍在原回复边界更新，不宣称后台新状态追溯控制本轮生成。三个入口初始提示哈希与重构前一致；303项测试、三个合成回放通过，本地浏览器执行文件缺失，浏览器检查由CI执行。真实候选记录待运行，下一项为05-03语言作用范围。见[上下文快照](context-snapshots.md)。

2026-10-12 收尾Task05-01已实现候选评测契约：显式绑定Agent提交、运行文件及允许变化，拒绝未声明变化和版本混用，提供独立候选工作流与同口径比较。旧基线保护保留，Agent运行文件／数据／依赖未改，本项没有真实模型调用。见[候选评测](candidate-evaluation.md)；下一项为05-02上下文快照。

2026-10-12 收尾 Task04设计已交付：[最小 POC Harness 改造方案](task04-poc-harness-design.md)及[Task05 分项实施与回归清单](task05-implementation-tasking.md)。明确本轮语言请求／会话设置／保存画像的作用范围、上下文快照与更新确认、拒绝／收束、澄清／纠正、共享预算、回合归属和总结证据。下一项为 05-01 候选版本评测契约，再逐类修改 Agent。本文档提交只更新设计、README及任务状态；46个运行文件、依赖、作者数据和旧评分均不变，没有新豆包或评分模型调用。Pi 完整目标设计继续归档参考。

2026-10-12 收尾 Task03完成本轮预注册根因对照：4主案、16新会话／40输入步骤均有效，直接复用 Task02音频。只中文请求均识别为关闭英文支架，但有2次仍带英文；上下文更新确认回执晚到时既有违规也有6个遵守反例，旧双语上下文干扰有支持，精确因果未完全隔离。040／036残段与Hmm超时本轮未复现，旧根因不冒充已修复。Agent、原基线与评分未改；其后 Task04设计已交付。见[结果](eval-results/2026-10-12-task03-root-cause.md)和[预注册范围](task03-root-cause-plan.md)。

2026-10-12 收尾 Task 02 已交付评测侧采集证据及独立真实诊断，未改 Agent：5 案／32 轮中 29 轮有效，011 完整，036 跨轮残段未复现，040 多 ASR 停止留证。失败片段计完整／进入评分的问题已修正；内部记忆与实际播放继续未覆盖。旧基线与 Task 01 分数保持原样，下一项是 Task 03 根因验证。见[Task 02 报告](eval-results/2026-10-12-task02-evidence.md)和[完整收尾 TODO](poc-completion-todo.md)。

## Evaluation before Agent changes (2026-10-11)

The user explicitly prioritizes evaluation tooling, collection and scoring before further Agent changes. Freeze the published Agent baseline `6661d7ba3ecf7f3eef8f23f74c5d625cb8f457e2`; retain the already merged ASR protocol repairs. Do not tune the Agent from one case. Tasks E01–E03 adapt actual observations to the existing rubric, complete evaluation evidence/review and enable controlled batch collection. E04 executes the full original set plus separately reported language controls; E05 aggregates evidence and root-cause hypotheses. Only then does H01 design Agent harness changes and compare versions. Current-turn strategy timing and content issues remain recorded, not repaired in this phase. Task 10 device acceptance remains separate. See [evaluation-first tasking](evaluation-first.md) and [baseline record](eval-baselines/freechat-v3.1-baseline.json).

2026-10-12 evaluation update: E01–E03 tooling is implemented; the full scope and two failed-case retries attempted all 48 cases. 47 cases collected completely; 244/255 actual replies were reviewed with the existing ten dimensions and per-criterion evidence. Case 011 retains five replies and eleven missing turns; eleven collected-turn criteria lack sufficient evidence. This is explicitly model-assisted offline review, with zero external Judge API calls and no human approval. E05 has an initial cross-case report, not confirmed causes. Agent runtime hashes remain frozen. See [results and proposed modification surfaces](eval-results/2026-10-12-freechat-baseline.md); H01 and Task 10 remain open.

## Independent POC scope (2026-10-09)

2026-10-12 closeout Task 01: reviewer-only calibration and comparison tooling are implemented. Reassessed 97 observed units; carried forward 147 v1 units on the identical immutable bundle. Failed turns changed from 36 to 20, material ASR differences from 42 to 8, with seven uncertain turns and nineteen unassessable criteria. This changes review interpretation, not Agent quality, runtime or rubric weights. Independent Judge calls and human approval remain zero/false. The user has separately confirmed ordinary Web vertical acceptance. See [calibration results](eval-results/2026-10-12-task01-calibration.md) and the [integrated closeout TODO](poc-completion-todo.md).

The user clarified that this is an independent Ask Kai Agent POC. Default
business interfaces now use the repository's local mock HSKai HTTP service;
no `wohuipteltd/HSKai` checkout, BFF deployment or business database is needed.
The same ports, signed authorization and runtime ownership remain in use.
See [standalone POC](standalone-poc.md) and [ADR 0002](adr/0002-standalone-poc.md).
Tasks 05–10 use this backend; real voice still requires the local Doubao key
and a reviewed supplier profile. Mock safety/privacy records are not real
human delivery or vendor deletion evidence. This support task is separate
from Task 05, whose engineering rules are now implemented; real teaching quality
is still pending acceptance.

## Current P0: conversation experience (2026-10-09)

Only the reported speed, turn-taking, length/density, natural HSK association,
progressive subtitles and visual summary issues are P0 for the next iteration.
The language rule (Chinese first, short English support when needed)
is P0 within tasks 04, 06, 09 and 10. Task 04 implements the model policy and
metadata checks; Task 06 now implements approximate playback-aware captions.
Live model compliance and actual caption listening quality remain pending.
Both languages share the reply budget. The 2026-10-10 language adjustment adds only bounded support preferences, reported
comprehension and known expressions to P0; see [language support](language-support.md).
Full personas/complex bilingual or word-by-word glosses,
age-based duration, complete profiles/target
selection/scaffolding and correction branches are P1; cross-session continuity,
complex long-term memory and professional pronunciation evaluation are P2.
Existing authorization and safety invariants remain in force.

| Task | Deliverable | Status |
| --- | --- | --- |
| 01 | Current behavior inventory, opt-in metadata timeline/export, fixed cases | Engineering implemented; real-account/device baseline pending. See [experience baseline](experience-baseline.md) |
| 02 | Speech speed configuration and slow mode | Engineering implemented: slow default, normal option, session-isolated native speed and diagnostics. Real listening calibration pending. See [speech pace](speech-pace.md) |
| 03 | Turn-taking and false interruption fixes | Engineering implemented: ASR text confirmation, owner-bound output wait, serialized controls and duplicate/obsolete cancel handling. Real pause/echo/noise calibration pending. See [turn taking](turn-taking.md) |
| 04 | Short reply/density budgets; Chinese first, adaptive English support | Engineering implemented: versioned adaptive language/density policy, bounded sourced profile and current requests, shared budgets, ACK-safe audits and scoring criteria. Real model compliance/listening pending. See [short replies](short-replies.md) |
| 05 | Natural teaching decisions | Engineering implemented: single-goal/action selection, refusal/topic pause, clarification limit, teaching cooldown and sourced ACK snapshots. Real semantics/model teaching quality pending. See [natural teaching](natural-teaching.md) |
| 06 | Playback-aware progressive subtitles, preserving Chinese/English order | Engineering implemented: phrase buffering, PCM clock, pause/cancel fences, labeled text fallback and Web size/highlight controls. Real device synchronization pending. See [progressive captions](progressive-captions.md) |
| 07 | Per-session structured summary data | Engineering implemented: three entries, sourced target text/attempts, bounded refs, optional review and honest empty/partial/suppressed states. Bounded vocabulary and actual ASR/model semantics need acceptance. See [session summary](session-summary.md) |
| 08 | Web summary cards | Engineering implemented: Chinese-first headline, sourced expression/pinyin/English cards, attempt counts, one optional review, honest empty/partial/unavailable states and session/safety isolation. Real content/device acceptance pending. See [Web summary cards](web-summary-cards.md) |
| 09 | P0 regression and content evaluation, including language order and bilingual length | Engineering implemented: scoped runtime matrix, 16 cross-entry content cases, 10 authored negative controls, surface and per-criterion semantic gates, incomplete/review blocking, approved-record templates and optional structured Judge. Free-chat fixed-baseline observations and provisional model-assisted review completed for 244/255 turns; missing input coverage and human/independent Judge calibration remain open. See [evaluation results](eval-results/2026-10-12-freechat-baseline.md) and [P0 regression](p0-regression.md) |
| 10 | Real speech/device acceptance and fixes, including bilingual listening/captions | In progress: 2026-10-10 explicit audio-lane ownership, ID-less usage isolation and graceful adapter close repaired; 220 regression tests pass. Production-adapter live smoke passed complete TTS, two updates, cancellation, resumed output and graceful ACK; all 10 cancel-in-flight chunks discarded. ASR, model teaching and Web/device acceptance pending; Web review flags unchanged. See [Actions probe](protocol/actions-connect.md) |

Each development task is tested and committed separately on main. Engineering
implementation and real-experience acceptance are tracked separately. The
original steps below describe the foundation, not the current priority order.

## Foundation delivery

### Free-conversation evaluation data preparation

2026-10-10: completed the uploaded 40-case / 244-turn dataset preparation and checks. Opening soft goals, explicit unknown initial fields, sourced scenario assumptions, turn requirements and reference conflicts now follow adaptive language and existing Web-summary scope. The original ten-dimensional rubric is preserved. Reference replies and future turns cannot enter tested history; 34 proactive utterance signals are not idle events. A metadata-only manifest and offline preparation checker are on main; full dialogue files are delivered separately. Real response collection, runner adaptation and Judge scoring are the next task, not completed acceptance. See [dataset preparation](freechat-eval.md).

2026-10-11: calibrated the dataset as `freechat-v3.1-20261011` (prepared format v2). All 244 original turns now include independently authored language expectations, mapped scoring criteria, ten-dimensional anchors and short alternative replies. There are 33 concrete key-turn calibrations, 40 conditional case-specific summary contracts, and 8 supplementary language scenarios / 11 turns. Runtime language previews remain diagnostics, not gold labels. The offline checker accepts explicit authored-versus-runtime disagreements while rejecting future evidence, reference leakage and fabricated results. Actual reply collection, complete replay adaptation and real scoring remain pending; this iteration changes data preparation only.

2026-10-11: at the user's request, added the complete V3.1 Excel, JSON, CSV and review notes to the [versioned dataset directory](eval-datasets/freechat-v3.1/), with README links and per-file hashes in the manifest. CI now runs the offline checker against the committed JSON. This publishes the prepared fixed scripts and annotations; it does not record provider/Judge runs or complete real-experience acceptance.

### Multi-turn evaluation runner

2026-10-11: implemented the same-repository CLI `npm run eval:multiturn`. Default offline preflight selects one original case; explicit live collection uses the signed mock HSKai launch, production gateway/adapter, paced student audio, actual ASR/replies, teaching updates with ACK and existing summaries. Every case has a fresh session and declared initial language fixtures. References, soft goals and future turns never enter model requests. Optional fixed-input TTS uses the existing Doubao credential in separate sessions. Private, per-turn checkpoints bind candidate/data/audio/model/policy versions and preserve partial failures; later cases continue independently. Local protocol-fixture tests pass. No real run of this dataset has occurred, no scores are produced, and recorded-output adaptation, semantic review, scoring and Task 10 Web/device acceptance remain pending. See [runner usage and sequence](multiturn-eval.md).

2026-10-11: added a dedicated GitHub Actions first-case trial that reuses the existing `DOUBAO_API_KEY` Repository Secret. It pins case 001 / four turns and exact data/profile hashes, prepares authored input TTS, and collects through the same Agent runner with a five-minute supplier budget and no automatic retries. The existing probe-only attestation is explicit and remains rejected by ordinary Web/CLI; no normal review flags change. Three-day artifacts retain authored-input/AI observations and metadata, excluding PCM and raw provider wire traces. Local fixture checks validate isolation and blocked requests. The initial real trial is tracked separately from these engineering checks and from content/device acceptance.

2026-10-11 actual first-case trial: [run 38144369875](https://github.com/yqhuang-cyber/ask-kai/actions/runs/38144369875), candidate `8b3cf36bd57193cccf449eea7bb35e08343aae4c`, collected four ASR finals, four complete model replies, four context ACKs and a normal existing summary through the production Agent gateway using the existing Actions Secret. Earlier trial failures exposed and repaired the actual ASR final `text` mapping. Observed cumulative ASR revisions now replace partials; per-turn diagnostics include delayed context ACKs. Repair verification [run 38144953706](https://github.com/yqhuang-cyber/ask-kai/actions/runs/38144953706) also succeeded, with all per-turn ACKs retained and cumulative partials bounded. The current-turn decision ACK arrives after the response starts: next-turn confirmation does not prove current-turn policy application. That timing needs a separate design and live verification. Opening sentence budget, unsupported pronunciation praise and ASR surface differences require content review. No Judge scores, full-dataset acceptance or Web/device acceptance are claimed. See [actual trial notes](multiturn-eval.md#首案实际收集成功).

| Step | Deliverable | Gate | State |
| --- | --- | --- | --- |
| 1 | Local foundation, event contracts, synthetic replay, CI | Local verification passes; true provider readiness is never simulated | Merged to main (PR #1) |
| 2 | Actual Doubao protocol spike and adapter | Verified auth/audio/text/cancel/context behavior with redacted event samples | Official PDF + Go/Python/Web Demo mapped; Seeduplex adapter and metadata mute/error probe implemented; 接入必读/ACK order/terminal IDs/live account verification pending |
| 3 | Web presentation, browser capture/playback and real gateway | Continuous upload and stable real bidirectional speech | Implemented: AudioWorklet, PCM/playback, ticketed WebSocket, reviewed-profile adapter; native Chromium synthetic-device checks pass; real account/device acceptance pending |
| 4 | Interruption, late-event isolation and subtitles | Real recordings/measurements confirm behavior across devices | Implemented: manual/provider speech-start cancellation, ACK timeout, reply fences and paced subtitles; real-device timing pending |
| 5 | One sports teaching loop | Goal, word card and evidence have traceable sources | Implemented: authored versioned goal/cards, persona, stages, sourced attempts, boundary context updates with ACK; real model teaching quality pending |
| 6 | HSKai contract boundary, three modes and minimal learner memory | Signed course input, owner-scoped data and corrected preferences | Implemented: signed bridge, three modes and memory port/UI; standalone POC now includes local mock identity/Mission/preferences. External deployment is outside POC scope |
| 7 | Safety, privacy, content eval and controlled release | P0 regression, critical-failure gates, human handling and separate real-time metrics | Implemented: safety floor/handoff and privacy ports, aggregate metrics, LangChain Judge, Langfuse scores, release checker and browser CI; live services/calibration/original P0/market approvals pending |

The first client is Web only. No iOS SDK or native app is required. The homepage
defaults to a disconnected preview. Real audio requires a reviewed supplier
profile, server credential and signed identity from the local mock HSKai contract.
External HSKai integration is optional future work, not a POC prerequisite. Test providers
have no UI activation switch. Engineering replay lives at /dev/replay. Steps
3–7 are code implementations with separate acceptance gates, not a released
student service. See release-and-eval.md and the release checker for open gates.

Testing progresses alongside each step. Platform reuse is a separate spike: inspect
its source and prove one authorized teaching result before introducing a runtime
dependency. No migration to the platform is required to start the voice spike.
