import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

let catalog;

function load() {
  if (catalog) return catalog;
  const url = new URL('../../apps/hskai-mock/data/hsk-2025-vocabulary.json', import.meta.url);
  const raw = readFileSync(url);
  const data = JSON.parse(raw);
  const byWord = new Map();
  for (const entry of data.entries) {
    const levels = byWord.get(entry.word) ?? [];
    levels.push(entry.level);
    byWord.set(entry.word, levels);
  }
  catalog = {
    version: data.version,
    hash: createHash('sha256').update(raw).digest('hex'),
    lookup(word) {
      const levels = byWord.get(word);
      if (!levels) return { status: 'unknown', levels: [] };
      return { status: 'found', levels: [...levels] };
    }
  };
  return catalog;
}

export function hskVocabularyCatalog() {
  return load();
}

export function termWithinVerifiedRange(word, verifiedThrough) {
  const found = load().lookup(word);
  if (found.status !== 'found') return { ok: false, reason: 'unknown' };
  const numeric = found.levels.map(level => level === '7-9' ? null : Number(level));
  if (numeric.some(level => !Number.isInteger(level))) return { ok: false, reason: 'unresolved' };
  if (new Set(numeric).size !== 1) return { ok: false, reason: 'ambiguous' };
  if (numeric[0] > verifiedThrough) return { ok: false, reason: 'above' };
  return { ok: true, level: numeric[0] };
}
