# 真实多轮评分与批量评测

本工具沿用 `kai-content-v3` 的十维、权重和 0／1／2，适配作者固定学生脚本经真实 Agent 产生的回复。Agent 固定在 [基线清单](eval-baselines/freechat-v3.1-baseline.json) 的运行文件、依赖、数据与原 profile；评测提交另记 `runner_revision`。当前正常 Web／CLI 的审核开关保持原值。

## 评分输入与证据

`adaptRecordedObservations` 为每个回合生成独立评分单元：当前实际 ASR 与 Kai 回复、实际此前历史、作者逐轮 criteria／锚点、独立语言标注、当前可替代参考、上下文依赖、输入音频哈希及源运行 ID。评分只针对当前回复；此前真实记录供理解上下文，未来输入与参考不补入历史。参考和规范只进入评审，不能进入待测 Agent。

每维和每项可评 criteria 必须绑定 `{turn, role, start, end}` 证据，位置使用 JavaScript UTF-16 索引；引用范围只能来自截至当前轮的实际文本。评分文件绑定整个输入 artifact 的 SHA-256，修改回复或换一轮历史后必须重新评分。纯聊天的 progress 不强求教学。总结单独按作者条件契约与实际事件审核，不虚构任意词卡、掌握或发音结论。

`role` 支持 `student`、`kai`、`summary`、`metadata`。总结 JSON 仅在最后一轮提供；运行元数据只证明观测到的执行来源及隔离标记，不证明没有内部记忆写回。缺少该类执行证据的要求保留 `null`，不能当作通过。

十维数值复用原 `scoreCase`；`authored_tts_real_model` 显式区分固定作者音频／真实 AI 输出与真人记录。通用 `eval:content` 不接受该来源，必须经过真实记录适配。现有真人数据审核合同不因本工具改变。

| 状态／分类 | 处理 |
| --- | --- |
| 收集失败、未运行、缺回复／缺前文 | 不补参考；不可评或部分覆盖，保留原因和可用回合 |
| ASR 表面不同 | 只给复核提示；评分者另判语义等价、含义变化或不确定 |
| 前文依赖不成立 | 标记 `context_mismatch`；继续评实际输入回应，但从原案例可比分母排除 |
| 内容失败／部分满足 | 保留十维、逐项失败和证据；高平均分不能抹掉 criteria 或安全失败 |
| 评分未完成／Judge 失败 | `pending`，保存检查点并继续下一轮；不生成占位成绩 |
| 当前轮策略时序 | 只记录实际诊断与跨案例频率，不修改 Agent 或把相关性当根因 |

## 本地使用

准备评分输入及人工模板（无模型调用）：

```bash
npm run eval:recorded -- --observations .local/run/observations.json \
  --out .local/scoring-prepare
```

生成 `scoring-input.json`、`judgements.json` 和 `score-report.json`。模板的 `pending` 不是成绩。填写模板后从同样的观测重新适配：

```bash
npm run eval:recorded -- --observations .local/run/observations.json \
  --judgements .local/scoring-prepare/judgements.json --out .local/scoring-reviewed
```

可选结构化模型 Judge 使用现有 `EVAL_JUDGE_API_KEY`、`EVAL_JUDGE_BASE_URL`、`EVAL_JUDGE_MODEL` 和 `EVAL_JUDGE_VERSION`，显式加 `--live-judge`。逐轮与总结分别调用；失败不自动重试，模型不能批准人工审核。语音 `DOUBAO_API_KEY` 不被假定为评分接口凭证；人工或明确标识的模型辅助离线复核也可使用同一模板。

## 批量运行与重跑

GitHub workflow **Frozen Agent full evaluation** 固定 8 个按轮数均衡的批次，最多同时运行 2 个批次。当前请求选择 40 个原始案例／244 轮和 8 个语言对照／11 轮。每案独立初始画像与会话，输入 TTS 可在同批复用；单案输入准备失败不阻止后续案例。每批总采集预算 20 分钟，正常 CI 不调用供应商。专用 `protocol_smoke` 配置不能启用普通 Web；这不是设备验收。

`collection-report.json` 列出每案状态和 `retry_case_ids`。通过新的显式请求选择失败 ID，从第一轮新建会话重跑，保留旧记录；工具不会自动续接、改写前文或调 Agent。汇总有重复案例时必须显式选择替代运行 ID，且只能替代未完成的原尝试，不能挑选更高分的成功尝试。

每批 Artifact 包含请求／基线、观测、评分输入、评分模板与报告，保留 7 天。仅固定作者脚本与 AI 输出，不上传 PCM、Key、原始 wire trace 或真人录音。缺少独立 Judge 配置时仍完成采集和评分适配，报告明确未评分；不会把规则计数冒充语义分数。

安全协议诊断只记录事件名、字段类型／长度、会话内 ID 别名和错误类别，不保留原始值。2026-10-12 的失败重跑确认输入 TTS 有超过 64 KiB 的单包 PCM；`authored-tts-pcm-reframing-v1` 仅对评测输入合成拆包，保持字节、顺序和所有权，记录版本。Agent 输出与生产解码器仍沿用冻结基线。语气词无最终 ASR 时保留采集失败，不替换脚本或伪造回复。

```bash
npm run eval:report -- \
  --observations .local/batch-01/observations.json,.local/batch-02/observations.json \
  --out .local/full-report
```

汇总始终以 48 案／255 轮为完整分母，原始案例和语言对照分别统计。需要替代失败尝试时，加 `--replacement-runs` 及明确的观测 `run_id`；需要全量语义评分时填同一全量输入的模板并加 `--judgements`。不同批次的评分输入哈希不同，不能直接拼分数冒充全量已审核。

输出 `report.md` 和机器可读 JSON，列出收集／评分覆盖、有效分母、问题类别、案例轮次、最早偏离和待验证的修改方向。原始逐字稿与完整证据仍保存在私密观测和评分输入文件。完整评测结果出来前，不宣布根因或修改 Agent；Task 10 的真人 Web／设备验收独立保留。

## 2026-10-12 全范围首轮结果

后续已完成[Task 01 重点复核与校准](eval-results/2026-10-12-task01-calibration.md)，保留 v1 原记录和结果。`kai-recorded-review-v2` 不修改 `kai-content-v3` 十维或 Agent。校准版的每个低分/null需 `finding_attribution`，每轮 ASR 解释需只引用学生文本的 `asr_review`；原要求的解释变化保存在 `calibration_notes`。不可评范围类要求必须 null，不能生成数字通过。总结引用必须来自实际可评分轮次，来源诚实与学习条目覆盖分开报告。

`npm run eval:review:compare -- --input INPUT --before V1 --after V2 --out NEW_DIRECTORY` 校验同一个绑定输入并保存比较、前报告和后报告。它不采集、不调用 Agent 或 Judge、不覆盖旧文件。新数字表示评分校准，不表示模型改进；97 轮重点重审、147 轮沿用以及独立审核缺口均明确保留。

已尝试 40 个原始案例和 8 个语言对照，失败案独立新会话重跑，最终 47/48 案完整、244/255 轮有实际回复并完成模型辅助离线审阅。011 案仍缺 11 轮，11 项要求证据不足；独立 Judge API 调用 0 次、人工批准 false。逐轮要求、实际历史、证据位置、基线与全部失败尝试均独立保留，原数据和 Agent 未修改。见[完整结果与后续修改候选](eval-results/2026-10-12-freechat-baseline.md)及[机器可读结果](eval-results/2026-10-12-freechat-baseline.json)。这不是完整评分或 Task 10 的 Web／设备验收。
