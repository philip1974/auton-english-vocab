import { deserializeCard, serializeCard } from './scheduler.mjs';
import { uiText } from './ui-text.mjs';

const EMPTY = () => ({ version: 1, cards: {}, flags: {} });

function codeOf(error) {
  return error && typeof error === 'object' && typeof error.code === 'string' ? error.code : '';
}

function newestCard(a, b) {
  const at = a?.last_review ? Date.parse(a.last_review) : 0;
  const bt = b?.last_review ? Date.parse(b.last_review) : 0;
  return bt > at ? b : a;
}

export class ReviewStore {
  constructor(app, { now = () => new Date(), notify = () => undefined, locale = 'en' } = {}) {
    this.app = app;
    this.now = now;
    this.notify = notify;
    this.t = uiText(locale);
    this.rootGeneration = null;
    this.reviewRevision = undefined;
    this.logRevision = undefined;
    this.review = EMPTY();
    this.log = [];
  }

  async load() {
    this.rootGeneration = (await this.app.storage.scope()).rootGeneration;
    await this.#loadReview();
    await this.#loadLog();
    return this.review;
  }

  async reloadForRootChange() {
    this.rootGeneration = null;
    this.reviewRevision = undefined;
    this.logRevision = undefined;
    this.review = EMPTY();
    this.log = [];
    return this.load();
  }

  async #loadReview() {
    const result = await this.app.storage.read(this.rootGeneration, 'review.json');
    if (!result.found) {
      this.review = EMPTY();
      this.reviewRevision = null;
      return;
    }
    this.reviewRevision = result.revision;
    try {
      this.review = normalizeReview(JSON.parse(result.text));
    } catch {
      await this.#backupCorrupt(result.text);
      this.notify(this.t.corruptReview);
      this.review = EMPTY();
      this.reviewRevision = null;
    }
  }

  async #loadLog() {
    const result = await this.app.storage.read(this.rootGeneration, 'log.json');
    if (!result.found) {
      this.log = [];
      this.logRevision = null;
      return;
    }
    this.logRevision = result.revision;
    try {
      const parsed = JSON.parse(result.text);
      this.log = Array.isArray(parsed) ? parsed.slice(-2000) : [];
    } catch {
      this.log = [];
      this.logRevision = null;
    }
  }

  async #backupCorrupt(text) {
    const stamp = this.now().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    await this.app.storage.write(this.rootGeneration, `review.corrupt-${stamp}.json`, text);
    const backups = (await this.app.storage.list(this.rootGeneration))
      .filter((item) => /^review\.corrupt-\d+\.json$/.test(item.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const item of backups.slice(0, -3)) await this.app.storage.remove(this.rootGeneration, item.name);
  }

  async saveReview(next = this.review) {
    try {
      const written = await this.app.storage.write(this.rootGeneration, 'review.json', JSON.stringify(next), {
        expectedRevision: this.reviewRevision,
      });
      this.review = normalizeReview(next);
      this.reviewRevision = written.revision;
      return { review: this.review, rootChanged: false };
    } catch (error) {
      if (codeOf(error) === 'ROOT_CHANGED') return { review: await this.reloadForRootChange(), rootChanged: true };
      if (codeOf(error) !== 'REVISION_CONFLICT') throw error;
      const local = normalizeReview(next);
      await this.#loadReview();
      const merged = mergeReview(this.review, local);
      const written = await this.app.storage.write(this.rootGeneration, 'review.json', JSON.stringify(merged), {
        expectedRevision: this.reviewRevision,
      });
      this.review = merged;
      this.reviewRevision = written.revision;
      return { review: this.review, rootChanged: false };
    }
  }

  async appendLog(entry) {
    const next = [...this.log, entry].slice(-2000);
    const written = await this.app.storage.write(this.rootGeneration, 'log.json', JSON.stringify(next), {
      expectedRevision: this.logRevision,
    });
    this.log = next;
    this.logRevision = written.revision;
    return this.log;
  }
}

export function normalizeReview(value) {
  const review = EMPTY();
  if (value?.version === 1 && value.cards && typeof value.cards === 'object') {
    for (const [word, card] of Object.entries(value.cards)) {
      const normalized = deserializeCard(card);
      if (normalized) review.cards[word] = serializeCard(normalized);
    }
  }
  if (value?.flags && typeof value.flags === 'object') {
    for (const [word, flag] of Object.entries(value.flags)) {
      if (flag === 'mastered' || flag === 'ignored') review.flags[word] = flag;
    }
  }
  return review;
}

export function mergeReview(base, incoming) {
  const merged = normalizeReview(base);
  const other = normalizeReview(incoming);
  for (const [word, card] of Object.entries(other.cards)) merged.cards[word] = newestCard(merged.cards[word], card);
  merged.flags = { ...merged.flags, ...other.flags };
  return merged;
}
