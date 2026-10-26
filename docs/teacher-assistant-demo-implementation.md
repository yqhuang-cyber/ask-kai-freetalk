# 主题对话作业最小 Demo：实施与试用

日期：2026-10-26。G0 已通过，MD-01～MD-07 的最小功能已实现；MD-08 工程检查及真实豆包浏览器链路通过，真人麦克风 / 设备听感走查待验。因此 G-Demo-E 通过，G-Demo-L 保留真人走查这一项，完整 TA backlog 未整体完成。

## 现在可以做什么

林老师预览并确认预置点餐计划，选择截止时间并发布给 Maya。Maya 在独立学生端看到任务，与扮演服务员的 Kai 练习；结束先停采音 / 播放，然后明确点击提交。报告异步生成，学生看到描述性反馈，教师额外看到有界识别片段及来源引用。双方都没有 A/B/C/D。

两个要求是“点一种食物”“说明一种口味要求”。没有说口味，报告就不会预写成完成；无法判断的改述显示尚未评估。所有结果只描述本次可核实的表达尝试，不宣称独立完成、掌握或发音诊断。模拟账号与授课关系、预置计划、真实语音分别标识。

## 启动与五步试用

项目要求 Node >=22.19.0。SQLite 已在 Node 22.19.0 和本机 Node 24.18.0 实测；Node 22 的 SQLite experimental 提示不代表测试失败。原 FreeTalk 的启动要求、代码和命令保持原样。

```sh
npm run poc:teacher
```

