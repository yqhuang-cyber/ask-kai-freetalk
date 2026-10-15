# 动态初始化、会话与逐轮规划：实施记录

2026-10-14（Asia/Shanghai）。旧基线 `88615712787ac3c547e51e24d1ee11d436485fb4` 已在 [冻结清单](eval-baselines/dynamic-planning-v1-baseline.json) 保留源码及作者数据哈希。此前真实录音、旧分数和十维权重不变。

## 当前交付与能力边界

动态数据契约、mock 资源、会话准备、整体计划、逐轮 Planner、提案校验、状态失效、输出观察、尝试总结和自愿 mock 写回已接入同仓库运行。用户确认规划使用 **MiniMax M3**，语音保持 **豆包实时全双工**，不增加独立 ASR／TTS 服务。

当前路径是 `next_turn_advisory`。整体计划在创建豆包会话前接受并编译；有效 final 触发逐轮 M3 提案，校验后只能在无活动回复、无待取消／更新 ACK 的边界更新后续输入。当前适配器没有已验证的“禁止本轮自动生成／显式启动本轮回复”接口，所以不会将豆包自动输出倒记成受控生成。`controlled` 请求返回 `CONTROLLED_REALTIME_NOT_VERIFIED`，不连接供应商。

这完成了可运行的规划与观察工程路径，**没有完成设计主路径的本轮先规划后生成验收**。`ReplyExecutor` 只是带硬门槛的宿主端口；测试用合成可门控 provider 证明调用顺序，不能据此启用真实 Seeduplex。DP-05／06／10 保持开放。

## 配置与预算

```dotenv
ASK_KAI_PLANNING_MODE=next_turn_advisory
MINIMAX_API_KEY=仅在本机配置
MINIMAX_BASE_URL=https://api.minimax.cn/v1
MINIMAX_PLANNER_MODEL=MiniMax-M3
```

