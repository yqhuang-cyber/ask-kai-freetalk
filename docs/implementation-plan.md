# Incremental delivery

2026-10-28 提交检查点：补齐默认深入报告、实际分析进度与超时提示、录音人工核对到腾讯适配器链路，并统一师生界面；教师端关键字段与操作增加简短英文辅助。789 项回归、三类合成回放和四项合成浏览器检查通过，真实发音与专业教学验收仍开放。详见[提交检查记录](eval-results/2026-10-28-report-ui-checkpoint.md)。

2026-10-28 音频评测链路工程补齐：新增 M4 独立录音核对记录、授权回听、教师来源 / 质量 / 短参考确认、按源 hash 绑定的重新评测、腾讯结构化结果到双端报告与回听。开启核对模式的新会话默认采集录音，学生无额外勾选；录音待核对时学生等待，教师确认后再评测。不修改封口原始元数据，不把人工声明当作自动声源或专业声学验收。腾讯真实握手已通过；用户没有现成录音，本轮只做合成链路验证，真实发音验收仍未完成。[实现与边界](conversation-report-audio-pipeline.md)。

2026-10-27 学生端布局整理：待练习、当前练习、历史报告分视图；历史报告倒序分页，开始后直接进入对话，提交后等待深入报告。文本用途保留一句提示，详情、对话设置和记录管理折叠，工程标识从学生任务卡移除；保留 Mock / 合成标识。772 项验证、三项模拟回放及三项合成浏览器检查通过，真人音频与真实腾讯验收仍独立。[当前流程](conversation-report-stage-c.md)。

2026-10-27 深入报告试用流程调整：主题对话默认记录文本并在提交后由 MiniMax 后台分析，不再要求逐次勾选文本记录；开始前仍明确告知本次处理用途。分析服务未就绪时禁止开始；后台任务完成前不发布基础记录或候选，双端只展示深入报告、等待或失败状态。学生可重试自己的失败深入分析，旧会话不自动补录或升级用途。腾讯真实声音验证仍开放。[当前流程](conversation-report-stage-c.md)。

2026-10-27 阶段 C 工程推进：已接入报告专用 MiniMax 文本分析、M4 分支状态 / 心跳 / 外呼准入 / 部分结果 / 复用重试与派生删除，以及腾讯新版服务端适配器。769 项回归、三项 synthetic replay、新旧合成浏览器通过；虚构文本的真实 MiniMax analyzer 和独立 M4 Worker 链路通过。腾讯配置已填写但真实联通未验证；作者音频、B 的可靠声源 / 对齐及专业教学验收仍未通过，C 和整体 feature 不标全部完成；默认配置中采集 / 外传关闭；本地试用服务已单独开启文本采集和 AI 备课，报告外传未开启。[实施与边界](conversation-report-stage-c.md)、[分层验证](eval-results/2026-10-27-report-stage-c.md)。

2026-10-27 阶段 B 开发中：工作区已接入隔离的旧规则报告进程与授权文本记录基础（实验开关默认关闭），实验音频已实现独立授权 / 候选分段 / 私有存储与封口，实际声源归属、对齐、完整故障恢复和真人设备验收仍未完成；本机端口权限已恢复，合成回归和浏览器检查通过；[进度与待办](conversation-report-stage-b-progress.md)。

2026-10-27 阶段 A 本地实施：已新增版本化教学记录 / 音频 / 覆盖 / 引用契约，M4 独立记录选择与 Mock 授权 API、分别可配置的 7 天保留策略、撤回 / TTL / epoch 屏障及学生端准备说明。采集与外部分析开关仍关闭；B 接入全文 / 音频存储、内容清理与独立 Worker。腾讯预检和能力实验清单已准备；用户确认服务尚未准备，先完成本地 A，AUD-01 真实声学验证保持开放。[阶段 A 实施](conversation-report-stage-a.md)、[分层验收](eval-results/2026-10-27-report-stage-a.md)。

2026-10-27 M4 架构与供应商确认：用户明确本次对话教学记录及分析结果属于 Module 4 学习者资料，报告异步离线执行。已新增[技术架构确认](conversation-report-m4-architecture.md)和更新[Tasking v1.2](conversation-report-deep-analysis-tasking.md)：M4 权威数据服务 + 独立分析 Worker，唯一 SQLite writer，提交事务只入队，语义 / 声学后台并行并按依赖汇总；腾讯云智聆口语评测新版为已选方案，P0 接入任务 AUD-03-TX01。当前只更新设计与任务，未实施新 Worker / 完整记录 / 腾讯适配器或实际调用，未新增验收结果。此前“未选择供应商”为历史记录。

