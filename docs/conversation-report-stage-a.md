# 深入对话报告：阶段 A 本地实施

日期：2026-10-27。分支：`codex/report-analysis`。只适用于主题作业 POC。

## 交付与边界

| Task | 本轮结果 | 尚需后续验证 / 接入 |
| --- | --- | --- |
| M4-01 | 沿用已确认的 M4 权威数据服务、唯一 SQLite writer、独立分析 Worker 设计 | B 的 M4-02 才新增 Worker；当前规则报告仍按原实现执行 |
| DR-01 | 可执行、版本化的记录 / 文本 / 音频 / 覆盖 / 引用 / 分析候选和结果契约；合成反例 | B 的真实采集与增量存储，C 的语义及声学真实性校验 |
| DR-02 | 本地 Mock 中独立的文本 / 音频选择、告知、7 天默认可配置策略、撤回 / 到期 / epoch 屏障及账户删除；学生端说明 | B 将采集、内容清理、任务取消和三处权限检查接入这些策略；C 外部处理准入。当前没有新全文 / 音频可删，不能宣称内容全链路删除验收完成 |
| AUD-01 P0 | 腾讯新版官方能力核对、模式矩阵、无外呼预检与实验清单 | **真实自然语音能力未验证**。用户确认先完成本地阶段 A；待服务配置、获准作者录音及专业标注准备好后完成 |

阶段 A 本地基础可交付；AUD-01 的真实能力门仍开放，整个阶段不能记为真实发音验证通过。当前不新增全文或音频采集，也不改变旧规则报告。旧证据不是完整对话档案，不能反向补回未保存的话。

## DR-01：执行契约

实现：`packages/teacher-assistant/teaching-record/contracts.js`。所有对象是 JSON 数据，无绝对磁盘路径、密钥或 provider trace。未知字段拒绝，迁移需新版本。契约校验不代替安全审查或分析内容的真实性验证。

### ConversationRecord / TeachingRecord 快照

| 字段 | 约束 |
| --- | --- |
| schema_version / version | `teaching-record-v1`、正整数版本。只接受封口快照 |
| scope | learner_id / assignment_id / attempt_id / session_id / plan_hash、auth_epoch / deletion_epoch / consent_revision；子段从外层继承同一归属 |
| created_at / sealed_at | 宿主毫秒时间；创建不晚于封口。与说话时间无等价关系 |
| retention | policy_version、text_expires_at / audio_expires_at；分别计算、不可因重试或再次选择延长 |
| transcript / audio | 有序 TranscriptSegment 与 AudioSegment，段 ID 在快照内唯一；引用同时绑定 snapshot_hash，不能单凭段 ID 跨会话引用 |
| transcript_manifest / audio_manifest | 覆盖计数、未知分母、缺口与原因；无内容不等于没有能力 |
| snapshot_hash | SHA-256，递归按对象键排序的 JSON；数组顺序参与 hash；绑定全部以上字段、已发布计划和授权代次 |

调用者必须用 M4 权威 scope 调用 `validateRecord(record, expectedScope)`，不能相信上传者自报的身份。`sealRecord` 只生成 / 验证快照，不写存储，不给客户端封口权限。B 的写入接口负责核验实时会话归属、计划、队列计数和授权。

### TranscriptSegment

`id, sequence, role, turn_id, response_id, event_ids, text, kind, status, received_at, speaking_time, uncertainty, source`。

- 学生：`role=learner`、`source=accepted_user_final`、`status=final`、response_id=null；B 可将明确的结束 / 设置指令标为 control。仅接入现有网关已接受的内部 user.final。最终文本按 ASR 内容保存，不能称为逐字准确原话。同一 turn 不能重复计算。
- Kai：`source=forwarded_safe_text`，仅安全及输出门放行、实际向页面转发的内容；同一 response 的 delta 先聚合。状态为 completed / cancelled / interrupted / incomplete。控制文本 kind=control，不充当学习成果。
- speaking_time 在 v1 固定为 null；received_at 是接收时间。event_ids 只证明我们接受的内部事件来源，不能推断供应商 wire event 或供应商保证。
- sequence 表示本地接受顺序，严格递增；不要求连续，缺口由 manifest 说明。已转发不证明播放、听到或字幕帮助归因；候选 support 固定 unknown。
- 每段最大 65,536 个 UTF-16 code units，最多 20,000 段。B 的采集器还需有界容量与显式截断缺口；超限必须拒绝 / 标记，不能静默取前几轮。

