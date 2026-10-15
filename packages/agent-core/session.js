import { validateEvent } from '../contracts/events.js';

/** One reducer per session; response IDs must never be reused within a session. */
export class SessionRuntime {
  constructor(sessionId, { target = '足球', maxEvents = 10000 } = {}) {
    this.sessionId = sessionId;
    this.target = target;
    this.maxEvents = maxEvents;
    this.status = 'connecting';
    this.active = null;
    this.seen = new Set();
    this.responses = new Map();
    this.finalTurns = new Set();
    this.evidence = [];
    this.accepted = 0;
    this.dropped = 0;
  }
  ingest(event) {
    const drop = reason => { this.dropped++; return { accepted: false, reason }; };
    if (!validateEvent(event)) return drop('invalid_event');
    if (event.session_id !== this.sessionId) return drop('foreign_session');
    if (this.seen.has(event.event_id)) return drop('duplicate_event');
    if (this.seen.size >= this.maxEvents) return drop('event_limit');
    this.seen.add(event.event_id);
    if (['closed','failed'].includes(this.status)) return drop('terminal_session');
    if (event.type === 'session.failed' || event.type === 'session.closed') {
      this.status = event.type === 'session.failed' ? 'failed' : 'closed';
      this.active = null;
    } else if (event.type === 'session.ready') {
      if (this.status !== 'connecting') return drop('already_ready');
      this.status = 'active';
    } else {
      if (this.status !== 'active') return drop('session_not_ready');
      if (event.type === 'user.final') {
        if (this.finalTurns.has(event.turn_id)) return drop('duplicate_final_turn');
        this.finalTurns.add(event.turn_id);
        if (this.target && event.payload.text.includes(this.target)) {
          this.evidence.push({ session_id: this.sessionId, turn_id: event.turn_id, source_event_id: event.event_id, target: this.target, kind: 'attempted', rule_version: 'keyword-attempt-v1' });
        }
      } else if (event.type === 'response.started') {
        if (this.responses.has(event.response_id)) return drop('reused_response');
        if (this.active !== null) return drop('overlapping_response');
        this.active = { id: event.response_id, turn: event.turn_id };
        this.responses.set(event.response_id, { turn: event.turn_id, status: 'active' });
      } else if (event.type === 'response.cancelled') {
        const old = this.responses.get(event.response_id);
        if (!old || old.turn !== event.turn_id || old.status !== 'cancel_pending') return drop('unexpected_cancel_ack');
        old.status = 'cancelled';
        // An old cancellation acknowledgement must not clear a newer response.
      } else if (event.type.startsWith('response.')) {
        if (!this.active || this.active.id !== event.response_id || this.active.turn !== event.turn_id) return drop('inactive_response');
        if (event.type === 'response.cancel.requested' || event.type === 'response.done') {
          this.responses.get(event.response_id).status = event.type === 'response.done' ? 'done' : 'cancel_pending';
          this.active = null;
        }
      }
    }
    this.accepted++;
    return { accepted: true, event };
  }
  snapshot() {
    return { status: this.status, active_response_id: this.active?.id ?? null, accepted: this.accepted, dropped: this.dropped, evidence: this.evidence.map(item => ({ ...item })) };
  }
}
