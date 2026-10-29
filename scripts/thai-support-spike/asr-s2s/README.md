# Front ASR → current S2S capability spike

**Runtime update (2026-10-29):** the isolated experiments below remain available,
and the Thai page now separately implements the user-selected manual Chinese/Thai
route. See [runtime implementation](../../../docs/free-talk-thai-input-bridge-implementation.md)
and [layered checks](../../../docs/eval-results/2026-10-29-thai-input-bridge.md).
The same ASR settings now configure that runtime; `ASK_KAI_THAI_INPUT_MODE=native`
disables its input bridge. Historical statements below describe the initial spike.

This is an isolated, authored-input experiment, not a product provider or a new
Thai page setting. It never starts the application, changes a profile, collects
learner audio, or sends microphone audio simultaneously down two answer paths.

Configuration: [ASR setup spike](../../../docs/free-talk-thai-asr-setup-spike.md).
`DOUBAO_ASR_API_KEY` overrides the existing `DOUBAO_API_KEY` only for ASR.
`DOUBAO_ASR_RESOURCE_ID` defaults to `volc.seedasr.sauc.duration`. Explicitly
configured resources never trigger the legacy access fallback. Run
`node --env-file-if-exists=.env scripts/thai-support-spike/asr-s2s/run.js --preflight`
to inspect presence and selected resource without a network call or key output.
Preflight cannot verify service permissions. These settings do not enable app ASR.

Run `node --env-file-if-exists=.env scripts/thai-support-spike/asr-s2s/run.js`
for a dry run; append `--live` for bounded actual supplier calls. Private authored
audio and normalized review text go under `.local/thai-support-spike/asr-s2s/`.
Only explicit metadata is printed. No wire traces, keys or provider identifiers
are saved. `--stage=asr` / `--stage=s2s` restrict collection; the S2S-only stage
uses authored text and must not be reported as an ASR-to-S2S pass.

## Predeclared gates (2026-10-29)

1. Independent ASR: `bigmodel_nostream`, `enable_auto_lang: true` for Chinese,
   Thai and concatenated mixed speech, plus fixed `th-TH` as a Thai control.
   Use only macOS authored synthetic voices, 16 kHz PCM16 mono. A final result,
   transcription accuracy and final-packet latency are separate observations.
   Account denial does not prove lack of Thai model capability. Try ASR 2.0;
   if all calls fail before upgrade, make one ASR 1.0 access control attempt.
2. Native Seeduplex 1.2.6.1 / current Thai profile / Vivi voice:
   - Chinese audio question is the positive generation control.
   - `conversation.item.create` with a single user message is an explicitly
     experimental use of the documented history event, outside its complete-QA
     guidance. Observe rejection, ACK-only, timeout or a generated answer.
   - A complete authored QA pair is the documented history control.
   - `speech_text_buffer.commit` with the question is the specified-text speech
     control. Reading the question is not answering it.
   No guessed `response.create`, text-buffer event or O2.0 binary event is sent.
3. Count a bridge pass only when the exact final text from the real ASR is sent,
   and S2S answers the question with completed non-silent audio. History ACKs,
   direct recitation, and unrelated spontaneous output are insufficient. A
   finite quiet observation cannot prove every possible text path unsupported.
4. No product adoption without turn ownership, single answer authority,
   cancellation/late-ASR isolation, Chinese/Thai switching and end intent checks.
   This capability spike does not fabricate learner turns to satisfy an adapter.

## Primary evidence

