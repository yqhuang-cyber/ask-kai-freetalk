# P0 Task 01 — 体验基线与诊断

2026-10-09。本项增加观测和测试场景，不更改语速、轮次规则、提示词、字幕节奏或总结能力。工程实现可验证；真实账号、真实设备和真人体验基线待本地测试。当前 P0 仅覆盖语速、抢话／误打断、冗长与知识点密度、自然 HSK 关联、渐进字幕、可视化总结。完整任务顺序见 [实施计划](implementation-plan.md)。

## Task 01 时的代码基线

下表保留 Task 01 起点，便于前后对比。Task 02 已增加默认慢速和正常档，详见 [语速实现与试听](speech-pace.md)；Task 03 已增加 [话轮等待、文本确认与控制串行化](turn-taking.md)；Task 04 已增加 [短回复、教学密度与中英顺序策略](short-replies.md)；Task 06 已替换固定字符节奏，详见 [播放进度渐进字幕](progressive-captions.md)。真实体验基线仍待本地测试。

| 项目 | 当前行为 | 边界／后续 Task |
| --- | --- | --- |
| 语速 | Seeduplex 模板没有显式设置 `session.audio.output.speed`；PCM 输出 24kHz | 采样率不是语速；不能据此判断听感。02 实现慢速档 |
| 轮次 | 供应商 speech-start control 立即尝试打断；Seeduplex 来源为 ASR started | 识别开始不是实际 VAD 起点；没有本地学生停顿判断。03 验证并修复 |
| 打断 | 手动按钮先清前端队列，再发 cancel；网关取消有 1500ms ACK 超时 | ACK 超时不是等待学生的时长；上下文更新与取消竞态仍可能结束会话 |
| 采音 | 麦克风持续上传；请求 AEC、降噪和自动增益 | 记录实际 getSettings 布尔值；请求不保证设备效果，需耳机／扬声器对比 |
| 长度 | 人设提示通常一到两句、最多一个问题；4000 字符硬边界 | 硬边界不是学习者回复预算；密度和自然性需人工观察。04–05 修复 |
| 字幕 | 每 70ms 揭示 1–3 字符及可选标点，打断清队列 | 固定节奏，未与播放同步。06 优化 |
| 总结 | 固定词卡与尝试计数；结束时发教学视图 | 未实现本轮动态知识点总结。07–08 实现 |

## 本地测试与导出

1. 按 README 启动，打开 `http://127.0.0.1:4310/?diagnostics=1`。默认首页不显示诊断，也不启用网关诊断流。
2. 展开“体验基线诊断”，选一个场景。开始新会话会清除上一次诊断并锁定场景；前一份报告需先导出。
3. 在已有真实授权和真实供应商就绪的条件下完成测试。诊断不绕过 HSKai 授权，不启用假服务，不改变麦克风权限时机。
4. 结束后选择人工观察结果，点“导出诊断 JSON”。每个场景分别测试耳机／扬声器。对比前后版本时使用相同设备、音量、场景与配置；代码版本、设备和浏览器在操作者的本地记录中关联，不自动采集设备身份。
5. 报告仅在本页内存中保留，刷新清除；手动下载后由操作者保管。不自动上传，不保存对话文本、录音、原始供应商 trace、票据、学生身份或密钥。不要将真实会话报告提交仓库。

未接通的报告为 `not_connected`，不能作为语音基线。`npm run baseline:demo` 输出 authored synthetic 元数据示例，不使用网络、麦克风或密钥。

## 固定测试场景

Web 与测试共用 `apps/realtime-gateway/public/experience-cases.json`。

| ID | 场景 | 重点观察 |
| --- | --- | --- |
| E01 | 普通短回复 | 听感语速、总长度、PCM 时长、字幕节奏 |
| E02 | 句中短停顿 | 是否抢话、识别与回复事件先后 |
| E03 | 较长思考 | 等待是否自然；人工观察实际停顿 |
| E04 | 背景噪声 | 是否误识别／误打断 |
| E05 | 扬声器回声 | 是否自我打断，与耳机对比 |
| E06 | 真正插话 | 停播、清字幕、持续采音、取消 ACK |
| E07 | 手动打断与迟到输出 | 打断来源、旧回复隔离、新回复归属 |
| E08 | 双语、长回复及换题 | 长度、密度、自然关联、字幕积压 |
| E09 | 正常／中途结束 | 总结不足与旧输出清理 |

本项不设置未经实测的“合格语速／停顿／同步延迟”。人工 outcome 不自动批准 P0 或发布。教学密度、关联和总结正确性不能从数字推断，需按场景人工观察；后续 09 补内容评测。

