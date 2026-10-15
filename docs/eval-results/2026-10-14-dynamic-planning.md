# 动态规划工程与真实连通验证

2026-10-14（Asia/Shanghai）。本轮交付初始化、会话计划和逐轮 M3 规划的工程实现，语音保留豆包实时全双工。**工程回归通过；完整动态规划质量／本轮受控生成／真实设备验收未通过。** 不覆盖此前的实际录音、作者标注或旧分数。

## 版本与结果文件

旧基线为 `88615712787ac3c547e51e24d1ee11d436485fb4`，[冻结清单](../eval-baselines/dynamic-planning-v1-baseline.json)保留源码与作者数据哈希。各次报告以采集时工作区的源码 SHA-256 绑定；采集时尚未提交，报告也不代表已部署或已通过质量验收。

- [离线规划契约结果](2026-10-14-dynamic-planning-offline.json)：15 个 A～E fixture／入口组合，完全合成，无模型调用。
- [真实 MiniMax M3 提案结果](2026-10-14-dynamic-planning-m3.json)：6 组 A／B 合成 fixture，含合同有效性、阶段分母、降级与匿名时间／HTTP／token 统计。
- [豆包动态初始配置连接探针](2026-10-14-dynamic-planning-voice.json)：一个真实 M3 初始计划及 5 秒豆包连接，只有结构／匿名元数据。
- [Chromium 合成设备结果](2026-10-14-dynamic-planning-browser.json)：页面与原生音频 API 回归，provider_connected=false。

所有报告不含密钥、M3 推理文本、真实学生逐字稿／音频或原始供应商 trace。M3 的源数据是已授权调用的虚构成年学习者 fixture；不是实际 learner。HTTP 与 token 统计不等于账单总量，被取消调用的费用未知。

## 合成工程检查

`npm run verify`：**363／363 通过**，无跳过／取消。新增检查覆盖三类上下文、资源与引用、成对兴趣／学习证据、Mission 非首目标、free 空目标、M3 JSON／取消／一次修复、原目标拒绝／冷却、实际前文、旧规划失效、修订、shadow、准备版本／owner／并发一次性消费、签名 mock HTTP、WebSocket 投影、attempted-only 总结、显式写回回执／幂等及取消、匿名诊断。

`npm run replay`：正常、打断与迟到事件、连接失败三个合成回放通过。保持 synthetic=true／provider_connected=false。

`npm run eval:planning`：15／15 合成 fixture 的运行契约通过，free 初始目标为空。规则选择结果与真实 LLM 语义质量分开；plan_quality、content_score、learning_assessment 为 null。

## 浏览器音频检查

`npm run test:browser` 使用本机 Chromium 合成麦克风。动态准备能依据 B fixture 选择时间表达目标；快速 Mission→free 切换后旧结果不覆盖，free 无词卡／Start Tip；未配置语音不会申请麦克风；保存尝试默认未勾选。原 AudioWorklet、持续采音、PCM、停播、渐进字幕、播放时钟、偏好、更正、总结与页面移动布局均通过，page_errors=0。

这证明本机页面／原生 API 和合成设备路径，没有真人停顿、回声、噪声、豆包双向语音、真实扬声器听感或三个入口新版本纵向验收。原已确认普通 Web 体验不转记为本轮通过。

## 真实 MiniMax M3

首次有界诊断确认 M3 返回 HTTP 200／provider status 0：初始化约 5.2 秒，超过原试点 5 秒；逐轮 1.5 秒被取消。诊断中的空运动目标暴露字段模板过于容易被沿用，随后增加了宿主“有合法候选时必须选择目标”门槛和明确字段说明。此变化没有改作者数据或内容评分。

预算改为初始化 10 秒、逐轮 5 秒后执行六组，保留全部失败与降级，不把它们算成 LLM 通过：

| Fixture / 入口 | 初始化 | 当前目标 | 逐轮提案 |
| --- | --- | --- | --- |
| A / sports | M3 接受 | 喜好表达 | 规则降级，规划超时 |
| A / mission | 初始化未在预算内完成 | 未接受 | 未发起 |
| A / free | M3 接受 | null | M3 接受 |
| B / sports | 规则降级 | 时间表达 | M3 接受 |
| B / mission | M3 接受 | 时间表达 | M3 接受 |
| B / free | M3 接受 | null | M3 接受 |

完整分母：初始化 **4 个 M3 接受／1 个规则降级／1 个失败，共 6 个**；初始化完成后的逐轮 **4 个 M3 接受／1 个规则降级，共 5 个**。共观察 11 个 HTTP 完成响应、2 个取消；有界修复在同一预算中。两阶段都接受 M3 的组合为 3 个，不能把单阶段通过写成完整闭环通过。

提案接受只表示来源／字段／策略契约有效，不表示语义判定、纠错、目标适配或学习效果已通过。B sports 初始化降级的具体提案拒绝原因本轮未保留，不能编造根因。没有独立 Judge API 调用或人工校准；原十维新候选内容分数继续为空。初始化和逐轮的等待／费用还需真实多轮校准。

## 真实豆包连接与执行因果

`npm run probe:planning:voice`：一个 M3 初始整体计划接受后，编译与页面相同的动态上下文，随后通过当前已审核适配配置创建豆包会话。探针观察 socket open 和真实 session.ready，5 秒后正常达到 duration_limit；没有麦克风上传。

报告保留 plan／context／原 profile hash 与 accepted-before-request 顺序。它验证**动态初始指令可以经当前配置建连**，没有测试当前 final 后的生成控制、双向音频、内容遵循或字幕体验。`current_turn_generation_gate_verified=false`、`voice_output_tested=false`、`browser_audio_tested=false`。

当前真实逐轮仍为 `next_turn_advisory`。旧全双工输出的生成起点 unknown，不绑定为 M3 TurnPlan 的受控生成；后续上下文 ACK 不追溯控制本轮。独立 gated provider 的合成调用顺序测试不构成 Seeduplex 账号门控证明，因此 controlled 保持关闭。

## 尚未完成

DP-05 的准确协议与账号门控证据、DP-06 真实先规划后生成、完整动态 KP／局部教学语义观察、播放消费范围、M3 语义校准、原十维新版本内容评分、三个入口真实音频与费用等待验收仍开放。用户确认不使用独立 ASR／TTS，本轮不改变语音选路。

当前可运行版本及回滚方式见[实施记录](../dynamic-planning-implementation.md)，逐项状态见[DP 清单](../dynamic-planning-tasking.md)。