2026-10-27 范围更正：用户明确发音评测为“对话报告深入分析”的 must-have，已将[Tasking 升级为 v1.1](conversation-report-deep-analysis-tasking.md)：AUD-01～04 为 P0 必交付，覆盖自然对话能力验证、学生音频记录 / 归属 / 对齐、真实评测与可回听证据、专业声音验收。文本路径可先交阶段成果，缺少发音能力不能宣布整体完成；自动等级仍非前置。当前仅修订规划，未采集新增音频、未选择 / 调用新评测服务，也未新增验收结论。下方此前“发音独立 / 后续”记录不再代表新 feature 的可选优先级。

2026-10-27 报告深入分析规划：按用户要求新增[完整对话文本与模型分析 Tasking](conversation-report-deep-analysis-tasking.md)，将记录师生文本、模型语义分析、可追溯校验与双端反馈列为优先任务；发音专项单独验收，自动等级不作为前置。本文仅完成任务规划，尚未实施全文记录、报告模型或新增验收。旧会话未保存的文本无法还原；本地 Mock / FreeTalk 边界保持。

2026-10-27 报告分析优先切片：用户要求在 `codex/report-analysis` 细化并实施 TA-12 / TA-15，新增独立 LST / SPK / AUD 任务，先完成有来源的情境理解与口语表达观察，发音单独准入，不等待自动等级。当前已实现有界问答 / 组织证据、版本化有限分析、提交前来源与语义校验、双端投影和练习建议；完整 TA-12 / TA-15、通用语义模型、真实听觉理解、音频评测与教学质量仍未验收。保留已合入 AI 备课与 FreeTalk 边界。详见[细化任务](teacher-assistant-report-analysis-tasking.md)、[分层验收](eval-results/2026-10-27-report-analysis.md)。

2026-10-26 AI 备课合并：按用户明确要求，将 `codex/teacher-ai-planning` 的教师端前置备课合并回主干与原 Demo。4330 启用 AI 备课并保留预置点餐路径和原作业记录；4331 继续作为隔离试用入口。最小 Demo / G0 的历史标记不改动，FreeTalk 冻结基线保留。下方“原 4330 未改或重启”是合并前隔离开发阶段的记录。

2026-10-26 教师端完善第一阶段：已在 `codex/teacher-ai-planning` 独立工作树接入 MiniMax 前置教学包与个人目标生成、持久草案 / 委托 / 取消 / 显式重试、教师目标编辑和精确 hash 发布；新主题交给同一作业 controller，未知反馈继续未评估。655 项回归、三项回放、Node 22.19 的 19 项新场景检查与合成浏览器通过；真实 MiniMax 昆虫 / 指定句式、真实 AI 点餐备课到 Doubao 浏览器提交反馈通过，真人 / 教学质量另验。原 4330 Demo 未改或重启，独立 4331 使用另一数据库 / cookie。当前仅 Mock 等级，不宣称已接入近期学习证据或完整多人分层；[实施](teacher-assistant-ai-planning-implementation.md)、[验收](eval-results/2026-10-26-teacher-ai-planning.md)。

2026-10-26 教师助教最小 Demo 已实施：G0 通过，MD-01～MD-07 最小子交付完成，MD-08 工程及真实豆包浏览器音频闭环通过，真人麦克风 / 听感走查待验。独立入口 `npm run poc:teacher`（4330），本地 Mock 业务子进程与 SQLite；预置点餐计划 → 发布 → 作业对话 → 明确提交 → 双端事实反馈，无等级。648 项回归、三项合成回放、Node 22.19.0 新场景 12 项检查及新旧浏览器通过；8 个冻结 FreeTalk 文件 hash 不变，共享 realtime 仅加默认不变的可选注入。实际实现 / 限制见[试用说明](teacher-assistant-demo-implementation.md)、[验收](eval-results/2026-10-26-teacher-assistant-demo.md)。下面此前“未实施”记录为历史阶段状态。

