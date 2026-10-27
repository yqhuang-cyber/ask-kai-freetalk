# 阶段 C：后台语义分析与腾讯发音适配

日期：2026-10-27。分支：`codex/report-analysis`。**文本后台分析已接入并完成有限真实 MiniMax 工程验证；腾讯适配器已实现，真实腾讯、可靠学生声源 / 对齐与专业教学验收仍未通过。阶段 C 不标整体完成。** 阶段 B 的未完成项继续保留，不因 C 的代码推进而视为通过。

## 已实现的范围

- DR-05 / DR-06：独立 `ConversationReportAnalyzer` 使用报告专用配置、提示 / schema / rubric 版本和预算，结合单次提交的计划与授权会话文本，提出情境理解、口语表达、用词句式与组织的有引用候选。候选一律为 `review_required`；支持归因 unknown，不从文本判定纯听力、独立完成、长期掌握、等级或声学表现。
- M4 Worker：先保存兼容的基础反馈，再并行运行文本 / 音频分支；提交事务只入队。分支独立持久化，文本先完成时可查看；后台进程持专用内部凭据和提供方配置，不打开共享 DB，也不持有用户 Cookie。M4 数据进程仍是唯一 SQLite writer。
- 失败恢复：每次外呼前与写回前复核当前委托、来源和该分支授权；心跳保租，撤回 / 删除阻止迟到写回。调用发出后的进程故障记外部结果未知，不自动重发。显式重试复用成功的文本窗口及音频片段；另一分支仍运行时禁止重试改写租约。
- AUD-03-TX01 工程部分：新增 `packages/provider-tencent-soe/`，实现新版 WSS 签名、握手、16k PCM 录音上传与按 40ms 节奏发送已存片段、最终结果确认、范围 / hash 绑定、取消及错误分类。没有改变实时 Doubao 路径。
- DR-07 工程部分：精确原文和 UTF-16 范围、同一快照、角色 / 控制语句、完整问题与回答顺序、窗口来源、音频元数据及 PCM hash 校验。M4 再次校验模型候选，不因外层 hash 相同就发布。**这些检查不证明解读或声学诊断正确**；结果仍待核对，独立教学 / 声学评审在 D。
- 双端最小展示：新增分支状态、候选观察、原文、限制和针对性练习；基础规则记录折叠为补充。尚未完成 D 的完整证据审阅、专业反馈和音频回听体验。

## 文本覆盖与实验预算

短会话按完整可用文本处理。长会话按约 18,000 UTF-8 字节的窗口及相邻片段重叠处理；长段拆分保留原始 UTF-16 范围，输入仍包含角色、顺序、控制 / 取消等状态。窗口有输入 hash、处理状态及序列范围，重复候选按内容和来源去重。

当前 POC 每次最多处理 12 个窗口、每窗口最多 6 条候选、最多一次格式 / 引用修复。超过窗口预算、原始记录有缺口或部分窗口失败时，报告保持 partial，明确未处理窗口数；不把前面几轮当作全场。失败窗口可以显式重试并复用成功窗口。超出 12 窗口的未处理部分仍受本次 POC 容量限制，尚未接入继续分批处理的长期任务调度。

文本 root budget 为 90 秒，窗口为 30 秒；报告 Worker 根任务为 120 秒，5 秒心跳续租。音频分支为 90 秒、最多 12 个评测片段，候选输出有大小上限；文本 / 音频并发各一条，同一 Worker 一次处理一个根任务。提供方调用数量、token（实际返回时）、耗时与模型 / prompt / rubric / schema 版本属于必要元数据；不保存完整请求、原始响应、签名 URL 或供应商 trace。这些是实验资源上限，不是面向用户的延迟承诺。

## 告知、授权和删除

记录说明升级为 `deep-report-notice-v4`。每次选择另存当时允许的处理用途：`local-only`、`minimax` 或 `tencent_soe_v2`。后来启用模型配置不会把旧的本地保存选择变成外传授权；旧说明版本也不能授权新处理。文本 / 音频各有独立 grant revision，撤回其中一个不会错误取消另一个仍获准的分支。

`ASK_KAI_TA_REPORT_EXTERNAL_REVIEWED=1` 表示部署者已核对相应用途、提供方处理 / 留存边界并允许外部处理；默认关闭，不能把该开关或本地 Mock 选择当作真实学生、监护或供应商治理已验收。现有 `.env` 未修改。新说明版本和 local-only 选择均不对旧会话自动补分析。

