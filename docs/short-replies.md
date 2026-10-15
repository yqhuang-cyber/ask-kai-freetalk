# Adaptive conversational replies

2026-10-15: the user reported dry, single-sentence acknowledgements and asked to remove artificial reply-length budgets. The current runtime uses `kai-reply-v5`; the older policy below is historical.

Kai first responds to the learner's specific content, question or feeling, then develops the exchange with a relevant observation, explanation or natural follow-up. This is a conversational direction, not a required three-step template. A simple confirmation can remain short; a story or request for explanation deserves enough substance to answer it. Do not replace a meaningful response with generic praise or a new exercise.

There is no fixed character, word, sentence-pair or combined-length allowance. Complexity and information flow adapt to actual understanding, current requests and context; HSK alone does not determine length. Respect requests for a single sentence, no questions, help understanding, or ending. Avoid monologues and leave room for interruption. Chinese-first and sourced English support remain in effect.

A single primary action means one conversational focus. Acknowledging content, adding a relevant observation and asking a connected question can all belong to `RESPOND` or `FOLLOW_UP`. Invite one main answer or exercise at a time; a follow-up is optional, not a mandatory closing question. Ordinary chat may introduce zero teaching points; proactive teaching still focuses on one point/example rather than stacking exercises. These teaching boundaries do not ration ordinary vocabulary or conversational sentences.

For example, after “今天第一次跑完五公里，最后很累，但很开心”, Kai could respond: “第一次跑完五公里，难怪你又累又开心！最后那段还坚持下来了，很不容易。你觉得最难的是哪一段？” This illustrates substantive acknowledgement and a connected follow-up; it is not a script, length target or required answer. A learner asking for a shorter reply, no question or help understanding needs a different response.

The policy reaches initial session instructions and subsequent context updates for all three entries. Both full-contract and draft Planners share it, as does the rule fallback. The planner directive's compatibility field `budget_ref` names the current policy; `reply_budget` length fields are `null`. Per-reply diagnostics retain numeric counts, while `budget_exceeded:null` means no fixed runtime length rule is assessed (null fields are omitted from the metadata export). The 4096-character transient audit buffer remains a memory/privacy bound, not a tutor speaking allowance. Streamed output is not clipped for length.

The frozen `evaluation-reply-v3.js`, authored datasets and historical scores retain their original rules. Their 36-character/shared-length findings describe the old evaluation contract and cannot establish compliance or failure of the new conversational style. A new semantic review must assess whether Kai understood the content, responded with substance, continued naturally and left the learner space; counting sentences cannot prove this. Verification: `npm run verify` passed all 461 tests; `npm run replay` passed all three synthetic scenarios. No new real-provider or browser audio checks were performed; conversational naturalness remains unaccepted.

## Historical Task 04 policy and results


Engineering implemented; actual model compliance and listening calibration are
pending. This task addresses long answers and dense teaching, including the basic
language rule from the supplied Ask Kai persona requirements. It does not claim
that deterministic checks prove teaching quality or real voice acceptance.

## Reply policy

`kai-hsk1-v3` uses the versioned `kai-reply-v2` / `kai-language-v1` policies in sports, free conversation
and authorized Mission modes. Session creation and every subsequent context
update include the same policy. Existing ACK, authorization, ownership, safety,
continuous microphone upload and attempted-only evidence rules remain in force.
The 2026-10-10 adjustment follows PRD §5.4: Chinese stays first, while English
support adapts to sourced known expressions, reported comprehension and current
requests. Authorized `support_language: zh` is now honored. See
[language support](language-support.md) for fields, precedence and test limits.

| Concern | Initial policy |
| --- | --- |
| Language order | Chinese first; necessary English immediately follows the Chinese it explains; known/easily understood content or Chinese-only preference can omit English |
| Default reply | One short Chinese sentence and necessary English; at most two Chinese sentences with their necessary English |
| Shared length | At most 36 Han characters, 24 Latin words, 48 combined units, and 180 total Unicode code points including spaces/punctuation |
| Combined units | Han characters + Latin word tokens + numeric groups across the entire reply; both languages consume this budget |
| Questions/tasks | At most one main question or practice task; its English translation counts as the same question |
| Teaching density | Zero new points is valid for ordinary chat; at most one new word or structure and one short example when teaching is needed |
| Examples | Consume the same sentence-pair and length budget; do not add glosses, grammar, pinyin, multiple examples and practice instructions together |
| Long requests | Explain one point briefly, then wait for the learner before continuing |
| English | Convey the preceding Chinese meaning without additional explanations, teaching points or questions |
| Safety | Necessary controlled safety help takes priority over brevity and bilingual style |

