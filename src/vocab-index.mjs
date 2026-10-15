import { parseNote } from './note-format.mjs';

const VOCAB_PATH = /^wiki\/vocab\/[^/]+\.md$/;
const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

function unwrap(result) {
  if (result && result._tag === 'Err') {
    const detail = result.error;
    const error = new Error(String(detail?.message ?? detail?.code ?? detail ?? 'knowledge error'));
    if (typeof detail?.code === 'string') error.code = detail.code;
    throw error;
  }
  return result;
}

export class VocabIndex {
  constructor(knowledge, { batchSize = 50, onProgress = () => undefined, onUpdate = () => undefined } = {}) {
    this.knowledge = knowledge;
    this.batchSize = batchSize;
    this.onProgress = onProgress;
    this.onUpdate = onUpdate;
    this.cache = new Map();
    this.entries = new Map();
    this.duplicateWords = new Set();
    this.invalid = [];
    this.refreshing = null;
    this.pending = false;
    this.generation = 0;
  }

  reset() {
    this.generation += 1;
    this.cache.clear();
    this.entries.clear();
    this.duplicateWords.clear();
    this.invalid = [];
    if (this.refreshing) this.pending = true;
  }

  async refresh() {
    if (this.refreshing) {
      this.pending = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      let result;
      do {
        this.pending = false;
        const generation = this.generation;
        try {
          result = await this.refreshOnce(generation);
        } catch (error) {
          if (error?.code !== 'ROOT_CHANGED' && generation === this.generation) throw error;
          this.cache.clear();
          this.entries.clear();
          this.duplicateWords.clear();
          this.invalid = [];
          if (!this.pending && generation === this.generation) throw error;
          this.pending = true;
        }
      } while (this.pending);
      return result;
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  async refreshOnce(generation = this.generation) {
    const metas = unwrap(await this.knowledge.listDocuments()).filter((meta) => VOCAB_PATH.test(meta.path));
    if (generation !== this.generation) throw Object.assign(new Error('stale root'), { code: 'ROOT_CHANGED' });
    this.invalid = [];
    const readFailures = [];
    const live = new Set(metas.map((meta) => meta.path));
    for (const path of [...this.cache.keys()]) if (!live.has(path)) this.cache.delete(path);
    let done = 0;
    for (let i = 0; i < metas.length; i += this.batchSize) {
      const batch = metas.slice(i, i + this.batchSize);
      for (const meta of batch) {
        const hash = meta.revision?.contentHash ?? '';
        const cached = this.cache.get(meta.path);
        if (cached?.hash !== hash) {
          try {
            const doc = unwrap(await this.knowledge.readDocument({ path: meta.path }));
            this.cache.set(meta.path, { hash, meta, parsed: parseNote(doc.content) });
          } catch (error) {
            if (error?.code === 'ROOT_CHANGED' || generation !== this.generation) throw error;
            this.cache.delete(meta.path);
            readFailures.push({
              path: meta.path,
              kind: 'read',
              code: typeof error?.code === 'string' ? error.code : 'READ_FAILED',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        done += 1;
        if (generation !== this.generation) throw Object.assign(new Error('stale root'), { code: 'ROOT_CHANGED' });
        this.onProgress(done, metas.length);
        const partial = this.rebuild(readFailures);
        this.onUpdate(partial);
      }
      if (i + this.batchSize < metas.length) await sleep();
    }
    return this.rebuild(readFailures);
  }

  rebuild(readFailures = []) {
    this.entries = new Map();
    this.duplicateWords = new Set();
    this.invalid = [];
    const byWord = new Map();
    for (const [path, item] of this.cache.entries()) {
      if (!item.parsed.ok) {
        this.invalid.push({ path, kind: 'parse', error: item.parsed.error });
        continue;
      }
      const entry = { ...item.parsed.entry, path, title: item.meta.title || item.parsed.entry.word };
      const matches = byWord.get(entry.word) ?? [];
      matches.push(entry);
      byWord.set(entry.word, matches);
    }
    for (const [word, matches] of byWord.entries()) {
      if (matches.length === 1) this.entries.set(word, matches[0]);
      else {
        this.duplicateWords.add(word);
        for (const entry of matches) this.invalid.push({ path: entry.path, kind: 'duplicate', word });
      }
    }
    this.invalid.push(...readFailures);
    return { entries: [...this.entries.values()], invalid: this.invalid };
  }

  get(word) {
    return this.entries.get(String(word).toLowerCase());
  }

  isAmbiguous(word) {
    return this.duplicateWords.has(String(word).toLowerCase());
  }
}
