# Agent 后续四项：实现与边界

2026-10-14，基于 6b7e4cf。用户确认先推进原始评测上下文与 ObservationPort，再完善降级与长会话。新 LLM 未确定；本轮仅完成可替换的工程与 synthetic 验证，不自动启用模型观察、不调用外部 ASR／TTS，不启用 controlled。

## 1. 原始规划上下文

PlanningState 的 opt-in onAcceptedProposal 在提案通过来源／策略／时效验证后、应用 goal patch 前，提供 immutable 的真实输入与对应提案。新输入／撤权／退出造成取消的提案不进入 hook；hook 失败不控制教学运行。普通 Web 不设置 hook，不因此保存真实逐字稿。

合成 goal-eval 的私有 artifact 升为 synthetic-planning-review-v2：包含 dataset hash、原始输入 snapshot、snapshot hash、提案及 hash，并绑定 session、turn、source_event_id、input revision、planning revision、authorization epoch 与原会话计划 revision。每批 artifact 保留 content-addressed 文件，review.json 只代表最近批次。

审阅输入来自该 snapshot 的整体计划、实际前文、prior execution、learner feedback、三类学生资料、coverage、policy、language、resource 与 goal review。不能从接受后的状态、后续播放报告或评测期望重建。缺绑定／缺字段／hash 不符／重复行拒绝；旧不完整 array artifact 不直接进入新命令，不回填历史缺口。

npm run eval:goals -- --capture-review 可离线保存 18 个规则提案的原始快照。npm run review:planning -- --preflight 只检查绑定，无 key／模型调用要求；完整字段存在不等于 coverage 全 available 或实际听到。常规 review:planning 只审阅该 bundle 中实际 LLM 提案，至多一次 12 秒审阅，人工／独立质量验收仍 false。文件在 ignored .local，不能提交正文／实际学习者输入。

## 2. ObservationPort candidate lifecycle

JsonObservationPort 接受同一授权话轮的原始表达、实际前文、当前目标 KP 与结构反馈；模型独立返回 kp_id、relation、semantic_fit、Unicode code point span。接口不接受掌握、独立程度、提示程度、身份或其他话轮作为表达来源。字段／KP／范围／明确引语、转述、自述和疑问冲突校验只证明候选结构，不证明语义正确。

ObservationCoordinator 使用源输入、原 goal／plan revision、input revision、planning revision、authorization epoch 与 hash。新输入、更正、偏好更新、目标修订、退出、截止和忽略 abort 的迟到 adapter 都不能落入新候选。候选状态包括 candidate_validated、rejected、cancelled、stale、timeout。

当前仅 shadow：候选不加入 Planner 输入、不修改目标／attempts、不改变 HSKai 记录和总结，不影响学习事实。它是候选提出→出处／权限校验→接纳或拒绝→评测的闭环，通用语义质量和候选转为学习事实的校准仍未完成。

默认 port=null，没有模型请求。服务器需明确注入 observationPort 才运行；普通 Web 未开启，未自动复用 M3 key。候选调用与规划并行，默认至多 2 秒且不超过源话轮剩余预算，不增加初始化 10 秒／逐轮 5 秒。以后的更强 LLM 替换 transport，再分别验收语义、延迟与取消。

## 3. 保守降级

fallback policy v2 按已接受 policy／feedback 区分困难、必要澄清、拒绝／换题、理解求助、局部表达求助、明确练习、最小对话承接、教师转述、实际尝试与暂停交流。仍只给一个低压动作，new_points=0、goal_assessment=null、固定答案 null；一般未知不由规则猜成能力或学习结论。

转述回应不把教师的话改写成学生喜好；困难先降低本轮负担，连续两轮才考虑现有先修目标。求助只本轮有效，明确选择仍受资源／先修校验。支架字段是执行建议，不是实际提示／播放事实。

## 4. 长会话与目标恢复修复

独立新增三个完整序列，topic 16 轮、free 14 轮、mission 14 轮，共 44 轮；覆盖实际尝试、困难、拒绝、转述、求助及失效、恢复、目标切换／停止、未知先修和结束，并核对最终有来源总结。期望只在执行后检查，不进入模型输入。teacher reply 仅作为作者声明的 synthetic 输出事件，不是参考答案或真实供应商连接。

发现并复现旧 PlanningState 缺口：喜好目标停止后，明确选择时间练习，再连续报告困难，会自动退回已停止的喜好目标。现在会内 session_declined_goal_ids 保存明确拒绝／停止目标；普通困难降级与模型 replace 都不得自动恢复，只有当前明确选择或原目标的明确恢复才能解除。Goal policy 升 v2，Agent reasoning 升 v2、prompt 升 v7；原 backend learning evidence 与记录 v2 不改。

这些拒绝记录限于当前会话，不等于已持久化的学习偏好。跨会话业务持久化仍为原 POC 范围，不能从 Mock 回执推断真人数据或服务完成。

本轮验证见 [结果报告](eval-results/2026-10-14-agent-four-tasks.md)。
