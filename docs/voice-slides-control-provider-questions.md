# 豆包原生 Function Calling：输入归属待确认项

适用：Ask Kai 独立 POC，2026-10-26。供接口对接讨论使用；尚未发送给任何第三方。本文不含真实学习者内容、供应商原始 trace、会话编号或密钥。

后续更新：第四阶段已找到会话级页面操作与可撤销工具权限的受限方案，可以继续默认关闭的工程接入；本文保留为原生来源、完整语义时序及将来扩展的待确认项，不再作为本会话页面动作唯一实现前提。见[最新报告](eval-results/2026-10-26-voice-slides-control-stage4.md)。

## 已观察到的现象

使用 Seeduplex 原生 S2S、模型 1.2.6.1，持续上送 16kHz 作者测试音频。语音输入的 ASR 事件有 item_id，回复文本及音频边界有 question_id／response_id，question_id 可以匹配已观察输入。

实际工具事件的顶层字段只有 type、event_id、items；每个调用只有 name、arguments、call_id。工具 event_id 没有与本地上行事件编号匹配，call_id 也不等于输入编号。按输入 item_id 查询 conversation.item.retrieve，可以得到输入记录，但其中没有 call_id、parent 或对应工具的信息。

原 call_id 配对回传、工具等待时持续输入、两个独立查询同批调用及结果聚合均已有真实观察。session.update 可以在本次样本中更新完整工具集并得到确认。当前问题集中在**如何确认某个工具调用属于哪一个语音输入**。

## 希望确认的协议约定

1. **关联字段**：response.function_call_arguments.done 或其 items 是否支持 question_id／input item_id／response_id 等输入关联字段？是否需要特定配置、版本或功能开通？若不能直接返回，是否有官方定义的查询方式？
2. **生命周期与顺序**：同一输入是否允许多个 FC 批次或多次工具续调？对应输入的完整结束边界是什么？旧输入被新语音打断后，是否仍可能产生迟到 FC；如何从协议上区分旧调用和新调用？请给出可依赖的字段或事件顺序，不仅是提示词建议。
3. **取消与结果**：工具等待中发送 response.cancel 是否应返回 response.canceled？取消的范围是回复、未完成 FC，还是两者？对于已经接受的调用，应用执行已完成而用户又说话时，回传原 call_id 的结果是否仍合法；会归到哪个输入生成回复？
4. **可执行的接入建议**：若当前事件不提供输入关联，官方是否有仍保持原生全双工 S2S、持续采音和插话的受支持方案，能够隔离过期操作并正确处理明确撤销？

## 为什么需要这个约定

例如旧输入要求“上一页”，新输入明确说“算了，不要翻了”。下面是说明问题的合成时序，不是原始 trace：

```text
输入 A 被识别
输入 B 被识别
一个 navigate_slides 调用到达，只有 call_id
```

应用不能仅凭调用到达顺序，把它当成输入 B 的请求；也不能用“目标像 A”猜测归属。这个动作可能在尚未执行时就已经被学习者撤销。call_id 能保证结果回到原调用，但无法单独证明调用来自哪次输入。

我们需要保留：不把迟到动作执行到新请求、不把打断当成页面回滚、已经发生的切页按实际事实反馈。未核验前，普通 Agent 继续禁用这条工具能力；这不表示原生 FC 整体不可用。

相关依据：[官方实时协议](https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh)、[接入必读](https://docs.volcengine.com/docs/DoubaoVoice/access-mustread?lang=zh)、[本仓库技术方案](voice-slides-control-design.md)。
