# Implementation verification and remaining acceptance

目标迭代检查：npm run eval:goals 使用 12 个独立虚构案例／18 个话轮；显式 --live 调用真实 M3，--case=refusal 可限定范围。不调用豆包或 Judge，不把 fallback 计为模型通过。新增浏览器检查包含换目标／停止后多目标总结；独立／达成、当轮受控生成与真实设备继续分开。见 [新验证报告](eval-results/2026-10-14-dynamic-goals.md)。

> 2026-10-14 动态规划更新：独立 mock 默认使用 next_turn_advisory，已接入三类学生上下文、可信资源、建连前整体计划与 MiniMax M3 逐轮提案；保留豆包实时全双工，本轮生成门控未证实。下文旧 Task 行为保留为 legacy／历史说明，新行为、尝试写回和验收范围见[实施记录](dynamic-planning-implementation.md)及[验证报告](eval-results/2026-10-14-dynamic-planning.md)。


Run `npm ci --ignore-scripts`, `npm run verify` and `npm run replay` on Node
>=22.19. No provider credentials or network are required. CI runs Node 22 and 24.
Optional Pi planning (`ASK_KAI_PLANNER_PROVIDER=pi`) uses the same commands;
`npm run eval:goals -- --live --pi` is a separate real MiniMax batch and is not
part of `verify`.

`npm run verify:p0` now combines these checks with the 16-case scoped content
suite and 10 authored negative controls. See [Task 09](p0-regression.md) and its
runtime/content/manual coverage matrix. Native browser checks remain a separate
`npm run test:browser` command/CI job. This does not claim the original 58-case
workbook has been executed or that real content/device acceptance passed.

Current tests cover runtime contract rejection, ready/failed/closed lifecycle,
duplicate and cross-session events, final-only attempted evidence with provenance,
wrong-turn and reused reply IDs, interruption with late audio/text/done/ack events,
fixture cancellation, loopback configuration, real-provider fail-closed behavior,
HTTP/SSE end-to-end projections, WebSocket rejection and cross-site/Host checks.
All committed dialogue is authored/synthetic. WebSocket tests additionally contain
generated PCM bytes; browser checks use a Chromium synthetic microphone device.

Task 05 adds focused [natural teaching](natural-teaching.md) regressions for
single-goal selection, zero-point ordinary chat, one-time invitations, final-turn
cooldown, refusal/topic pause, clarification limits, quoted controls, direct
attempts, privacy and response/ACK snapshot races. Synthetic provider checks
verify policy transport, not semantic accuracy or real audible teaching.

Task 07 adds 18 [summary](session-summary.md) regressions covering all entry
modes through signed local mock HTTP, actual WebSocket forwarding/holds,
source/scaffold provenance, unsupported/absent evidence, cancellation,
sampling/copies, partial failures and once-only finalization. Authorization
revocation tests also verify learning suppression and owner isolation.

Task 08 adds seven [Web summary](web-summary-cards.md) projection/state tests:
three entries, honest empty/text-only/partial views, schema/session/provenance
rejection, immutable snapshots, restart fences and safety/revocation. Native
Chromium also exercises real DOM cards, pinyin/English/counts, optional review,
unsupported goals, missing receipts, literal HTML-like text, mobile/desktop
layout and the actual WebSocket End/new-start path. These summaries are authored
synthetic data; provider readiness is withheld and does not open the microphone.

Task 09 adds 12 focused evaluator regressions: high-score surface violations,
all semantic failure gates, uncertain/partial review, safety/handoff preservation,
N/A/applicability rejection, missing coverage, privacy/revision validation before
Judge calls, full multi-turn audits, metadata-only reports, copied observations,
structured P0 LangChain contract and CLI failure exits. Semantic negative labels
are authored expectations, not a live Judge result. All 199 Node tests pass.

Protocol-probe tests additionally cover profile/credential preflight, real Node
WebSocket headers against a loopback peer, historical readiness versus active
connection state, payload-value masking, within-run identity aliases, malformed
frames, aborts and bounded report output. See docs/protocol/duplex-spike.md.

## Traceability to the existing plan

| Plan task | Step 1 evidence | Remaining |
| --- | --- | --- |
| V01 | runnable shell, event validator, provider port, tests and CI | production framework and configuration after protocol verification |
| F02 | pinned HSKai source inventory | consent, region, schema and actual deployed integration |
| Q01 | foundation coverage mapped here | import original 58 case IDs and full requirements matrix |
| Q02 / V04 | deterministic late-event cancellation regression | real provider event fixtures and browser audio measurements |
| V03 / V05 | reviewed-profile adapter, real local WebSocket/PCM, progressive reply-fenced captions, native browser API checks | actual account WSS/audio, provider timing and phrase/audio alignment |
| A03 | attempted-only evidence invariant | prompted/independent use rules and persistent evidence |
| Q03 / Q04 | separate scorer, LangChain structured Judge, numeric Langfuse export port, NA/critical/release rules | real-model runs, original cases, deployed Dataset/score readback and human calibration |

The replay CLI is an event regression tool. It does not evaluate teaching content,
does not call a model and does not report quality scores. The separate content
runner implements the 10-dimensional scoring contract. Its eight seed examples
are illustrative scoring data, not actual teacher performance or the original
58-case workbook/53 P0 cases. Those original IDs still need archival and mapping.

## Manual local check

1. `npm start`; visit http://127.0.0.1:4310. Switch sports/free topics and check prompts update. Mission stays disabled.
2. Start conversation: service returns 501, page reports realtime unavailable and remains disconnected; no microphone permission is requested.
3. Open /dev/replay and run normal: synthetic subtitles increment and a single attempted evidence item appears.
4. Run interruption: cancelled subtitles clear; three late events are dropped; new reply survives old cancellation acknowledgment.
5. Run failure: the session stays failed; no provider connection is reported.
6. Stop midway, then restart; no previous subtitles remain.

Local verification now includes Node rules, HTTP/SSE, real loopback WebSocket,
PCM/ownership/cancellation/context, auth/Mission/memory/privacy, safety/tool rules,
LangChain callable Judge and Langfuse HTTP contract tests, plus native Chromium.
Browser controls and synthetic-device AudioWorklet capture/playback pass, including
continuous capture during stop and no permission request while disconnected.
Local CJK fonts were absent, so typography needs a font-capable device check.
No real-provider, live Judge/Langfuse, deployed HSKai, human-team or actual AEC/
audible-latency acceptance was performed. Release status remains blocked.
# Seeduplex protocol follow-up

`tests/seeduplex.test.js` uses authored synthetic payloads shaped by the supplied
official PDF and Go/Python/Web demos. It covers text-before-audio, ASR increment
assembly, attempted-only final evidence, output format/framing, text suffixes,
audio-vs-interaction completion, cancellation with a newer reply, serialized and
deduplicated ACKs, wrong ownership and masked failures. A local gateway/WebSocket
integration exercises teaching context updates. Additional probe and interruption
regressions verify mute/close/error behavior and waiting for cancellation before
updating context. No real provider transcript/audio, key or live assertion is used.
See `protocol/seeduplex-integration.md` for ACK and terminal-identity limitations.

## Adaptive English support (2026-10-10)

`language-support.test.js` adds profile/default/expiry and direct-request tests,
no ASR mastery inference, actual mock HTTP edits, ACK-safe reply audits and
student-history-only content expectations. The original ten dimensions remain.
`browser-check.js` saves and exports support, comprehension and known-expression
fields through production Web controls and the local signed mock. These checks
are synthetic, not observed Doubao teaching. See [language policy](language-support.md).