打开 [课后练习助教](http://127.0.0.1:4330)。新应用独立监听 4330，原 FreeTalk 继续使用自己的 4310 和 `npm run poc`。

1. 选择“林老师 · 教师端”，预览两项要求、Maya 和截止时间，勾选确认后发布。
2. 切换演示身份到 Maya，打开本人任务，点击“开始主题对话”。
3. 等待真实语音实际就绪并允许麦克风，练习点餐和口味表达；可求助、打断、调速和切换拼音。
4. 点击“结束这次练习”，确认采音和播放已停，再点击“提交这次练习”。告别、断线、关闭页面都不会自动提交。
5. 学生看反馈；切回林老师，查看 1/1 提交状态和同次尝试的报告。报告尚未生成会显示处理中；失败由教师显式重试。

同一发布请求重复点击不重复发布。要发布另一份独立练习，点击“另建一次练习”，重新确认截止时间和要求后发布；历史发布保持原版本。当前一个分配只接收一次提交，重练 / 择次提交后续实现。测试使用临时库，不把测试的已提交作业写进试用库。

## 配置

| 配置 | 实际行为 |
| --- | --- |
| `ASK_KAI_TA_PORT` | 默认 4330；固定只监听 127.0.0.1 |
| `ASK_KAI_TA_DATABASE` | 默认 `.local/teacher-assistant/homework.sqlite`，SQLite 只由独立 Mock 业务进程访问 |
| `ASK_KAI_TA_PROVIDER` | `doubao` 或 `none`；存在配置的 profile 时默认 doubao，否则为 none；none 仍可发布 / 查看任务，不开放开聊 |
| `ASK_KAI_TA_VOICE_PROFILE` | 新场景专属已审核 profile；省略时只读复用已有 `DOUBAO_REALTIME_PROFILE`，不修改该文件或旧应用配置 |

凭据仍从已审核 profile 指定的服务器环境变量读取，不进入前端或数据库。没有合成 provider 的产品开关；合成能力只由测试注入，并且正式就绪守卫拒绝用合成事件开启麦克风。新场景没有调用 MiniMax 逐轮 Planner，`planning_strategy=fixed_task`；AI 备课、多人分层及通用语义分析尚未实现。

## 实际架构与扩展边界

| 位置 | 职责 |
| --- | --- |
| `apps/teacher-assistant` | 四个独立视图、同源 API、专属 WS 路径 / 协议及语音配置 |
| `apps/hskai-mock/src/teacher-assistant` | 唯一业务权威：Mock actor、授课关系、授权 epoch、发布 / 提交事务、SQLite 和报告任务 |
| `packages/hskai-bridge/homework-port.js` | 有随机服务凭据的内部回环 HTTP 端口；管理业务子进程；不扩宽旧 learner assertion |
| `packages/teacher-assistant` | PlanSource、正式最小契约、固定作业 controller、证据账本及 ReportAnalyzer |
| `apps/realtime-gateway/src/realtime.js` | 只增加可选 controller / 路径 / 协议 / lifecycle 注入点；默认仍为原 TeachingSession |

这是完整技术方案的最小切片：actor / publication / assignment / attempt / submission / job / report 的职责已分开，实体以有版本的 JSON envelope 放在独立表中。授课关系保存在 Mock actor 的授权名单中，当前由服务校验引用关系，尚未建设完整关系表、SQL 外键体系或通用队列。包和个人计划随不可变 publication 固定，摘要 hash 同时用于任务、会话、证据和报告；后续独立资源目录仍可沿这个绑定扩展。

Mock 身份使用服务生成的随机不透明会话令牌，数据库仅保存令牌 hash 与 actor / epoch / 有效期。内部 HTTP 服务用另一份进程级随机凭据隔离；没有复用旧 bridge 的 learner-only audience。cookie 为 `ask_kai_ta_session`，HttpOnly / SameSite=Strict / Path=/api/ta；Host / Origin / 跨站请求校验独立于端口。

计划来源可通过 `PlanSource.prepare(brief, learnerContext)` 替换；runtime 只读已发布计划。报告来源通过 `ReportAnalyzer.analyze(plan, snapshot, attempt)` 替换，支持异步实现；报告提交前重新核对 epoch、publication、submission 与 source fence。新的学生由授权数据和分配建模，不以姓名分支判断。当前契约校验器有意限制为点餐的两项目标能力；新主题需增加并验证资源 / 观察规则，不能仅改标签就宣称支持。

报告任务与 submission 同一 SQLite 事务提交。单个业务进程每 250ms 领取少量报告任务并串行执行，重启保留已提交数据，将未完成的确定性本地规则任务重新置为 pending；失败保留提交，等待显式重试。未来接入外部模型时，要补独立任务租约、调用费用 / 中断状态和模型验证，不能照搬本地确定性任务的自动恢复策略。

尝试准备租约 30 秒；WS 握手再次验证。活动会话每 3 秒续期，业务租约 6 秒，读取 / 提交 / report commit 重新查授权；换人或退出主动终止。撤销 / 删除会阻止迟到写入，异步报告不能复活已删除的 job。业务服务故障会关闭新场景会话，原 FreeTalk 不依赖这个进程。

## 数据与证据

业务库不保存原音频、原始 provider payload 或整场逐字稿。最多保留 24 条受限目标表达片段（每条 <=160 字）、12 条求助事件引用、24 条转发回复终态和计数 / 截断标志。转发不等于听到；支持因果一律 unknown，播放确认不据此推断真人听到。授权 / 安全终止不产生可提交证据。

SQLite 目录新建权限 0700、数据库 0600，启用 WAL、busy timeout 和 secure_delete。基本删除增加 auth / deletion epoch 并清除相关尝试、提交、job 与报告；**不把逻辑删除当作 WAL、备份和磁盘的安全物理擦除证明**。完整保留期、清理界面及生产合规治理仍在后续 TA 范围。试用库和截图均在 ignored `.local`；不要提交真人对话数据。

有限规则支持明确的“我要一碗面条”“给我一份炒饭”“不要辣”“我喜欢清淡”等完整表达；单关键词、引语、转述、否定点单、疑问、明确不确定和范围外改述保持未评估。“不要辣”是合法口味要求，不与否定点单混淆。识别文本可能出错，未建立语音准确率或教学效果结论。

## 检查与验收

```sh
npm run verify
npm run replay
npm run check:teacher:isolation
npm run test:teacher
npm run test:teacher:browser
npm run test:browser
```

合成浏览器检查真实执行本地业务、SQLite、浏览器 AudioWorklet / AudioContext 和渐进拼音字幕；只在测试里显式替换 readiness 依赖以使用 Chromium 合成设备。另先验证正式 readiness 会拒绝 synthetic。覆盖发布、本人任务、结束停 tracks、明确提交、提交回执丢失后查询、双端不同投影、移动布局和无页面错误。

真实检查默认不会调用 provider；显式开启：

```sh
npm run probe:teacher:browser -- --live
```

需 macOS `say` / `afconvert` 与已配置豆包。这次用作者生成的点餐语音，通过 Chromium 合成麦克风 → 正式新页面 → 正式新 gateway → 真实豆包：观察到真实 ready、1 次输入 final、16 个音频片段、1 次完整回复、拼音字幕、结束停 tracks、提交和真实来源反馈；两个目标均有本次表达尝试。没有绕过新页面的真实 readiness，也没有保存原始 provider 跟踪。**这是实际 provider 与浏览器音频检查，不代表真人设备听感验收。**

详细结果见[本次验收记录](eval-results/2026-10-26-teacher-assistant-demo.md)。真人操作按上面的五步走查即可补齐剩余 G-Demo-L；完整 AI 备课 / 教师工作台 / 重练 / 通用反馈 / 教师专属等级沿原 backlog 继续。