2026-10-26 教师助教交付顺序调整：用户确认先实现[最小 Demo 蓝图](teacher-homework-minimal-service-blueprint.md)。已将[技术方案](teacher-assistant-technical-design.md)和[完整 tasking](teacher-assistant-tasking.md)更新至 v0.2，执行顺序为 **G0 最小隔离 / 架构基线 → [MD-01～MD-08](teacher-assistant-minimal-demo-tasking.md) 完整 Demo → 教师 / 学生 / Kai 分角色完善**。Demo 用一位教师、一位学生、一份明确标注的预置点餐计划，发布、真实主题对话、明确提交和双端事实反馈实际连通；不等待完整 AI 备课 / 四人分层，不做等级。保留正式计划 / 版本 / 授权 / 尝试 / 提交 / 报告边界；原 G1～G4 改作完整能力验收标号。**目前只更新方案，G0、MD 和完整 TA 任务均未实施，FreeTalk 运行代码未改。**

2026-10-26 教师助教作业主题对话初版方案：已交付[技术方案](teacher-assistant-technical-design.md)及[TA-00～TA-21 实施计划](teacher-assistant-tasking.md)，依据[PRD v0.2](prd/teacher-assigned-conversation-homework-prd-v0.2.md)与[师生 Journey](teacher-homework-user-journey.md)。拟新增独立 TA 应用 / 页面、本地 Mock 授课授权与持久化业务、前置主题包及按人计划、作业对话与双端报告；原 FreeTalk 的入口、初始无目标规划、提示词、学习记录及新服务零依赖为硬边界。共享 realtime 注入点先做旧行为差分，自动等级按语义 / 机会 / 支持能力独立准入。该条保留初版完整架构范围，执行顺序已由上方 Demo 优先方案取代；**未修改运行代码或新增模型 / provider / 浏览器验收结论。**

2026-10-26 拼音字幕首版：普通 Web 默认显示中文声调拼音，保留原 S2S 音频／渐进字幕；明确 ASR final 指令与手动开关共用本场设置、版本和页面 ACK，之后一次固定语音确认。修复连续 final-only 指令误取消新确认，636 verify 与三个 synthetic replay 通过；普通 IAB 8 项拼音＋12 项既有场景通过，真实豆包普通网关三轮开关通过但页面／播放回执模拟。原始画像、学习记录和归档评测基线不变；真人麦克风／听感、开放读音质量仍待验。详见[实施记录](pinyin-captions-implementation.md)。

2026-10-26 拼音字幕隔离 spike：确认默认中文字幕附带拼音、拼音不送语音、学习者可在本场口头关闭。基础库 16 个作者读音样本通过 13 项，经两条样本内覆盖＋繁体映射通过 16 项；不能视为开放文本准确率。真实豆包 6 个独立语音开关样本符合预期，应用执行器 synthetic；离线 IAB 6 项呈现检查通过，无麦克风／听感。普通 Agent／Web、工程依赖及生产提示词未改，尚未实施；后续选择明确 ASR 控制或完善原生 FC 归属，见[Spike 报告](pinyin-captions-spike.md)。

2026-10-26 VS-07 普通页面自动化与复杂联调：普通 Web 在隔离合成语音／Planner 宿主中，经 CUA 运行 12 场景全部通过，包含手动／语音交错、追加、撤销、改口、迟到确认、调速、Planner 晚到、丢回执、未知冻结、重连换人、课件降级与真实就绪守卫。修复旧回复首次迟到及后续匿名音频隔离、排队状态发布；624 verify 与三个 synthetic replay 通过。真实豆包普通网关两种插话各两次通过，其中最终运行记录旧文字／音频转发均为零；使用作者 PCM 和 synthetic Viewer，不替代真人设备。共享浏览器检查及 CI 驱动已提供，本轮实际执行的是 CUA 驱动。完整质量、真实 Planner 竞争及真人听感仍待验，默认关闭。见[第六阶段报告](eval-results/2026-10-26-voice-slides-control-stage6.md)。

2026-10-26 VS-04～06 工程接入：普通 Seeduplex 显式注册受限 Slides 工具，Gateway 建立独立会话事务与 Viewer 握手，Web 接入被动组件；功能默认关闭，展示框握手失败降级普通聊天。工具结果不伪造 turn_id，不进入学习证据；回执、上下文全量更新、调速、结束及权限代次共同隔离。617 verify、三个 synthetic replay、真实豆包到普通网关三轮检查通过，真实 IAB 组件／播放队列已验证；真人麦克风／听感和完整插话、Planner 竞争矩阵待验，整体验收未通过。此前报告为各阶段历史状态，不代表当前仍未接入。详见[第五阶段报告](eval-results/2026-10-26-voice-slides-control-stage5.md)。

