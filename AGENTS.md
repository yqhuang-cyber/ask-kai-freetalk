# Working on Ask Kai

- This is a standalone POC. Default business contracts use the local mock HSKai;
  external HSKai repository/service integration is outside the current scope.
- Keep mock identity/course/workflow data visibly separate from real Doubao voice
  readiness. Mock safeguarding ACKs never prove actual human delivery.

- Read README.md, docs/implementation-plan.md, and docs/prd/ask-kai-agent-prd-v1.1.md before changing scope. The PRD is the product direction; when it differs from the current POC boundary, follow README.md and docs/implementation-plan.md.
- Keep synthetic replay visibly distinct from real provider connectivity.
- Never infer wire event names or provider guarantees from our internal contract.
- Never commit keys, raw provider traces or real learner transcripts/audio.
- Preserve response/turn ownership, late-event isolation and attempted-only evidence.
- Run npm run verify and npm run replay for runtime/contract changes.
- Keep identity, course and learning records behind authorized HSKai boundaries.
- Report synthetic, real-provider and browser audio checks separately.