MiniMax 的[官方 OpenAI 兼容说明](https://platform.minimax.cn/docs/api-reference/text-openai-api)与[Chat Completions 接口](https://platform.minimax.cn/docs/api-reference/text-chat-openai)确认模型 ID、Bearer 鉴权、M3 可关闭 thinking。实现使用普通非流式 JSON 提案、宿主严格校验和至多一次格式修复；不假设服务端提供 strict JSON Schema 保证。拒绝重定向与其他模型名，不保存或输出 reasoning 内容。首次真实 M3 初始化约 5.2 秒超过原 5 秒预算，逐轮 1.5 秒也取消请求；当前试点预算改为初始化 10 秒、逐轮 5 秒，仍需校准，不是时延保证。

`legacy` 保留旧运行方式；`shadow` 调用规划器供获准观测，但模型指令、页面和学习记录仍按旧方式；`next_turn_advisory` 是当前本地 mock 默认方式；`controlled` 被明确阻断。外部业务后端继续默认 legacy，未实现真实 HSKai 数据对接。

密钥缺失显示并记录 `planner_unconfigured`；格式／来源／策略不合法或服务不可用时使用有来源、零新知识点的保守规则提案，保持 rule/degraded 标记。初始化失败不会冒充准备完成。诊断仅保留状态、匿名轮次、版本、耗时和受限 HTTP／token 元数据，不记录 prompt、画像值、模型原文或供应商原始事件。

## 数据、资源与生命周期

- `packages/contracts/planning.js` 提供严格字段、大小、身份、版本、时间和引用校验。个人兴趣最多 5、KP 状态 20、活动历史 10；历史截断和不可用明确返回。发音状态不接受来自 ASR 的推断。
- 签名 `HskaiPlanningPort` 以服务端 owner／learner 和独立 scope 访问本地 `/internal/ask-kai/planning`。context、curriculum 和 learning write 不接受浏览器身份或模型权限字段。当前只实现 mock 提供方。
- A～E 合成 fixture 分别覆盖依赖提示、已有喜好独立表现且时间需要支架、不同兴趣、历史不可用和已拒绝目标。普通浏览器仍只使用固定虚构成年学习者；其他 fixture 由宿主测试装载。
- 可信运动／示例 Mission 资源有两个候选目标及先修：喜好表达、简单时间表达。模型不能新增资源 KP。喜好独立表现有证据、近期时间表达需支架时，允许选择第二目标；活动 completed 不用于推断掌握。
- 初始化由 M3 提案与 Validator 共同完成；free 初始目标与 KP 为空。无 Key／服务失败的规则选择会保留明确降级，不算语义质量通过。
- 准备接口为 POST／GET／DELETE `/api/conversation-preparations`。结果有 owner、entry、语速、epoch 和最多 60 秒期限；消费前重新读资料／资源版本；并发消费只允许一个成功。入口切换、偏好更正、撤权和过期取消旧结果。
- 逐轮输入只含当前 final、必要实际前文、实际已转发回复及播放未知、整体计划、语言／冷却／拒绝和有限资源；没有未来输入、参考回复或评分要求。新 final／更正、打断、偏好变化或关闭取消旧在线请求；迟到结果被拒。
- 会话支持立即暂停、明确恢复、按当前明确选择替换目标、停止目标、连续明确困难时退回可信先修目标，以及授权偏好刷新。2026-10-15 修正：Free 的一次求助只影响本轮；明确要求持续练习时使用宿主通用 Skill catalog，结合三类授权资料与实际前文验证先修。Free 不读取课程或 Topic Pack，课程引用为空；未验证的观察规则不产生 attempted。先修未知时不设新目标，也不暗中继续旧练习。详细条件见 [目标生命周期](dynamic-goal-lifecycle.md)。
- 有效目标尝试后减少完整示范；不从次数推断独立或达成。资源已有 success_rule_ref，评估列出语义复核、提示范围、不同情境和独立表达等缺口；尚无这些可核验证据，session_achieved 继续不可提交。transfer／independent 自动记录未启用。供应商重复 final 仍按原协议隔离；核心更正链单测不代表供应商已支持 final 后修订。

## 执行、学习观察与页面

自动生成首次观察时间与宿主生成请求分开；现有豆包输出 `generation_requested_at:null`、生成依据 unknown、`turn_plan_ref:null`。只有带已接受计划的可门控端口才能发起受控生成。输出转发和客户端消费分别记录；普通 Web 暂不发送消费回执，账本保持 unknown，不能声称学生听到完整示范。

动态模式按可信 KP 规则记录直接肯定的喜好句及有限时间句，均为 attempted／support unknown。库外表达未评估，教师文本、计划和 ACK 不生成学生事实。新 learning-record-v2 的观察绑定发生时的 goal_id、plan_revision 和 attempt_rule_ref；后端核对目标／KP／规则关联。总结使用独立 kai-dynamic-summary-v2，保留会中涉及目标的状态和尝试来源，不将旧观察改归最后目标。撤权和安全限制清空；legacy 与旧动态总结显示兼容保留。

页面的目标、可选 Start Tip 和词卡来自同一服务端计划；暂停／停止立即清空旧提示和词卡，free 可以没有词卡。准备过程不申请麦克风；实际豆包 ready 才开始持续采音。页面开始、切换、失败、重新开始保留 epoch 隔离。原播放时钟、字幕缓冲、立即停播和持续上行没有改成停麦式规划。

结束默认不写学习记录。学生明确勾选保存后，只提交受限观察及 plan／resource 来源，按 learner＋session 去重，等待真实 mock 回执；失败提示未保存。撤权／离开会取消尚未提交的请求，已经在后台接受的请求不能靠客户端 abort 撤回。Mock 内存写回可出现在下一会话历史中，但不自动升级 KP 状态；重启重置。隐私 erase 清理这些本地记录，现有 preference export 不等于完整学习档案或供应商删除。

## 验证与未完成项

运行 `npm run verify`、`npm run replay`、`npm run test:browser` 和 `npm run eval:planning`。规划评测默认是 15 个合成 mock fixture／入口组合，输出源码哈希、完整分母、rule/LLM 与降级标记。独立规划质量、生成执行遵循、原十维内容和学习结果保留 null，不把契约通过当作语义得分。

显式 `npm run eval:planning -- --live` 使用 A／B 的三个入口，共 6 个初始化和 6 个 final，至多每次一次格式修复；不调用豆包、不上传麦克风、不调用独立 Judge。`--live --probe` 只用一个合成运动案例，初始化放宽到 15 秒，用于判断默认预算和服务可用性，不修改运行预算。

本轮合成 Node 与真实本机 HTTP／WebSocket 验证、Chromium 合成设备验证以及真实 M3／豆包结果在 [验证报告](eval-results/2026-10-14-dynamic-planning.md) 分开记录。历史普通 Web 验收不直接迁移到新规划版本。

新增独立检查入口 npm run eval:goals：12 个独立编写的虚构行为案例、18 个话轮，期望只用于评测器，不进入 Planner。分别报告宿主行为、LLM 接受／降级及可枚举拒绝原因；自动行为检查不等于完整语义评分。显式 --live 最多 30 次规划及各一次有界修复；--case=refusal 可限定一个案例。新结果见 [目标迭代验证](eval-results/2026-10-14-dynamic-goals.md)。

剩余：M3 真实语义与延迟校准、准确 Seeduplex 本轮生成门控的协议／账号实证、DP-06 真实受控执行、更加完整的局部教学／动态 KP 语义观察、播放范围、三个入口真实音频与费用等待验收。用户选择保持豆包全双工，本轮不会改成组合 ASR／TTS 来绕过这些缺口。

回滚：`ASK_KAI_PLANNING_MODE=legacy` 恢复旧目标与自主生成；停止 mock 写回不影响正常授权退出。旧作者数据、基线、录音与分数不覆盖；新准备结果和页面契约一起切换，避免新页面显示旧固定结果为动态计划。
