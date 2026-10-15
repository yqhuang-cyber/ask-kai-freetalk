/** Proposed internal port. Real protocol mappings are deliberately unimplemented. */
export interface ProviderEvent {
  version: 1;
  event_id: string;
  session_id: string;
  seq: number;
  at_ms: number;
  type: string;
  turn_id?: string;
  response_id?: string;
  payload: Record<string, unknown>;
}
export interface RealtimeProvider {
  readonly kind: 'replay' | 'doubao';
  open(input: {sessionId: string; signal?: AbortSignal}): AsyncIterable<ProviderEvent>;
  sendAudio(frame: Uint8Array): Promise<void>;
  cancel(responseId: string): Promise<void>;
  updateContext(input: {version: number; instructions: string}): Promise<void>;
  close(): Promise<void>;
}
