# 课件回看控制实验

第六阶段普通页面自动化与复杂插话入口：

```sh
node scripts/voice-slides-control/ordinary-web-host.js
npm run test:browser:slides
node --env-file-if-exists=.env scripts/voice-slides-control/gateway-probe.js --live --interrupt-question
node --env-file-if-exists=.env scripts/voice-slides-control/gateway-probe.js --live --interrupt-add
```

`ordinary-web-host.js` 启动随机 loopback 端口上的隔离宿主，使用原普通 HTML／web.js、授权、Gateway、Provider 适配和 Viewer；语音 socket peer 与 Planner 为合成。仅测试宿主替换音频输入与就绪策略两个依赖，输入为持续静音、不请求麦克风，输出走真实浏览器 AudioIO；页面明确显示“豆包未连接／合成联调”。普通产品服务没有测试模式或控制入口。控制通过独立 loopback HTTP 端口的固定测试 header，或 `.local/voice-slides-control/ordinary-control-*` 本地 mailbox；二者仅操纵作者夹具。关闭宿主移除自己的 mailbox。

`ordinary-web-checks.js` 的 12 场景共享检查可注入 CUA 的 locator facade 或 Playwright Page。`ordinary-web-browser-check.js` 是 CI Chromium 驱动，需环境已安装 Playwright 和浏览器，可用 `ASK_KAI_BROWSER_EXECUTABLE` 指定可执行文件。本轮实际运行 CUA IAB 驱动，未执行独立 Chromium CLI，不能把驱动文件存在写成 CI 通过。检查覆盖手动／语音共用状态、追加、撤销、改口、旧确认、调速、旧 Planner 竞争、回执核对与冻结、重连换人、展示框降级、真实就绪守卫。

真实插话 probe 使用固定作者 PCM、普通 Gateway／Provider 和真实豆包；首项回看回执由 synthetic Viewer 延迟 1500ms，期间插入普通问题或明确追加。核验第二输入确实早于回执、最终页码、第二原生话轮回复，以及旧文字／音频零转发。它没有浏览器或真人听感，不能替代原生 FC 输入身份；报告只保留去敏元数据，作者回应另存本地忽略目录。当前结果见[第六阶段报告](../../docs/eval-results/2026-10-26-voice-slides-control-stage6.md)。

第五阶段入口：

```sh
node --env-file-if-exists=.env scripts/voice-slides-control/gateway-probe.js --live
node --env-file-if-exists=.env scripts/voice-slides-control/gateway-viewer-fixture.js --live
```

前者使用普通 HTTP 授权、Gateway、Provider 和真实豆包，但回执是 synthetic Viewer。后者输出临时 loopback 地址，使用实际 Gateway／Provider／SlidesViewer 和浏览器 AudioIO，只播放固定作者录音，不申请麦克风；HTTP 外壳是隔离测试宿主，不能冒充普通 Web 完整验收。两者都由 Mock 作者演示依次展示三页建立历史。报告及作者回应只存 `.local/voice-slides-control/`，公开阶段报告只包含去敏汇总。真实浏览器原生链路已通过基础三轮，真人设备及完整竞争矩阵仍待验。

本目录集中存放课件回看的作者材料与隔离实验工具。普通 Agent 已默认关闭地接入；原 protocol／lifecycle probe 的页面执行器仍为 synthetic，不能当成真实浏览器回执。第五阶段另外增加普通 Gateway probe 和真实 Viewer 联调入口。

最新见[第四阶段报告](../../docs/eval-results/2026-10-26-voice-slides-control-stage4.md)。原话核对未选作主接入；会话级操作与可撤销工具权限已有可行性证据，可继续默认关闭的工程接入，不提供原生 FC 输入身份。

```sh
node --env-file-if-exists=.env scripts/voice-slides-control/probe.js --live --source-evidence --all
node --env-file-if-exists=.env scripts/voice-slides-control/probe.js --live --capability-epochs --all
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=epoch-repeat
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=epoch-resume
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=epoch-delayed-old
node scripts/voice-slides-control/prepare.js --only=add-previous
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=epoch-add-explicit
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --capability-epochs --mode=control-revoke-dispatched
```

source-／epoch- 报告前缀分别隔离两种方案。模型原话声明只保留在本地作者样本回顾里，不入提交报告；共享权限内核位于 apps/realtime-gateway/src/slides-command-gate.js，实验目录仅作导入入口。epoch-delayed-old 的迟到是本地交付故障注入，不能当成供应商乱序证明。工具权限是会话动作协议，不是话轮身份或账号授权替代品。

