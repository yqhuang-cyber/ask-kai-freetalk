# Planner reliability 与可替换模型

2026-10-14。本轮先推送已验证的 88c98f7，再建设通用规划可靠性与独立豆包控制实验。保持本地 mock HSKai 和豆包全双工，不引入外部业务、独立 ASR／TTS 或未经核验的生产门控。

## 模型与宿主职责

保留 planConversation／planTurn 端口。实验 Draft 路径中，LLM 输出小型 ProposalDraft：交流目的、内容、目标选择、依据、意图、下一步动作与支架。通用 DraftCompiler 严格校验字段，再用同一不可变输入补齐确定性字段：身份／版本、目标的 KP、明确偏好、实际前次执行状态、回复预算和 required_student_answer:null。模型不能覆盖这些字段；错误目标、证据或动作仍拒绝，不静默修补为成功。

Prompt、Draft 契约、编译器、运行验证与截止时间独立于 MiniMax HTTP／模型配置。适配器只提供有界 JSON transport 及能力描述。以后换更强 LLM 时替换 adapter 或 transport，保持相同输入、契约、取消和评测；模型名称、provider、prompt／draft 版本分别记录，不将新模型得分混入 M3。

M3 官方接口已核验 thinking disabled 与生成长度字段；未证实其原生 strict JSON Schema 时保持 json_prompt，不凭 OpenAI-compatible 名称推断能力。不自动换模型、提高服务级别或放宽预算来制造通过率。

当前 M3 默认 full_contract_v3，由同一有界 transport 提供 JSON。826f2b8 保留与 88c98f7 逐字一致的 prompt；后续 Agent 优先迭代追加通用 reasoning，升级为 kai-planner-v6，原始 v3 留作冻结对照。ASK_KAI_PLANNER_PROTOCOL=draft_v1 显式选择候选。一次同组完整对照并未证明 Draft 更好，不能将架构分离计为模型质量提升。冻结 eval adapter 仍用于原始传输对照，不由运行服务导入。

更强模型上线流程是注册 transport／adapter、明确原生结构化输出／思考／截止与费用能力，先跑相同离线负例和独立真实矩阵，再决定默认。MiniMax 当前仅核验 M3；增加型号需核验其独立配置，不能从旧模型推断 thinking disabled 等保证。Provider factories 只在服务端注册，浏览器不能指定任意 endpoint／模型。

## 诊断与评测

区分 HTTP 等待、响应体完成、JSON／draft 形状、编译、运行来源／policy 和语义行为错误。只记录有限错误码、合法字段路径、时长、大小和 token；不保存思维链、异常正文或原始响应。超时／取消／修复共享原截止时间；未完成调用成本仍未知。

复用冻结的 12 案／18 轮行为约束，不向 Planner 提供期望或未来输入。冻结旧完整契约候选，和 draft 候选在相同预算、同一案例范围分别运行；规则 fallback 不计为 LLM 通过。改善输出格式不自动证明目标选择或教学语义改善。

## 豆包当轮控制实验

已知官方 FC 契约只有 session.tools、response.function_call_arguments.done 的 items／call_id／name／arguments、conversation.item.create 的 tool 结果回传。独立 probe 先验证这些真实接口及延迟回传期间的输出时序，不修改普通适配器的工具禁用或 controlled 硬门槛，不发送猜测的 tool_choice／response.create。

实验输入必须是有出处的作者合成 PCM，持续按 20ms 上送；工具调用前／等待结果期间出现自主文本或音频都记录为缺口。计划接受与工具结果发送分开计时；回传时再检查计划有效期，旧输入／退出使未回传结果失效。即使有限样本均等待，也只能报告样本观察；没有官方每轮强制调用契约，generation_gate_verified 保持 false。

本轮结果见 [对照与真实控制实验](eval-results/2026-10-14-planner-reliability.md)。MiniMax 配置依据 [官方 OpenAI-compatible API](https://platform.minimax.cn/docs/api-reference/text-openai-api)，豆包 wire 字段依据 [官方全双工 API](https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh)。这些文档不提供本项目的每轮强制规划或教学质量验收。
