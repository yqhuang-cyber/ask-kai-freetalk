# 教师端完善第一阶段：AI 前置备课

日期：2026-10-26。开发分支：`codex/teacher-ai-planning`，基于已推送的最小 Demo / G0 提交 `606227d`。本阶段先在独立工作树实现，现已按用户要求合并回主干并更新原 4330 Demo；保留原数据库记录、cookie 与预置点餐路径。

## 这次完善的能力

老师提供主题、表达类型、课后要求和可选指定句式；AI 先生成主题教学包，再为当前一名学生生成 1～3 个练习目标。老师查看、修改目标和具体要求、确认截止时间后发布。Kai 消费该不可变计划的主题、角色、目标、交流机会与支持方式。

这属于教师端完善中的备课 / 作业设计，也把已确认计划交给 Kai。不是完整教师工作台：本阶段仍只开放一位教师 / 一位学生；多人分层、班级分析、报告复核、自动评级、教学包缓存与长期学习证据接入继续后移。

当前学生资料只有获准读取的本地 Mock HSK 等级。包生成不接收学生标识 / 等级；个人规划接收裁剪后的等级与“近期证据缺失”声明，不能把模拟等级推断成具体薄弱点。教师确认用于采用草案，不表示自动教学 / 评估质量已经验证。

## 试用

