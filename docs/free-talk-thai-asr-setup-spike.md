# 中泰 Free Talk：豆包 ASR 接入配置 Spike

**产品接入更新**：已按用户选择接入[手动中文／泰语输入](free-talk-thai-input-bridge-implementation.md)，这些 ASR 变量现在也供独立中泰运行时使用；设 `ASK_KAI_THAI_INPUT_MODE=native` 可回退。以下保留早期独立配置 Spike 的时间和边界，不代表当前页面仍未接入。[最新分层验证](eval-results/2026-10-29-thai-input-bridge.md)。

2026-10-29。范围是独立 ASR 探针，不启用产品 ASR，不改变现有 S2S、中英或教师助教入口。延续[真实服务验证](eval-results/2026-10-29-thai-asr-s2s-spike.md)。本轮新增本地配置预检，没有重复发送已被拒绝的真实请求。

**后续更新**：用户配置专用 ASR Key 后已完成[真实调用核验](eval-results/2026-10-29-thai-asr-live-check.md)：权限与纯中文／泰语识别通过，混合音频漏中文。下文“尚未配置／403”描述配置前的检查记录，不代表更新后的凭证状态。

## 最小准备

新版鉴权需要 **有 ASR 资源调用权限的 API Key + Resource ID**。API Key 通过 `X-Api-Key` 发送，资源通过 `X-Api-Resource-Id` 发送。新接入官方推荐 ASR 2.0；本次选择小时版 `volc.seedasr.sauc.duration`。[官方一句话识别接口](https://docs.volcengine.com/docs/doubao-voice/unidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)。

服务开通、可用额度及凭证资源权限需要在火山账号中核实。当前 Key 能调用 S2S，并不证明它获准调用独立 ASR。上轮对 ASR 1.0、2.0 小时资源均实测 HTTP 403、资源访问未授权；不能单凭该错误断言账号未开通、未付费或 Key 本身无效。

推荐在本地忽略的 `.env` 中配置以下两项。本轮只改 `.env.example` 注释，不写入真实配置或密钥：

```dotenv
DOUBAO_ASR_API_KEY=<有ASR权限的APIKey>
DOUBAO_ASR_RESOURCE_ID=volc.seedasr.sauc.duration
```

这些环境变量名称是本仓库探针的约定，不是火山要求必须使用的名字。

| 变量 | 必需性 | 当前实现 |
| --- | --- | --- |
| `DOUBAO_ASR_API_KEY` | 推荐独立配置；凭证本身必需 | 独立识别用 Key，发送为 `X-Api-Key`；未设置时尝试已有 `DOUBAO_API_KEY` |
| `DOUBAO_ASR_RESOURCE_ID` | 可选，有默认值 | 默认 ASR 2.0 小时版；发送为 `X-Api-Resource-Id` |
| `DOUBAO_API_KEY` | 现有 S2S 配置，ASR 的兼容回退 | 配了独立 ASR Key 后，识别不再使用它；S2S 保持原配置 |

显式设置了空或非法 ASR Key 时，预检失败，不偷偷改用 S2S Key。Key 存在和预检通过都不代表供应商权限已经通过验证。

探针接受官方列出的四个资源 ID：

| 版本／计费资源 | Resource ID |
| --- | --- |
| 2.0 小时版（默认） | `volc.seedasr.sauc.duration` |
| 2.0 并发版 | `volc.seedasr.sauc.concurrent` |
| 1.0 小时版 | `volc.bigasr.sauc.duration` |
| 1.0 并发版 | `volc.bigasr.sauc.concurrent` |

资源 ID 是调用哪个模型／计费资源的标识，不是密钥。上轮只尝试两个小时资源；并发资源未做真实权限或效果验证。显式设置资源变量后，探针不会在拒绝时擅自换成其他资源。未配置变量时，沿用原实验的默认 2.0 及有限 1.0 访问对照。

## 不需要额外配置的项

- **App ID、Access Token、AK/SK**：当前实现选择新版 API Key 鉴权，不需要额外配置这些旧版凭证。旧鉴权路径是 App ID + Access Token，当前探针没有实现该路径。[新旧鉴权对照](https://docs.volcengine.com/docs/doubao-voice/large-model-streaming-automatic-speech-recognition-api-1?lang=en)。
- **请求编号**：程序每次生成 UUID 作为 `X-Api-Request-Id`，不需要环境变量。兼容头 `X-Api-Sequence: -1` 由探针填写。
- **自定义接口地址**：固定为 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream`。不增加可把凭证发送到任意地址的环境变量。
- **音色**：ASR 只识别语音，没有 Vivi 音色参数；已有 Vivi 2.0 保留给 S2S 输出。现有 S2S profile 也不是独立 ASR 必需配置。

## 中文、泰语和自动语种

本次选择官方“一句话识别／流式输入”模式；说完后返回整句结果，区别于逐字双向流式。音频使用 16 kHz、16 bit、单声道 PCM，依照官方二进制 WebSocket 协议，探针按约 200 ms 分包。

语种作为每次请求的参数，不需要更多环境变量：

- 纯泰语对照：`audio.language: "th-TH"`。
- 中文／泰语自动识别候选：`request.enable_auto_lang: true`，不指定固定语言。
- 固定语言和自动模式分开测试；当前配置校验不允许同时传两者。自动模式不加 corpus 热词／替换词／上下文，符合新版接口限制。

以上能力在官方模式中列出，但本账号没有识别成功样本；自动语种也不等于一句话内中泰混说已验收。[语种与自动识别参数](https://docs.volcengine.com/docs/doubao-voice/unidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)。

## 复跑与当前检查

仅检查环境变量，不联网、不合成音频、不显示 Key：

```sh
node --env-file-if-exists=.env scripts/thai-support-spike/asr-s2s/run.js --preflight
```

本轮实际结果：独立 `DOUBAO_ASR_API_KEY` 尚未配置，探针选用已有 `DOUBAO_API_KEY`，资源为 2.0 小时版；`configured: true`，`permission_verified: false`，`network_called: false`。没有查看或输出密钥值，没有更改权限。

获得授权后只测试独立识别，可运行：

```sh
node --env-file-if-exists=.env scripts/thai-support-spike/asr-s2s/run.js --live --stage=asr
```

这会向供应商发送固定作者合成的中文、泰语及混合音频。完整 `--live` 阶段另含 S2S 对照，不等于已接入业务。原生文本提问／连续更新仍有独立缺口，详见前一轮报告。

本轮验证：配置与协议定向测试 6/6，`npm run verify` 完整合成回归 867/867、`npm run replay` 三场景通过，8 个原 FreeTalk 保护文件哈希不变。配置测试明确检查专用 Key 优先、缺少／空值／非法值、资源选择、预检不泄露 Key，以及“配置存在”不能升级为“权限通过”。本轮没有新的真实供应商或浏览器音频结果。
