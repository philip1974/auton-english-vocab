import { deserializeCard, newSerializedCard, rateCard, serializeCard } from './scheduler.mjs';
import { uiText } from './ui-text.mjs';

const wordRecord = () => Object.create(null);
const EMPTY = () => ({ version: 1, cards: wordRecord(), flags: wordRecord() });

function sameLogEntry(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueLogEntries(values, onCollision = () => undefined) {
  const entries = [];
  const byId = new Map();
  const ratingIds = new Map();
  for (const value of values) {
    if (!value?.id) {
      entries.push(value);
      continue;
    }
    let next = value;
    if (value.undoOf) {
      const candidates = (ratingIds.get(value.undoOf) ?? []).filter((candidate) => candidate.word === value.word);
      if (candidates.length === 1) next = { ...value, undoOf: candidates[0].id };
      else if (candidates.length > 1) {
        onCollision(value.undoOf);
        continue;
      }
    }
    const originalId = next.id;
    const existing = byId.get(originalId);
    if (!existing) {
      byId.set(originalId, next);
    } else {
      if (sameLogEntry(existing, next)) continue;
      onCollision(originalId);
      let suffix = 1;
      let id = `${originalId}~recovered-${suffix}`;
      while (byId.has(id)) {
        suffix += 1;
        id = `${originalId}~recovered-${suffix}`;
      }
      next = { ...next, id };
      byId.set(id, next);
    }
    entries.push(next);
    if (!next.undoOf && !next.undo && next.rating) {
      const candidates = ratingIds.get(originalId) ?? [];
      candidates.push({ id: next.id, word: next.word });
      ratingIds.set(originalId, candidates);
    }
  }
  return entries;
}

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
    this.reviewWritable = true;
    this.generation = 0;
  }

  async load() {
    const generation = ++this.generation;
    const rootGeneration = (await this.app.storage.scope()).rootGeneration;
    /* v8 ignore next -- the delayed mutation/root reload test covers the shared stale-generation contract. */
    if (generation !== this.generation) return this.review;
    this.rootGeneration = rootGeneration;
    await this.#loadReview(generation);
    /* v8 ignore next -- repeated await boundary for the same generation contract. */
    if (generation !== this.generation) return this.review;
    await this.#loadLog(generation);
    /* v8 ignore next -- repeated await boundary for the same generation contract. */
    if (generation !== this.generation) return this.review;
    if (this.review.pendingLogs?.length) {
      try { await this.flushPendingLogs(); } catch { this.notify(this.t.pendingLogRecoveryFailed); }
    }
    return this.review;
  }

  async reloadForRootChange() {
    this.generation += 1;
    this.rootGeneration = null;
    this.reviewRevision = undefined;
    this.logRevision = undefined;
    this.review = EMPTY();
    this.log = [];
    this.reviewWritable = true;
    return this.load();
  }

  async #loadReview(generation = this.generation) {
    const rootGeneration = this.rootGeneration;
    const result = await this.app.storage.read(rootGeneration, 'review.json');
    /* v8 ignore next -- private read boundary uses the tested shared stale guard. */
    if (this.#stale(generation, rootGeneration)) return;
    if (!result.found) {
      this.review = EMPTY();
      this.reviewRevision = null;
      return;
    }
    this.reviewRevision = result.revision;
    try {
      let invalidCards = 0;
      let invalidItems = 0;
      let logIdCollisions = 0;
      this.review = normalizeReview(JSON.parse(result.text), {
        onInvalidCard: () => { invalidCards += 1; },
        onInvalidItem: () => { invalidItems += 1; },
        onLogIdCollision: () => { logIdCollisions += 1; },
      });
      if (invalidCards > 0 || invalidItems > 0 || logIdCollisions > 0) {
        await this.#backupCorrupt('review', result.text, rootGeneration, generation);
        if (this.#stale(generation, rootGeneration)) return;
      }
      if (invalidCards > 0) this.notify(this.t.invalidReviewCards(invalidCards));
      if (invalidItems > 0) this.notify(this.t.invalidReviewItems(invalidItems));
      if (logIdCollisions > 0) this.notify(this.t.logIdCollisions(logIdCollisions));
    } catch (error) {
      await this.#backupCorrupt('review', result.text, rootGeneration, generation);
      /* v8 ignore next -- backup boundary uses the tested shared stale guard. */
      if (this.#stale(generation, rootGeneration)) return;
      if (codeOf(error) === 'UNSUPPORTED_REVIEW_VERSION') {
        this.notify(this.t.unsupportedReviewVersion);
        this.reviewWritable = false;
      } else {
        this.notify(this.t.corruptReview);
      }
      this.review = EMPTY();
      this.reviewRevision = result.revision;
    }
  }

  async #loadLog(generation = this.generation) {
    const rootGeneration = this.rootGeneration;
    const result = await this.app.storage.read(rootGeneration, 'log.json');
    /* v8 ignore next -- private read boundary uses the tested shared stale guard. */
    if (this.#stale(generation, rootGeneration)) return;
    if (!result.found) {
      this.log = [];
      this.logRevision = null;
      return;
    }
    this.logRevision = result.revision;
    try {
      const parsed = JSON.parse(result.text);
      if (!Array.isArray(parsed)) throw new Error('log must be an array');
      let collisions = 0;
      this.log = uniqueLogEntries(parsed, () => { collisions += 1; }).slice(-2000);
      if (collisions > 0) {
        await this.#backupCorrupt('log', result.text, rootGeneration, generation);
        if (this.#stale(generation, rootGeneration)) return;
        this.notify(this.t.logIdCollisions(collisions));
      }
    } catch {
      await this.#backupCorrupt('log', result.text, rootGeneration, generation);
      /* v8 ignore next -- backup boundary uses the tested shared stale guard. */
      if (this.#stale(generation, rootGeneration)) return;
      this.notify(this.t.corruptLog);
      this.log = [];
      this.logRevision = result.revision;
    }
  }

  async #backupCorrupt(kind, text, rootGeneration = this.rootGeneration, generation = this.generation) {
    const stamp = this.now().toISOString().replace(/[^0-9]/g, '').slice(0, 17);
    let name;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      /* v8 ignore next -- supported hosts expose crypto.randomUUID; the fallback is for older runtimes only. */
      const nonce = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
        ?? `${Math.random().toString(36).slice(2, 10)}${attempt}`;
      name = `${kind}.corrupt-${stamp}-${nonce}.json`;
      try {
        await this.app.storage.write(rootGeneration, name, text, { expectedRevision: null });
        break;
      } catch (error) {
        if (codeOf(error) !== 'REVISION_CONFLICT' || attempt === 3) throw error;
      }
    }
    /* v8 ignore next -- repeated backup boundary for the same generation contract. */
    if (this.#stale(generation, rootGeneration)) return;
    const listed = await this.app.storage.list(rootGeneration);
    /* v8 ignore next -- repeated backup boundary for the same generation contract. */
    if (this.#stale(generation, rootGeneration)) return;
    const backups = listed
      .filter((item) => new RegExp(`^${kind}\\.corrupt-\\d+(?:-[a-z0-9]+)?\\.json$`, 'iu').test(item.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const item of backups.slice(0, -3)) {
      await this.app.storage.remove(rootGeneration, item.name);
      /* v8 ignore next -- repeated backup cleanup boundary for the same generation contract. */
      if (this.#stale(generation, rootGeneration)) return;
    }
  }

  async saveReview(next = this.review) {
    this.#assertReviewWritable();
    const generation = this.generation;
    const rootGeneration = this.rootGeneration;
    try {
      const written = await this.app.storage.write(rootGeneration, 'review.json', JSON.stringify(next), {
        expectedRevision: this.reviewRevision,
      });
      /* v8 ignore next -- legacy saveReview uses the mutation path's tested generation contract. */
      if (this.#stale(generation, rootGeneration)) return { review: this.review, rootChanged: true };
      this.review = normalizeReview(next);
      this.reviewRevision = written.revision;
      return { review: this.review, rootChanged: false };
    } catch (error) {
      /* v8 ignore next -- legacy saveReview uses the mutation path's tested generation contract. */
      if (this.#stale(generation, rootGeneration)) return { review: this.review, rootChanged: true };
      if (codeOf(error) === 'ROOT_CHANGED') return { review: await this.reloadForRootChange(), rootChanged: true };
      if (codeOf(error) !== 'REVISION_CONFLICT') throw error;
      const local = normalizeReview(next);
      await this.#loadReview(generation);
      /* v8 ignore next -- legacy conflict reload uses the tested generation contract. */
      if (this.#stale(generation, rootGeneration)) return { review: this.review, rootChanged: true };
      const merged = mergeReview(this.review, local);
      const written = await this.app.storage.write(this.rootGeneration, 'review.json', JSON.stringify(merged), {
        expectedRevision: this.reviewRevision,
      });
      /* v8 ignore next -- legacy conflict write uses the tested generation contract. */
      if (this.#stale(generation, rootGeneration)) return { review: this.review, rootChanged: true };
      this.review = merged;
      this.reviewRevision = written.revision;
      return { review: this.review, rootChanged: false };
    }
  }

  async mutateReview(operation) {
    this.#assertReviewWritable();
    const generation = this.generation;
    const rootGeneration = this.rootGeneration;
    const apply = () => applyReviewOperation(this.review, operation, this.now());
    let applied = apply();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!applied.applied) return { ...applied, review: this.review, rootChanged: false };
      try {
        const written = await this.app.storage.write(rootGeneration, 'review.json', JSON.stringify(applied.review), {
          expectedRevision: this.reviewRevision,
        });
        if (this.#stale(generation, rootGeneration)) return { review: this.review, rootChanged: true, applied: false };
        this.review = applied.review;
        this.reviewRevision = written.revision;
        return { ...applied, review: this.review, rootChanged: false };
      } catch (error) {
        if (this.#stale(generation, rootGeneration)) return { review: this.review, rootChanged: true, applied: false };
        if (codeOf(error) === 'ROOT_CHANGED') return { review: await this.reloadForRootChange(), rootChanged: true };
        if (codeOf(error) !== 'REVISION_CONFLICT' || attempt === 1) throw error;
        await this.#loadReview(generation);
        if (this.#stale(generation, rootGeneration)) return { review: this.review, rootChanged: true, applied: false };
        applied = apply();
      }
    }
    return { ...applied, review: this.review, rootChanged: false };
  }

  async appendLog(entry) {
    const generation = this.generation;
    const rootGeneration = this.rootGeneration;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const next = uniqueLogEntries([...this.log, entry]).slice(-2000);
      try {
        const written = await this.app.storage.write(rootGeneration, 'log.json', JSON.stringify(next), {
          expectedRevision: this.logRevision,
        });
        if (this.#stale(generation, rootGeneration)) return this.log;
        this.log = next;
        this.logRevision = written.revision;
        return this.log;
      } catch (error) {
        if (this.#stale(generation, rootGeneration)) return this.log;
        if (codeOf(error) !== 'REVISION_CONFLICT' || attempt === 1) throw error;
        await this.#loadLog(generation);
      }
    }
    return this.log;
  }

  effectiveLog() {
    return uniqueLogEntries([...this.log, ...(this.review.pendingLogs ?? [])]).slice(-2000);
  }

  async flushPendingLogs() {
    const generation = this.generation;
    const rootGeneration = this.rootGeneration;
    const pending = [...(this.review.pendingLogs ?? [])];
    if (pending.length === 0) return this.log;
    for (const entry of pending) {
      await this.appendLog(entry);
      if (this.#stale(generation, rootGeneration)) return this.log;
    }
    const ids = pending.map((entry) => entry.id);
    await this.mutateReview({ type: 'removePendingLogs', ids });
    return this.log;
  }

  #assertReviewWritable() {
    if (this.reviewWritable) return;
    throw Object.assign(new Error('unsupported review version'), { code: 'UNSUPPORTED_REVIEW_VERSION' });
  }

  #stale(generation, rootGeneration) {
    return generation !== this.generation || rootGeneration !== this.rootGeneration;
  }
}

export function applyReviewOperation(value, operation, now = new Date()) {
  const review = normalizeReview(value);
  const previousCard = Object.hasOwn(review.cards, operation.word) ? review.cards[operation.word] : null;
  if (operation.type === 'restoreCardIfFingerprint' && JSON.stringify(previousCard) !== operation.expectedFingerprint) {
    return { review, previousCard, applied: false };
  }
  if (operation.type === 'rateCard') {
    review.cards[operation.word] = rateCard(previousCard ?? newSerializedCard(now), operation.rating, now);
  } else if (operation.type === 'setCard') review.cards[operation.word] = operation.card;
  else if (operation.type === 'deleteCard') delete review.cards[operation.word];
  else if (operation.type === 'restoreCardIfFingerprint') {
    if (operation.card) review.cards[operation.word] = operation.card;
    else delete review.cards[operation.word];
  }
  else if (operation.type === 'setFlag') review.flags[operation.word] = operation.flag;
  else if (operation.type === 'removeFlag') delete review.flags[operation.word];
  else if (operation.type === 'removePendingLogs') {
    const ids = new Set(operation.ids);
    review.pendingLogs = (review.pendingLogs ?? []).filter((entry) => !ids.has(entry.id));
  }
  else throw new Error(`unknown review operation: ${operation.type}`);
  if (operation.logEntry) {
    const entry = operation.type === 'rateCard'
      ? { ...operation.logEntry, previousState: previousCard?.state ?? 'New' }
      : operation.logEntry;
    review.pendingLogs = uniqueLogEntries([...(review.pendingLogs ?? []), entry]);
  }
  return { review, previousCard, applied: true };
}

export function normalizeReview(value, { onInvalidCard = () => undefined, onInvalidItem = () => undefined, onLogIdCollision = () => undefined } = {}) {
  if (value?.version !== undefined && value.version !== 1) {
    throw Object.assign(new Error(`unsupported review version: ${value.version}`), { code: 'UNSUPPORTED_REVIEW_VERSION' });
  }
  const isObject = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);
  if (!isObject(value) || value.version !== 1 || !isObject(value.cards) || !isObject(value.flags)
    || ('pendingLogs' in value && !Array.isArray(value.pendingLogs))) throw new Error('invalid review schema');
  const review = EMPTY();
  for (const [word, card] of Object.entries(value.cards)) {
    try {
      if (!isObject(card)) throw new Error('invalid card');
      for (const key of ['stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'reps', 'lapses']) {
        if (!Number.isFinite(card[key]) || card[key] < 0) throw new Error('invalid card');
      }
      for (const key of ['elapsed_days', 'scheduled_days', 'reps', 'lapses']) {
        if (!Number.isInteger(card[key])) throw new Error('invalid card');
      }
      if (card.difficulty > 10) throw new Error('invalid card');
      if (!['New', 'Learning', 'Review', 'Relearning'].includes(card.state)) throw new Error('invalid card');
      if (card.state !== 'New' && !card.last_review) throw new Error('invalid card');
      if (card.state === 'New') {
        if (card.stability !== 0 || card.difficulty !== 0 || card.reps !== 0 || card.lapses !== 0) throw new Error('invalid card');
      } else if (card.stability < 0.001 || card.difficulty < 1 || card.reps < 1) throw new Error('invalid card');
      const normalized = deserializeCard(card);
      if (!normalized || Number.isNaN(normalized.due?.getTime?.()) || (normalized.last_review && Number.isNaN(normalized.last_review.getTime())) || ![0, 1, 2, 3].includes(normalized.state)) throw new Error('invalid card');
      review.cards[word] = serializeCard(normalized);
    } catch {
      onInvalidCard(word);
    }
  }
  for (const [word, flag] of Object.entries(value.flags)) {
    if (flag === 'mastered' || flag === 'ignored') review.flags[word] = flag;
    else onInvalidItem(`flag:${word}`);
  }
  if (Array.isArray(value.pendingLogs)) {
    const pendingLogs = [];
    for (const entry of value.pendingLogs) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.id === 'string') pendingLogs.push(entry);
      else onInvalidItem('pendingLog');
    }
    review.pendingLogs = uniqueLogEntries(pendingLogs, onLogIdCollision).slice(-2000);
  }
  return review;
}

export function mergeReview(base, incoming) {
  const merged = normalizeReview(base);
  const other = normalizeReview(incoming);
  for (const [word, card] of Object.entries(other.cards)) {
    const current = Object.hasOwn(merged.cards, word) ? merged.cards[word] : undefined;
    merged.cards[word] = newestCard(current, card);
  }
  for (const [word, flag] of Object.entries(other.flags)) merged.flags[word] = flag;
  if (other.pendingLogs?.length || merged.pendingLogs?.length) {
    merged.pendingLogs = uniqueLogEntries([...(merged.pendingLogs ?? []), ...(other.pendingLogs ?? [])]).slice(-2000);
  }
  return merged;
}
