# HSKai BFF integration contract (new, not deployed)

> 2026-10-14 动态规划更新：独立 mock 默认使用 next_turn_advisory，已接入三类学生上下文、可信资源、建连前整体计划与 MiniMax M3 逐轮提案；保留豆包实时全双工，本轮生成门控未证实。下文旧 Task 行为保留为 legacy／历史说明，新行为、尝试写回和验收范围见[实施记录](dynamic-planning-implementation.md)及[验证报告](eval-results/2026-10-14-dynamic-planning.md)。


Current runtime: [standalone POC](standalone-poc.md). The local mock implements
this contract and signs fixture assertions; the external deployment described
below is optional future work. No changes in `wohuipteltd/HSKai` are required.
The mock does not certify real account/course/guardian information.

HSKai remains the identity/course/learner-memory truth source. No existing HSKai
repository, database or production service was modified. The historical inventory
does not prove these new endpoints are available. Real integration requires its
authenticated BFF to implement this contract and end-to-end acceptance.

HSKai issues a v1 HMAC-SHA256 launch assertion after verifying account ownership,
learner/guardian voice consent, market admission and any Mission completion.
Format: base64url(JSON).base64url(HMAC(body)). It is not a JWT. Required claims:
v=1, iss=hskai, aud=ask-kai, owner_id, learner_id, jti, iat, exp (<=60s), market,
minor, consent.voice and consent.guardian for minors, scopes. Optional:
authorization_until (session horizon <=10min from iat; default token expiry),
memory and a Mission {id, completion_id, title, targets[1..2], completed:true}.
The issuer must prove that Mission belongs to this learner; a signature does not
make unchecked business data correct. Browser requests cannot supply its contents.

Transport it via Authorization: Bearer or an HttpOnly Secure SameSite=Strict
ask_kai_launch cookie, behind the same origin BFF. Never place it in a URL, local
storage or a browser form. HSKAI_BRIDGE_SECRET is >=32 characters and server-only.
HSKAI_ALLOWED_MARKETS defaults empty. Session creation consumes a launch nonce;
each WebSocket ticket is additionally single-use and capped by assertion expiry.
Scopes: session:create, memory:read, memory:write, memory:delete, session:revoke.
The BFF must mint a fresh assertion for a new session or expired access.

GET /api/bootstrap exposes only authorized modes/Mission and memory writability.
POST /api/sessions accepts mode and, for Mission, mission_id matching the signed
completion. No unauthenticated real-provider mode is available. Test identity is
an injected test-only path, with synthetic provider markers and no startup switch.

GET/POST/DELETE /api/memory use the verified owner+learner, never browser IDs.
Allowed preferences: interest, correction_preference (gentle/on_request),
support_language (auto/zh/zh_en), chinese_comprehension (beginner/comfortable),
and known_expressions (1–12 distinct Chinese expressions, each at most 16 characters).
At most five unique fields carry source/update/expiry; expired values are
ignored. These are bounded support inputs, not measured mastery; see
[adaptive language support](language-support.md). Corrections expire after 30 days and take effect at a reply boundary.
Delete ends the learner's active sessions and removes pending tickets. A signed
POST /api/authorization/revoke also ends sessions when consent is withdrawn;
this operation intentionally accepts consent.voice=false for revocation.
Memory access/deletion also stays available with its explicit owner scope after
voice consent or market admission is withdrawn; those gates apply to new speech.

HSKAI_MEMORY_ENDPOINT is a configured HTTPS server-to-server endpoint implementing
POST {operation:read|write|delete, record?|field?}. Ask Kai signs short-lived
iss=ask-kai/aud=hskai-memory assertions containing owner/learner/operation. HSKai
must verify signature/audience/expiry/nonce and its current owner permissions,
perform atomic updates/deletes in its authoritative store, and return {records}
on read or an empty JSON object after mutation. Redirects are denied. Without
this port, authorized launch memory is read-only; writes return 501.
The in-memory port exists only for tests/local development and is not a durable
substitute for HSKai. No transcript/audio is stored as memory.

This loopback build is not a deployed same-origin BFF. Actual cookie routing,
permissions/revocation across services, data deletion downstream, regions and
guardian workflow require deployment verification. Session horizons cap stale
authorization; the BFF must invoke revocation promptly when permissions change.
