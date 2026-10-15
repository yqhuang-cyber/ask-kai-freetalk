# Seeduplex 3.0 integration from supplied official evidence

Reviewed static evidence on 2026-10-04 (Asia/Shanghai): the user-supplied 14-page
official API PDF and the Go 1.24, Python 3.7 and Web demos linked inside it.
No demo code was executed and no demo transcripts/keys were copied into this repo.
The initial static review did not call the supplier. On 2026-10-10 the separately
authorized Actions connection probe observed real session readiness; see
[live probe scope and results](actions-connect.md). The separate **接入必读** page was
initially unavailable. Its [current official page](https://docs.volcengine.com/docs/DoubaoVoice/access-mustread?lang=zh)
was retrieved on 2026-10-09; it describes migration and control events, but does
not replace actual account validation of ACK ordering and terminal ownership.

## Source provenance

| Source | SHA-256 | Location |
| --- | --- | --- |
| Supplied official PDF | `702867cc74d8bfc5f6135313aefe8801ce8ff8fbaec53889160924480f96df9b` | User attachment; API URL below |
| Go demo archive | `417791341ecae230b369d9d1e9ee2b2c52557e17167e3e4d53b13b45f807b971` | [Official download](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_623b7ef30ec3660a806e92bde33d05d8.zip) |
| Python demo archive | `bcd9a6a8b4672bc25057dab06c4425a791dfac79f17c2421c251b0916eccf7c0` | [Official download](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_148ee77d3245e465d244b912d1e83c91.zip) |
| Web demo archive | `47e854d2887bca4a6c9b56bd0b006108c6acaf5dcb74ed28ca5133ac06356131` | [Official download](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_40e78e155a0960f1fa2cdafc098a4254.zip) |

[API](https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh)
and [接入必读](https://www.volcengine.com/docs/6561/2549732?AuditDocumentID=397063&lang=zh)
are authoritative. Static examples establish supported fields, not an actual
account's permissions, payload ordering, audio quality, retention or availability.

## Mapping and restrictions

| Wire contract | Adapter behavior | Evidence |
| --- | --- | --- |
| `X-Api-Key`; model `1.2.6.1`; fixed duplex endpoint | Server-only `DOUBAO_API_KEY`, no redirect | PDF body pp. 1–2 |
| input `pcm`, 16000 Hz; output `pcm_s16le`, 24000 Hz | Reuse mono 20ms/640-byte browser capture and signed-int16 playback | PDF body p. 2; `config.py` |
| output `pcm` means **32-bit** PCM | Reject this format instead of misplaying it as int16 | PDF body p. 2 |
| `session.created`, `session.id` | Normalize readiness only after the event | PDF body p. 10; Go `SessionCreatedEvent` |
| ASR `started/delta/completed`, `item_id`, `delta`; actual completion `text`, legacy fixture `transcript` | Candidate on first recognized character; observed cumulative hypotheses replace partials, including revisions/shortening; final uses `text` or compatible `transcript`, conflicting finals fail closed | PDF event table; Go/Python typed examples; 2026-10-11 real trial field/snapshot observations; Task 03 local policy |
| text delta IDs; audio.started/audio.done IDs; ID-less audio.delta | Alias separate turn/reply namespaces; bind PCM only to the explicit exclusive audio.started lane | Go typed demo fields + 2026-10-10 actual TTS observations |
| `response.cancel` is type/event_id; `response.canceled` is ACK | One outstanding control; fence cancelled output; ACK attaches only to captured pending reply | PDF body pp. 9, 11; Go `SimpleEvent` / `baseEvent` |
| `session.update` sends session instructions; `session.updated` ACK exposes session ID | One outstanding update; verify session ID, deduplicate ACK, map to local pending version | PDF body pp. 1, 10; Go `SessionCreatedEvent`; Python client |
| `response.output_audio.done` vs ID-less `response.done` usage | Identified audio.done completes internal output after any started text stream is done; usage does not complete a reply | PDF body pp. 10–11 + 2026-10-10 actual TTS observations |
| Output text final | Emit only an exact suffix of deltas; rewritten text fails rather than duplicating subtitles | PDF event types + local bounded display policy |

**Unresolved wire gates:** the demos do not provide a typed `response.done`
payload or a guarantee that ACKs echo client event IDs. We do not assume an echo.
The implemented ACK policy instead requires unique server event IDs and a single
pending control on an ordered connection. `realtime.ordered_acks_reviewed` must
be explicitly attested only after reading 接入必读 and approved account testing.
Duplicate ACK event IDs are ignored; wrong-session, unsolicited and overlapping
controls fail closed. Task 03 now fences/stops locally during a pending update
and queues the captured cancellation. Only one cancel/update goes over the wire
at a time. A queued stop is skipped if that reply has already completed or been
replaced, because simple response.cancel has no target ID; this is not a fake
cancel ACK. The cancellation timeout starts at actual send. See [Task 03](../turn-taking.md).

The 2026-10-10 real authored TTS probe confirmed ID-less audio.delta and
response.done containing only response.usage. The repaired adapter binds ID-less
PCM to an identified audio.started lane, keeps cancelled output discard-only
until ACK, and rejects a new audio boundary while an old lane or cancellation
barrier remains unresolved. After a lane closes, orphan chunks stay fenced.
Closed IDs cannot reopen it. This relies on ordered, exclusive audio boundaries;
ID-less bytes cannot reveal arbitrary supplier mislabeling after a new boundary.

ID-less usage is separate telemetry with no inferred reply owner. Internal
response.done means reply **output** completed, using identified audio.done and,
if text has started, text.done. It is not a supplier interaction/usage ACK.
Late usage cannot clear a new reply, acknowledge a control or create an attempt.
Explicit-ID response.done remains compatible with already reviewed fixtures.
See [repair probe and remaining acceptance](actions-connect.md). Unknown tool requests fail.
Tools, history continuation, locations and any other model extension settings stay
disabled. The voice adapter adds one field on `session.create`:
`extension.dialog.extra.enable_user_query_exit` set to `true`. The committed
profile JSON stays without it, so pinned connect-probe hashes do not move.
The full-duplex page says this makes
`response.output_audio.done` carry an exit-intent signal for the client to close.
That page does not print the signal JSON. 接入必读 maps the event to old
`TTSEnded`, whose published example uses `status_code` `"20000002"`. The adapter
reads that value, then the client closes and saves. No safety setting is inferred
from any other demo extension field.

## Internal setup

1. Copy `docs/protocol/seeduplex-profile.template.json` to
   `.local/seeduplex-profile.json`; the template has three review flags **false**.
2. Confirm product access/model/voice against the account and full official docs.
   The voice is an official demo example, not an account permission check.
3. Configure the server's ignored `.env`: `DOUBAO_API_KEY` and
   `DOUBAO_PROBE_PROFILE=./.local/seeduplex-profile.json`. Never paste a key in
   chat, browser UI, profile JSON, traces or commits.
4. After static review set top-level `reviewed=true`. Run `npm run probe:preflight`,
   then `npm run probe:live`. This bounded **metadata-only** probe mutes supplier
   input after readiness to obey keepalive guidance and sends session.close on
   cleanup. Supplier error events fail the probe. It uploads no microphone audio
   and does not prove voice/cancel/context behavior. Usage may be billable.
5. Use approved operator testing plus 接入必读 to verify IDs, ACK ordering, stale
   events and terminal ownership. Only then mark `realtime.reviewed` and
   `realtime.ordered_acks_reviewed=true`.
6. For the independent POC configure `ASK_KAI_PROVIDER=doubao`,
   `DOUBAO_REALTIME_PROFILE` (same reviewed path) and the local key, then run
   `npm run poc`. Local mock HSKai generates signed fixture authorization; no
   external HSKai endpoint, account or bridge secret is needed. See
   `../standalone-poc.md`. The ordinary signature/scope/ticket checks still apply.

Defaults remain disconnected, loopback-only and internal. A key being configured
on some other service does not make it available to this code workspace.
No deployment, real account connection or HSKai production mutation is included
in this change. Real browser/device AEC, reply timing, pauses, consent, safety,
privacy and release gates remain required.

## Verification

Authored synthetic tests exercise the official-shaped contract, text-before-audio,
partial/final ASR, output suffixes, audio/interaction completion distinction,
cancel ACK with a newer reply, duplicate/wrong-session ACKs, malformed ownership,
PCM bounds, masked errors and gateway teaching updates over a local WebSocket.
The metadata probe has synthetic readiness/mute/close/error regression.
These tests are not live supplier fixtures or true-device speech acceptance.
