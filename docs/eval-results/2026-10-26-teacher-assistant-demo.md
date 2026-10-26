# 教师助教最小 Demo：G0 / MD 工程验收

日期：2026-10-26。范围：[MD-01～MD-08](../teacher-assistant-minimal-demo-tasking.md)。试用与实际边界见[实施说明](../teacher-assistant-demo-implementation.md)。所有身份、授课关系均为本地 Mock，不代表外部 HSKai 集成或真人教师处理。

## 结果

| 检查 | 结果 | 能证明什么 |
| --- | --- | --- |
| G0 原版本 `npm run verify` | 636/636 | 实施前原有回归基线 |
| G0 / 最终 `npm run replay` | 三个合成回放通过 | 正常、打断、预期失败的内部契约回放，非真实 provider |
| G0 / 改造后 `npm run test:browser` | 通过，page_errors=0 | 原 FreeTalk Chromium 合成设备、控件、音频、字幕、学习者切换等既有浏览器回归 |
| 最终 `npm run verify` | **648/648** | 既有 636 项 + 新场景 12 项，无失败 / 跳过 |
| Node 22.19.0 新场景测试 | **12/12** | 最低支持运行时的 SQLite、契约、业务事务、独立进程和 realtime 兼容 |
| `npm run check:teacher:isolation` | 8 个冻结文件 hash 不变 | FreeTalk 页面、TeachingSession、prompt 编译、初始化、旧 server / main 不改；共享 seam 另靠原回归验收 |
| `npm run test:teacher:browser` | 通过，page_errors=0，无移动横向溢出 | 实际 Mock 业务 / SQLite + 合成 provider 的五步闭环、实际浏览器 AudioWorklet / 播放 / 拼音、提交回执丢失后的查询恢复 |
| `npm run probe:teacher:browser -- --live` | 工程链路通过 | 正式新页面、正式新网关、真实豆包、作者 TTS 经 Chromium 合成麦克风、结束及提交报告关联 |
| 真人麦克风 / 设备听感 / 手工操作 | **待验** | 上述自动化不能代替真人体验 |

G0 通过，MD-01～MD-07 最小功能完成，MD-08 工程部分完成。G-Demo-E 通过；G-Demo-L 的真实 provider 与浏览器音频部分通过，真人走查未完成。完整 TA-00～TA-21 不因 Demo 实现而整体标完成。

## 工程闭环与失败证据

新测试覆盖：

- 一般 ID 的 teacher / learner 授权、授课关系、另一名学生与无授课关系教师的读取拒绝；教师不能开 learner 会话。
- 实际发布事务、重复发布相同结果、同键异请求冲突、计划 hash 校验；任务 / runtime / report 同一 plan hash。
- 独立 WS path / protocol、一次性票据、错误协议消耗票据、连接失败；没有有效输入就不能提交 / 造成功报告。
- 有效 final 去重、session / attempt / plan 来源绑定、关闭后的迟到输入隔离；结束不自动创建 submission。
- 显式提交幂等、版本校验、重启后读取；submission 与报告 job 同事务。
- 报告失败仍为已提交，教师显式重试；异步结果在撤销后拒绝提交，删除后不能复活 job / report。
- 受限完整点单及合法口味否定；引语、转述、否定点单、疑问、未知改述保持未评估；无口味表达不生成口味成功事实。
- 学生报告固定白名单不含等级或教师证据 DTO；教师看到实际引用，grade=null。

浏览器合成测试先验证正式 readiness 拒绝 synthetic、麦克风请求数保持 0；随后只在测试中替换 readiness 依赖，使用明确标注的合成设备跑实际音频组件。提交响应被丢弃后，页面保持未确认，再从服务查询同一份已提交记录；并未重写或预置成功报告。

## 真实 provider 与浏览器音频

一次正式新场景会话：

| 指标 | 观察 |
| --- | --- |
| 业务 / 内容 | Mock HSKai / authored_fixture |
| 输入 | 作者生成点餐 TTS，经 Chromium 合成麦克风上传；非真人录音 |
| 正式 readiness | provider_connected=true、synthetic=false 后才调用采音 |
| 有效识别 / 回复 | 1 次 final、16 个音频片段、1 次完整回复 |
| 页面 | 拼音字幕实际渲染，page_errors=0 |
| 结束 | 浏览器音轨确认 ended |
| 提交 / 反馈 | 服务回执确认提交，报告标真实 Doubao 来源，两项目标有本次表达尝试 |
| 归因 / 教学结论 | 不评独立完成、长期掌握或发音；真人听感未验 |

结果仅保存最小元数据及本机 ignored 截图，没有保存原始 provider payload / 跟踪。测试临时业务库和作者测试音频在结束后清理。截图和本机 JSON 位于 `.local/teacher-assistant-checks/`，不纳入 Git。

## 共享变更与限制

原 FreeTalk 唯一共享运行文件改动为 `realtime.js`：可选 controller factory、WS 路径 / 协议、业务 lifecycle、授权短租约。默认值保持 `/api/realtime`、`ask-kai.v1` 和原 TeachingSession / 保存规则；原模式与 prompt 无作业依赖。

新应用固定任务 controller 不实例化旧 NaturalTeaching / PlanningState，不接外部逐轮 Planner；成熟音频 / 字幕 / 取消宿主和浏览器基础组件直接复用。完整多主题、自动教学包、多学生 UI、语义抽取、评级校准、机构账号及复杂隐私治理仍需沿原设计实现。有限规则的通过不等于通用反馈质量或真实学习效果验收。
