# 五位学习者与三类 Mock 数据服务

2026-10-14（Asia/Shanghai），数据版本 `mock-learners-v2`。五份完整个人画像、学习画像和近期实例见[学习者画像数据文档](learner-profiles.md)，该文档已加入 README 顶部导航。

上一版 8／12／16／20 项只是交流技能摘要，不是全量 HSK 知识。现在按官网 2025-11 大纲保存累计语法细目索引与完整 11000 条词汇编号；同一学习者的完整档案与每次规划的少量摘要分开。

| 学习者 | UID | 已模拟完成 | 累计模拟掌握语法细目 | 完整目录含待学 | 初始近期记录 |
| --- | --- | --- | ---: | ---: | ---: |
| Alex | `poc-learner` | HSK1 | 70 | 148 | 6 |
| Maya | `mock-maya-hsk3` | HSK3 | 244 | 339 | 6 |
| Dao | `mock-dao-hsk4` | HSK1 | 70 | 148 | 6 |
| Leo | `mock-leo-hsk5` | HSK5 | 409 | 458 | 6 |
| Nina | `mock-nina-hsk7` | HSK7 | 530 | 592 | 6 |

“语法细目”是本目录对大纲表格内容的索引单位，不是把词汇、语法和交际技能混成一个官方知识点计数。Nina 继承一至六级 458 项，再加作者明确指定的 72 项高级已学；七至九级共同的其余 62 项没有全标掌握。

五位均为虚构成年学习者，使用同一演示 owner 与五个独立 UID。Alex、Maya、Leo、Nina 的母语是英语；Dao 的母语是泰语，当前为 HSK1 初学者，中文理解标记为 beginner；UID 的 hsk4 后缀保留为历史身份标识，不表示当前等级。中泰入口默认 Dao，原中英入口仍从名单第一位 Alex 开始。个人背景包括年龄、职业、学习时长、动机、兴趣、运动习惯和交流偏好；学习画像包含累计目录、已完成等级、下一阶段、听说读写译、复习候选及技能摘要；近期记录包含六项独立的观察和作者合成表达。

课程累计证据单独保存在学习档案 `inventory.course_evidence`，不能用六次近期聊天冒充多年课程的学习过程。当前对话尝试写回仍不改变作者设定的累计掌握。

## 三个独立业务接口

同一个本地 HTTP Mock 服务提供三个不同端点，不需要启动三个进程。每条接口都有独立签名 audience 与 scope。

| 内容 | 内部接口（POST） | scope | 网页 BFF（GET） |
| --- | --- | --- | --- |
| 个人画像 | `/internal/ask-kai/personal-profile` | `profile:read` | `/api/learner/personal-profile` |
| 学习画像 | `/internal/ask-kai/learning-profile` | `learning-profile:read` | `/api/learner/learning-profile` |
| 近期学习记录 | `/internal/ask-kai/learning-history` | `learning-history:read` | `/api/learner/learning-history` |

内部请求 body 固定为 `{"operation":"read"}`；身份来自服务端签名，body 不接受 UID、owner 或 learner 覆盖。BFF 身份来自 HttpOnly 授权 cookie；query 不允许另传身份。网页还发送当前 Mock UID 提示，服务端只用它拒绝与签名身份不一致的请求，不能用它改写身份；其他标签页更换共享 cookie 时会失败而不会读取或修改错人资料。

响应为 `learner-part-v1`，学习画像另含完整 `inventory`（语法细目、状态、课程证据、词汇参照）；响应包含 `part`、`uid`、`owner_id`、`learner_id`、`snapshot_id`、`revision`、`fixture_version`、`as_of`、`source:mock_hskai`、`coverage` 和 `data`。历史响应另含 `history_page`。三个响应的 UID、owner、快照、revision 和 fixture_version 必须一致才能聚合；版本混用最多重新读取一次，持续不一致则失败。

`HskaiPlanningPort.read()` 通过 `HskaiLearnerDataPort` 并行读取三条接口，校验后组合为 `learner-context-v1`；模型只读取累计摘要、能力和相关技能，完整大纲索引不送入每次规划请求。学习画像接口最大响应 512 KiB，运行上下文仍限 24 KiB、20 项交流技能与 10 条近期记录。原聚合 `/internal/ask-kai/planning` context 操作保留兼容；正常 Mock 规划读取已走三个接口。

