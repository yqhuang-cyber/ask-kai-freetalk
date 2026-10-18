# Planner 与语音模型观测

本机开发页面提供一条连续的时间线，帮助核对初始规划、逐轮规划和语音配置之间的关系。它用于解释实际走过哪些步骤，不改变规划预算、生成方式或对话结束规则。

## 打开与使用

启动更新后的服务，访问 `http://127.0.0.1:4310/?observe=1`，展开页面下方「Planner 与语音模型观测」。普通页面也有开启链接，点击后重新加载。观测默认关闭；只记录开启后新准备、新创建的会话，不能追溯以前的对话。

1. 选择学习者，等待准备完成，查看初始规划。
2. 开始对话，每个已接受的学生表达会出现在同一条时间线上。
3. 展开事件查看 JSON；可筛选初始规划、逐轮规划、学生输入或语音模型交互。
4. 需要交给开发者分析时，手动导出 JSON。文件包含画像、提示词及对话文字；普通元数据诊断仍不包含这些文字。

切换学习者会清空旧内容。每次重新准备产生独立 `trace_id`；开始语音时继续使用该准备对应的观测。刷新页面不会加载过去的内容。页面「清空显示」只清空当前显示，后续仍继续观测；要关闭观测，回到不带 `observe=1` 的页面后重新开始。

## 能看到什么

| 阶段 | 事件与内容 | 能证明什么 |
| --- | --- | --- |
| 准备 | `preparation.started`、`preparation.ready/failed` | 当前入口和最终采用的初始计划 |
| 触发 | `planning.triggered`、`planning.attempt` | 初始／逐轮类型、输入、预算、规划模型、尝试序号及修复原因 |
| 模型请求 | `planner.request` | 实际请求方法、地址和 JSON body；含 messages、生成参数，以及 Pi 使用的 tool schema |
| 模型返回 | `planner.http_response`、`planner.response` | HTTP 状态、content 或 tool_calls、结束原因、token 用量；不采集模型思考过程 |
| 校验 | `planning.proposal`、`planning.validated/rejected` | 适配器编译后的提案、校验结果、错误码和安全字段名 |
| 降级／采用 | `planning.fallback`、`planning.committed`、`planning.accepted/cancelled` | 规则计划和具体原因；通过校验后是否仍适用于当前轮。通过校验的旧提案仍可能失效 |
| 语音配置 | `voice.context.prepared/requested/waiting` | 编译后的完整 instructions、配置版本与哈希，以及是否正在等待回复结束或控制确认 |
| 实际发送 | `voice.request.sent` | 当前豆包适配器成功交给 WebSocket 的 session.create / session.update / response.cancel body；不包含鉴权头或音频帧 |
| 打断 | `voice.cancel.requested/sent/ack/skipped/ignored/timeout` | 自动识别或手动打断的来源、归属、实际发送和确认时长；超时前是否仍在等配置确认 |
| 确认 | `voice.ready`、`voice.context.confirmed` | 连接就绪；或适配器接受了匹配的配置更新确认。初始就绪与配置更新确认分开 |
| 回复 | `voice.reply.started`、`voice.reply.forwarded` | 回复开始时观察到的已确认版本、哈希、是否还有配置待确认；安全和归属检查后已转发的文字及完成／取消状态 |

全部事件共享一个服务端单调时钟；准备阶段就是时间原点。`trace_id` 关联整个准备和会话；`planning_id` 区分每次规划，`attempt` 区分修复重试；逐轮事件还包含 `turn_id`、输入版本。配置通过版本和哈希关联到回复。未开启观测时不保留请求内容，既有模型传输元数据观察接口继续独立使用。

## 排查 Alex 的中文难度

先在最终初始计划中检查 `strategy.speaking_difficulty` 和 `speaking_constraints`。随后在 `voice.request.sent` 的 `body.session.instructions` 搜索「说话要求」，确认普通主动用词范围为 HSK1。

逐轮调整时，依次查看请求、返回、校验／降级、`voice.context.requested`、实际发送和配置确认。再找到对应回复，比较 `applied_context_version/hash` 和当前配置，并查看 `pending_context`。这样可以区分规划未产出要求、结果被拒绝、仍未发送、尚未确认，以及要求已经发送但输出仍超出预期。

当前全双工允许豆包先生成、Planner 在后台规划。因此 `voice.reply.started.generation_basis` 保留 `unknown`：这个事件只记录收到回复开始通知时的已确认配置，不能证明生成开始时间，也不能证明每句话使用了最新计划或遵守了全部要求。文字已转发也不代表浏览器已播完；未完整结束的回复可能只有开始事件，没有完整文字事件。

## 保留与边界

仅在本机服务内存和当前页面内存保留，不写普通日志、业务记录或磁盘。服务端每条观测最多 128 KiB，整个观测最多 160 条、2 MiB；页面同样最多 160 条、2 MiB。超大事件明确标记省略；超出容量淘汰旧事件；发送受 WebSocket 背压限制，序号缺口在页面显示。导出只包含页面当前保留的内容，不保证长会话完整。

服务端取消、过期、撤销或结束会清理对应内存。已接收的页面内容保留到刷新、重新准备、切换学习者或手动清空。失败或超时后的迟到模型返回不再进入该次规划观测。观测回调失败不改变业务结果。

请求捕获限于规划请求 body 和语音会话配置 body；不捕获认证头、Cookie、票据、原始音频或原始供应商消息流。敏感字段和常见凭证形式另做屏蔽。显式开启后，请求中的授权画像与对话文本会展示和进入手动导出，不能将其提交到仓库。

此开关与 `?diagnostics=1` 的体验采集分开。后者保留旧有采集语义，会抑制自动收束；普通排查使用 `?observe=1`，无需开启它。

## 本次验证

合成验证覆盖并行会话隔离、实际规划 body 对照、修复／降级／超时、迟到返回、授权及一次性准备传递、真实适配器向合成 WebSocket 发送配置的 body 对照、逐轮配置确认与回复关联，以及观测不抑制自动收束。

浏览器检查使用 Chromium 合成设备与本地 mock，验证初始准备观测、去重、筛选、文本安全展示、手动导出、切换学习者与移动端布局。工程与浏览器检查不代表真实 MiniMax／豆包可用性、语音内容合规或真人听感验收。本次没有新增真实模型或语音服务调用。


验证结果：`npm run verify` 507/507 通过；`npm run replay` 正常、打断和失败三个合成场景符合预期；`npm run test:browser` 通过，页面错误为 0。移动端观测面板截图也已检查。更新后的本地 4310 服务已重启，健康检查、观测页面和观测模块均返回 HTTP 200。这里只读取静态页面，没有触发真实模型或语音请求。