合并后的主入口为 [原 Demo 4330](http://127.0.0.1:4330)，已启用 AI 前置备课，同时保留预置点餐与原记录。独立开发验收入口 [4331](http://127.0.0.1:4331) 继续使用另一数据库和 `ask_kai_ta_ai_session` cookie，避免两者相互覆盖。

选择林老师，在“AI 前置备课”中：

1. 填主题；选餐厅点餐、描述观察、经历 / 剧情 / 指定句式或其他交流方向；写课后要求。
2. 点击“让 AI 准备草案”。页面分别显示等待、生成教学包、规划个人目标；失败 / 超时明确显示，不回退成冒充 AI 的预置内容。
3. 核对角色、上下文、开场、词语例句、交流机会和练习目标。可编辑目标标题、给学生的要求、教师观察标准，再保存。
4. 确认截止时间和采用这份草案，点击发布。改动 brief 后旧草案不能直接发布，需要重新生成；更改目标后需要先保存新 hash。
5. 切到 Maya，看到已发布的新主题，进入作业对话；结束 / 明确提交 / 双端反馈继续使用最小 Demo 的语义。

例如“昆虫”选择描述观察；“再也不”选择经历 / 剧情并填写指定句式。老师仍负责确定它是句式练习还是具体剧情，程序不把某个短语硬编码成唯一剧情类别。

页面保留下方原预置点餐路径。生成的其他主题可以对话，但自动反馈只覆盖有限点餐表达；昆虫、经历与其他表达保持未评估，不因 AI 出了目标就称学生完成或掌握。

## 配置与运行

```sh
ASK_KAI_TA_TEXT_PROVIDER=minimax \
ASK_KAI_TA_PORT=4331 \
ASK_KAI_TA_COOKIE_NAME=ask_kai_ta_ai_session \
npm run poc:teacher
```

| 配置 | 行为 |
| --- | --- |
| `ASK_KAI_TA_TEXT_PROVIDER` | 默认 `none`；本阶段只注册 `minimax`，与 FreeTalk Planner 配置独立 |
| `MINIMAX_API_KEY` | 服务器本机凭据，只交给业务子进程内存，不存 SQLite / 前端 / 任务 |
| `MINIMAX_BASE_URL` / `MINIMAX_PLANNER_MODEL` | 复用现有已注册 MiniMax-M3 transport 的有限配置，不新增猜测的模型协议 |
| `ASK_KAI_TA_COOKIE_NAME` | 默认原 TA cookie；并行部署显式另取名字。新名字仍要求 `ask_kai_ta_` 前缀及有限格式 |
| `ASK_KAI_TA_DATABASE` | 默认原 TA 本机路径；独立试用 4331 指定工作树内 `.local/teacher-ai-planning/homework.sqlite` |
| `ASK_KAI_TA_VOICE_PROFILE` | 使用已审核 profile；工作树中若原路径是相对路径，应显式给出可读的绝对路径，不复制 / 改写原 profile |

未配置文本 AI 时，页面显示未配置，预置路径仍可用。没有产品侧 synthetic 生成开关；合成只由测试注入，教学包与后续教师编辑都继续保留合成来源标识。

## 实际实现与边界

| 模块 | 实现 |
| --- | --- |
| `planning-contract.js` / `capabilities.js` | TeacherBrief、有限能力目录、教学包及个人计划校验；模型只能引用允许能力和真实机会 ID |
| `ai-plan-source.js` | 两阶段 MiniMax 调用；包 60 秒 / 个人计划 30 秒，每阶段最多一次修复、共用本阶段期限；不改旧 transport 的默认预算 |
| `preparations.js` | 持久草案 / 备课 job、教师到学生的授权委托、单 Worker、进度、取消、失败 / 显式重试及 CAS |
| SQLite migration 2 | 新增 drafts / preparation_jobs；旧 publication / assignment / attempt / submission / report 保持原含义 |
| `teacher-planning.js` | brief、进度、草案恢复 / 编辑 / 发布；创建回执丢失后复用请求键，避免重复触发模型 |
| 作业 controller / report | 同时读 v1 预置计划与 v2 生成计划；新主题不被硬改成点餐，反馈仍守有限观察能力 |

新计划 `schema_version=homework-v2`。模型不填写 learner / source / hash / authorization / assessment；宿主补齐身份、来源、能力规则、hash、未评估状态和 grade=null。老师编辑生成计划后标为 teacher_edited，并保留原教学包 / 模型来源。

生成 API 只创建 / 查询已有任务，不在每次轮询里重复调用 AI。每次阶段写入、结果接受和发布重新校验授课关系、auth / deletion epoch、学生等级快照、draft revision 与 run token；取消 / 删除 / 失效后的迟到结果不得覆盖新草案或复活内容。

重启把 running 备课任务标为 interrupted，等待老师显式重试；不会把不确定是否已收费的模型调用自动重发。已完成草案持久化，发布使用已审阅的精确 plan hash，不重新生成。模型错误 / 原始回复 / 完整请求不写入持久任务或普通日志。

本阶段每个草案生成自己的包，尚无跨草案缓存 / 复用；目标及材料经过结构、引用、大小和有限内容守卫，不能据此称通用注入防护、语言事实正确性或教学效果验收。语义是否符合教师意图，仍需教师预览及后续独立质量集。

## 验证

```sh
npm run verify
npm run replay
npm run check:teacher:isolation
npm run test:teacher:browser
npm run test:teacher:planning:browser
npm run probe:teacher:planning -- --live
npm run probe:teacher:browser -- --live --ai
```

本阶段结果见[验收记录](eval-results/2026-10-26-teacher-ai-planning.md)：655 项全量测试通过、三个合成回放通过、Node 22.19 新场景 19 项通过、预置 Demo 和 AI 备课浏览器通过；真实 MiniMax 的昆虫 / 指定句式两案通过结构与范围检查，点餐案通过真实 AI 备课到真实豆包浏览器提交反馈。

合成生成器 / 合成语音浏览器、真实 MiniMax、真实 Doubao / 浏览器音频分别记录。真实语音输入仍是作者生成 TTS 经 Chromium 合成麦克风；不替代正在进行的真人麦克风、听感或教学质量走查。

对应完整 tasking 的 TA-04 / TA-05 / TA-06 / TA-07 / TA-08 仅完成一位学生的必要子集。接下来可分别扩展获准三类学习者资料、多学生差异化、素材准入与教学包复用、质量 / 反馈能力；不要求修改 FreeTalk 入口或 Planner。
