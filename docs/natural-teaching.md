# P0 Task 05: natural teaching decisions

> 2026-10-14 动态规划更新：独立 mock 默认使用 next_turn_advisory，已接入三类学生上下文、可信资源、建连前整体计划与 MiniMax M3 逐轮提案；保留豆包实时全双工，本轮生成门控未证实。下文旧 Task 行为保留为 legacy／历史说明，新行为、尝试写回和验收范围见[实施记录](dynamic-planning-implementation.md)及[验证报告](eval-results/2026-10-14-dynamic-planning.md)。


Engineering implemented for the standalone Web POC. Model teaching quality,
actual spoken compliance and device listening remain pending in Tasks 09/10.
The business backend stays the local mock HSKai; no new external service,
planning model, credential or database is required.

## One decision per confirmed student turn

`kai-teaching-v1` adds a conservative rule selector to `TeachingSession` and the
same immediate selection policy to initial and updated model instructions.
Only unique, validated, session-owned `user.final` events advance the state.
Partials, teacher text, duplicate finals and rejected runtime events cannot select
an action or add evidence. A session keeps its latest metadata decision and the
existing limit of 1000 final student turns; it does not store a new transcript.

| Situation | Selected action | Teaching behavior |
| --- | --- | --- |
| Clear ordinary question or unrelated content | RESPOND, or a relevant FOLLOW_UP | Answer/share first; zero new points |
| Unclear short input | CLARIFY_INTENT | One low-pressure clarification; no correction or new point |
| Further unclear answers | RESPOND | Wait or offer a low-pressure choice; no repeated clarification loop |
| Relevant sports word/English preference fragment in theme or supported Mission | TEACH_TARGET | One short scaffold for the current goal, at most once without learner help |
| Explicit expression help or request to resume practice | TEACH_TARGET outside cooldown | At most one point/example; new-topic help does not reactivate the old goal |
| Direct affirmative target expression | FOLLOW_UP | Reduce scaffolding and continue the content; no mastery claim |
| Refusal or explicit topic change | RESPOND; mark original goal paused | Follow the student; later keywords cannot force a return |
| Clear conversational ending | CLOSE | Brief goodbye, no extra question or practice |

Every selected teaching invitation starts a **two-final-turn cooldown**. The next
two confirmed student turns continue conversation or receive low-pressure help
without another new point. This is a conservative bound on selected invitations,
not proof of two heard/model-compliant replies. Partials, silence and duplicate
events do not consume it. No silence timer or automatic repeated prompt is added.
All actions share Task 04's Chinese/English sentence pairs and brevity budget;
the existing safety restriction takes priority before teaching selection.

Entry mode remains an independent state axis:

- **Mission:** use the first signed target as the single main goal. The POC's
  sample likes-expression Mission supports the sports cues; arbitrary future
  Mission goals do not acquire a sports detector automatically.
- **Sports:** short relevant answers can invite the authored likes expression.
  A direct attempt moves the conversation toward its content, without repeated
  forced imitation.
- **Free:** ordinary conversation has no fixed lesson goal or sports evidence.
  Explicit expression help may receive one relevant example; zero teaching is a
  valid whole-session outcome.

Changing topic or asking for help does not mutate signed identity, entry mode or
course results. A CLOSE decision is a conversational recommendation, not a claim
that the provider connection has closed. The existing End control still stops
the actual session and microphone. No new pronunciation, mastery, correction or
long-term learner record is introduced.

## Scope and uncertainty

The selector recognizes narrow Chinese/English control phrases, requests,
short ambiguous answers and authored sports expressions. Quoted examples and
language questions cannot operate end/refusal/topic controls; English
contractions remain intact. Unmatched expressions fall back to conversation
rather than an inferred teaching need. This is not a general intent classifier,
ASR accuracy check, translation judge or grammar assessment. One-word English
answers do not imply poor ability. Real semantic quality requires reviewed runs.

`sports-expression-attempt-v2` narrows the existing attempted-only rule to direct
affirmative variants such as `我喜欢足球` / `我很喜欢踢足球`.
Negation, questions, teacher reports and quoted examples do not count. Legitimate
longer variants can be missed; this conservative match is not a language score.
Mission/free structured learning evidence is now implemented within the bounded
[Task 07 summary rules](session-summary.md). A chosen TEACH_TARGET,
an ACK or `new_points: 1` is never a presented/practiced learning fact.

## Context timing and traceability

Each local decision contains the policy version, session/turn/source-event IDs,
context revision, mode, action, fixed reason, chat/teach intent, optional goal
reference, support level, clarification state, paused goal, attempt observation
and cooldown. Returned views are copies. Input text is not copied into decisions.
`goal_attempt_observed` concerns the session's known goal, not the expression in
an unrelated help request. Mission's `mission-target-1` is a session-local
reference to its first authorized target, not a new global course ID.

The realtime fast path still has no second planning model. The rule selector
observes final ASR; provider replies may already have begun before that event.
Context changes are coalesced to the latest revision at existing safe response
boundaries, with cancellation and exact-version ACK checks preserved. A pending
update captures its own decision snapshot, so an old ACK cannot attribute itself
to a newer student turn. The first reply may use older state. Updated instructions
require the latest student input to override any stale action recommendation.

Open `/?diagnostics=1` to collect the metadata-only report:

- `teaching.decision` records fixed actions/reasons, turn aliases, revisions and
  counts/flags; no transcript, goal label, Mission title or event payload.
- `context.requested` / `context.applied` carry the source turn of the captured
  decision, distinct from the newest local teaching state.
- `teaching.response` and `summary.responses[].teaching_context` snapshot the
  acknowledged context version at the **first accepted response-start notice**,
  the decision revision and `decision_context_matched`. That flag means the ACK
  snapshot's source turn matches the response turn. It does not prove generation
  began after the ACK, model adherence, audible delivery or successful teaching.
  A later ACK cannot rewrite this snapshot.

Diagnostic export remains opt-in, bounded and ID-aliased. Normal student UI does
not expose engineering decisions; summary-card presentation stays in Task 08.
Continuous microphone upload, native speed selection, interruption/ownership
fences and honest provider readiness remain in force.

## Verification and next listening check

`tests/natural-teaching.test.js` adds focused authored/synthetic cases covering
all three modes, one trusted Mission target, ordinary questions, relevant short
answers, explicit help, cooldown, target attempts, Chinese/English refusal,
topic changes, repeated ambiguity, quoted/meta language, session isolation,
privacy and early-response/late-ACK races. The synthetic Seeduplex peer also
checks that the policy reaches session creation and acknowledged updates.
Run `npm run verify`, `npm run replay` and `npm run test:browser` for engineering
validation. These do not call the real provider or prove teaching quality.

This task's local results: 152 tests passed (18 new focused decision regressions),
three synthetic replays passed, and Chromium's synthetic-device/control check
passed with zero page errors. No real provider, live Judge or actual learner
audio/transcript was used. Real naturalness and audible teaching remain unaccepted.

For local real listening, try each entry with: an ordinary question, a sports
word, a full target sentence, a request for help, two unclear answers, refusal,
a new topic and expression help on that new topic. Check that Kai follows the
meaning, stays short and bilingual, gives one manageable next step, and does not
repeat the old goal. Export only the metadata report; keep actual keys, audio
and learner transcripts local. [Task 06](progressive-captions.md) now adds playback-aware captions;
Tasks 07/08 provide sourced summaries and cards; Tasks 09/10 own full evaluation.