2026-10-26 VS-01 第四阶段：原话回显核对误拒 5/12 有效回看，不选为主方案。改为授权会话／call／可撤销工具权限的独立页面事务，语音保持原生 question／response，不伪造缺失的 FC 输入身份。新方案原 23 条结构回归通过，重复回看、明确追加、改口、撤销、旧批次迟到拒绝及更新后新请求均有真实 S2S 样本；页面仍为 synthetic，62 次尝试保留失败。共享门控内核已沉到 Gateway 模块并完成协调器组合测试，596 verify、三 synthetic replay 通过；普通 Provider／Gateway／页面尚未接入，无新增浏览器音频或真人验收。可以继续默认关闭的 VS-04／05，不再把供应商补字段作为本会话页面动作唯一实现前提。见[第四阶段报告](eval-results/2026-10-26-voice-slides-control-stage4.md)。

2026-10-26 VS-01 第三阶段：新增已确认状态的导航能力编译、归属字段／编号及输入上下文诊断、受限两项批次支持。收窄能力后的原 23 条结构检查均通过；两个独立只读调用真实同批到达并一次聚合回传。会中更新放到原结果及回复完成边界后，三次均正确暂缓后续页请求。保留 22 次配置前置错误、两次同名相对批次未生成、两次过早更新后的语义不符，62 次尝试不写成全通过；最终提示仅针对性复测，不伪装同一版本全套。568 verify、三个 synthetic replay 通过；无新增真实浏览器／音频验收。FC 输入关联仍未取得可靠字段或生命周期依据，VS-04／05 等待供应商确认，普通 Agent 未改。见[第三阶段报告](eval-results/2026-10-26-voice-slides-control-stage3.md)及[待确认问题](voice-slides-control-provider-questions.md)。

2026-10-26 VS-01 插话补验：新增不主动取消工具的三场景与改口／撤销两种派发状态，最终七场景均观察到预期 synthetic 页面结果及新轮回复。12 次尝试包含三次严格参数拒绝和两次配置前置失败，完整保留；精确布尔值说明及 JSON 示例后的两次改口复测通过。协调器补充只替换／取消未派发回看及重复控制请求去重，14 项协调器测试、558 verify 和三个 synthetic replay 通过。FC 输入身份仍未核验、批次多调用未实测、既有多余 goto 尚未修复，VS-01 整体准入未通过，VS-04／05 不启动；普通 Agent 未改。本批没有真实浏览器语音或真人设备验收。见[补验报告](eval-results/2026-10-26-voice-slides-control-stage2.md)。

2026-10-25 课件回看实施 VS-01～03：新增独立作者语音／原生 FC probe、应用契约、执行协调器、三页被动组件及专属 fixture。两轮各 23 条真实单输入，12 条回看均到预期模拟页，11 条反例均未改页；仍有一例多余 goto 被宿主拒绝。顺序两轮可工作，但 FC 无输入身份、等待中取消未 ACK；准入未通过，未接普通 Agent／provider，VS-04／05 等待此缺口解决。550 verify、三 synthetic replay、真实 IAB＋synthetic 宿主八项组件检查通过；未做真实浏览器语音或真人听感验收。见[阶段报告](eval-results/2026-10-25-voice-slides-control-stage1.md)和[当前任务状态](voice-slides-control-tasking.md)。

2026-10-25 对话内 Slides 控制：仅完成[独立 PRD](prd/voice-slides-control-prd-v1.md)、[技术方案与核心模块改动](voice-slides-control-design.md)、[实施清单](voice-slides-control-tasking.md)，尚未实现或验收。定义“控制课件进度”意图：回看当前或更早且已展示页可执行；下一页／后续指定页仍识别并回应稍后会学到，但不跳转、不排队或自动执行。工具／宿主／前端禁止任何向大于当前页的跳转；自然回看指代依赖有来源的历史，单说没听懂不自动切页。保留独立 POC／mock 边界，不新增课程推进引擎。归属、输出及取消收束须先做真实协议实验；本轮只有文档变化，没有新增供应商／浏览器验收结论。

2026-10-25 口头调速已实现：已接受 final 的慢／快／正常请求进入独立控制事务，先播请求确认，经浏览器 PCM／字幕完成回执后串行更新语速和教学上下文，供应商确认后以新语速播结果。有效设置覆盖旧计划但不写长期画像，控制语音不产生学习证据。verify 527／527、三个 synthetic replay、通用及专项 Chromium 合成音频检查通过；真实豆包作者语音三请求完成，CLI 播放回执为 synthetic muted，真人设备听感未验收。见[任务与结果](spoken-speech-pace-tasking.md)。

