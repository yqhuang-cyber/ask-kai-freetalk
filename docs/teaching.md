# Sports teaching loop

> 2026-10-14 动态规划更新：独立 mock 默认使用 next_turn_advisory，已接入三类学生上下文、可信资源、建连前整体计划与 MiniMax M3 逐轮提案；保留豆包实时全双工，本轮生成门控未证实。下文旧 Task 行为保留为 legacy／历史说明，新行为、尝试写回和验收范围见[实施记录](dynamic-planning-implementation.md)及[验证报告](eval-results/2026-10-14-dynamic-planning.md)。


The authored sports-likes-v1 curriculum has one goal: express a sports preference
with 我喜欢…. Cards/start tips are curriculum, not live model output or an HSKai
completed Mission. The kai-hsk1-v3 persona, kai-reply-v2 and kai-language-v1 policies request short,
patient Chinese-first replies with English support according to the learner profile and intent, a shared length budget, one main question
or task, at most one new teaching point/example, AI identity honesty, student topic
choice and no mastery claims. See [Task 04 policy](short-replies.md).
These are model instructions; compliance still requires content evaluation.

Task 05 adds the `kai-teaching-v1` rule selector: one main action per validated
final student turn, a two-turn teaching cooldown, one clarification before
waiting, and goal suspension after refusal/topic change. Sports and the sample
Mission share a single main likes-expression goal; free chat has no forced
sports target. New-topic expression help does not resume the original goal.
See [natural teaching decisions](natural-teaching.md) for rules and limitations.

Server stages advance from warmup to conversation and then practice, with a
separate closing recommendation and independent paused/clarification state. Only a
validated final student event can add an attempted expression with session, turn,
source event, lesson/rule version and available scaffold provenance. Partials,
teacher text, duplicate final turns and free-chat keywords cannot award progress.
The conservative `sports-expression-attempt-v2` excludes quoted/third-person,
negated and questioned examples. [Task 07](session-summary.md) now adds supported
first-target Mission evidence and free-chat attempts following a sourced,
completed forwarded target reply; ordinary free chat still has zero forced goals.
Choosing a teaching action never creates a learning fact.
No raw transcript is included in stored evidence; no pronunciation score exists.
The browser shows current attempt counts; structured summary data is sent at
ending. [Task 08](web-summary-cards.md) renders the ended session's summary,
supported expression cards and optional review, with honest empty/partial states.

Persona/goal context starts with provider session creation. Subsequent changes
are sent at response boundaries and require the exact reviewed version ACK.
An ACK timeout closes the session. The first response after a student final may
still use the previous context; the design avoids a second model on the fast path.
Context application is reported separately from local teaching state.
ACK snapshots retain their own source decision; a later ACK cannot rewrite the
metadata captured when an earlier response-start notice was received. Matching
source turns and ACKs does not prove model compliance or audible delivery.

Local WebSocket/teaching tests validate ownership and rules, not model teaching
quality, short-pause handling or true speech. Real multi-turn account evaluation
must confirm adaptive English support, brevity/order, accurate corresponding English, teaching
density, one-question behavior, topic changes and refusal handling.
