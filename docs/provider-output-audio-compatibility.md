# Bounded provider output audio compatibility

The full evaluation recorded a 92,844-character base64 output packet rejected by the previous 87,384-character guard. This confirms a length rejection; the original PCM packet is unavailable, so it does not prove every field was valid.

The Seeduplex adapter now accepts canonical, nonempty, even-length PCM up to 90 KiB per owned provider packet and emits ordered internal chunks no larger than 64 KiB. This leaves room for protocol fields within the existing 128 KiB socket limit. This bound is a local compatibility policy, not a supplier guarantee. Web playback, internal contracts, cancellation fences and input audio framing retain their limits. Oversized or malformed packets still fail rather than being truncated.

Synthetic tests concatenate output chunks byte-for-byte, validate runtime ownership and reject malformed, noncanonical, odd, oversized and cancelled output. Real-provider collection and audible Web acceptance remain separate checks. Historical 018 collection records are preserved.

## Web playback burst repair (2026-10-14)

A separate browser guard rejected the next chunk whenever already scheduled playback was more than three seconds ahead. `web.js` then closed the entire conversation and cleared playback. Valid PCM arriving faster than it can play therefore produced a truncated reply and re-enabled Start. This is a reproduced failure path; the reported learner session had no diagnostic record, so its exact failure remains unconfirmed.

The queue now permits up to 30 seconds including the incoming chunk (~1.44 MB of decoded PCM at 24 kHz; browser Float32 buffers use ~2.88 MB). Packet, node and ownership limits remain in force. Cancellation still stops all scheduled output immediately without changing capture generation. Failures now display a fixed category-specific message and “连接中断” before audio cleanup, retain the cause after socket close, and preserve only allowlisted metadata codes.

Validation is separated by source:

- Synthetic: `npm run verify` passed all 424 tests in the isolated commit tree (433 in the shared workspace with unrelated pending learner changes); `npm run replay` passed all three fixtures. Added eight-second burst, whole-chunk queue bounds, interruption, and sanitized failure-code regressions.
- Real provider with authored input: an OS-synthesized utterance yielded one final, one complete reply, two confirmed context updates and no session/protocol failure. A fixed authored TTS probe received all 40 chunks / 19,801 ms of PCM, with an estimated scheduled queue peak of 17,410 ms. The old guard would have rejected this burst; the new playback scheduling code did not. This used a simulated playback clock, no microphone, and no retained provider text or audio; it is not audible-device acceptance.
- Browser synthetic device: the Chromium check now queues a 7.2-second burst into native AudioContext and verifies complete playback/captions, suspend/resume, continued capture, and a persistent visible failure cause. Real microphone/AEC/listening acceptance remains separate.
