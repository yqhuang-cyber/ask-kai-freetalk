# Agent 四项后续工程：验证结果

2026-10-14，基于 6b7e4cf。按用户顺序完成原始评测上下文、ObservationPort 候选闭环、明确意图降级与长会话回归。新模型未确定；本轮没有 MiniMax／新 LLM／豆包请求，不将 synthetic 成功计为真实语义或语音验收。

## 交付结果

| 节点 | 工程完成范围 | 仍未验证 |
| --- | --- | --- |
| 1 原始上下文 | 目标修订前 opt-in 捕获 immutable 输入和已接受提案；session／turn／source／revision／epoch／hash 绑定；私有 snapshot-v2 artifact；完整来源块审阅和无模型 preflight | 新版本真实提案／独立 Judge 校准 |
| 2 ObservationPort | 模型无关 JSON port、当前目标 KP、Unicode span、角色冲突、来源／权限、取消／过期及忽略 abort 的迟到结果；默认无 port，仅 shadow | 真实语义分类、候选转为学习事实的校准与更强模型延迟 |
| 3 保守降级 | 困难、澄清、拒绝／换题、理解求助、局部帮助、练习意愿、对话承接、转述与实际尝试各有有限动作；单点、零新点、不推断能力／掌握 | 新语音实际遵循及自然度 |
| 4 长会话 | topic 16／free 14／mission 14 轮，共 44 轮；拒绝、恢复、换目标、停止、先修、求助失效及原目标观察／总结 | 真实长会话设备、生成控制与跨会话生产持久化 |

工作设计与运行命令见 [四项实施](../agent-four-tasks.md)。Goal policy v2、fallback v2、Agent reasoning v2、prompt v7；JSON 规划／学习记录契约仍为既有版本。

## Synthetic 验证

npm run verify：420／420 通过，无跳过／取消。包括目标修订前的原始快照、偏好／播放更新不改旧输入、迟到提案不捕获、私有 artifact 缺字段／错 binding／重复／hash 篡改、候选范围与角色／跨 KP／过期／取消、候选不增加学习事实、规则／模型均不能自动恢复已停止目标等负例。

npm run replay 的 normal／interruption／failure 三案通过，synthetic=true、provider_connected=false。

原 20 案反馈、12 案／18 轮规划离线回归全部通过，固定作者数据与旧评分未改。全为明确规则提案，LLM 成功分母为 0。新增三会话／44 轮逐步约束全部通过，最终总结只保留 attempted／support unknown、有原目标和版本的实际规则观察；学习达成继续 unverified。

原始 review capture 保存了 18 个对应提案的完整快照；preflight 验证 18 行绑定，limited_context=false、missing_context=[]、model_calls_enabled=false。这里的完整是原始来源块存在，不表示数据 coverage 全 available；实际前文没有教师输出时保持空，播放／提示时间仍未知。私有数据只在 ignored .local，不进入提交。

候选 probe 使用明确 synthetic adapter：改述案例形成未校准候选，引语和跨目标 KP 拒绝，忽略 abort 的迟到结果取消；持久化学习事实为 0。该 probe 和测试只验证接口／校验／隔离，不能证明真实模型能理解改述。

元数据：[20 案反馈](2026-10-14-agent-four-tasks-feedback.json)、[原目标回归](2026-10-14-agent-four-tasks-goals.json)、[完整快照 preflight](2026-10-14-agent-four-tasks-preflight.json)、[shadow 候选](2026-10-14-agent-four-tasks-observation.json)、[44 轮序列](2026-10-14-agent-four-tasks-long.json)。

## 长会话发现与修复

旧 PlanningState 可复现：明确练喜好 → 停止该目标 → 明确选择时间表达 → 连续两次表示困难，旧规则自动恢复已停止的喜好目标。复现只加载 6b7e4cf 的旧状态模块，并使用当前共有契约／观察入口；它不是完整旧提交的全量或质量比较。

新 session_declined_goal_ids 将明确拒绝／停止记录为会内约束。困难降级和模型 replace 均不能解除；当前明确选择或对原目标的明确恢复才解除。修复后相同序列保留时间目标，提供更小的低压选择，不自动改练喜好。这条状态仍只限本会话，不冒称跨会话偏好已保存。

三个入口的长序列与 adversarial patch 单测验证修复；旧学习观察保留原 goal／revision，不因目标恢复或替换被改写。来源与复现范围见 [manifest](2026-10-14-agent-four-tasks-manifest.json)。

## 浏览器、真实供应商分别报告

Chromium 合成设备回归通过：持续采音、字幕、打断、偏好／准备、目标历史与总结，page_errors=0，无移动端横向溢出。没有真实供应商连接、真实麦克风、AEC 或听感检查。见 [浏览器元数据](2026-10-14-agent-four-tasks-browser.json)。

本轮真实模型／豆包调用为 0；普通 Web 不开启 ObservationPort，controlled 继续关闭。上一轮 M3 3/18 接受与豆包有限 FC 样本保留为历史结果，没有重标成功或覆盖旧分数。

## 后续接入条件

四项工程完成后，更强 LLM 可复用完整原始 snapshot、规划／观察 port 和独立长会话数据。先验证语义质量、schema／来源、取消及相同 10 秒／5 秒预算，观察候选仍需独立校准，不能仅凭模型 JSON 或辅助评分提升为学习事实。真实当轮控制、提示因果、播放、独立／迁移与实际设备仍单独验收。
