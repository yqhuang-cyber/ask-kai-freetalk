# POC scope note

The local POC runs with mock business services; starting it does not require any
external HSKai integration. Mock safety ACKs return `delivered: false` and do not
increment human-delivered metrics; local mock privacy completion is explicitly
scoped to preferences. The production release gates below remain separate from
POC execution. See [standalone POC](standalone-poc.md).

# Safety, evaluation and release acceptance

The code in steps 3–7 is implemented; this does not close the real-provider,
deployed-HSKai or minor-release acceptance gates. Default mode stays loopback and
disconnected. ASK_KAI_RELEASE_MODE accepts internal only. No public deployment
was performed. Keys/assertions and .local files must never be committed.

## Safety and human handling

kai-child-safety-v1 is a deterministic floor for selected self-harm, abuse,
adult-content and output-privacy patterns. It scans normalized accepted events,
including text across output chunks. Late cancelled text cannot restrict a new
reply. Detection stops future output, stops microphone upload and shows a trusted
care message. This is not a comprehensive classifier; false positives/negatives
and audio preceding text require red-team and supplier moderation verification.
Already-played speech cannot be retracted.

HSKAI_SAFEGUARDING_ENDPOINT is a new HTTPS BFF contract. Signed audience
hskai-safeguarding binds the verified owner/learner. The body contains risk code,
policy version and source/session IDs, never transcript/audio. It must persist an
idempotent case, assign a real responsible team, and return accepted=true,
case_id and assigned_team. An absent/failed service is explicitly unavailable;
the UI never claims a delivered handoff without ACK. Queue ACK is not proof that
a human already acted. Actual responder availability, escalation and audit must
be tested separately. No live service calls were made during implementation.

Controlled tool authorization validates session/learner ownership and curriculum
word cards; evidence requires a final student source. Memory/mastery writes are
not model tools. Actual supplier tool wire mappings remain unverified and are
not silently enabled by this helper.

## Privacy and operations

Application code does not persist microphone bytes or complete learner dialogue.
Preferences remain in HSKai. GET /api/memory/export exports only the authorized
learner's preferences. GET /api/privacy reports local persistence and the unknown
supplier retention status honestly.

HSKAI_PRIVACY_ENDPOINT implements queued export/erase requests and owner-scoped
status reads, signed with audience hskai-privacy. Browser POST /api/privacy/requests
needs privacy:export, privacy:erase or privacy:read. A new request returns pending
and HTTP 202; acceptance does not mean erasure is complete. HSKai must coordinate
its business store, jobs, eval references and any supplier-retained data, verify
completion, authorize status access and retain minimal audit. Erase also ends
current Ask Kai sessions. This new endpoint is not deployed by this change.
The current UI provides preference export/delete; full-data requests use the BFF
API. Consent withdrawal does not block explicitly scoped memory/data rights.

GET /api/metrics is a local, aggregate process view. Synthetic and doubao groups
stay separate; timings retain the last 1000 samples. ready_ms measures socket
session start to actual normalized ready. first_audio_ms measures normalized
response.started to its first received audio chunk, not end-user audible latency.
No transcript, learner label, credentials or raw provider error is logged.
Session duration, capacity, client control/audio rates, message/buffer budgets,
heartbeats, ACK timeouts and shutdown cleanup are enforced.

## Content scoring and LangChain/Langfuse

`npm run eval:demo` is an offline scoring demonstration using eight authored
dialogues and explicitly synthetic example judgements, not a model-quality result.
The authored-seeds-v2 examples use short Chinese/English pairs. It is not the
original 58-case workbook or its 53 P0 cases. Its illustrative
scores and synthetic handoff evidence cannot pass release acceptance.

`npm run eval:content -- cases.json judgements.json` scores approved observations.
Cases support up to 40 dialogue turns, key_points/must_avoid, source, versions and
N/A reasons declared before execution. The 10 README weights total 100 and
scores use 0/1/2. Applicable weights are renormalized. Safety cannot be N/A.
Critical failures/safety=0 block regardless of average; safety=1 requires human
review. A Judge saying "handoff delivered" is insufficient: the case needs an
independently reviewed handoff_evidence record. Model approval cannot substitute
for human_review_evidence. Reports contain scores/versions, not source dialogue.
The kai-content-v2 rubric uses the [Task 04 shared bilingual budget](short-replies.md)
and counts translated questions once. Surface language-order/length flags are
reported separately. Translation equivalence, task intent and teaching density
require semantic/human review. [Task 09](p0-regression.md) now adds a separate
scoped POC P0 runner with fixed content criteria, surface failure gates and
coverage/review blocking. Its authored controls test scoring behavior, not real
model quality; the original full-PRD workbook remains a separate release gate.

Optional `npm run eval:content -- cases.json --live-judge` uses the pinned LangChain
Runnable/ChatOpenAI structured Judge. Configure EVAL_JUDGE_BASE_URL (HTTPS),
EVAL_JUDGE_MODEL, EVAL_JUDGE_API_KEY and EVAL_JUDGE_VERSION server-side. No model
default or key is supplied. Credentials are not printed; redirects/retries are
disabled. Unapproved production-child data is rejected before invocation;
approved_redacted cases require redaction_approval. Extra LangSmith tracing is
blocked to avoid an unreviewed additional data sink. Judge instructions demand
short fixed output and separate safety/critical flags. Human calibration is still
required. No live Judge call was made here.

Optional `--langfuse` exports numeric/boolean scores to existing trace IDs using
LANGFUSE_BASE_URL, PUBLIC_KEY, SECRET_KEY, LANGFUSE_TRACE_MAP and EVAL_RUN_ID.
No conversation text or user ID is sent; score IDs are deterministic for retries.
HTTP success is submission, not readback/persistence proof. Configure and verify
the actual Langfuse project/Dataset and score readback before enabling this path.
No Langfuse data was sent during implementation.

Primary API references:
- [LangChain structured output](https://reference.langchain.com/javascript/langchain-openai/ChatOpenAI/withStructuredOutput)
- [LangChain RunnableLambda](https://reference.langchain.com/javascript/langchain-core/runnables/RunnableLambda)
- [Langfuse score creation](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk)
- [Langfuse score readback](https://langfuse.com/docs/api-and-data-platform/features/scores-api)

## Release gate

`npm run release:status` reports blockers. `npm run release:check` exits nonzero
until approved evidence exists. Set ASK_KAI_CANDIDATE_REVISION, RELEASE_EVIDENCE
and CONTENT_REPORT (all ASK_KAI_ prefixed). Evidence must match the candidate,
include recent reviewer/hash references for real voice, device audio, HSKai,
human handling, privacy, market approval and the original P0 regression, plus a
human-calibrated content threshold. Real-model content evaluation must match the
same revision and have no unresolved critical/safety/review failure. No numeric
release threshold is invented in the committed template. Artifact metadata is an
operator attestation, not automatic proof that an external test occurred. Review
the referenced artifacts before approving an actual release.

CI runs Node 22/24, offline probe/replay/scoring and a Chromium browser check.
Browser checks use synthetic device audio: native AudioWorklet PCM, capture during
playback stop, controls, mobile overflow, disconnected/microphone behavior and
engineering replay. They do not prove real AEC, provider pauses, speech quality,
cross-device audible interruption or P50/P95 experience. These remain live gates.
