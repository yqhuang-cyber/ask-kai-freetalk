# Planner reliability 与豆包当轮控制：第一轮结果

2026-10-14，上一版 88c98f7 已推送 main。本轮完成可替换模型的接口分离、安全诊断、独立对照与真实 Function Calling 实验。M3 可靠性没有验收通过；普通 Web 仍为 next_turn_advisory，controlled 保持关闭。业务数据来自本地 mock HSKai。

## 工程交付与后续模型替换

- Provider-independent planConversation／planTurn、Draft schema／compiler 与 MiniMax JSON transport 分开。实验 Draft 只让 LLM 选择目标、理解意图和规划动作；宿主补齐 KP、明确偏好、实际执行、预算与空的固定答案字段。原权限、版本、取消、迟到隔离和 attempted-only 写回不变。
- 修复与首次请求共享原 10 秒初始化／5 秒逐轮预算，至多两次；记录 request／validation 阶段、时长、大小、token、有限错误码与合法字段名，不保存响应正文或思维链。
- 当前 M3 默认 full_contract_v3；系统 prompt／修复消息与 88c98f7 完全相同，测试核对实际请求。Draft-v5 仅 ASK_KAI_PLANNER_PROTOCOL=draft_v1 或评测 --draft-contract 显式选择；冻结原 adapter 仅用于评测，不进入运行依赖。
- 更强 LLM 替换服务端注册的 transport／adapter，复用业务输入、目标生命周期、策略验证和同一独立数据集。模型名、provider、prompt、Draft 与原 contract 分别留证。当前只核验 MiniMax-M3，没有自动开放任意型号、endpoint 或服务等级。

设计与操作见 [Planner reliability](../planner-reliability-design.md) 和 README 7.1。

## Synthetic 与浏览器回归

npm run verify：394／394 通过，无跳过／取消。npm run replay：normal／interruption／failure 三案通过，synthetic=true、provider_connected=false。

独立离线 eval:goals：12 案／18 轮，初始及逐轮自动行为检查全部通过，全部是明确规则规划，LLM 分母 0。负例涵盖来源／权限注入、策略不符、取消、工具遗漏、规划失败和结果回传前过期。

Chromium 合成设备回归通过：采音持续、字幕、打断、偏好／准备、目标历史及多目标总结等检查通过，page_errors=0，无移动端横向溢出。没有连接真实供应商、真实麦克风、扬声器、AEC 或 FC 浏览器通路。

元数据：[离线结果](2026-10-14-planner-reliability-offline.json)、[浏览器结果](2026-10-14-planner-reliability-browser.json)。

## 真实 M3：同组完整分母

三批都使用冻结的 12 个虚构案例／18 轮及原预算、1600 最大生成 token，不调用豆包、Judge 或真实学习者。期望和未来输入不进入模型，数据／运行源码哈希随各批保存。批次是分别运行的单次样本，不能解释为统计显著对照或最终提交全量真实验收。

| 批次 | 初始化 LLM／规则／失败 | 逐轮 LLM／规则 | 自动初始／逐轮行为检查 | 降级原因 |
| --- | --- | --- | --- | --- |
| 冻结 full-contract prompt-v3 | 4／8／0 | 5／13 | 12/12；18/18，LLM 5/5 | 18 次超时、3 次校验失败 |
| Draft 初版 prompt-v4 | 0／12／0 | 1／17 | 12/12；18/18，LLM 1/1 | 26 次超时、3 次校验失败 |
| Draft 修订 prompt-v5 | 4／8／0 | 4／14 | 12/12；18/18，LLM 4/4 | 21 次超时、1 次校验失败 |

Draft-v4 完整 JSON 返回后多次在引用／长度及业务校验处拒绝；v5 对齐长度，提供宿主派生的 available_refs／goal_options，并明确引用实际 ID。v5 的六次被拒绝尝试分别为来源引用、无效 JSON、已拒绝初始目标、inactive goal assessment、policy 冲突及逐轮契约错误；一次修复不一定能在剩余截止时间完成。这些拒绝次数与最终降级次数不是同一分母。