```sh
node scripts/voice-slides-control/prepare.js
node --env-file-if-exists=.env scripts/voice-slides-control/probe.js --live --case=recent
node --env-file-if-exists=.env scripts/voice-slides-control/probe.js --live --all
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=sequential
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=interrupt-cancel
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=close-waiting
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=interrupt-finish
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=interrupt-add
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=interrupt-question
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=control-correct-queued
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=control-correct-dispatched
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=control-revoke-queued
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=control-revoke-dispatched
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=inspect-context
node --env-file-if-exists=.env scripts/voice-slides-control/lifecycle-probe.js --live --mode=scope-update
node scripts/voice-slides-control/prepare.js --only=two-previous-batch,inspect-slide-batch
node --env-file-if-exists=.env scripts/voice-slides-control/probe.js --live --case=two-previous-batch
node --env-file-if-exists=.env scripts/voice-slides-control/probe.js --live --case=inspect-slide-batch
node scripts/voice-slides-control/viewer-fixture.js
```

不带 `--live` 只显示选定用例，不连接供应商。固定作者文本通过本机 macOS Tingting 生成 16kHz PCM；输入、汇总报告及作者样本的模型回应仅存 `.local/voice-slides-control/`，不提交音频或原始供应商 trace。

报告记录 ASR 与作者文本是否匹配、规范化动作、调用是否带输入身份、模拟执行及工具结果前后输出。`sample_observed` 仅表示该样本的结构和执行顺序观察符合预期；`semantics_accepted` 保持 null，需单独审阅回应。不能把暂缓请求的预期无调用计成漏调用，不能把单输入槽当成生产多轮归属已核验。

遇新识别输入／重叠调用，单输入实验不执行旧动作、不回传旧结果，关闭实验会话。多轮、取消和真实 Viewer 验证仍需独立证据。

生命周期脚本只用于原生协议诊断。sequential 用两个依次送入的作者输入观察顺序；interrupt-cancel 在工具等待中送第二段音频，观察取消确认和后续调用，不执行页面；close-waiting 验证未回传工具时的关闭回执。interrupt-cancel-result 仅为合成可测的诊断分支，只有实际得到取消 ACK 才尝试旧取消结果，不能作为默认执行策略。所有生命周期报告的 enable_allowed 均保持 false。

不主动发送 response.cancel 的补验：interrupt-finish 为第二次指定回看，interrupt-add 为追加上一页，interrupt-question 为普通翻译问题；旧动作继续结算，输出按 question 身份独立过滤。control-correct-* 使用 replace_pending 布尔标志；control-revoke-* 注册参数为空对象的 cancel_pending_slides。queued 模拟请求尚未派发，dispatched 模拟已派发但未回执，均保留原 call_id 返回结果；不能把这些预先安排的输入顺序当成已解决生产 FC 归属。工具参数类型错误直接拒绝，不隐式转换。可用 prepare.js --only=correct-first,revoke-review 单独生成新增作者材料，保留合法既有 manifest 条目。

组件 fixture 只监听临时本机端口，输出访问地址；页面明确标注“真实浏览器组件＋合成宿主”。作者测试推进建立实际组件回执历史，与模型工具分离。可验证手动回看、仅列允许目标、重复命令、伪造后续页请求、丢 ACK 后核对、冻结及释放迟到回执。它没有生产授权／豆包链路，不能代替普通 Agent 端到端验收；退出该脚本即可关闭。

当前阶段结果见 [VS-01～03 阶段报告](../../docs/eval-results/2026-10-25-voice-slides-control-stage1.md)。
插话／改口／撤销补验见 [VS-01 第二阶段报告](../../docs/eval-results/2026-10-26-voice-slides-control-stage2.md)，其中保留修正前失败次数和仍未通过的准入条件。

后续诊断：inspect-context 仅查询本次已知作者输入的上下文，记录字段与相等关系，不保存查询内容。生命周期报告另记录 FC event_id 是否回带上行编号、call_id 是否与输入编号相等等布尔元数据；这些检测不是新的供应商保证。

单输入 probe 默认按确认页收窄工具，--static-tools 可保留原始静态能力作诊断对照。第 1 页没有更早目标时不注册导航，其他页收窄 action 与页码 maximum；所有提案仍由宿主校验，不能依赖 schema 证明执行权限。批量 --all 仍只包含原来的 23 条自然意图；配置／连接在 ready 前失败会停止整批。

scope-update 在模拟切到第 1 页后，先返回原工具结果并等对应回复完成，再全量更新工具与指令、等待配置确认，随后输入后续页请求。只检验该隔离时序，不代表普通 Agent 的配置编排已接入。两个 batch 用例单列：连续相对动作尝试与两个独立只读查询不是同一类证据；只读工具只存在于协议诊断，不进入 Agent 能力。支持的两项批次先完整校验再执行，结果按原 call_id 一次聚合；重复／不合法第二项令整批不执行。

能力收窄、批次及归属诊断的历史分母／失败见[第三阶段报告](../../docs/eval-results/2026-10-26-voice-slides-control-stage3.md)。原生来源问题仍存在，[待确认问题](../../docs/voice-slides-control-provider-questions.md)保留；当前受限页面方案改用会话级动作，不再将补字段作为唯一工程路径。
