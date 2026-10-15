# ADR 0002: standalone POC with a local HSKai contract double

Status: accepted, 2026-10-09, following the user's clarified POC scope.

The project is independent from `wohuipteltd/HSKai`. Maintain the current Web,
gateway, Agent Core, provider adapter and HSKai ports, but compose those business
ports with a repository-owned local mock HTTP service by default. No external
repository, BFF deployment or business database is required. This supersedes the
external-integration prerequisites and framework expectations in ADR 0001 and
the original foundation task plan; their protocol/ownership invariants still apply.

Use the same signed v1 assertions and ordinary gateway authorization rather than
a real-provider authentication bypass. The service owns fixed fictional identity
and Mission fixtures plus transient owner-scoped preferences. A generated secret
binds the process; browser launch refresh is same-origin and HttpOnly. External
HTTP clients keep HTTPS enforcement; only explicit mock composition admits
literal loopback HTTP. `npm run poc` ignores external HSKai settings.

Business mock and voice source are independent. Real Doubao readiness is still
required before microphone access; replay/test peers remain synthetic. Mark mock
fixtures in the UI/diagnostics. Mock safety ACKs cannot report actual human delivery,
and mock privacy completion cannot certify upstream deletion. Learning attempts
continue to require real final-event provenance within the session and never
become mastery evidence. Restart resets the mock store; no durable business
database or external platform runtime is introduced.

See [standalone POC](../standalone-poc.md) for commands, endpoints and limits.
