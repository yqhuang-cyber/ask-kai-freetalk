# 双语语速调整 Spike 工具

本目录集中存放“中文相对更慢、英文维持基础节奏”的原生 S2S 实验工具与测试。实验结果未达到接入门槛，当前生产 Tutor 未采用这些候选。

| 文件 | 用途 |
| --- | --- |
| `probe.js` | 有界的豆包真实 S2S 探针；默认不联网 |
| `cases.js` | 作者提示词、语音示范与多轮对照套件 |
| `evidence.js` | 作者输入核对、输入音频裁边和 WAV 封装 |
| `summarize.js` | 提取本机报告中的脱敏统计 |
| `tests/evidence.test.js` | 输入核对与作者音频辅助工具测试 |

继承仓库现有依赖与 ESM 配置，无需单独安装。所有命令从**仓库根目录**运行：

```sh
# 不联网，检查入口和套件加载。
node scripts/bilingual-speech-pace/probe.js --suite=bp01

# 仅在显式 --live 时调用真实供应商，需要已有审核配置和本机凭据。
node --env-file-if-exists=.env scripts/bilingual-speech-pace/probe.js --suite=bp01 --live

# 汇总已有本机实验结果，不产生新的供应商调用。
node scripts/bilingual-speech-pace/summarize.js bp01 bp01b bp02a bp02b bp02retry bp05a bp05b bp03a bp03b bp03c bp04a bp04b

node --test scripts/bilingual-speech-pace/tests/evidence.test.js
```

本机结果仍读取／写入仓库根目录下已忽略的 `.local/`；本次源码归档不迁移或改写历史实验数据。输出作者示例音频需显式添加 `--keep-authored-audio`。不提交密钥、原始供应商事件或真实学习者数据。

需求、方法与结论继续存放在文档区：[任务清单](../../docs/bilingual-speech-pace-tasking.md)、[第三轮结果](../../docs/bilingual-speech-pace-experiment-results.md)、[初始 Spike](../../docs/bilingual-speech-pace-spike.md)、[身份提示词实验](../../docs/bilingual-tutor-prompt-spike.md)。
