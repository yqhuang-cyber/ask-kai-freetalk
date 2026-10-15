# Current standalone POC runtime

The Web/gateway now defaults to local mock HSKai for signed identity, an authored
Mission fixture and preferences. See [standalone POC](standalone-poc.md). External
HSKai deployment is not required. Real voice readiness and microphone gating
remain independent; mock course data never proves an actual completed course.

# Web realtime implementation and acceptance

The first client is Web. `ws` 8.21.0 provides the RFC 6455 server/client transport,
with compression disabled, bounded messages, bounded buffered output, handshake
timeout and explicit termination. See its [official API](https://github.com/websockets/ws/blob/8.21.0/doc/ws.md).

The loopback gateway can create 30-second, single-use session tickets for a same
origin browser. Tickets travel in the WebSocket subprotocol header, not the URL.
Only a normalized provider session.ready enables microphone capture. Browser
AudioWorklet uploads continuous mono PCM s16le in 20ms frames. The resampler
preserves fractional positions across buffers. Playback has a bounded queue;
mute affects output only. Ending, disconnecting or leaving stops tracks and closes
the AudioContext/provider. HTTPS/localhost is required for microphone access.

Interruption stops client playback immediately without pausing capture. A reviewed
provider speech-start mapping or manual button cancels the active response. The
dedicated Seeduplex adapter treats ASR first-character started as a candidate:
new-turn recognized speech text confirms the captured old reply; punctuation
and isolated hesitation sounds do not automatically cancel. Same-turn/late
confirmation never retargets a newer reply. See [Task 03](turn-taking.md).
An owner-bound output gate waits for a known student's final ASR and a provisional
350ms continuation window. This is presentation policy, not physical VAD.
The runtime fences late text/audio/done; an old cancellation ACK never clears a new
reply. Seeduplex cancel/update controls are serialized while local stop/fencing
happen immediately. Obsolete queued cancels never target a newer response.
Missing ACK closes the connection 1.5s after actual wire dispatch and asks the
user to restart; a queued cancel waiting on context retains the context deadline.
The browser independently checks reply ownership and reveals text progressively;
timers/queued text are cleared on interruption/end. [Task 06](progressive-captions.md)
now buffers short phrases and paces them approximately with played PCM spans,
preferring the browser's output timestamp with a rendering-clock fallback.
No reviewed supplier word timestamps or proven phoneme alignment are claimed.
Completed replies without accepted PCM are explicitly labeled text-only.
No local amplitude-based VAD
is substituted for the provider's full-duplex semantics.

The Seeduplex 3.0 dedicated adapter now implements the supplied official PDF and
Go/Python/Web demo fields: 16k input, 24k int16 output, X-Api-Key, accumulated ASR,
text-before-audio, simple cancellation and serialized session-bound ACKs. See
[its mapping, review gates and setup](protocol/seeduplex-integration.md). Its
unreviewed template cannot enable a connection. ACK ordering and ID-less terminal
events remain real-account gates; this implementation is not live acceptance.

`ASK_KAI_PROVIDER=doubao` additionally needs `DOUBAO_REALTIME_PROFILE` pointing
to a local reviewed profile plus its server-side credential. The generic realtime adapter
extends the step-2 profile with `realtime.reviewed`, an official `evidence_source`,
`audio` (PCM s16le, input/output rate, 20ms frame), an `initial_instructions` path,
explicit `inbound` mappings and explicit `outbound` mappings. Accepted inbound
roles: user_partial, user_final, response_started, text_delta, audio_chunk,
response_done, response_cancelled, speech_started, context_updated, error.
Outbound roles: audio, cancel, context. Mapping paths describe provider fields;
their wire names are never inferred from these internal roles. JSON/base64 PCM
is the only implemented framing; binary/Ogg/Opus requires a separately reviewed
adapter. A profile boolean is an operator attestation, not actual account proof.

No reviewed live profile or credential has been supplied. Default startup stays
disconnected and returns 501 for a speech session. Test providers are injected
only by test code, marked synthetic, and have no startup or UI activation switch.
Existing DoubaoProvider remains a fail-closed compatibility placeholder.

Current acceptance covers a real local WebSocket peer, ticket reuse/origin,
readiness-before-upload, PCM forwarding, identity-bound output, timeouts and
cleanup. It does not establish a real Doubao connection or device AEC quality.
Browser installation was attempted but the Chromium download was invalid in
this environment. A packaged Chromium executable later enabled native local
browser checks with synthetic device audio (controls, AudioWorklet PCM, continuous
capture during playback stop and mobile overflow). The local renderer lacked
CJK fonts, so screenshots alone do not establish Chinese typography quality.
Real-device audio, secure deployed origin and latency remain
required before release. No public hosting or HSKai production mutation occurred.
