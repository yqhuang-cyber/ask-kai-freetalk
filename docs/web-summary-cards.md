# P0 Task 08: Web session summary cards

2026-10-09. Engineering implemented for sports, Mission and free chat in the
standalone Web POC. The production WebSocket receiver consumes Task 07's
versioned summary; no additional model, external HSKai service, database,
transcript export or provider configuration is introduced.

## Student experience

The summary stays hidden during the conversation. After ending, a nearby
“查看本轮小结” link points to the section below the conversation workspace.
The section contains a short Chinese-first bilingual headline, entry label,
the current planned goal when present, and only observed supported expressions.
Planned goals are not expression achievements. An unsupported Mission target
is explicitly unassessed and does not produce sports-expression credit.

Each expression card shows approved Chinese, pinyin and corresponding English.
An attempted expression displays its recognized attempt count. A target found
only in a completed forwarded reply says “回复中的表达 · 尚无尝试记录”. Forwarding
does not prove display, hearing or understanding. At most four bounded authored
expressions and one optional “可再练一句” item are shown. No mastery, independent
use, pronunciation result or weakness diagnosis is inferred.

| Received state | Web behavior |
| --- | --- |
| Practice observed | Supported expression cards with actual attempt counts and optional review |
| Target text observed | Expression cards explicitly marked without student attempts |
| Conversation only | “本轮以交流为主”, without forced learning cards or review |
| Insufficient | Honest insufficient-record headline; no expression or review cards |
| Ordinary early failure | Received partial facts remain labeled as partial |
| Missing or rejected summary | Summary unavailable, without fabricated recovery or learning data |
| Safety restriction / revoked authorization | Clear goal, word card, counter and retained summary; block late learning packets and show no learning points |

The card's “再聊一轮” button invokes the existing user-triggered start flow.
Rendering never opens the microphone, plays speech or starts another session.
Actual provider readiness remains required before microphone capture.
Local mock identity/course data and synthetic engineering data remain labeled.

## Ownership, privacy and rendering

The client binds the receiver to the session ID returned by its current ticket
and the selected entry mode. It accepts one valid `kai-summary-v1` snapshot,
checks schema, source ownership, bounded text/arrays, count consistency and
attempt-only assessment fields, then renders only after the session ends.
Invalid/foreign/unknown-version packets cannot replace the current view.
An ended or suppressed receiver rejects later summary packets. The existing
WebSocket generation fence also rejects callbacks from a previous session.

New start, entry change and page reload clear the summary. Ordinary ending keeps
it visible for review in the current page. Successful preference deletion also
clears retained learning content. No localStorage, durable history, new download
route or server-side summary recovery is added. Lost transport can prevent a
summary from arriving, which is reported as unavailable.

The display projection strips session, learner, owner, event, reply and course
identifiers. Labels and authored examples use DOM `textContent`; no model or
learner string is inserted as HTML. Raw transcripts and audio are absent. Cards
use a responsive grid, English language annotations, a labeled section, status
announcement and native link/button controls. Chinese font availability remains
a device typography check, separate from layout and DOM correctness.

The observation rules are still bounded to the approved sports-likes vocabulary.
Free chat can have zero knowledge points; arbitrary expressions are not extracted.
See [Task 07's sources and limits](session-summary.md).

## Verification and remaining acceptance

`npm run verify` passes all 187 tests, including seven new focused projection/state regressions
for all entry modes, empty/text-only/partial views, provenance/count rejection,
copied snapshots, missing receipts, restart isolation and suppression.
`npm run replay` passes all three synthetic scenarios.

Native Chromium checks exercise the production renderer with summaries from the
real deterministic builder, Chinese/pinyin/English cards, counts, optional review,
conversation/insufficient/unsupported states, partial warnings, safety/revocation,
literal HTML-like text, restart/reset, 390px mobile and desktop layout. The actual
WebSocket End path renders an insufficient summary from a synthetic transport
that withholds provider readiness; a new start clears it. Zero page errors and
no microphone requests before provider readiness are asserted. Existing native
AudioWorklet/capture/caption regressions continue to pass.

No real Doubao, actual learner transcript/audio, live Judge or external HSKai was
used. Tasks 09/10 remain responsible for real content/ASR accuracy, listening and
device acceptance. Engineering cards alone do not complete POC acceptance.
