# Seeduplex protocol Spike: verified facts and open gates

Checked 2026-10-04 (Asia/Shanghai). This step implements a connection probe,
not a completed speech adapter or proof of an actual account connection.

**Update:** the supplied official API PDF and its linked Go/Python/Web demos have
now been read. Auth/audio/event names are mapped in
[Seeduplex integration](seeduplex-integration.md), with a dedicated adapter and
`seeduplex-profile.template.json`. The inventory below preserves the original
spike's evidence boundary; its previously unknown static fields are superseded
by that mapping. 接入必读, ACK ordering, terminal ownership and actual account
speech acceptance remain open. This workspace contains no live credential.

## Sources and evidence

1. [Official full-duplex API](https://www.volcengine.com/docs/6561/2549778),
   redirected to the README's full-duplex document URL. The available retrieval
   returns a JavaScript application shell, not the full API tables. Auth headers,
   model version, codec format, ready/cancel/update events and payload details
   could not be confirmed from this source in this environment.
2. [Official iOS SDK](https://docs.volcengine.com/docs/6561/2556358) explicitly
   describes Seeduplex, JSON protocol, the duplex endpoint and session.create.
   It configures an SDK API key but does not establish the raw WebSocket auth
   header here. Do not infer the raw header from TTS, Ark or the old voice API.
   This is protocol evidence only; the Web-first project includes no iOS SDK.
3. [Undici WebSocket API](https://github.com/nodejs/undici/blob/main/docs/docs/api/WebSocket.md)
   documents its Node-only constructor options with additional headers. Local
   Node source and a real loopback WebSocket peer verify this transport path.
   CI checks Node 22 and 24; it does not contact Volcengine.

| Area | Confirmed | Still required |
| --- | --- | --- |
| Endpoint | wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue in official SDK | Account access and deployment egress |
| Session initialization | JSON session.create with a session object | Required settings, supported model and speaker |
| Auth | SDK accepts an API key | Exact WebSocket header and any other required headers |
| Transport | Built-in Node WebSocket with additional headers works against a local test peer | TLS/handshake with approved account |
| Audio | No codec claim made | Format, bit depth, sample rates, packet sizes and framing |
| Readiness | No raw ready event defaulted | Full API event type and actual session ID path |
| Reply isolation | Internal reducer has synthetic regression | Actual provider reply IDs and terminal semantics |
| Cancel/update/tools | Not mapped | Exact requests, acknowledgements, ordering and timeouts |
| Subtitles | No sync claim made | Text granularity and measured alignment with playback |

Do not use unrelated third-party tutorials or OpenAI-shaped event names as the
provider contract. HSKai's existing binary dialogue framing is separate evidence
and is not proof of compatibility with this endpoint.

## Probe commands

`npm run probe:preflight` runs without network. The committed template has
reviewed=false and cannot open a socket, even with credentials present.

After obtaining the full API spec, a developer must review the profile mappings:

1. Copy docs/protocol/duplex-profile.template.json into .local/duplex-profile.json.
2. Confirm auth.header, auth.env (a DOUBAO_* env name), auth.prefix, ready.type,
   ready.session_id_path, allowlisted observed_event_types and identity_paths
   from the full API. The session settings must come from that same spec.
3. Record the official evidence_source and set reviewed=true only after review.
   A boolean is an operator attestation, not automatic verification.
4. Configure DOUBAO_PROBE_PROFILE and the test credential in local .env. Never
   put keys in JSON, README, commits or chat. A key is not currently available
   to this project; the current implementation performed no live account call.
5. Run npm run probe:preflight, then npm run probe:live explicitly.

The live probe sends one reviewed session.create, observes for five seconds,
then closes. It does not capture microphone input, upload voice, playback audio,
cancel replies or update context. It can incur provider usage depending on the
reviewed session settings. Use an approved internal test account.

The endpoint is fixed; auth cannot be redirected to another domain. Unknown raw
payloads, errors and credentials are not printed. Reports contain allowlisted
event types, times, byte lengths and safe top-level structural keys. Reviewed ID
paths are aliased with a random per-run HMAC salt; aliases correlate only within
one report. No actual provider IDs, field values, audio or transcript are saved.

socket_open_observed and session_ready_observed describe historical observations.
provider_connected is false after probe cleanup. HTTP upgrade alone is never
reported as session readiness. Early remote close, abort, malformed input and
limits are distinct outcomes. The CLI succeeds only when readiness was observed
and the observation duration completed without another stopping condition.

Report length and observation time are bounded. Frame size checks apply after
Node assembles a WebSocket message; they are not a preallocation transport cap.
Production use needs transport-level backpressure/message limits and a verified
shutdown policy. The probe is not exposed through learner-facing HTTP routes.

## Current verification

The local suite tests profile gates, credential masking, actual header transmission
to a loopback peer, JSON initialization, readiness validation, malformed/oversized
frames, frame limits, aborts, terminal metadata and per-run ID aliasing. All fake
wire events use test.* names and are not presented as Doubao protocol fixtures.

To close F01, archive a reviewed API mapping and run approved account tests for
normal speech, short pauses, echo/noise, natural/manual interruption, late events,
subtitle arrival, session updates, tools, errors and disconnects. Only then replace
the fail-closed DoubaoProvider with a normalized, audio-capable adapter.