改进架构没有证明 M3 更可靠，因此不将 Draft 设置为默认。超时是主要降级原因，但有限 HTTP／body 元数据不能定位供应商内部排队、推理或网络原因。完成返回的 reasoning_present 可观察，取消请求的隐藏执行与费用仍未知；不承诺延迟 SLO 或总成本。

自动行为检查只覆盖目标／状态／动作／局部帮助范围。对 v5 四个已接受提案做辅助复核，仍发现需要校准的内容：篮球追问包含两个问题；困难自述被规划成 attempted assessment；先修澄清的指令含内部 goal ID，并给出需要复核的时间表达选项。它们没有升级为独立／掌握或直接写回学习事实，也没有真实语音遵循检查。语义质量、人工校准和独立 Judge 验收仍为 false，旧十维数据与分数未改。

完整元数据：[M3 各批结果](2026-10-14-planner-reliability-m3.json)。私有 accepted-plan review 仅供本地辅助审阅，不提交原始 provider 响应。

## 真实豆包 FC：样本等待成立，正式门控未成立

输入为三句固定作者文本，由本机 macOS say／afconvert 生成 PCM；没有独立外部 TTS 服务，识别与输出仍由豆包实时全双工承担。音频留在 ignored .local；只上传这组已核对来源／哈希的合成输入，不上传麦克风。每个连接只输入一个话轮，继续每 20ms 送音频／静音；不保存 ASR 内容、输出文本／音频、call_id 或原始 wire trace。

| 批次 | 连接与输入 | 计划来源 | 工具前／等待中输出 | 回传后输出 |
| --- | --- | --- | --- | --- |
| 初步 probe-v1 | chat／refusal／switch，3/3 ready | 全部规则 | 均为 0／0 | 3/3 观察到 |
| 最终计时 probe-v2，规则隔离 | 同三案，3/3 ready | 全部规则 | 均为 0／0 | 3/3 观察到 |
| probe-v2，首次 M3 联调 | chat，1/1 ready | 初始／逐轮均规则降级 | 0／0 | 1/1 观察到 |
| probe-v2，增加降级诊断后的复验 | chat，1/1 ready | 初始超时降级；逐轮 LLM 接受 | 0／0 | 1/1 观察到 |

共 8 次真实连接，均结束于 reply_output_done 并收到 session.closed。不同版本／规则／LLM 样本分开报告，不能合并为 8 次 M3 成功。v1 接受时间包含 intentional hold，v2 分开记录计划接受／结果发送，并在回传前重新校验有效期。

最终规则三案接受后等待约 1.2 秒，等待期间持续上送分别 58／58／57 帧，均没有观察到文本或音频输出。最后一个 M3 样本从工具等待开始至计划接受约 3704ms；结果发送后约 724ms 观察到首次输出。其初始化请求约 9950ms 被取消并降级，逐轮 HTTP 完成约 3679ms、输出 JSON 739 bytes、completion_tokens=170。前一个 M3 联调样本在约 5 秒后接受规则计划，必须保留为降级分母。

实验验证 call_id 配对回传和所测样本的外部输出时序。没有官方每轮强制工具调用保证，只有提示词要求；单输入连接不验证跨轮归属、真实打断、新输入并行、重连或失败后供应商绕过。相关取消／迟到／失败负例目前来自 synthetic peer。输出事件晚于结果不证明供应商内部生成起点，亦不证明听到、教学语义或回复遵循。

mandatory_tool_api_verified、current_turn_generation_gate_verified、real_experience_accepted 均保持 false。普通 adapter 的 tools 禁止与 controlled 硬门槛不放宽。完整元数据：[FC 各批结果](2026-10-14-planner-reliability-fc.json)；官方契约与范围见 [控制核验](../protocol/seeduplex-planning-control.md)。

## 下一步

这一轮完成接口和实验交付，完整动态规划验收尚未完成。后续优先用更强 LLM 在相同契约与独立案例中验证目标选择、语义与截止可靠性；模型质量改善必须单独比较，不能通过规则兜底算成功。豆包继续核验每轮强制规划的准确契约，并做多轮／打断／工具遗漏与失败的真实对抗实验；满足归属和失败控制后才建设正式 Web controlled 路径。真实设备与播放、语义 KP 观察仍单独验收。
