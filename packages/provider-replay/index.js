import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { assertEvent } from '../contracts/events.js';

const fixtures = new URL('../../docs/test-fixtures/', import.meta.url);
export const SCENARIOS = Object.freeze([
  { id: 'normal', label: '正常回合' },
  { id: 'interruption', label: '打断与迟到事件' },
  { id: 'failure', label: '连接失败' },
]);
export async function loadScenario(id) {
  if (!SCENARIOS.some(item => item.id === id)) throw new Error('UNKNOWN_SCENARIO');
  const fixture = JSON.parse(await readFile(new URL(`${id}.json`, fixtures), 'utf8'));
  if (fixture.synthetic !== true || fixture.events.length > 1000) throw new Error('INVALID_FIXTURE');
  fixture.events.forEach(assertEvent);
  return fixture;
}
export class ReplayProvider {
  kind = 'replay';
  constructor(fixture, { paceMs = 0 } = {}) {
    this.fixture = structuredClone(fixture);
    this.paceMs = paceMs;
    this.closed = false;
  }
  async *open({ sessionId, signal } = {}) {
    for (const event of this.fixture.events) {
      if (this.closed || signal?.aborted) return;
      if (this.paceMs) {
        try { await delay(this.paceMs, undefined, { signal }); }
        catch (error) { if (error.name === 'AbortError') return; throw error; }
      }
      if (this.closed || signal?.aborted) return;
      yield { ...structuredClone(event), session_id: sessionId ?? event.session_id };
    }
  }
  async sendAudio() { throw new Error('REPLAY_DOES_NOT_ACCEPT_AUDIO'); }
  async cancel() { throw new Error('REPLAY_CONTROL_IS_SCRIPTED'); }
  async updateContext() { throw new Error('REPLAY_CONTEXT_UPDATE_UNSUPPORTED'); }
  async close() { this.closed = true; }
}
