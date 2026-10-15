# P0 Task 06: playback-aware progressive captions

2026-10-09. Engineering implemented for the standalone Web POC. Uses the existing
reply-owned Presentation and AudioIO pipeline; no new voice provider, planner,
HSKai dependency or transcript store. Real Doubao/device listening acceptance
remains pending. This replaces the initial fixed 70ms character reveal.

## Presentation behavior

- Buffer incoming deltas and reveal readable clauses/short phrases, including
  when a whole reply arrives in one delta. Completion never dumps the remaining
  text or stops audio still queued in the browser.
- Prefer punctuation and word boundaries. Hold an unfinished English token
  (`foot` + `ball`), preserve contractions/decimals and avoid splitting normal
  words. Long text is limited to 12 estimated speech units or 64 code points per
  phrase where boundaries permit; exceptional unbroken tokens split at a safe
  grapheme boundary. Closing quotes/whitespace stay with their phrase. The whole
  reply is capped at 4,000 UTF-16 code units; this is an operational bound, not
  the much smaller Task 04 reply budget.
- Preserve original Chinese/English order. Task 04 asks the model for each short
  Chinese sentence followed by its corresponding short English. Captions do
  not translate or reorder invalid model output independently of the speech.
- Previous phrases remain visible for the current reply, with the newly revealed
  phrase emphasized. This is ephemeral current-reply text, not a complete
  session history. Replacement, cancellation, end and reset clear it and all
  unrevealed text/timers. Reply ownership rejects old IDs; timer epochs also
  fence callbacks after an explicit reset reuses an ID. The WebSocket generation
  fence rejects messages from previous sessions.
- Web controls hide/show captions and select small/standard/large text. Hiding
  does not pause the caption clock or the microphone. Output mute and interruption
  also leave microphone upload active; ending the session closes capture.

## Approximate clock and fallbacks

AudioIO tracks the scheduled PCM spans for each response. Played milliseconds
count only intersections with those spans; the initial scheduling lead-in and
network underrun gaps are excluded. Finished spans are pruned, counters remain
monotonic, and stopping playback clears the response clock. Live nodes and
metadata are bounded, including tiny-chunk input. An old audio node's ended
callback cannot mark a replacement reply drained.

The browser prefers a usable `AudioContext.getOutputTimestamp()` pair, estimates
the output position near that sample and clamps it to `currentTime`. Missing,
zero, stale or throwing timestamps fall back to the rendering clock. A suspended
or interrupted context does not use wall-time extrapolation and pauses caption
reveals. See the primary [Web Audio specification](https://www.w3.org/TR/webaudio/#dom-audiocontext-getoutputtimestamp).
These are browser playback estimates, not proof that a person heard the audio.

No reviewed word/phrase timestamps are consumed from the supplier. Before
completion, cues use a provisional 300ms per estimated unit (Han character,
Latin word, numeric group or emoji grapheme). Once response.done establishes the
received PCM and final text, remaining cues use the proportion of cumulative
text units over the total PCM duration. This weighting is approximate; it does
not account for pauses, Chinese/English duration differences or phonemes.

| Situation | Behavior |
| --- | --- |
| Text before audio | Buffer; do not reveal while the reply is still streaming without audio |
| Audio before text | Start the response clock; later text follows current progress without a burst |
| PCM accepted but not yet played | Wait for playback to start |
| Clock suspended/interrupted | Pause captions; resume with playback |
| Network underrun | PCM progress excludes the gap; wall time alone cannot satisfy a future cue |
| Late text or very short audio | Catch up at most one phrase per reveal interval; captions can finish after audio |
| Completed reply with no accepted audio | Progressive text-only fallback, explicitly labeled during and after display |
| Audio reply with no text | Play normally; completion states that no captions were received |
| Cancel/replacement | Immediately clear audio, clock, visible text and buffered phrases |

`kai-captions-v1` uses an 80ms polling interval, at least 320ms between phrase
reveals, and a 400ms wait before an unpunctuated stable prefix can be segmented.
These values are provisional engineering defaults; they are not measured real
latency/readability targets. A delayed timer reveals only one phrase rather than
dumping all overdue captions. Text-only completion still observes this cadence.
There is no invented audio fallback or simulated provider readiness.

## Metadata and validation

Opt-in diagnostics add caption modes, phrase units/counts, pending/visible
character counts, estimated played/received/queued PCM milliseconds, cue position
and clock source. IDs are aliased; raw text/audio are excluded from exports.
`caption_phrases` counts retained reveal events and can undercount when the
bounded timeline is truncated. Gateway and browser clocks remain separate.
Neither `audio.drained` nor caption completion is a learner-delivery receipt.

Focused tests cover burst arrival, audio-first/text-first, split words and
bilingual ordering, paused clocks/underruns, text-only completion, cancellation,
stale callbacks, limits, PCM span accounting, timestamp fallbacks and metadata
privacy. Native Chromium checks use authored text and silent PCM with a synthetic
microphone: real AudioContext/AudioWorklet, progressive display, suspend/resume,
font/toggle controls, continuous capture and mobile overflow. They are clearly
synthetic and keep provider_connected false.

Local results: 162 tests passed (10 new focused caption/audio regressions), three
synthetic replays passed, and the native Chromium check passed with zero page
errors. No real provider or learner audio/transcript was used.

Run `npm run verify`, `npm run replay` and `npm run test:browser`. The engineering
replay route remains a separate event debugger; it is not this student caption
renderer. Task 09 expands regression. Task 10 must use real-account E01/E07/E08
listening on target desktop/mobile devices: compare perceived speech/caption
progress, late final text, pauses, backgrounding and cancellation, then calibrate
the provisional values. Chinese typography also needs a device with CJK fonts.
Task 07 now provides [sourced structured summary data](session-summary.md).
Task 08 next renders the Web summary cards.
