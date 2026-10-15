// INTERNAL contract, not an assertion about Doubao's wire protocol.
export const EVENT_TYPES = Object.freeze([
  'session.ready', 'session.failed', 'session.closed',
  'user.partial', 'user.final', 'response.started',
  'response.text.delta', 'response.audio.chunk', 'response.done',
  'response.cancel.requested', 'response.cancelled',
]);
const responseTypes = new Set(EVENT_TYPES.filter(type => type.startsWith('response.')));
const turnTypes = new Set([...responseTypes, 'user.partial', 'user.final']);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const exactKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateEvent(event) {
  if (!object(event) || !exactKeys(event, ['version','event_id','session_id','seq','at_ms','type','turn_id','response_id','payload'])) return false;
  if (event.version !== 1 || !identifier(event.event_id) || !identifier(event.session_id)) return false;
  if (!Number.isSafeInteger(event.seq) || event.seq < 0 || !Number.isSafeInteger(event.at_ms) || event.at_ms < 0) return false;
  if (!EVENT_TYPES.includes(event.type) || !object(event.payload)) return false;
  if (turnTypes.has(event.type) ? !identifier(event.turn_id) : event.turn_id !== undefined) return false;
  if (responseTypes.has(event.type) ? !identifier(event.response_id) : event.response_id !== undefined) return false;
  if (event.type === 'user.partial' || event.type === 'user.final' || event.type === 'response.text.delta') {
    return exactKeys(event.payload, ['text']) && typeof event.payload.text === 'string' && event.payload.text.length > 0 && event.payload.text.length <= 2000;
  }
  if (event.type === 'response.audio.chunk') {
    // Metadata only: the diagnostic replay does not contain or play audio.
    return exactKeys(event.payload, ['byte_length','format']) && Number.isSafeInteger(event.payload.byte_length) && event.payload.byte_length > 0 && event.payload.byte_length <= 65536 && event.payload.format === 'pcm_s16le';
  }
  if (event.type === 'session.failed') return exactKeys(event.payload, ['code']) && identifier(event.payload.code);
  return Object.keys(event.payload).length === 0;
}
export function assertEvent(event) {
  if (!validateEvent(event)) throw new Error('INVALID_INTERNAL_EVENT');
  return event;
}
