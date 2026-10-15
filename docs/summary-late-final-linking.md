# Summary evidence when final ASR arrives late

The full evaluation contained sparse learning items and source-bearing recaps. Empty items do not prove a timing failure: the POC expression directory remains deliberately bounded. Inspection did identify a separate ordering gap: a complete forwarded reply before the matching final ASR could lose its expression-request association.

`kai-summary-v3` retains at most eight complete owned replies awaiting final ASR (each subject to the existing text and event bounds). A matching actual expression request links the original forwarded text event IDs and completion event ID to the accepted final ASR ID. Learner-attempt evaluation happens before this linking; the same turn cannot receive credit for its own model answer. A later accepted direct expression can reference the prior scaffold, without claiming mastery, pronunciation or audible playback.

Wrong turns, unfinished/truncated replies, cancelled output, ordinary conversation and missing final ASR do not create learning items. Stop and finalization clear transient buffers; overflow and unresolved retained replies remain unassessed. No expression-directory expansion or transcript persistence is introduced. Schema 2 remains compatible in the Web projection with both policy v2 and v3.

Synthetic tests cover reversed ordering, one-time source linkage, later attempts, same-turn exclusion, ownership, cancellation and bounded unresolved buffers. This fixes an observed code ordering gap, not a proven explanation for every empty historical summary. Real evidence audits and Web card regression are separate acceptance checks.