2026-10-19 会话观测总结：普通页面自动整理每场前 5 轮，结束或断开后提供「汇总并导出观测总结」。包含连接 Log ID（如可取得）、供应商会话／回复 ID、对应指令快照及发送／确认状态、实际回复、Planner 预期和可选人工备注；晚到的逐轮计划单列，不追溯作为本轮要求。开发总结在 `.local/observation-reports/` 按授权账号／学习者隔离保留，与学习记录分开；原始时间线仍仅有界内存。verify 515/515、三个合成 replay、Chromium 检查通过。单独的真实豆包连接检查取得握手 Log ID 和供应商 session ID，无音频上传，不代表实际回复或真人听感验收。使用与验证边界见[观测说明](planner-observation.md)。原打断确认兼容性问题仍开放。

2026-10-18 自动打断确认超时排查：固定合成语音复现了用量统计后自动识别触发 cancel、没有确认但随后出现新回复的事件顺序。补齐观测中的取消来源／实际发送／确认／超时；准备清理 DELETE 改为幂等，清除 favicon 404。未调整取消状态机、1500ms 等待或确认归属；语音兼容性问题仍开放，用户那轮具体识别来源尚未确认。见[排查与实验限制](eval-results/2026-10-18-cancel-ack-diagnosis.md)。

2026-10-18 Planner 到语音的观测：新增独立 `?observe=1` 页面时间线，串联准备、初始／逐轮模型请求与返回、校验／修复／降级、采用或过期、语音配置实际发送与确认，以及回复开始时已确认的配置。规划请求支持完整 JSON、Draft 与 Pi tool body；观测按授权准备一次性传递并隔离，默认关闭，仅保留有界内存，不捕获密钥、音频或模型思考过程。与原元数据诊断分开，不抑制自动收束，不改变全双工或宣称本轮生成受控。使用与验证边界见[观测说明](planner-observation.md)。

2026-10-18 FreeTalk 初始规划目标字段修复：专用初始说明／输入／输出契约不再要求模型选目标，完整 JSON、Draft、Pi 均输出五个交流字段，经共享宿主编译器固定补齐空目标；技能目录仅用于会中，初始引用给出明确来源清单。页面区分四类降级原因。500 项 verify、三个 synthetic replay、Chromium 合成设备检查通过；最后真实 M3 四次检查接受 LLM，开发过程中的 JSON／难度失败和 Pi 引用修复超时均单列保留。未调用豆包、未重启现有服务，不代表实际语音或全部规划质量验收。见[修复与验证记录](eval-results/2026-10-18-free-initial-plan.md)。

2026-10-16 独立 FreeTalk POC 收尾增强：逐文件适配原仓库 `3e4422e` 的 ClosingCoordinator、浏览器播放确认、有来源 SessionRecap 和授权会话小结存取，保留本仓库的退出码／告别 fallback、中文结束语、8 秒上下文确认及可选 Pi Planner。口头正常收尾保持全双工，可继续／撤销；立即退出跳过播放；不再取消已完成告别来等待第二句。Planner 机制文档已移植并标记原仓库来源。483 项 verify、三个 synthetic replay、专项 Chromium 合成收尾检查通过；真实两轮作者合成音频探针收到有内容回顾和告别及正常关闭，但未测浏览器播放或真人设备，不声明真实 Web 自动结束验收。通用 Chromium 合成设备回归也通过，page errors 为 0；完整范围见[增强移植分析](freetalk-enhancement-port.md)。

2026-10-15 Pi 自由对话规划已接入为可关闭路径：锁 `pi-agent-core` / `pi-ai` 1.2.0，Node 要求改为 `>=22.19.0`。`ASK_KAI_PLANNER_PROVIDER=pi` 时，自由对话的初始计划和逐轮计划用 `submit_conversation_plan` / `submit_turn_plan` 各提交一次，请求仍走现有 MiniMax 配置；主题和 Mission 仍走原来的 JSON 规划。豆包语音未改。默认不加这个变量时行为与原来一致。真实 12 案／18 轮对照和是否改默认都还没做。见 [Pi 接入任务清单](pi-integration-tasking.md)。

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
