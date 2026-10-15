# Actions 真实连接探针

Task 10 的第一部分：使用 GitHub Actions Repository Secret `DOUBAO_API_KEY`，从短期 runner 发起一次真实豆包连接。密钥只传给调用步骤的环境变量，不写入源码、profile、报告或 `.env`。不访问外部 HSKai，不自动调用 Judge 或 Langfuse。

## 范围与协议审核

`seeduplex-connect.profile.json` 从已有 Seeduplex 模板复制，仅将静态连接审核 `reviewed` 标为 true，并添加 `review_scope=static_session_connect_only`。核对依据是 [官方 PDF 与 Demo 映射](seeduplex-integration.md) 和 [官方接入必读](https://docs.volcengine.com/docs/DoubaoVoice/access-mustread?lang=zh)：固定全双工 endpoint、`X-Api-Key`、model `1.2.6.1`、JSON 帧、`session.create`、`session.created/session.id`、显式 PCM 格式和无上行音频时的 `input_audio_mute.commit`。音色沿用官方 Demo 示例；账号是否有此模型和音色权限由本次实际调用检验，不预先认定。

`realtime.reviewed` 与 `realtime.ordered_acks_reviewed` 仍为 false，现有模板保持全部审核开关关闭。这个专用 profile **不能直接启用 Web 语音**。收到会话就绪只证明该次配置建立过真实会话，不证明取消、更新、terminal owner、ASR、语速、教学内容、字幕或设备验收通过。

探针总预算约 5 秒（包含建连），最多 64 个事件／每帧 64 KiB；禁止重定向和压缩，握手超时 5 秒。只发送会话创建、就绪后的静音与退出时的关闭；不上传麦克风或合成音频，不请求模型主动生成回复。首次连接或实际服务运行仍可能计费。不会自动重试失败调用。

## 启动

1. 仓库 Settings → Secrets and variables → Actions → New repository secret，名称 `DOUBAO_API_KEY`，值为已开通语音服务的 Key。不要提交 `.env`。
2. `.github/live/doubao-connect-request.json` 包含固定请求 ID 与审核 profile 的 SHA-256。只有该文件在 main 上变更时才通过 push 启动专用工作流；更改普通业务代码不会调用豆包。首次提交这个文件启动本次已授权测试。
3. 如需复测，可在 Actions 的 **Doubao live connection probe** 中对 main 手动启动，或更新请求 ID 后提交请求文件。每次均为实际调用，避免无目的复跑。
4. 查看 **Live metadata-only connect (5 seconds)** 步骤和 `doubao-connect-metadata` artifact。Artifact 仅保留 3 天。日常 Foundation checks 不使用真实 Key，继续运行离线／合成检查。

## 结果

- `status=passed`：实际观察到 `session.created` 和有效会话 ID，持续到短时预算结束。
- `status=blocked`：缺少 Key，未进行网络调用。
- `status=failed`：传输、协议、供应商错误、主动断线或没有观察到有效就绪；不会把 socket 打开当作成功。
- `http_status`：握手被拒绝时的数字状态码，不能单独断言是无效 Key、缺权限、额度或网络原因。
- 事件记录仅含固定 allowlist 类型、字节数、时间、字段名和每次探针随机盐处理的 ID；不含实际 ID、响应正文、鉴权头、供应商错误文字、逐字稿或音频。
- 退出后 `provider_connected=false` 是连接已清理的正常状态；本次是否就绪看 `session_ready_observed`。
- `voice_behavior_tested`、`real_experience_accepted` 和实时 ACK 审核字段始终 false。

本地可运行 `node scripts/actions-doubao-probe.js --preflight`，不会联网。测试使用虚构 Key 与本地 HTTP／WebSocket peer，覆盖缺密钥、profile hash、阶段边界、真实握手状态与禁止重定向；不代表真实供应商结果。

## 2026-10-10 实际连接结果

首轮 [Actions 运行 38015993713](https://github.com/yqhuang-cyber/ask-kai/actions/runs/38015993713) 使用用户配置的 Repository Secret，candidate `2f488c3a1151b162715ff3495509c718938cb7a2`。观察到真实 `session.created` 和会话 ID，探针启动后约 1930 ms 就绪，达到 5 秒预算，结果 `passed`。这是单次 GitHub runner 的连接样本，不是首音频延迟、P50/P95 或用户本机网络指标。未上传输入音频或评测模型内容。204 项测试、3 个合成回放和 Foundation checks 的 Node 22／24／browser 均通过。

## 后续固定文本输出与控制探针

专用 **Doubao live output and controls probe** 使用同一个静态连接 profile，main 上的 `.github/live/doubao-output-request.json` 更新或手动启动时调用。最大 25 秒，加最多 2 秒关闭 ACK 等待，不自动重试。

流程：创建会话 → 输入静音 → 更新 instructions 并观察 ACK → 官方 `speech_text_buffer.commit` 合成固定「你好。Hello.」 → 观察完整音频／交互终止结构 → 再用 `speech_text_buffer.commit` 合成较长的固定中英测试句 → 收到两个音频块后发送 cancel → 等待 ACK → session.close → 等待真实 session.closed 后关连接。

只验证作者指定文本的 TTS 输出，**不是模型自由生成的教学回复**，也不上传学生音频或评测 ASR。报告仅保留事件结构、同一探针内盐处理的 ID、ACK 形状和 PCM 块数／字节数／非零样本数／理论时长，不保存文本内容或音频。PCM 非零不证明音色、发音或实际听感通过。记录 response.done 是否携带 reply ID，更新／取消 ACK 是否带 event ID、是否回带客户端 event ID；单次观测不会自动授权 Web 或证明所有竞态已通过。

首轮输出 [运行 38016385764](https://github.com/yqhuang-cyber/ask-kai/actions/runs/38016385764) 观察到会话就绪、session.updated 与两个非零 PCM 块，共 34816 字节（理论约 725 ms），随后传输失败。更新 ACK 有 event ID 且 session 相符，但没有回带本次客户端 event ID。audio.started 有 question_id／response_id，随后两个 audio.delta 仅有 type／delta／event_id；现有 Web 适配器的逐块 ID 要求与该实际输出不同，不能直接标记可用。

后续请求增加安全的传输错误类别并将 JSON 音频帧上限调整为 128 KiB，解码后 PCM 仍限制 64 KiB。原先把 JSON/base64 封装和 PCM 共用 64 KiB 上限，无法容纳合法的较大 PCM 块。复测将验证是否存在这个问题；在观察到实际错误类别前，不将其认定为本次中断原因。

第二轮 [运行 38016589939](https://github.com/yqhuang-cyber/ask-kai/actions/runs/38016589939) 已收到完整 5 个 PCM 块，共 118354 字节（理论 2466 ms）；其中一个 JSON 帧为 73798 字节，超过旧的 64 KiB 上限。观察到 audio.done、response.done、session.closed；response.done 顶层仅有 type／event_id／response，没有顶层 response_id。本次 replacement append/commit 在等待预算内没有产生第二段音频，取消测试未进入，不宣称该 API 通用不可用。第三轮改用此前成功的 speech_text_buffer.commit，并记录 response 的字段名和嵌套 ID 是否匹配，不保存内容或实际 ID。

## 2026-10-10 完整输出／控制观测

第三轮 [运行 38016779537](https://github.com/yqhuang-cyber/ask-kai/actions/runs/38016779537)，candidate `36b04aacd2a81f145418e43d9347061488214342`，整体 `passed`。在同一会话中顺序观察到 session.created、session.updated、第一段完整 PCM、第二段 PCM、response.canceled 和 session.closed。第一段为 6 个音频块、131992 字节、理论约 2750 ms；第二段在取消前后收到 6 个块、139264 字节，包含取消在途期间的音频，不能作为客户端实际停播时长。所有音频仅在内存解码计数，未保存／上传音频或逐字稿。

| 实际结构 | 本次结论 | 当时发现的 Web 接入缺口 |
| --- | --- | --- |
| audio.started／audio.done 带 question_id 与 response_id；audio.delta 仅带 type／delta／event_id | 有可观察的回复边界，不能要求所有块都带 ID | 当前 SeeduplexProvider 对每个 audio.delta 调用 reply(raw)，无 ID 时会拒绝。需设计由明确边界绑定的音频归属，并回归取消期间／新回复开始后的迟到块隔离；不能简单套用最近回复 |
| response.done 有 response，但其中仅有 usage；无顶层或嵌套回复 ID | 它是 ID-less 用量／交互终止事件，无法靠 ID 查找已知回复 | 当前 adapter 要求顶层 response_id，实际不匹配。需明确 audio.done 与统计终止的关联及未知／迟到终止策略，避免关闭新回复或伪造学习证据 |
| session.updated 有 session.id 和服务器 event_id，未回带客户端 event_id | 本次唯一待处理更新得到同会话 ACK | 保持唯一 pending 更新与服务器 event ID 去重，继续验证超时／迟到／取消排队，不把 ACK 当语义遵循 |
| response.canceled 只有 type／服务器 event_id，无 response_id，也未回带客户端 event_id | 本次唯一 cancel 得到 ACK | 保持本地停止／旧输出 fence，以及串行控制所有权；单次成功不能证明多轮竞态已校准 |
| session.closed 收到后再关闭 WebSocket | 本轮观察到正常关闭确认 | 与浏览器退出／异常清理策略对照验证 |

本轮 Key、会话配置、选定音色的固定 TTS 生成和串行控制已取得实际观测。原始模板、Web 实时审核和 ordered ACK 审核开关没有修改。上述缺口促成下方适配器修复；持续上行音频、ASR、三种入口的真实模型回复和设备 P0 观察仍待取得。Task 10 仍为进行中；不需要再次提供 Key。

## 适配器修复与专用复测

`SeeduplexProvider` 现已采用明确的音频输出通道：只有带 ID 的 audio.started 才绑定无 ID PCM，取消期间旧通道只丢弃输出；收到取消 ACK 后清理通道。未结束的旧通道或取消屏障期间出现新音频边界会拒绝，关闭过的 ID 不能重新占用通道。该规则依赖连接上有序、独占的边界；没有 ID 的字节无法自行证明供应商在新边界后没有错误混入旧音频。

无 ID response.done 的 response.usage 只作统计，不关闭回复、不确认控制、不形成学生尝试。内部回复输出完成由带 ID 的 audio.done 决定；若文本流已开始，还须等 text.done，保留最后字幕后再完成。内部完成可释放上下文更新，不宣称供应商统计交互已结束。session.close 会立即隔离业务输出，同时最多等 2 秒真实 session.closed，再终止传输。

新增 **Doubao live adapter repair probe**，由 main 上 `.github/live/doubao-adapter-request.json` 变更或手动启动触发。直接使用上述生产适配器和它的归一化事件／updateContext／cancel／close，流程为静音 → 更新 v1 → 完整固定 TTS → 输出边界后更新 v2 → 第二段固定 TTS → 两块后取消 → 取消 ACK 及随后用量事件 → 第三段固定 TTS → 正常关闭。用量事件仅安排探针发起第三段，不被适配器用于推断回复归属。总预算 30 秒，加最多 2 秒关闭等待，不自动重试。

专用探针在内存中建立 `realtime.review_scope=protocol_smoke` 的临时审核配置，仅显式 `protocolProbe:true` 可用；普通 Web 启动拒绝它。原始模板与静态连接 profile 的实时审核字段仍为 false。报告仅含计数、数值状态和固定错误代码，Artifact 保留 3 天。不会保存音频、逐字稿或真实 ID，也不标记 ASR、模型教学、真人设备或 Web 审核通过。

修复的本地回归覆盖无 ID PCM、用量迟到、新旧回复隔离、文本／音频收尾、取消屏障、真实关闭 ACK／超时和 Web 配置隔离，并通过本地 WebSocket peer 验证上述完整探针流程。全部 220 项测试、3 个合成回放和 P0 的 16 个正向／10 个负向场景通过。

## 2026-10-10 修复后实际适配器结果

[Actions 运行 38018674072](https://github.com/yqhuang-cyber/ask-kai/actions/runs/38018674072)，candidate `3e8f0f874783c47d51b4460fdabf315fe9c71cea`，request `adapter-2026-10-10-01`，结果 `passed`。调用经过修复后的 `SeeduplexProvider`；观察到真实 session.ready、上下文 v1／v2 确认、三次不同回复启动、两次输出完成、一次取消确认和 session.closed。

| 归一化输出 | 转发 PCM 块 | 字节数 | 理论 PCM 时长 |
| --- | --- | --- | --- |
| 第一段完整播放 | 5 | 118804 | 2475 ms |
| 第二段取消前输出 | 2 | 43008 | 896 ms |
| 取消后的第三段完整输出 | 6 | 132730 | 2765 ms |

共观察 35 个 wire 帧、23 个无 ID 音频块和 2 个无 ID 用量事件。取消请求发出后又到达 10 个在途音频块，适配器向业务层转发的取消后旧音频为 **0**。随后第三段正常输出，证明本次序列里取消后的输出没有卡死。第一段输出边界后可成功发送第二次上下文更新，无 ID 统计没有造成归属错误；最终关闭获得真实 ACK。

这一次真实样本支持当前固定 TTS／串行控制映射，不能证明所有供应商乱序情况。理论时长不是浏览器播放时长或打断到设备停播延迟。本地缺少 Chromium，浏览器合成检查由对应 [Foundation checks](https://github.com/yqhuang-cyber/ask-kai/actions/runs/38018674069) 执行。ASR、持续学生上行音频、三种入口的模型教学内容、字幕同步、回声／噪声与真人停顿体验尚未验收。实时审核开关保持关闭，Task 10 继续进行。