- [ASR protocol and language modes](https://docs.volcengine.com/docs/doubao-voice/large-model-streaming-automatic-speech-recognition-api-1?lang=en)
- [Current native Seeduplex protocol](https://docs.volcengine.com/docs/doubao-voice/end-to-end-real-time-voice-full-duplex-version?lang=zh)
- [Official Web demo](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_40e78e155a0960f1fa2cdafc098a4254.zip),
  SHA-256 `47e854d2887bca4a6c9b56bd0b006108c6acaf5dcb74ed28ca5133ac06356131`.
  Static review only: `send_text()` sends `speech_text_buffer.commit`.
- [Other S2S versions' text query](https://docs.volcengine.com/docs/doubao-voice/end-to-endreal-time-speech-large-model-api-access-document?lang=en)
  is a different binary endpoint, not an assumed current protocol feature.

## Follow-up hypothesis (declared after the first run, before follow-up calls)

The first run found history accepted only for a complete QA, no text-triggered
answer, and ASR account denial. A separate `followup.js --live` tests a workaround:
inject an explicitly authored Thai-question / neutral-assistant-placeholder QA,
wait for the actual `conversation.item.added`, then send the same fixed Chinese
activation audio. Use two Thai arithmetic problems with different answers; the
placeholder and activation must contain neither answer. This is **history plus
audio**, not a native text query, a real ASR bridge, an actual prior model answer,
or evidence of product turn ownership. A successful pair is only an exploratory
reason to investigate this more complex route, never a production acceptance.

The first follow-up's ACK did not establish that the question was model-visible.
A format/readback control (`followup.js --live --text-content`) uses the Go
demo's other documented content type `text` instead of `input_text`, retrieves
the history, checks exact user-question text, then activates. Do not generalize
failures from a payload whose history visibility has not been confirmed.

Both content-type variants produced no answer; retrieved `text` variant history
contained empty user/assistant text. A further `--initial-history` control uses
the separately documented `session.create.extension.dialog.dialog_context`
role/text pairs, reads back before the same activation, and changes nothing in
the live product. Initial-history success would not establish a persistent
text-query or runtime history-update contract.

Initial-history readback and both arithmetic answers succeeded. The next
independent `update-history.js --live` tests two `session.update` calls on one
socket, each carrying `extension.dialog.dialog_context`; it requires the real
session ACK, exact history readback and a 500 ms quiet interval before sending
the same activation audio. It preserves the previous actual answer in the
second authored context. No response before activation is counted as a text
query guarantee; no product ownership or front-ASR success is inferred.

Runtime history update ACK arrived, but exact history readback failed, so that
run stopped before activation. Final bounded alternative:
`update-history.js --live --instructions` puts authored Thai question data and
previous actual answers in a quoted JSON section of `session.instructions`,
waits for its ACK, then sends the same activation audio. Two different questions
on one socket distinguish current question handling from replay of the previous
answer. This is a **prompt-context workaround**, not a native text-user-turn API.
Do not adopt arbitrary learner text as system authority: role separation,
injection handling, ownership, cancellation and recognition readiness remain
unverified product gates even if this authored arithmetic control succeeds.

The `run.js --live` entry also prepares the complete candidate for a future
authorized ASR account: only if a real Thai ASR final exists, it passes that
exact unmodified text through initial history, verifies readback, and sends
authored activation audio. With no real ASR final it explicitly skips this
bridge instead of substituting an expected transcript. Collection remains
`bridge_pass: false` pending independent semantic review; production multi-turn
acceptance remains separate. This conditional branch could not run in the
current denied account and is not a successful live result.

## Workaround stability batch (predeclared 2026-10-29, before batch calls)

`stability.js --live` freezes 3 conversations × 6 turns (18 planned S2S sessions,
12 independent Thai ASR requests). Every turn opens a fresh S2S connection;
complete prior QA records use actual recognized input and actual provider output.
Thai uses exact real ASR final + neutral placeholder + the unchanged authored
activation phrase. Chinese uses native audio, retaining prior QA at session
creation. All nonempty prior history and the current Thai question must match
readback before audio is sent. There is no live language classifier in this test:
the authored case explicitly selects the route, so routing accuracy is untested.

Coverage: different Chinese names/preferences, Thai name recall across rebuilt
sessions, three translation requests, Chinese/Thai switches, different arithmetic
answers after previous answers, two goodbye requests and one negated ending /
continue request. The simplified provider prompt stays unchanged; full M3 or M2
closing is not exercised. First run only; no silent retries or case removal.
An incomplete turn stops that conversation and preserves the failed denominator.

Report transport completion, ASR meaning, question/answer correctness, history,
Chinese-first/Thai surface, Unicode replacement characters and first audio
latency separately. Keyword presence alone is not a semantic pass. Authored
text is privately reviewed after collection; Thai pronunciation and browser
audio are not accepted. Product cancellation, late-event handoff, concurrent
audio and automatic hangup are still unimplemented acceptance gates and cannot
be proved by provider completions in this batch.

After the frozen 18-turn batch completed, 3 assembled streams contained U+FFFD.
An independent `text-final-check.js --live --source=<batch-folder-name>` compares
normalized delta assembly and `response.output_text.done.text` for one native
Chinese and one initial-history Thai control. It changes no prompt, decoding or
output selection; it only adds separate final-text observation. This diagnostic
does not rerun, overwrite or repair the original batch. Its source snapshot and
original measurement flags remain private with the immutable batch metadata.

Results: [18-turn stability review](../../../docs/eval-results/2026-10-29-thai-workaround-stability.md).
