# Dynamic goal lifecycle：实施规则

2026-10-14。保持独立 mock HSKai、MiniMax M3 与豆包实时全双工。本文细化动态规划设计第 6／10／15 节；实际语音路径仍为 `next_turn_advisory`。

## 目标与权限

整体目标与一轮表达求助分开。学生的明确选择优先于 Planner；Planner 只提出调整建议，宿主校验当前输入、资源、先修、拒绝和版本后提交。换题／拒绝立即暂停，不等待模型；关键词重现不能恢复。明确取消目标使其 retired，随后普通交流没有目标。主动恢复或明确提出新的练习才能重新 active。

替换目标只接受当前输入明确选择的可信资源目标，或连续两轮明确表示当前练习太难后，退回资源声明的先修目标。英文／单词／沉默不算困难证据。先降低问题与支架难度；不自动提高难度、连续加目标或把拒绝解释成换个目标继续考。

Free 初始化仍为 null；一次表达求助只产生本轮 local_help_target。2026-10-15 修正：free 的准备、消费及逐轮规划不读取课程资源或 Topic Pack，只使用三类授权学习者资料、实际对话和宿主通用 Skill catalog。学生明确要求持续练习时，验证 catalog 中技能的先修并修订计划，mode 保持 free；`resource:null`、`resource_refs:[]`，技能版本记入 `skill_catalog_ref`，GoalInstance 使用 `catalog_ref`。不需要课程读取权限或 Topic Manager 在线。未知技能继续局部帮助，不捏造课程。新输入、退出、打断或撤权仍使未完成规划失效。通用技能的观察规则当前为 unassessed；不把聊天关键词套入运动规则，不累计尝试或升级掌握。

## 证据与达成

资源绑定版本化 success_rule_ref，而不是模型自由填写成功条件。本期喜好／时间规则要求至少两个不同交流机会的语义合适表达、明确的提示范围、无完整句型示范依赖及经复核的上下文变化。次数本身不能证明独立／迁移／达成。

当前观察器只识别有来源的限定直接表达尝试，state 始终 attempted，提示程度 unknown。教师转述、引语、困难自述、疑问、否定和明确自我更正不计作尝试；库外改述返回未评估，不推断不会。learner_feedback 带实际最近不同话轮输出的匹配范围，转发／客户端完成都不能证明先于学生说话。success assessment 返回尝试数和缺失证据；没有独立语义复核、可核验提示范围与实际呈现时，session_achieved 不可提交。Planner 不能将 progress 或“我会了”直接转为学习结论。attempted assessment 还必须引用当前目标 observed_attempts 中的实际观察／输入来源；仅引用困难输入、后端历史或目标 ID 不足以通过。首次有效尝试后建议减少完整示范、继续内容交流，仍允许学生主动求助。

每条观察绑定当时 goal_id、plan_revision 与 attempt_rule_ref；目标替换不改写旧观察。更正同一 final 替换候选，不增加次数。总结保留会中涉及目标及状态；未达成的 active 目标结束为 unverified，paused／retired 保持原状态。保存仍需学生主动选择，只有最小 attempted 记录进入 mock，不升级后端能力状态。

## 评测

冻结独立案例的当前输入与人工编写的行为约束，和 Planner prompt／参考答案分开；不向 Planner 发送未来输入与评分标准。自动检查目标选择、控制权、局部求助、难度调整和来源边界；明确将规则检查与语义人工审阅分开。记录原始提案的安全投影、可枚举拒绝原因、完整 LLM／降级分母；不把规则 fallback 当作 M3 通过，也不据此给实际语音内容评分。

## 语音限制

本期目标状态、页面和后续输入指令来自同一计划。目标修订不证明豆包已开始的当轮自动输出采用了新计划。生成门控须有官方字段及当前账号时序证据；`controlled` 保持关闭，独立 ASR／TTS 不在本轮范围。

2026-10-14 后续修复：session_declined_goal_ids 保留会内明确拒绝／停止的目标；困难降级或模型 replace 不能自动恢复它们。只有当前明确选择／原目标的明确恢复可以解除。原观察及其 goal／revision 不重标，版本升为 kai-goal-lifecycle-v2。见 [长会话结果](eval-results/2026-10-14-agent-four-tasks.md)。