撤回或到期会删除该来源的深入结果及引文；读取结果也重新校验当前授权。音频清单 v2 固定说话人、质量、对齐 / 参考与权限代次的元数据 hash，不能在封口后仅修改 speaker 就把候选升级成合格样本。账号删除、撤权和迟到结果有独立屏障。原有提交事实与有界规则记录按原设置保留；本地删除不证明供应商已经删除先前收到的数据。

内容检查复用现有安全规则并增加有限的隐私 / 注入屏障；它不是完整的内容审核或隐私识别模型，真实试点仍需正式治理。

## 腾讯接入与当前硬边界

官方依据已重新核对：新版[接口及签名](https://cloud.tencent.com/document/product/1774/107497)、[中文自由说](https://cloud.tencent.com/document/product/1774/107398)、[中文句子](https://cloud.tencent.com/document/product/1774/107396)。使用新版 `soe.cloud.tencent.com/soe/api/<appid>`，不是基础版 API 3.0。PCM 使用 `voice_format=0`；录音模式按接口页的单次 60 秒上限做保守限制。不同官方示例的格式 / 时长注释并不完全一致，实际组合仍需真实调用核实。

- 自由说使用 mode 3，不提供 ASR 参考文本；仅归一化实际有效的准确度 / 流利度与词信息，不推定逐字声调或音素能力。
- 句子 mode 1 仅允许独立确认且已绑定来源的短参考，最多 30 个字符；未经确认的 ASR 不可充当正确答案。有效声调和音素只在该模式保留；无效值为 null。
- 时间无效、越界或缺失时范围为 null，不杜撰定位。只有包含可解析评测结果的 final 才成功；只有结束标记或非 JSON 的 result 字符串不被猜测为可用结果。
- 说话人必须确认，噪声 / 削波 / 丢帧 / 重叠必须有明确质量检查。连接前和握手后发送音频前再次授权。供应商分数只作为待核对的声学候选，不映射学生等级，不按未经校准的阈值自动纠音。
- **当前 B 录音均为 unknown，且没有真实对齐器或受审查的声源 / 质量确认入口，因此不会从普通会话自动产生可送评样本。** 配置密钥或打开单个开关不能绕过这个门。

后续本地配置检查确认腾讯三项配置已填写；尚未取得获准作者录音，也没有真实腾讯外呼，服务开通状态和密钥有效性仍未验证。AUD-01 / AUD-02、AUD-03-TX01 的真实调用与普通浏览器到腾讯全链路、AUD-03 的可靠可教反馈、AUD-04 的专业声音验收继续开放。发音仍为 must-have。

## 配置与验证入口

以下配置默认关闭；本地试用服务已单独开启文本采集和 AI 备课，但报告模型外传尚未开启。以下为报告启用配置示例：

```dotenv
ASK_KAI_TA_TRANSCRIPT_ENABLED=1
ASK_KAI_TA_REPORT_TEXT_PROVIDER=minimax
ASK_KAI_TA_REPORT_TEXT_MODEL=MiniMax-M3
# 先核对用途与提供方处理边界，再由部署者显式启用：
ASK_KAI_TA_REPORT_EXTERNAL_REVIEWED=1
# 复用服务端 MINIMAX_API_KEY / MINIMAX_BASE_URL；不使用备课模型开关。
```

音频仍需独立实验采集与用户选择。`ASK_KAI_PRONUNCIATION_PROVIDER=tencent_soe_v2`、腾讯三项密钥和 `ASK_KAI_TA_AUDIO_ASSESSMENT_VALIDATED=1` 仅是准入配置；最后一项在 AUD-01 / 02 通过前保持关闭，且它不改变 unknown 录音的身份或质量。

- `npm run probe:teacher:report` / `npm run probe:teacher:report:worker` 默认 dry-run；显式 `-- --live` 仅发送作者编写的虚构文本，分别验证真实文本 transport 和本地 M4 / 独立 Worker 全链路，不使用真实学习者材料。
- `npm run probe:teacher:pronunciation` 只输出配置是否存在。
- `npm run probe:teacher:pronunciation:audio` 默认不读音频、不连接。作者实验需显式 `-- --live --audio /absolute/path/test.pcm --format pcm_s16le_16000_mono --author-test-consent --author-quality-reviewed`；句子另加 `--sentence --reference '已核对短句' --reference-confirmed`，流式另加 `--streaming`。作者声明不是声学专业验收，probe 不准入学生报告、不输出原音路径 / 文本 / 签名或原始结果。
- `npm run test:teacher:report:browser` 是本地 Mock、合成语音 / 文本模型和测试麦克风；独立进程由真实 Worker probe 另验，不把该浏览器测试说成真实供应商或真人设备通过。

本轮分层结果见[阶段 C 验证记录](eval-results/2026-10-27-report-stage-c.md)。
