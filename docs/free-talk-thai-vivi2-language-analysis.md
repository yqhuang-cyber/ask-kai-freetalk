# Vivi 2.0、多语种参数与泰语输入

2026-10-29。核对用户截图和[指定音色列表](https://docs.volcengine.com/docs/doubao-voice/tone-list-3?lang=zh)。本轮仅研究，没有修改运行配置、没有向现有 S2S 添加新参数，也没有开通或实测新 ASR/TTS 服务。

## 文档中的关键边界

截图确有 Vivi 2.0 和多语种能力，覆盖泰语。但同一注释明确把该新增参数限定在单向流/双向流，并排除 S2S。合并音色表不意味着表中每项能力都适用于所有列出的产品。

对照[双向流式 TTS](https://docs.volcengine.com/docs/doubao-voice/websocket-bidirectional-streaming-v3?lang=en)和[配置 TTS](https://docs.volcengine.com/docs/real-time-communication/configure-tts?lang=zh)可定位参数：

- `enable_language_detector` 位于语音合成的 additions 配置，默认 false。这里的输入是待朗读文本；它帮助 TTS 选择合适语言处理文本，不是麦克风 ASR。
- 双向流式 TTS 的请求包含 `req_params.text` 和 `req_params.speaker`，意为文本流输入、音频流输出。它与当前输入音频的 Seeduplex 全双工对话不是同一接口。
- 独立 TTS 2.0 使用 `seed-tts-2.0` 资源及对应音色，具体请求封装和字段类型须按选定 API 实现，不把不同版本的参数结构混用。
- 文档音色表写作 `explicitlanguage`，API 文档另有 `explicit_language` 等具体路径；实现需以目标接口参数表为准，不直接把音色说明文字当作当前 `session.create` 的参数名。

当前本机中泰配置已为 `zh_female_vv_uranus_bigtts`，就是 Vivi 2.0；原生语音对话模型仍为 `1.2.6.1`，输入为 16 kHz PCM。换音色没有把原生识别切换成独立多语种 ASR。

## 想用 Vivi 2.0 支持中泰对话，需要两种不同的语言识别

| 环节 | 输入与输出 | 需要的能力 |
| --- | --- | --- |
| ASR | learner 的中文/泰语声音 → 转写 | 语音识别，准确处理实际说的话 |
| Agent | 转写及会话状态 → 中文/泰语回复文本 | 跟随学生意图，维持中文学习与中泰回复规则 |
| TTS | 回复文本 → Vivi 2.0 音频 | 识别待朗读文本的语种并合成，不能替代前面的 ASR |

ASR 可验证火山独立多语种识别的 `audio.language=th-TH` 或 `enable_auto_lang=true`；[官方 ASR 文档](https://docs.volcengine.com/docs/doubao-voice/large-model-streaming-automatic-speech-recognition-api-1?lang=zh)将这些多语种能力限制在流式输入 `bigmodel_nostream` 模式。其“自动识别”与 TTS 的同名概念属于不同产品、不同参数。自动判断一段音频的语言也不保证一句话中泰语/中文混说都准确。

## 可执行的独立 Spike 范围

1. **输入先行**：确认当前账号的独立 ASR 权限，作者音频覆盖纯中文、纯泰语、轮间切换、句内混说。分别记录准确转写、可用结果延迟和无结果；不以“返回某段文字”作为成功标准。
2. **Vivi 输出**：独立 TTS 2.0 使用 `speaker=zh_female_vv_uranus_bigtts`，在对应 TTS 配置启用 `enable_language_detector=true`，分别测纯中文、纯泰语和中文后泰语。测回听、字幕对齐、首音延迟及取消。是否能同一请求自然读好中泰混文需要实测，不能由语种列表直接保证。
3. **接入 Agent**：ASR 的可信转写交给中泰独立会话，由 Agent 生成双语正文，逐段送 TTS；原中英和教师助教仍走原链路。多 ASR 结果或 TTS 音频必须绑定正确话轮，插话后取消旧回复，避免当前 S2S 同时基于原始音频生成第二份回答。

这条候选可保留用户选定的 Vivi 声音，但属于中泰专用语音链路改造，并非给当前全双工接口加一个开关。全双工原生的判停、抗干扰、取消和延迟效果需要重新验证；不能沿用旧链路的验收结论。

## 本轮证据

- 用户截图已核对：音色、30+ 语种说明与 S2S 排除条款均可见。
- 官方音色页已取得正文；部分 TTS 接口正文直接抓取只有页面外壳或超时，参数位置使用同一官方页面的搜索索引与官方 RTC TTS 配置交叉核对，没有依赖第三方博客或猜测协议。
- 本地只读取当前中泰配置元数据：voice、model、protocol、音频格式；未输出密钥，未修改 profile。
- 没有新增真实 provider 调用、合成浏览器或真人听感测试。本次为接入分析。
