# 拼音字幕 Spike

目录包含历史隔离实验和普通接入后的验证工具。普通 Agent／Web 首版已接入，见[实施记录](../../docs/pinyin-captions-implementation.md)；原 conversion／native-control／demo 仍为隔离实验，不直接进入运行链路。需求为 Kai 中文字幕默认附拼音，拼音不送入语音，学习者可口头关闭／重新开启，仅当前会话生效。

所有实验文件都在本目录。依赖、固定作者音频及临时元数据仅在忽略目录 `.local/pinyin-caption-spike/`；不提交录音、原始供应商 trace 或真实学习者内容。

```sh
npm install --prefix .local/pinyin-caption-spike --no-save --package-lock=false --ignore-scripts --no-audit --no-fund pinyin-pro@3.29.5 @pinyin-pro/data@1.3.1
node scripts/pinyin-captions/conversion-spike.js base
node scripts/pinyin-captions/conversion-spike.js modern
node scripts/pinyin-captions/conversion-spike.js complete
node scripts/pinyin-captions/conversion-spike.js custom
node scripts/pinyin-captions/conversion-spike.js custom-traditional
node scripts/pinyin-captions/native-control-spike.js
node --env-file-if-exists=.env scripts/pinyin-captions/native-control-spike.js --live
node --env-file-if-exists=.env scripts/pinyin-captions/native-control-spike.js --live --case=off
node scripts/pinyin-captions/demo-host.js
```

- `cases.js`：16 条作者读音 oracle、两条词语覆盖和六条作者语音控制输入。自定义词语覆盖针对同一批发现的问题，属于样本内修正，不能据此宣布真实准确率。
- `conversion-spike.js`：比较词库、逐字符／短语上下文、非中文原文保留、Node 冷启动与热转换耗时。`dist/index.mjs` 只是重导出的入口，33 字节不是可用转换库体积；报告另外测完整 UMD。没有测最终生产 bundle 或浏览器加载时间。
- `native-control-spike.js`：使用已审阅 profile 和 wire 事件，固定作者文字经本机 `say` 生成 PCM；每个样本一个独立真实豆包连接，只有 `set_caption_pinyin({enabled:boolean})` 工具，执行回执来自 synthetic caption renderer。它不验证多轮归属、浏览器执行或真实发音。文本只在内存做有限特征检查后丢弃；输出音频只计字节、不保存、不播放。“未检测带声调拼音”不是人耳确认未朗读拼音。
- `demo-host.js`／`demo.html`：临时 loopback 离线排版示例，无语音服务／麦克风，按钮明确模拟设置回执。原文通过文本节点创建 ruby／rt，不能用模型文字拼接 innerHTML。示例仅用于布局与开关观察，不代表普通 Web 接入。

同一库版本在该 16 条作者样本上，基础／现代词典 13 项、完整词典 14 项、自定义覆盖 15 项、覆盖＋繁体映射 16 项符合 oracle。全部配置的原文重构均保持一致。详细结果、失败及下一步见[Spike 报告](../../docs/pinyin-captions-spike.md)。

普通接入后的补验：

```sh
node --env-file-if-exists=.env scripts/pinyin-captions/gateway-probe.js --live
```

`gateway-probe.js` 复用已生成、逐字节哈希核验的作者 off／on PCM，走普通授权／Gateway／Provider，连续关闭→开启→关闭。Renderer 与播放回执明确 synthetic，不保存输出音频／转录，不代表真实浏览器或人耳。需要先完成上面的 native-control 输入准备。

`browser-checks.js` 导出普通 Web 的 8 项拼音检查，可注入 CUA locator facade 或 Playwright Page、显式作者场景 control 和可选最新 UI observe。场景夹具复用 `scripts/voice-slides-control/ordinary-web-host.js`，补充 caption_sentence／caption_off／caption_on；不在产品服务加入测试路由。本轮实际通过 CUA IAB 执行，未运行独立 Chromium CLI。