These are model instructions and observable targets, not a hard audio
cutoff or a measured speech-duration guarantee. The gateway forwards valid
streamed text/audio in the existing order. It does not clip a sentence or cancel
a reply merely for exceeding the budget: doing so could remove the corresponding
English or interrupt a useful answer. Received PCM duration remains separate from
audible duration. Real slow/normal speech must be listened to before tuning these
numbers. No new vendor request field, SDK, extra planning model or secret is needed.

Examples:

- `你喜欢足球吗？ Do you like football?`
- `好呀！ Sure! 你喜欢吃什么？ What do you like to eat?`
- `可以说：我喜欢足球。 You can say: I like football.`
- With a sourced known expression or reported understanding: `你喜欢音乐。`

The full persona's word-by-word target-sentence breakdown remains P1 under the
agreed scope. [Task 05](natural-teaching.md) now adds natural teaching decisions;
[Task 06](progressive-captions.md) implements playback-aware captions that preserve
the original bilingual order; Tasks 09/10 expand regression and real acceptance.

## Metadata and evaluation

Open `/?diagnostics=1` before starting a reply and export the existing local
experience report. `reply.audit` includes counts, policy version, budget and
surface-language-order flags; `summary.responses[].reply_audit` exposes the same
metadata. Diagnostic export never contains reply text or audio. Collection keeps
at most 4096 code points transiently per observed reply, then clears the buffer at
completion, cancellation or session shutdown. Diagnostics enabled halfway through
a reply do not audit that reply, because its prefix was not collected.

Only completed, nonempty, untruncated received text with matching language-support
inputs gets a surface-language-order result. Each reply retains its original ACK
snapshot; pending changes are uncertain rather than retrospective violations. Cancelled, failed, empty or truncated output has `audit_complete: false`
and no language-order flag in the exported metadata. Received output is not proof
that the learner heard it. Late/foreign/duplicate events are excluded before the
audit; an old cancellation ACK does not affect the newer reply's counts.

The deterministic checks use punctuation, quoted examples and dominant sentence
scripts to detect Chinese-first order and conditional Chinese/English alternation. Latin proper names inside Chinese
sentences and decimal numbers are supported. Abbreviations, unusual quotation or
punctuation, mixed-language clauses and mismatched translations can require manual
review. A pair of question marks in corresponding Chinese/English sentences is
counted once; punctuation cannot establish that they express the same question,
nor count imperative practice tasks. Counts are lexical proxies, not HSK or audio
measurements. `translation_review_required` and `teaching_density_review_required`
and `language_support_review_required` always remain true; no “density passed” flag is inferred from a short answer.

The offline scorer now uses `kai-content-v3`, the same shared budget and separate
language-order counts. The optional LangChain Judge receives semantic criteria
for accurate translation, extra English content, question/task intent, and one
new point/one example. Scores keep their existing ten dimensions and weights;
surface-check flags alone do not prove semantic compliance. The eight authored
demo dialogues are revised to short bilingual examples (`authored-seeds-v2`),
with explicitly synthetic example judgements. They are not observed model replies
or the full Task 09 regression. No live Judge call was made.

## Verification and next local check

- `npm run verify`: policy/budget boundaries, bilingual order, translated questions,
  incomplete/truncated audits, metadata privacy, ownership and context updates.
- `npm run replay`: three synthetic scenarios; no real provider involved.
- `npm run test:browser`: Chromium with synthetic device audio; no live listening.
- Seeduplex synthetic peer verifies the policy reaches `session.create` and
  `session.update`, without claiming supplier adherence.

The original 2026-10-09 Task 04 baseline: 123 tests passed, three synthetic replays passed, and
the Chromium synthetic-device/control check passed with zero page errors. CI
runs the same engineering checks on Node 22/24. No real provider or live Judge
was called; actual translation, density and audible brevity remain unaccepted.

For the next real run, use E01/E08 in the diagnostics cases: ordinary feedback,
an English learner answer, a short correction, a request for a detailed explanation,
two proposed Mission targets, and interruption after the Chinese sentence. Listen
for Chinese first, appropriate English support and one manageable next step. Compare slow and
normal separately; manually check semantic translation and new-point count.
Keep keys and actual learner recordings/transcripts local. Tasks 09/10 still own
the complete reviewed content regression and device/listening acceptance.
