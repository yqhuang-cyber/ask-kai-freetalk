# Historical external integration inventory

This inventory is historical reference, not a current POC dependency or action
plan. The independent POC runs against [local mock HSKai](standalone-poc.md).
External repository/service work is outside the current scope.

# HSKai integration inventory (partial F02)

Read-only static inspection on 2026-10-03 of `wohuipteltd/HSKai` main at
`5c88c299b707672b14d578bfa17ab33bbf6dc753`. No HSKai files or database were changed.

| Evidence | Observed capability | Next integration work |
| --- | --- | --- |
| root package.json | Node >=22, npm workspaces | Use the same Node family; validate deployed runtime separately |
| apps/backend/package.json | Fastify 5, websocket plugin, Prisma, Redis and Langfuse dependencies | Reuse real API/observability facilities after checking deployment/configuration |
| modules/freetalk/freetalk.routes.ts | Session create, heartbeat, completion; request.auth user check and user-scoped lookup | Define Ask Kai session ownership and short-lived WSS tickets; do not assume existing authorization suffices |
| modules/missions/missions.routes.ts | Authenticated runtime/catalog routes | Define trusted Mission completion and target contract; actual mount prefix still needs verification |
| modules/freetalk/learner-memory.ts | Active memory reads and upserts, confidence/source handling | Determine allowed learner fields, evidence rules and data correction/deletion |
| modules/freetalk/doubao-protocol.ts | Binary framing, event numbers and gzip handling | Compare with actual purchased full-duplex product; protocol compatibility is unverified |
| jobs/freetalk and worker script | Background analysis/memory tasks exist in source | Verify task lifecycle, idempotency, deployment and available queues before reuse |

Imports/dependencies and source existence do not prove a service is deployed or
credentials are available. Guardian consent, country admission, external platform
APIs, token renewal, actual schema migrations and production capacity were not
verified in this step. F02 is partially complete, not closed.
