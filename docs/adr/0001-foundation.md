# ADR 0001: executable Node foundation, separate replay and voice transport

Status: accepted for step 1, 2026-10-03.

Historical foundation decision. [ADR 0002](0002-standalone-poc.md) supersedes its
external HSKai/framework prerequisites: current execution is an independent POC
with local mock business contracts and a separately configured real voice adapter.

## Decision

Use Node >=22.18, ESM JavaScript and Node's built-in test runner. This step has
no external dependencies and can install offline. `provider.d.ts` documents the
proposed provider port; this is not a TypeScript build or a claim of static type
verification. Runtime event validation is implemented in `contracts/events.js`.

The local HTTP server is a diagnostic shell, not the final HSKai API framework.
SSE is used only to inspect synthetic fixtures. Real WSS, PCM capture/playback,
provider transport and authentication are deliberately not represented by SSE.
Use the verified HSKai Fastify boundary when adding the real gateway in step 2.
Keep SessionRuntime and the provider adapter independent of that framework.

The diagnostic entry point binds only to loopback. It does not request microphone
permission, generate audio, persist transcript, accept credentials or create real
sessions. `/api/sessions` and WebSocket upgrades return 501. Selecting `doubao`
fails startup even if a key is present; the adapter remains unimplemented until
the actual full-duplex protocol is verified.

## Runtime contract

Events are normalized by an adapter before the reducer sees them. Each carries
version, event_id, session_id, seq, at_ms, type and a strictly validated payload.
User and response events carry turn_id; response events also carry response_id.
`seq` is diagnostic receive order and `at_ms` is a relative timestamp. They do
not imply provider ordering or synchronize audio. Fixtures run at fixed pacing.

Session readiness is separate from successful HTTP connection. A failed/closed
session cannot reopen. Every audio/text/done event must match the active response
and its turn. Cancellation retires the old response immediately; its later
acknowledgement cannot clear the new response. Duplicate event IDs, reused
response IDs, overlapping replies and duplicate final turns are rejected.
This reducer assumes reliable normalized response identity. If the provider
cannot supply it, step 2 must establish safe correlation or reconnect behavior;
these synthetic tests do not prove the real provider's cancellation semantics.

Final student text may produce `attempted` evidence with source event and rule
version. Partial text and teacher output never produce evidence. A substring
match is not a proficiency, intent, correctness or pronunciation assessment.

## Platform reuse

The attached Java agent platform is a candidate for context, authorized tools and
background analysis. No source-level integration has been verified. It must not
introduce a second synchronous answer loop in front of the real-time model.
Evaluate it independently while the voice foundation progresses. HSKai remains
the candidate authority for learner/course data; no duplicate database is created.

## Remaining checks

- Actual Doubao product/version, transport, auth and resource settings.
- Response correlation, cancel terminal event and timeout behavior.
- Whether timely text deltas exist and how they align with audio.
- Context update acknowledgment/version behavior and tool-call support.
- HSKai user/learner ownership, consent, market and session-ticket integration.
- Browser AEC, uninterrupted upload, short pauses and interruption latency.

No real-provider or learner-facing readiness is claimed by this decision.