## 网页切换与数据生命周期

页面提供 Alex／Maya／Leo／Nina／Dao 下拉选择和“当前学习者的三类 Mock 资料”面板。开始或连接中的会话锁定学习者；结束后可切换。切换会取消旧准备、撤销旧运行授权、清除旧字幕／小结／词卡／保存勾选，再为新 UID 重新授权和读取资料。权限刷新和受保护请求串行执行，避免共享 cookie 在不同 UID 间竞争。

`GET /api/poc/learners` 只列本机五位虚构学习者的选择信息。`POST /api/poc/launch` 接受 `{"uid":"mock-maya-hsk3"}` 或空对象（默认 Alex），UID 必须在 Mock 白名单里。真实 HSKai 路径没有这个选人入口。

偏好更正、新增学习尝试和回执只在进程内存；重启恢复作者 fixture，签名 secret 轮换。隐私擦除接口处理本地偏好与新增尝试，不删除代码中的虚构资料，也不能代表供应商删除。安全回执不代表真人接手。Mock 不保存音频或完整聊天逐字稿。

## 后续差异化与会话对比实施计划

| 阶段 | 工作 | 验收 | 当前状态 |
| --- | --- | --- | --- |
| ML-01 | 四个 UID、三类资料、知识点与模拟证据 | 身份一致、引用存在、不能由尝试升级掌握 | 已实现 |
| ML-02 | 三个签名接口与规划聚合 | scope／owner／UID 隔离，版本冲突重读或失败 | 已实现 |
| ML-03 | 网页切换与资料查看 | 切换清理旧状态，当前会话锁定，移动端可读 | 已实现 |
| ML-04 | 分层运动课程资源与初始化目标 | 四档的目标、难度与支架有证据；同兴趣对照排除选题干扰 | 待实施；与动态规划工作协调 |
| ML-05 | 能力摘要到语音指令与逐轮适配 | 实际输出难度与学生能力匹配；保留后续输入建议的边界 | 待实施 |
| ML-06 | 独立网页会话对比 | 两次会话有稳定身份／版本／来源，可以并排查看 | 待实施 |

本次只是资料与业务集成，不扩展运动目标，不修改正在迭代的 Planner 选择策略。当前资源仍只有喜好和时间两个目标，因此 HSK3／5／7 不保证得到不同的主要目标；全部已有独立证据时，规则仍可能回选旧目标。知识画像里的高阶知识点不是自动新增的可信课程目标。

### 会话对比建议作为独立功能

独立的评测页管理会话 A／B，而不是把两人的聊天合并成一份学习历史。每次会话绑定 `learner_id`、画像 revision／fixture_version、主题与资源版本、初始计划、Planner 版本、语速、真实／合成来源、开始结束时间和执行状态。对比维度为内容切入、初始目标、语言难度、支架、追问深度和实际尝试。

第一版应提供“同运动主题，各自兴趣”及“同篮球子话题、同开场输入”两种比较。逐字稿留存必须由用户在评测入口主动开启；默认仍不保存，音频默认不保存，禁止把真人逐字稿写入 Git。先做页面内存的有界会话列表和用户主动导出，明确刷新清空；跨刷新持久化另行设计删除和权限边界。导出与历史缓存必须保留真实／合成标签，不能把计划或老师输出作为学习者成绩。

本轮没有实现聊天归档或并排对比，因此切换前一位学习者的小结会清除；需要留存完整两次会话时，应先完成 ML-06。

## 验证

- 合成／本地契约：`npm run verify` 433／433 通过、`npm run replay` 三个场景通过；新增四账号、三接口、独立权限、UID 注入拒绝、版本竞态重读、偏好／尝试隔离、掌握不升级、历史截断与初始化数据检查。
- 浏览器：`npm run test:browser` 使用 Chromium 合成设备，无真实 provider；覆盖四档切换、三类资料、移动端、旧偏好管理及动态准备。
- 真实模型／provider 与真人浏览器音频：本轮未调用、未验收，不以合成检查代替。

实现入口：`apps/hskai-mock/src/learner-accounts.js`、`packages/contracts/learner-data.js`、`packages/hskai-bridge/learner-data-port.js`。