### AudioSegment / AudioManifest

`id, blob_id, sha256, stream_id, sample_start, sample_end, sample_rate, channels, encoding, speaker, turn_id, quality, alignment, created_at, expires_at, consent_revision`。

本地标准格式先固定 16kHz / mono / pcm_s16le；sample_start/end 是同一 capture stream 的半开采样区间，无重叠重复计数。blob_id 是 M4 管理的不透明标识，不接受任意磁盘路径；hash 指向标准化后的实际音频内容，B 在存取时检查字节。采集 stream 区间不是 provider 的词时间。

speaker=learner_verified / unknown；turn_id 可空，不凭 ASR 到达时间强配音频。quality 的 noise / clipping / missing_frames / overlap 各为 unknown / detected / not_detected，未测不能写 not_detected。alignment 可空；存在时绑定同轮学生段、UTF-16 文本范围、算法版本、0～1 confidence 与 author_verified / aligner_candidate。候选对齐不自动成为可靠声学诊断。

AudioManifest：`state, captured_samples, persisted_samples, reason`。available 要求已知分母、保存采样数完全相等且大于零；未启用、未授权、旧版无音频分别说明。质量合格与采集覆盖是不同的判断，保存完整不证明能评测。

### TranscriptManifest

`accepted_learner_finals, persisted_learner_finals, forwarded_kai_responses, persisted_kai_responses, analyzable_segments, gaps, late_events, uncertain_segments, state, seal_reason`。

accepted / forwarded 分母可为 null，表示未知。持久计数必须与快照段一致，可分析计数只统计内容段，不能拿规则命中数代替。gap 包含 after_sequence / before_sequence 与原因：overflow / write_failed / truncated / disconnected / unauthorized / legacy_unavailable / unknown。state=complete 必须分母已知且相等、无 gap、Kai 回复 completed、正常 ended；否则 partial / unavailable。complete 指已接受和已转发的可记录内容覆盖，不保证识别正确或证明纯听力。

### EvidenceRef / AnalysisCandidate / AnalysisResult

EvidenceRef：`snapshot_hash, type, source_id, start, end, quote`。text 为 UTF-16 半开范围，quote 必须逐字匹配，不能切开 surrogate pair；audio 为采样范围、quote=null，必须落在对应音频内。

Candidate v1 包含 `id, snapshot_hash, dimension, status, observation, explanation, support, uncertainty, suggestion, evidence_refs, analyzer_version` 和 schema_version。dimension 为 context_understanding / oral_expression / pronunciation / tone / fluency；status 为 observed / review_required / insufficient_evidence。理解候选至少有 Kai 内容和学生内容引用；表达候选至少有学生内容；声学候选至少有已核对归属的学生音频。没有证据时仅可 insufficient_evidence；不把 Kai 的控制话或“学生没回答”当作能力缺陷。

Result v1 绑定 scope / snapshot_hash / version / analyzer_version，分别记录 text_state / audio_state 及总 state；未完成的分支不能发布有证据结论。grade=null、mastery=unassessed。**这些是结构性输入准入，C 的 DR-07 仍要校验具体内容、相邻上下文、参考文本、声学有效性与能力版本；通过 schema 不等于结论正确。**

### 可运行的作者示例

`tests/helpers/teaching-record.js` 的 syntheticRecord 提供：昆虫主题、100 轮、Kai 被打断、持久化缺失、旧版不可恢复、只有假数据引用而没有真实文件的音频例。`tests/teacher-assistant-teaching-record.test.js` 验证跨会话 / 学生 / 版本拒绝及错引用反例。不得将这些合成对象当作 provider 实测或真人记录。

## DR-02：本地选择与权限生命周期

`recording_choices` 是 SQLite migration 3 新增的独立表，只存本次尝试的选择及必要元数据。不会把选择写成“正在录音”或更改 attempt / submission 状态。身份和访问仍由 M4 Mock 的 session / assignment / actor epoch 校验。教师不能替学生选择、读取私有选择或恢复已撤回授权。

认证 API：

- recording_notice：返回当前版本说明、两类用途 / 接收服务 / 保留期、实际能力开关；仅学生可读。
- recording_choice：读取当前 attempt 的默认关闭或已保存选择；没有事先选择不隐式 opt-in。
- recording_choice_update：提交 attempt_id、notice_version、expected_revision、text / audio 两个布尔值；有版本冲突则重新读取。可分别拒绝或撤回，撤回增加 revision，旧任务凭据失效。当前仅保存本地选择，collection_enabled / analysis_enabled 始终 false。
- delete_my_data：在原账户删除事务内清除选择表、原有本地尝试 / 提交 / 报告 / job，并提升授权 / 删除代次；旧 token 不能重新写入。

