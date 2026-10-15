# P0 Task 07: sourced per-session summary data

2026-10-09. Engineering implemented for all three Web POC entries. Agent Core
builds a deterministic `kai-summary-v1` snapshot; the authorized session's gateway
sends it before its terminal message. No second model, database, external HSKai
service or transcript export is added. [Task 08](web-summary-cards.md) now renders
the visible summary cards.
Real model/ASR semantics and device listening remain Tasks 09/10.

## Facts and limits

The summary separates planned goals, target text forwarded in completed replies,
and student attempts from unique validated final ASR. A teaching decision, initial
Start Tip, context ACK, keyword or configured Mission completion never creates a
learned item on its own. Forwarded text is not proof of subtitle display, audible
delivery, correct teaching or understanding. Final ASR is not a pronunciation
assessment, mastery result or proof of independent use.

| Entry | Evidence behavior |
| --- | --- |
| Sports | Direct affirmative forms supported by `sports-expression-attempt-v2` can create attempts, with source event/turn and authored curriculum version. Start Tip is available, not proven used |
| Mission | Only the first authorized target is considered. The sample likes-expression target and known literal sports-likes forms have conservative attempt rules; unsupported targets explicitly report `attempt_rule_supported: false` and receive no automatic sports credit |
| Free | No preset goal or sports credit from learner keywords. A same-turn TEACH_TARGET request plus a complete forwarded reply containing a supported expression can provide an optional scaffold; only a subsequent direct learner attempt can refer to it. Ordinary conversation may have zero learning items |

The bounded authored vocabulary covers `我喜欢足球 / 篮球 / 跑步 / 游泳`, including
the direct variants already accepted by the existing rule. Mission's sample
`用「我喜欢……」表达喜好` is an explicitly supported alias; a literal football
target does not award basketball or the Mission's second target. Other Mission
goals and arbitrary free-chat expressions need reviewed rules in future work.
They are not classified as failures, weak ability or mastered knowledge.

This is a sourced POC summary, not an exhaustive knowledge-point extractor.
`coverage.complete_learning_inventory` is always false. Canonical Chinese,
pinyin and English are authored display metadata, not stored quotations or a
semantic evaluation of the actual translation. Legitimate longer expressions,
early full-duplex attempts and unsupported variants can be missed.

## Wire contract

Normal live state views retain their existing fields. `attempt_count` counts all
recognized attempts; `attempts` contains at most the latest 20 copied refs and
`attempts_truncated` signals omission. The Web counter uses the count, not sample
length. The end packet adds `session_id` and a nested `summary`:

| Summary field | Meaning |
| --- | --- |
| `schema_version: 1`, `policy_version: kai-summary-v1` | Data schema and observation policy versions |
| `session_id`, `mode` | Current ticket/session identity and original entry mode |
| `outcome`, `end_reason`, `partial` | Actual session end, including provider close, errors, transport close, time limit, safety or revocation; a failed/transport-closed session is partial |
| `business_source`, `voice` | Local mock / external / unconfigured business source, historical provider readiness, synthetic / real-provider / not-connected kind; real_experience_accepted remains false |
| `focus`, `headline` | Practice observed / target text observed / conversation only / insufficient / unavailable, with short Chinese-first bilingual display text |
| `counts` | Accepted final student turns, completed forwarded replies and recognized attempts; not heard turns or successful lessons |
| `goals` | Planned first goal, or free chat's actually observed supported expression group, with authored or signed-Mission provenance and rule-support flag |
| `learning_items` | Actual supported expressions, authored metadata/source, target-text and attempt counts, sampled refs and truncation flag; kind is attempted or target_text_observed |
| `review_suggestions` | At most one optional suggestion referencing an observed item/goal; reason is attempt_not_assessed or target_text_without_attempt, not a weakness diagnosis |
| `coverage`, `assessment`, `notice` | Explicit observation limits; no mastery, pronunciation or independent-use assessment |

Target-text refs include source delta event IDs, completion event, response/turn,
optional same-turn request event, observation rule, `gateway_forwarded_text`
scope and `playback_confirmed: false`. Candidate spans can cross text deltas.
Student refs include final source event, turn, canonical expression ID, rule and
curriculum versions, scaffold availability and optional actual scaffold source.
Every actual learning item has source refs; planned goals remain separate.

Only safety-checked packets actually handed to the current WebSocket enter the
text observer, after the turn-output hold. The observer requires a complete,
owned, bounded reply; held/discarded output, cancelled or unfinished replies,
duplicates, reused IDs and late/wrong-turn events cannot create new text facts.
Stopping a completed reply marks retained text refs interrupted and removes it
as a future free-chat scaffold. Previously observed text still does not prove it
was heard. Earlier student attempts remain attempts, never upgraded results.

Per item, samples retain at most five refs (first observations plus latest),
while recognized counts remain complete within this rule scope. A retained
free-chat attempt embeds its prior scaffold source, so later text-ref sampling
cannot orphan its provenance. Whole raw replies are only transient buffers, at
most 4,096 UTF-16 units / 256 delta segments; truncated replies stay unassessed.
Buffers clear on completion, stop or finalization. Existing 1,000-final-turn and
10,000-event bounds remain. Final snapshots and nested live refs are deep copies;
finalization is idempotent and cannot accept late evidence.

## Ending, safety and retention

Manual End and normalized provider terminal events finalize once, before the
gateway's `session.closed` / `session.failed` packet. Provider errors/time limits
can return accepted partial facts without claiming the session succeeded.
No confirmed student turns gives `insufficient`; normal chat without supported
practice gives `conversation_only`, explicitly “本轮以交流为主”. A conversational
CLOSE decision remains advice, separate from the actual connection ending.

Safety restriction and authorization revocation suppress goals, items, refs,
suggestions and learning counts in both the nested summary and compatibility
view. Revocation affects only the authorized owner/learner session. If the
WebSocket is already closed, the gateway cannot deliver a summary; there is no
invented delivery receipt, HTTP recovery route or durable history. Task 08 shows
an honest unavailable state when no valid summary arrives.

Summary data stays in session memory/on the authorized WebSocket. No raw learner
or model text, audio, personal preferences or owner/learner IDs are added to the
summary. Canonical approved examples can naturally equal a learner's target
sentence; they are authored metadata rather than a raw transcript. No automatic
long-term record or mastery write is made to mock/production HSKai.
Opt-in diagnostics export only `summary.finalized` policy/focus/outcome, partial
flag and aggregate counts, never the summary, labels or event references.
Provider retention remains a separate unverified boundary.

## Validation

180 tests pass, including 18 new focused summary regressions: all entry modes,
signed local mock course provenance, absent/unsupported evidence, word-only and
quoted/negative/questioned input, actual forwarded text, free-chat causal
scaffolds, output holds, cancellation/stale packets, truncation/sampling,
immutability, failure/readiness timeout, authorization suppression and duplicate
terminal/reentrant close handling. Three synthetic replays pass. Native Chromium
regression passes with a synthetic microphone and zero page errors, including
continuous capture, progressive captions and existing POC controls. Browser
summary cards were outside Task 07; their implementation and verification are
now recorded in [Task 08](web-summary-cards.md).

Run `npm run verify`, `npm run replay` and `npm run test:browser`. No real Doubao,
actual learner transcript/audio, live Judge or external HSKai was used.
Task 08 now renders these fields as short Web summary cards; Tasks 09/10 evaluate
whether the actual model/ASR observations faithfully represent the conversation.
