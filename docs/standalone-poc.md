# Standalone Ask Kai Agent POC

> 2026-10-14 动态规划更新：独立 mock 默认使用 next_turn_advisory，已接入四位可切换 Mock 学习者的三类资料接口、可信资源、建连前整体计划与 MiniMax M3 逐轮提案；保留豆包实时全双工，本轮生成门控未证实。下文旧 Task 行为保留为 legacy／历史说明，新行为、尝试写回和验收范围见[实施记录](dynamic-planning-implementation.md)及[验证报告](eval-results/2026-10-14-dynamic-planning.md)。


This repository is an independent POC. It does not require the
`wohuipteltd/HSKai` repository, a deployed BFF, learner accounts, database or queue.
The existing HSKai interfaces remain architectural boundaries, implemented here
by a local mock HTTP service. Doubao stays a separate real voice provider.

## Run

```bash
npm ci --ignore-scripts
cp .env.example .env
npm run poc
```

Open http://127.0.0.1:4310. `npm start` also defaults to `ASK_KAI_BACKEND=mock`;
`npm run poc` explicitly selects mock even if an old environment says external.
One command starts the Web/gateway and a mock service on an automatically chosen
127.0.0.1 port. No second terminal or HSKai secret/address is needed. Startup
generates an ephemeral server-only signing secret; it is never sent to browser JS
or printed. Any HSKAI_* external endpoint settings are ignored in mock mode.

Without voice configuration, Mission and preferences work, and “开始对话” reports
voice unavailable without requesting the microphone. For actual voice set:

```dotenv
ASK_KAI_BACKEND=mock
ASK_KAI_PROVIDER=doubao
DOUBAO_API_KEY=your_local_key
DOUBAO_REALTIME_PROFILE=./.local/seeduplex-profile.json
```

Use the reviewed profile described in [Seeduplex integration](protocol/seeduplex-integration.md).
Mock business authorization does not verify supplier protocol/ACK behavior.
The homepage opens the microphone only after a real normalized provider-ready
event. There is no synthetic voice toggle in the POC. `/dev/replay` remains a
separate, clearly synthetic engineering tool. We did not call a real provider
during implementation; the key on your local machine is needed for listening.

## Architecture and scope

| Part | POC implementation |
| --- | --- |
| Web | Same-origin launch refresh, modes, continuous microphone, playback, progressive subtitles, ended-session summary cards, four fictional learner selections, three-part profile inspection and preference controls |
| POC BFF/gateway | Existing owner/scopes/signature checks, single-use launch nonce and WebSocket ticket; forwards business operations through ports |
| HSKai interface | `apps/hskai-mock` local HTTP service implements signed launch, three learner-data interfaces, memory, privacy and safeguarding contracts |
| Identity/course | Four fictional adult learners (HSK1/3/5/7) with UID-scoped profiles and an authored completed Mission fixture; not real accounts, consent records or completed courses |
| Preferences | Five bounded fields: interest, correction, language support, reported comprehension and known expressions; source/update/expiry validation and owner isolation; process memory only |
| Learning evidence | Task 07 builds sourced, bounded summaries for all entries; Task 08 renders expression cards and one optional review. Supported sports-likes rules separate target text and attempts. Authored mock mastery is explicitly separate from live attempted-only evidence; no live mastery or pronunciation score is inferred |
| Voice | Real Doubao adapter, independent from mock business state; readiness, response ownership, interruption and context ACK rules unchanged |
| Safety | Local mock case ACK returns `mocked: true`, `delivered: false`; UI says no human handoff, and human-delivered metrics are not incremented |
| Privacy workflow | Export/erase/status simulate local preference processing only; mock completion does not assert vendor deletion or a full learner-data export |

The UI permanently labels local mock identity/course/preferences, including when
real voice connects. Diagnostic export separately records `business_source` and
voice kind; real provider readiness never changes mock course data into real data.
Preferences and workflow requests disappear when the process stops; restart
restores the authored preference fixture and rotates the secret. No database or
new external service is required. Never use this mock as a public authentication
system. This build remains loopback-only and internal.

## Contracts

The Web calls `GET /api/runtime` to discover the backend. In mock mode it calls
same-origin `POST /api/poc/launch` with a selected, allowlisted mock `uid` (or `{}` for Alex) before protected operations. The gateway
asks the local service for that fictional learner's signed assertion and sets a 60-second
HttpOnly SameSite=Strict cookie at `/api`. Only the mock UID selector is accepted; arbitrary owner/learner identities, scopes or Mission contents
are not accepted from the browser, and the assertion is absent from response JSON.
The ordinary HskaiBridge still verifies it. Cookie refresh supports new sessions,
expired access and preference export after a long conversation. Local HTTP cookies
omit Secure; no public cookie-routing behavior is claimed.

Server-to-server requests use the existing signed `hskai-memory`, `hskai-privacy`
and `hskai-safeguarding` audiences. The mock verifies signature, expiry, issuer,
audience, operation and nonce, rejects browser-origin requests, bounds request
bodies/state, and scopes records to owner/learner. External port constructors
remain HTTPS-only. The POC composition explicitly allows HTTP only to literal
loopback IPs; it cannot point at an external HTTPS address in that mode.

External adapter code is retained for a future replacement, but is not a POC
dependency or a request to implement changes in another repository. The older
integration inventory and foundation plan are historical context. Production
release checks still report their separate real-user/service acceptance gaps;
they do not block starting the independent POC. Tasks 05–10 continue against
the local business backend and real voice when configured.

See [four learners, data contracts and follow-up plan](mock-learners.md) for the new three-interface integration and pending differentiated goals / conversation comparison.

## Engineering verification

134 tests and three synthetic replays pass locally. Tests exercise the actual
POC process entrypoint, local signed HTTP contracts, owner/nonce/origin isolation,
Mission tickets, preference export/delete, reset on restart, mock privacy scope
and no false human handoff. Chromium passes UI mock labels, Mission selection,
cookie refresh, preference operations, mobile overflow and existing native audio
checks with a synthetic device. No real Doubao or external HSKai was contacted;
real voice/listening acceptance remains your next local check.
