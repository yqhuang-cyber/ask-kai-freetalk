export class ProviderUnavailableError extends Error {
  constructor() { super('DOUBAO_PROTOCOL_NOT_VERIFIED'); this.code = 'DOUBAO_PROTOCOL_NOT_VERIFIED'; }
}
/** Fail closed even if a key happens to be present. Step 2 supplies verified mappings. */
export class DoubaoProvider {
  kind = 'doubao';
  async *open() { throw new ProviderUnavailableError(); }
  async sendAudio() { throw new ProviderUnavailableError(); }
  async cancel() { throw new ProviderUnavailableError(); }
  async updateContext() { throw new ProviderUnavailableError(); }
  async close() {}
}