## 诊断契约与测量边界

已授权的 WebSocket 可发送 `{ "type": "diagnostics.enable" }`，只启用当前连接。网关发送 `diagnostics.event`：`row.name`、网关 monotonic `at_ms` 和白名单 `fields`。该消息不参与供应商协议或教学归约。回调异常不改变音频行为；拥塞时允许丢诊断，不阻塞音频。缺少诊断记录不能证明没有事件发生。

导出 schema 为 `version:1`，kind 区分未接通、合成、真实供应商待就绪、已观察真实就绪。真实就绪不证明真人听感，`real_experience_accepted` 始终为 false，人工 outcome 只是测试记录。

| 观测 | 含义与限制 |
| --- | --- |
| `response.first_text / first_audio` | 网关 response.started 到首个文本／音频的间隔，不是学生真正说完到首响 |
| `response.complete` | 接受的 Unicode code points 字符数、delta 数、PCM 块数、收到的 PCM 时长；排除已隔离的迟到输出 |
| `pcm_duration_ms` | 字节数 ÷ 2 ÷ sample rate；不是实际听到时长或语速评分 |
| `cancel.requested / ack` | manual、provider_speech_start、safety；active、pending_cancel、pending_context，以及请求到 ACK 的网关间隔 |
| `user.partial / final` | 只记字符数、匿名 turn 引用；不存识别内容；final 到达未必早于回复开始 |
| `event.dropped` | 运行时拒绝原因与匿名引用；适配器内部已过滤的 wire 事件不进入网关 |
| `caption.received / revealed / cleared` | 到达、已显示、待显示字数；Task 06 每次揭示一个短语，最短 320ms 间隔；短语数仅统计保留的事件 |
| `caption.mode / playback`（Task 06） | 等待、播放、暂停、文字降级与完成；约每 250ms 及完成时记录 PCM 播放估计、收到／待播时长与时钟来源，不等于逐字同步或真人已听到 |
| `audio.queued / drained / stopped` | WebAudio 调度队列、累计入队声音长度、自然排空与主动停止；每 250ms 抽样，scheduled_ms 另属 AudioContext 时基 |
| `audio.capture.started / progress` | 实际音频处理布尔设置、累计采集帧数；每秒抽样，不保存 PCM；帧数不能证明供应商收到 |
| `context.requested / applied`、`session.end` | 更新、结束和白名单错误码；不复制原始错误信息 |
| `session.config` 的语速字段（Task 02） | `speech_pace`、`speech_pace_supported`、`output_speed`、`speed_explicit` 是本会话适配器配置；不证明供应商按该值合成或真人听感合格 |
| `speech.candidate / confirmed`（Task 03） | ASR 首字候选与本地文本确认；不是实际 VAD 起点，也不能证明说话来自学生而非回声 |
| `response.held / released / hold.discarded`（Task 03） | 本地呈现等待／释放／丢弃，held_ms 是网关等待，不是人耳听到的延迟 |
| `cancel.sent / skipped / ignored`（Task 03） | 实际派发、完成／替换后跳过、重复请求；ACK 时间改为实际派发到 ACK，不含排队；skipped 不是供应商确认 |
| `reply.audit`（Task 04） | 中英共享长度、句对及问题计数、完整性与表面顺序提示；打断／缺失／截断文本不判顺序违规，翻译与密度仍需语义审核；不含文本 |

浏览器与网关 at_ms 各自从自己的起点计时，只能在同一 clock 内求间隔，不能跨 clock 相减计算网络或真实插话延迟。WebAudio scheduled_ms 也不能与事件时间相减。导出将回复／话轮 ID 映射为 r1、t1 等，跨 clock 用同一匿名引用关联，不导出原始 ID。

最多保留 2048 条事件和有界匿名映射。超出标记 truncated、discarded_rows；汇总只覆盖保留窗口，不能当作全会话总计。每个场景使用独立短会话。实际说话起点、设备输出延迟、逐字音频同步与误触发判断仍需真人／设备测量。

## 验证

运行 `npm run verify`、`npm run replay`、`npm run baseline:demo`。浏览器可用时运行 `npm run test:browser`，检查默认隐藏、场景加载、未接通报告导出、原生 WebAudio 元数据与停播期间继续采音；输入是 synthetic device，不能替代真实供应商／真机 E01–E09 验收。

本次工程验证：92 项测试通过，3 个合成回放通过，合成诊断示例通过；Chromium 153 使用 synthetic device 通过报告导出、采音元数据、持续采音与页面检查。未调用真实豆包账号，未取得真人 E01–E09 基线。