学生页目前只展示“准备中”和折叠的用途 / 保留说明；**不让学生为尚未启用的功能进行无意义的勾选**。正式采集开放时 B 必须更新 notice_version、展示独立选择并连接上述 API；本轮测试 / API 保存的选择不会直接授权未来版本采集。

authorizeRecording 是后续 M4 读、外呼前、结果写回的统一策略函数，要求权威最新 choice、context、revision、kind、operation、now；分别检查身份 / epoch / 说明版本 / 撤回 / TTL / 采集能力。provider_call 与 commit 额外要求对应分析已启用和外部用途审查完成。当前默认能力全关，复选框或腾讯密钥本身无法开通分析。

默认文本与必要音频均 7 天，从 attempt 创建时间起算，后续选择 / 重试不延长；配置 ASK_KAI_TA_TEXT_RETENTION_DAYS 和 ASK_KAI_TA_AUDIO_RETENTION_DAYS，限整数 1～30。子进程只接收这两个白名单参数。启动和每分钟清理过期选择，并在每次读 / 写 / 使用时检查 TTL，定时清理失败也不能授权过期读取。过期选择保留最少的未授权状态，不保存新全文 / 音频内容；账户删除会清除该元数据。

后续 B 的内容删除接口必须事务提升 revision / deletion_epoch，先阻断读取 / 外呼 / 提交，再清除文本、音频、对齐、声学结果、缓存、候选和已生成报告，取消关联任务，并记录删除中 / 完成 / 失败。重试只清理相同清单，不能复活。当前未建立内容存储与独立 Worker，故**本轮不声称已经完成真实音频、WAL、临时文件或云端删除验证**。本地数据库有 secure_delete 和文件权限控制，但逻辑删除回执不是磁盘取证擦除证明。

## AUD-01：腾讯能力实验准备

选型沿用腾讯智聆新版；`npm run probe:teacher:pronunciation` 只检查配置存在与否，打印公开能力元数据，不读音频、不打印密钥、不签名或外呼。即使密钥齐全，ready_for_learner_reports 也保持 false，服务开通、输入材料、声学有效性仍未验证。

| 维度 / 路径 | 官方资料支持的方向 | 本机验证结论 |
| --- | --- | --- |
| 中文自由说 eval_mode=3 | 无参考文本；句 / 词准确度及流利度 | 未调用，不能推定音素 / 声调可用 |
| 中文句子 eval_mode=1 | 核对参考短句后测试音素与声调；声调有效性与空字段需检查 | 未调用；ASR 文本不能直接当正确参考 |
| 自然语音声调、轻声 / 变调 | 需要独立专业标注与模式适用性实验 | 未验证，不承诺细分能力或阈值 |
| 离线录音 / 流式传输 | 录音模式单次上限 60s；流式按节奏发送 | 组合、时延和故障未实测 |
| 费用、额度、留存与服务商删除 | 实际账户 / 商业条款及供应商处理确认 | 未验证；不虚构价格或删除回执 |

资料核对：2026-10-27，[腾讯新版接口](https://cloud.tencent.com/document/product/1774/107497)、[模式矩阵](https://cloud.tencent.com/document/product/1774/107373)、[中文句子与声调](https://cloud.tencent.com/document/product/1774/107396)。文档字段表和声调样例结构存在差异，实际接入需验证嵌套位置 / nullable，不能从展示文字猜测保证。

冻结的实验类别见 tencent-readiness.js：自然自由说、人工核对参考短句、错误 ASR 参考、声调 / 轻声 / 变调、噪声 / 削波 / 重叠、静音 / 编码 / 时长边界。材料仅允许获准作者录音；每例要绑定音频 hash、声学专家标签、参考来源、mode、API / 参数版本、score_coeff、字段有效性、耗时、错误和实际调用计数。原始材料 / 请求 / provider 响应不进 Git 或普通日志。

先确认服务连通与字段，再形成与标注一致率 / 错误反馈率 / 不评比例的基线并冻结准入门槛，最后用独立 holdout 验证。服务接通不代替 AUD-04 专业准确性验收。按用户本轮选择，真实调用等待本地环境和作者材料准备好；B 的记录基础可以继续，C 的真实发音放行依赖未解除。
