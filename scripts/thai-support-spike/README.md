# Free Talk 中泰支架隔离 Spike

只测试当前已审核 Doubao S2S 配置的能力，不连接教师助教、业务画像或学习记录，不修改正式提示词、配置和默认行为。

```bash
# 离线查看实验输入与提示词，不访问供应商
node scripts/thai-support-spike/probe.js

# 7 个独立会话；使用 .env 现有密钥和审核后的本机 profile
node --env-file-if-exists=.env scripts/thai-support-spike/probe.js --live

# 指定样本，额外保存可回听的模型输出和对应文字
node --env-file-if-exists=.env scripts/thai-support-spike/probe.js --live --case=thai_fixed --keep-review-sample
```

需要 macOS `say` / `afconvert` 及 Tingting、Kanya 音色；输入全部是作者预先写好的合成句，不采集麦克风。工具若输出空 WAV，验证会拒绝继续，不会把空音频当作正常输入。

每个会话最多 35 秒，沿用正式 `SeeduplexProvider` 的语音事件映射和话轮归属检查，收到当前回复完成后正常关闭。不通过 UI 或普通 Agent / Planner，因而不代表完整 Free Talk 已接入。

`.local/thai-support-spike/` 被 Git 忽略：保存作者输入音频及汇总 JSON；默认不保存输出音频或转写。指定 `--keep-review-sample` 后另存 `*-reply.wav` / `*-reply.txt`，只供人工核对，不能提交真实使用者数据或原始供应商消息。

`complete_sample` 只说明真实就绪、一次 ASR final、输入 / 回复归属一致、音频非空和回复完成；`surface_language_match` 只检查首个文字系统、汉字 / 泰文字母 / 拉丁字母的存在。二者均不证明翻译等义、泰语发音、完整逐句顺序、浏览器播放或真人听感。`asr_matches_authored=false` 必须单列，不能自动认定模型理解了作者原意。

命令非零表示采集未完成；能力没有出现时也会正常产出结果，不能用进程退出码当作质量验收。

结果与下一步见 [Spike 报告](../../docs/free-talk-thai-support-spike.md)。

独立入口实施后新增 `browser-check.js`（合成 provider / 浏览器设备，测试依赖显式替换，不改产品就绪守卫）与 `gateway-probe.js --live`（真实中泰应用 / Planner / provider，作者输入，汇总记录）；`--suite=natural` 单独补验自然对话。真实 probe 使用临时端口，不影响既有应用。采集成功不表示表面语种、作用范围、翻译或听感全部通过，结果详见[实现与边界](../../docs/free-talk-thai-implementation.md)。
