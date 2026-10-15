# 候选版本评测与 Agent 对比

2026-10-12。收尾 Task05-01：只修改评测契约、评分适配和运行入口，不改 Agent 运行文件、作者数据、旧基线清单或十维权重。真实候选行为从05-02起另按提交评测。

## 固定旧版与显式候选

旧版入口继续使用 `docs/eval-baselines/freechat-v3.1-baseline.json`，运行文件、依赖、数据或profile漂移即拒绝。新增候选清单记录已经存在的实现提交、父版本、相对旧基线的全部允许变更、完整运行文件哈希、依赖及锁文件、数据／profile原字节哈希和评分口径。

候选校验同时比较工作树文件与指定实现提交中的文件。仅改文档或评测工具的后续提交不会成为新 Agent 行为版本；提交号、运行文件和评测工具版本分别记录。当前 POC仍固定原依赖和原数据／供应商配置，未声明的改动拒绝。

专用工作流可将运行目录恢复为请求声明的历史Agent提交，评测工具仍来自本次main提交。只允许声明提交的精确运行文件，运行文件集合和每个字节再次校验；其他未提交变化拒绝。这样后续主干改动不会阻止对早前候选按相同PCM复测，也不把工具提交误记为Agent版本。普通本地冻结仍要求干净工作区。

在干净工作区冻结候选，不调用模型：

```bash
npm run eval:candidate -- freeze \
  --agent-revision IMPLEMENTATION_COMMIT \
  --parent-revision PARENT_AGENT_COMMIT \
  --allow packages/agent-core/changed-file.js \
  --out .local/candidate-freeze-01
npm run eval:candidate -- verify \
  --manifest .local/candidate-freeze-01/candidate.json
```

`--allow`为相对原冻结基线的全部变化文件，以逗号分隔，不仅是最后一项提交。没有运行文件变化时省略该参数。占位提交与文件须换为实际值；实现提交必须已在本地 Git 中。输出写入新的私有目录，不覆盖历史文件。

## 实际采集入口

[候选评测工作流](../.github/workflows/candidate-evaluation.yml)和 `scripts/actions-candidate-evaluation.js`只在 main 的专用 `.github/live/candidate-evaluation-request.json`变更或显式启动时运行。05-01不创建请求文件，普通代码提交与日常持续集成不调用真实豆包。

请求绑定版本1、`ask_kai_candidate_evaluation`、唯一运行编号、05子任务、实现／父提交、全部允许运行文件变更、原数据与profile哈希、案例列表、1～8个批次、每批20分钟预算及明确的重跑来源。案例为空表示48案；指定列表则只跑所列整案。最大并行2批；失败留证并继续其他案例，不自动重试，不使用参考前文。

语言对照使用一个批次，同文字在该批内复用同一合成PCM。显式 `input_fixture_run` 可引用先前候选运行：只读取并验证输入manifest及PCM，重新保存已校验音频；不读取Kai回复。缺失、脚本／数据／音频哈希不符即记录采集失败，不偷偷重合成。全量运行的不同批次仍可能有不同合成音频，不宣称原历史基线同音频。

已有GitHub Secret `DOUBAO_API_KEY`供工作流使用；本入口不配置或调用独立评分模型。学生脚本经合成音频进入相同Agent网关和本地mock，每案实际Kai前文由供应商会话生成。新合成音频及manifest与记录保留为私有Artifact7天，以支持后续按字节回归；没有录制真实学习者。

候选记录标为 `evaluation_contract_kind: candidate`、`candidate_verified: true`、`baseline_verified: false`。旧基线和候选不可混合成一次同版本评分；不同候选也不可混用。评分输入继承这些身份字段，仍按作者独立要求保留逐轮实际证据。

## 版本对比

```bash
npm run eval:candidate -- compare \
  --before .local/old-score-report.json \
  --after .local/new-score-report.json \
  --out .local/agent-comparison-01
```

对比要求同一数据、模型／profile、真实或合成执行类型、十维及权重、校准口径和评分来源／版本。候选必须有校验身份。历史旧报告缺少新增profile字段时，从其已保存的不可变评分输入和同一judgements重新计算一份单独报告；不能把缺失条件猜成一致，原历史文件不覆盖。

按同一案例／轮次逐项列出旧新状态、分数和要求变化。只有两边都有得分且输入及上下文均可比，才统计改善／退化；缺失、未评分和输入失配不产生分数增益。单轮可同时有改善与退化，计数不可相加为独立轮数。新增关键失败及候选仍有关键失败都单列，不被均分抵消。

总结条目数量只报告覆盖，不证明内容、学习效果或播放通过。模型辅助评审不变成人工批准；采集成功不变成内容合格。真实语速、停顿、插话、字幕和三个入口旅程仍由对应Web验收覆盖。

本项验证：300项Node测试、三个合成回放通过；比较器加强后五项针对性测试再次通过。46个冻结运行文件及原数据哈希未变，依赖和锁文件未改，没有真实豆包或独立评分模型调用。
