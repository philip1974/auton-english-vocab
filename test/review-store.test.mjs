import { describe, expect, it } from 'vitest';
import { ReviewStore, mergeReview, normalizeReview } from '../src/review-store.mjs';
import { activeReviewLog, dueQueue, newSerializedCard, rateCard } from '../src/scheduler.mjs';

function appWithStorage(files = {}, failures = {}) {
  const revisions = {};
  let rootGeneration = 'root-a';
  return {
    setRoot(value) { rootGeneration = value; },
    externalWrite(name, text) {
      files[name] = text;
      revisions[name] = `external-${String(text).length}`;
    },
    storage: {
      async scope() { return { rootGeneration }; },
      async read(root, name) {
        if (root !== rootGeneration) throw Object.assign(new Error('root changed'), { code: 'ROOT_CHANGED' });
        if (!(name in files)) return { found: false };
        return { found: true, text: files[name], revision: revisions[name] ?? 'r1' };
      },
      async write(root, name, text, options = {}) {
        if (root !== rootGeneration) throw Object.assign(new Error('root changed'), { code: 'ROOT_CHANGED' });
        if (failures.conflictOnce) {
          failures.conflictOnce = false;
          throw Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' });
        }
        if ('expectedRevision' in options) {
          const exists = name in files;
          if (options.expectedRevision === null ? exists : !exists || options.expectedRevision !== (revisions[name] ?? 'r1')) {
            throw Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' });
          }
        }
        files[name] = text;
        revisions[name] = `r${Object.keys(files).length + text.length}`;
        return { revision: revisions[name] };
      },
      async list() { return Object.keys(files).map((name) => ({ name, bytes: files[name].length, revision: revisions[name] ?? 'r1' })); },
      async remove(root, name) { delete files[name]; },
    },
    files,
  };
}

describe('review store', () => {
  it('should load empty progress when review file does not exist', async () => {
    const store = new ReviewStore(appWithStorage());
    await expect(store.load()).resolves.toEqual({ version: 1, cards: {}, flags: {} });
  });

  it('should stop retrying after three consecutive root changes during initial reads', async () => {
    let reads = 0;
    const app = appWithStorage();
    app.storage.read = async () => {
      reads += 1;
      throw Object.assign(new Error('root keeps changing'), { code: 'ROOT_CHANGED' });
    };
    const store = new ReviewStore(app);
    await expect(store.load()).rejects.toMatchObject({ code: 'ROOT_CHANGED' });
    expect(reads).toBe(3);
  });

  it('should back up corrupt review json and keep only recent three backups when parsing fails', async () => {
    const app = appWithStorage({
      'review.json': '{broken',
      'review.corrupt-20260101000000.json': 'a',
      'review.corrupt-20260102000000.json': 'b',
      'review.corrupt-20260103000000.json': 'c',
    });
    const notices = [];
    const store = new ReviewStore(app, { now: () => new Date('2026-10-14T01:02:03Z'), locale: 'zh', notify: (message) => notices.push(message) });
    await store.load();
    expect(Object.keys(app.files).filter((name) => name.startsWith('review.corrupt-'))).toHaveLength(3);
    expect(notices[0]).toMatch(/已损坏/);
  });

  it('should preserve a corrupt review revision and recover it through real cas semantics', async () => {
    const app = appWithStorage({ 'review.json': '{broken' });
    const store = new ReviewStore(app);
    await store.load();
    expect(store.reviewRevision).toBe('r1');
    await store.mutateReview({ type: 'setFlag', word: 'run', flag: 'ignored' });
    expect(JSON.parse(app.files['review.json']).flags.run).toBe('ignored');
  });

  it('should merge by newer last_review when revision conflict occurs', async () => {
    const oldCard = { ...newSerializedCard(new Date('2026-10-14T00:00:00Z')), state: 'Review', stability: 2, difficulty: 5, reps: 1, last_review: '2026-10-14T00:00:00.000Z' };
    const newCard = { ...newSerializedCard(new Date('2026-10-15T00:00:00Z')), state: 'Review', stability: 2, difficulty: 5, reps: 1, last_review: '2026-10-15T00:00:00.000Z' };
    const app = appWithStorage({
      'review.json': JSON.stringify({ version: 1, cards: { word: oldCard }, flags: {} }),
    }, { conflictOnce: true });
    const store = new ReviewStore(app);
    await store.load();
    await store.saveReview({ version: 1, cards: { word: newCard }, flags: {} });
    expect(store.review.cards.word.last_review).toBe('2026-10-15T00:00:00.000Z');
  });

  it('should replay card flag and delete operations against latest review when revisions conflict', async () => {
    const app = appWithStorage({
      'review.json': JSON.stringify({ version: 1, cards: { old: { due: '2026-10-14T00:00:00.000Z', state: 'New', last_review: null } }, flags: { old: 'ignored' } }),
    }, { conflictOnce: true });
    const store = new ReviewStore(app);
    await store.load();
    await store.mutateReview({ type: 'deleteCard', word: 'old' });
    await store.mutateReview({ type: 'removeFlag', word: 'old' });
    expect(store.review.cards.old).toBeUndefined();
    expect(store.review.flags.old).toBeUndefined();
  });

  it('should preserve a future review version when a save reloads after a revision conflict', async () => {
    const original = JSON.stringify({ version: 1, cards: {}, flags: {} });
    const future = JSON.stringify({ version: 2, cards: { future: true }, flags: {} });
    const app = appWithStorage({ 'review.json': original });
    const store = new ReviewStore(app);
    await store.load();
    app.externalWrite('review.json', future);
    await expect(store.saveReview({ version: 1, cards: {}, flags: { beta: 'ignored' } })).rejects.toMatchObject({ code: 'UNSUPPORTED_REVIEW_VERSION' });
    expect(app.files['review.json']).toBe(future);
  });

  it('should preserve corrupt review bytes when backup fails during conflict reload', async () => {
    const corrupt = '{bad json';
    const app = appWithStorage({ 'review.json': JSON.stringify({ version: 1, cards: {}, flags: {} }) });
    const store = new ReviewStore(app);
    await store.load();
    app.externalWrite('review.json', corrupt);
    const write = app.storage.write.bind(app.storage);
    app.storage.write = async (root, name, text, options) => {
      if (name.startsWith('review.corrupt-')) throw Object.assign(new Error('full'), { code: 'STORAGE_TOO_MANY_FILES' });
      return write(root, name, text, options);
    };
    await expect(store.mutateReview({ type: 'setFlag', word: 'beta', flag: 'ignored' })).rejects.toMatchObject({ code: 'REVIEW_READ_ONLY' });
    expect(app.files['review.json']).toBe(corrupt);
  });

  it('should preserve corrupt log bytes when backup fails during conflict reload', async () => {
    const corrupt = '{bad log';
    const app = appWithStorage({ 'log.json': '[]' });
    const store = new ReviewStore(app);
    await store.load();
    app.externalWrite('log.json', corrupt);
    const write = app.storage.write.bind(app.storage);
    app.storage.write = async (root, name, text, options) => {
      if (name.startsWith('log.corrupt-')) throw Object.assign(new Error('full'), { code: 'STORAGE_TOO_MANY_FILES' });
      return write(root, name, text, options);
    };
    await expect(store.appendLog({ id: 'new', word: 'beta', rating: 'Good' })).rejects.toMatchObject({ code: 'LOG_READ_ONLY' });
    expect(app.files['log.json']).toBe(corrupt);
  });

  it('should replay sequential ratings and append logs after revision conflicts', async () => {
    const failures = { conflictOnce: true };
    const app = appWithStorage({}, failures);
    const store = new ReviewStore(app, { now: () => new Date('2026-10-14T12:00:00Z') });
    await store.load();
    await store.mutateReview({ type: 'rateCard', word: 'run', rating: 'Good' });
    const first = store.review.cards.run;
    await store.mutateReview({ type: 'rateCard', word: 'run', rating: 'Again' });
    expect(store.review.cards.run.reps).toBe(first.reps + 1);
    await store.appendLog({ id: 'one', word: 'run', rating: 'Good' });
    app.files['log.json'] = JSON.stringify([{ id: 'external', word: 'run', rating: 'Good' }]);
    failures.conflictOnce = true;
    await store.appendLog({ id: 'two', word: 'run', rating: 'Good' });
    expect(store.log.map((entry) => entry.id)).toEqual(['external', 'two']);
  });

  it('should recover a pending rating log after log write fails and the store restarts', async () => {
    const failures = {};
    const app = appWithStorage({}, failures);
    const first = new ReviewStore(app, { now: () => new Date('2026-10-14T12:00:00Z') });
    await first.load();
    const entry = { id: 'rating-1', word: 'run', rating: 'Good', reviewedAt: '2026-10-14T12:00:00.000Z', mode: 'flip' };
    await first.mutateReview({ type: 'rateCard', word: 'run', rating: 'Good', logEntry: entry });
    const originalWrite = app.storage.write;
    app.storage.write = async (...args) => {
      if (args[1] === 'log.json') throw Object.assign(new Error('failed'), { code: 'STORAGE_WRITE_FAILED' });
      return originalWrite(...args);
    };
    await expect(first.flushPendingLogs()).rejects.toThrow('failed');
    expect(JSON.parse(app.files['review.json']).pendingLogs).toHaveLength(1);
    app.storage.write = originalWrite;
    const restarted = new ReviewStore(app, { now: () => new Date('2026-10-14T12:01:00Z') });
    await restarted.load();
    expect(restarted.log).toEqual([expect.objectContaining({ id: 'rating-1', word: 'run', previousState: 'New' })]);
    expect(restarted.review.pendingLogs).toEqual([]);
  });

  it('should report a root change that occurs after log persistence but before pending cleanup', async () => {
    const app = appWithStorage();
    const store = new ReviewStore(app, { now: () => new Date('2026-10-15T12:00:00Z') });
    await store.load();
    await store.mutateReview({
      type: 'rateCard',
      word: 'alpha',
      rating: 'Good',
      logEntry: { id: 'rating-a', word: 'alpha', rating: 'Good', reviewedAt: '2026-10-15T12:00:00.000Z' },
    });
    const originalWrite = app.storage.write;
    app.storage.write = async (...args) => {
      const result = await originalWrite(...args);
      if (args[1] === 'log.json') app.setRoot('root-b');
      return result;
    };
    await expect(store.flushPendingLogs()).resolves.toMatchObject({ rootChanged: true });
    expect(store.rootGeneration).toBe('root-b');
  });

  it('should reload state when root changes during save', async () => {
    const app = appWithStorage();
    const store = new ReviewStore(app);
    await store.load();
    app.setRoot('root-b');
    await store.saveReview({ version: 1, cards: {}, flags: { x: 'ignored' } });
    expect(store.rootGeneration).toBe('root-b');
  });

  it('should trim log to two thousand entries when appending', async () => {
    const store = new ReviewStore(appWithStorage({ 'log.json': JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: `old-${i}`, word: 'run', rating: 'Good' }))) }));
    await store.load();
    await store.appendLog({ id: 'new', word: 'run', rating: 'Good' });
    expect(store.log).toHaveLength(2000);
    expect(store.log[0].id).toBe('old-1');
  });

  it('should migrate current-day introductions when bounding detailed log history', async () => {
    const old = Array.from({ length: 2001 }, (_, i) => ({ id: `old-${i}`, word: `old-${i}`, rating: 'Good', reviewedAt: '2026-10-14T12:00:00.000Z' }));
    const introduced = Array.from({ length: 50 }, (_, i) => ({ id: `introduced-${i}`, word: `new-${i}`, rating: 'Good', previousState: 'New', reviewedAt: '2026-10-15T00:01:00.000Z' }));
    const reviews = Array.from({ length: 2000 }, (_, i) => ({ id: `review-${i}`, word: `review-${i}`, rating: 'Good', previousState: 'Review', reviewedAt: '2026-10-15T01:00:00.000Z' }));
    const app = appWithStorage({ 'log.json': JSON.stringify([...old, ...introduced, ...reviews]) });
    const store = new ReviewStore(app, { now: () => new Date('2026-10-15T12:00:00.000Z') });
    await store.load();
    expect(store.log).toHaveLength(2000);
    expect(store.review.introduced.words).toHaveLength(50);
    const words = Array.from({ length: 50 }, (_, i) => ({ word: `candidate-${i}`, definition: 'x' }));
    expect(dueQueue(words, store.review, { newLimit: 50, log: store.effectiveLog() }, new Date('2026-10-15T12:00:00.000Z'))).toEqual([]);
  });

  it('should project pending logs without dropping conflicting legacy entries when a flush is pending', async () => {
    const store = new ReviewStore(appWithStorage({
      'log.json': JSON.stringify([{ id: 'same', word: 'old', rating: 'Good' }]),
    }));
    await store.load();
    store.review.pendingLogs = [{ id: 'same', word: 'new', rating: 'Good' }];
    expect(store.effectiveLog().map((entry) => entry.id)).toEqual(['same', 'same~recovered-1']);
    const flushed = await store.flushPendingLogs();
    expect(flushed.log).toHaveLength(2);
    expect(flushed.idMap.get('same')).toBe('same~recovered-1');
    await expect(store.flushPendingLogs()).resolves.toMatchObject({ log: expect.any(Array), rootChanged: false });
    expect(normalizeReview({ version: 1, cards: {}, flags: {}, pendingLogs: [null, { word: 'missing-id' }, { id: 'valid', word: 'run', rating: 'Good' }] }).pendingLogs).toEqual([{ id: 'valid', word: 'run', rating: 'Good' }]);
    expect(mergeReview(
      { version: 1, cards: {}, flags: {}, pendingLogs: [{ id: 'first', word: 'alpha', rating: 'Good' }] },
      { version: 1, cards: {}, flags: {}, pendingLogs: [{ id: 'first', word: 'beta', rating: 'Again' }, { id: 'second', word: 'gamma', rating: 'Hard' }] },
    ).pendingLogs.map((entry) => entry.id)).toEqual(['first', 'first~recovered-1', 'second']);
  });

  it('should keep safe read-only projections when corrupt backups cannot be written', async () => {
    const app = appWithStorage({
      'review.json': '{broken',
      'log.json': '{broken',
    });
    const originalWrite = app.storage.write;
    app.storage.write = async (root, name, text, options) => {
      if (name.includes('.corrupt-')) throw Object.assign(new Error('disk full'), { code: 'STORAGE_WRITE_FAILED' });
      return originalWrite(root, name, text, options);
    };
    const notices = [];
    const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
    await expect(store.load()).resolves.toEqual({ version: 1, cards: {}, flags: {} });
    expect(app.files['review.json']).toBe('{broken');
    expect(app.files['log.json']).toBe('{broken');
    await expect(store.mutateReview({ type: 'setFlag', word: 'run', flag: 'ignored' })).rejects.toMatchObject({ code: 'REVIEW_READ_ONLY' });
    await expect(store.appendLog({ id: 'one', word: 'run', rating: 'Good' })).rejects.toMatchObject({ code: 'LOG_READ_ONLY' });
    expect(notices.some((message) => message.includes('只读'))).toBe(true);
  });

  it('should ignore corrupt backup cleanup failures after preserving the current source', async () => {
    const app = appWithStorage({
      'review.json': '{broken',
      'review.corrupt-20260101000000000-old.json': 'old-1',
      'review.corrupt-20260102000000000-old.json': 'old-2',
      'review.corrupt-20260103000000000-old.json': 'old-3',
    });
    app.storage.remove = async () => { throw Object.assign(new Error('busy'), { code: 'STORAGE_WRITE_FAILED' }); };
    const store = new ReviewStore(app);
    await expect(store.load()).resolves.toEqual({ version: 1, cards: {}, flags: {} });
    expect(Object.keys(app.files).some((name) => /^review\.corrupt-\d+-[a-z0-9]+\.json$/u.test(name))).toBe(true);
  });

  it('should merge review flags when merging reviews directly', () => {
    expect(mergeReview({ version: 1, cards: {}, flags: { a: 'ignored' } }, { version: 1, cards: {}, flags: { b: 'mastered' } }).flags).toEqual({ a: 'ignored', b: 'mastered' });
  });

  it('should union same-day introductions and retain the newest day when reviews merge', () => {
    const sameDay = mergeReview(
      { version: 1, cards: {}, flags: {}, introduced: { day: '2026-10-15', words: ['alpha'] } },
      { version: 1, cards: {}, flags: {}, introduced: { day: '2026-10-15', words: ['beta'] } },
    );
    expect(sameDay.introduced).toEqual({ day: '2026-10-15', words: ['alpha', 'beta'] });
    const newer = mergeReview(sameDay, { version: 1, cards: {}, flags: {}, introduced: { day: '2026-10-16', words: ['gamma'] } });
    expect(newer.introduced).toEqual({ day: '2026-10-16', words: ['gamma'] });
    expect(mergeReview(newer, sameDay).introduced).toEqual({ day: '2026-10-16', words: ['gamma'] });
  });

  it('should keep existing card when it has the newest review time', () => {
    const newer = { ...newSerializedCard(new Date('2026-10-15T00:00:00Z')), state: 'Review', stability: 2, difficulty: 5, reps: 1, due: '2026-10-15T00:00:00.000Z', last_review: '2026-10-15T00:00:00.000Z' };
    const older = { ...newSerializedCard(new Date('2026-10-14T00:00:00Z')), state: 'Review', stability: 2, difficulty: 5, reps: 1, due: '2026-10-14T00:00:00.000Z', last_review: '2026-10-14T00:00:00.000Z' };
    const merged = mergeReview(
      { version: 1, cards: { word: newer }, flags: {} },
      { version: 1, cards: { word: older }, flags: {} },
    );
    expect(merged.cards.word.due).toBe('2026-10-15T00:00:00.000Z');
  });

  it('should ignore malformed review values when normalizing through load', async () => {
    const store = new ReviewStore(appWithStorage({ 'review.json': JSON.stringify({ version: 1, cards: { bad: null }, flags: { bad: 'other' } }) }));
    await store.load();
    expect(store.review).toEqual({ version: 1, cards: {}, flags: {} });
  });

  it('should isolate malformed cards while preserving valid progress and reporting the damage', async () => {
    const valid = newSerializedCard(new Date('2026-10-14T00:00:00Z'));
    const app = appWithStorage({ 'review.json': JSON.stringify({ version: 1, cards: { valid, broken: { ...valid, due: 'not-a-date' } }, flags: {} }) });
    const notices = [];
    const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
    await store.load();
    expect(store.review.cards.valid).toEqual(valid);
    expect(store.review.cards.broken).toBeUndefined();
    expect(notices.join('\n')).toMatch(/1/u);
    const backup = Object.keys(app.files).find((name) => name.startsWith('review.corrupt-'));
    expect(backup).toBeTruthy();
    expect(JSON.parse(app.files[backup]).cards.broken.due).toBe('not-a-date');
    await store.mutateReview({ type: 'setFlag', word: 'valid', flag: 'ignored' });
    expect(JSON.parse(app.files[backup]).cards.broken.due).toBe('not-a-date');
  });

  it('should infer a missing legacy learning step when normalizing stored cards', () => {
    const legacy = newSerializedCard(new Date('2026-10-14T00:00:00Z'));
    delete legacy.learning_steps;
    const learning = rateCard(newSerializedCard(new Date('2026-10-14T00:00:00Z')), 'Good', new Date('2026-10-14T00:00:00Z'));
    delete learning.learning_steps;
    const invalid = { ...legacy, learning_steps: 0.5 };
    const review = normalizeReview({ version: 1, cards: { legacy, learning, invalid }, flags: {} });
    expect(review.cards.legacy.learning_steps).toBe(0);
    expect(review.cards.learning.learning_steps).toBe(1);
    expect(review.cards.invalid).toBeUndefined();
  });

  it('should store prototype-shaped card and flag keys as own properties', async () => {
    const store = new ReviewStore(appWithStorage());
    await store.load();
    for (const word of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      await store.mutateReview({ type: 'setFlag', word, flag: 'ignored' });
      expect(Object.hasOwn(store.review.flags, word)).toBe(true);
    }
    await expect(store.mutateReview({ type: 'rateCard', word: 'constructor', rating: 'Good', logEntry: { id: 'constructor-rating', word: 'constructor' } })).resolves.toMatchObject({ applied: true });
    expect(Object.hasOwn(store.review.cards, 'constructor')).toBe(true);
  });

  it('should preserve different legacy log entries that share an id and back up the source log', async () => {
    const original = [
      { id: 'same', word: 'alpha', rating: 'Good' },
      { id: 'same', word: 'beta', rating: 'Again' },
    ];
    const app = appWithStorage({ 'log.json': JSON.stringify(original) });
    const notices = [];
    const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
    await store.load();
    expect(store.effectiveLog().map((entry) => entry.word)).toEqual(['alpha', 'beta']);
    expect(new Set(store.effectiveLog().map((entry) => entry.id)).size).toBe(2);
    expect(Object.keys(app.files).some((name) => name.startsWith('log.corrupt-'))).toBe(true);
    expect(notices.join('\n')).toMatch(/日志/u);
  });

  it('should rewrite a colliding rating id in a later same-word undo reference', async () => {
    const app = appWithStorage({ 'log.json': JSON.stringify([
      { id: 'same', word: 'alpha', rating: 'Good' },
      { id: 'same', word: 'beta', rating: 'Good' },
      { id: 'undo', word: 'beta', undoOf: 'same' },
    ]) });
    const store = new ReviewStore(app);
    await store.load();
    expect(store.effectiveLog()[2].undoOf).toBe('same~recovered-1');
    expect(activeReviewLog(store.effectiveLog()).map((entry) => entry.word)).toEqual(['alpha']);
  });

  it('should rewrite a pending undo when its colliding rating is flushed as one batch', async () => {
    const app = appWithStorage({
      'log.json': JSON.stringify([{ id: 'same', word: 'alpha', rating: 'Good', previousState: 'New' }]),
      'review.json': JSON.stringify({ version: 1, cards: {}, flags: {}, pendingLogs: [
        { id: 'same', word: 'beta', rating: 'Good', previousState: 'New' },
        { id: 'undo', word: 'beta', undoOf: 'same' },
      ] }),
    });
    const store = new ReviewStore(app);
    await store.load();
    expect(store.log.at(-1)).toMatchObject({ word: 'beta', undoOf: 'same~recovered-1' });
    expect(activeReviewLog(store.log).map((entry) => entry.word)).toEqual(['alpha']);
    expect(store.review.pendingLogs).toEqual([]);
  });

  it('should back up and isolate malformed current undo records without changing another word history', async () => {
    const app = appWithStorage({ 'log.json': JSON.stringify([
      { id: 'r1', word: 'alpha', rating: 'Good' },
      { id: 'junk', undoOf: 'r1' },
    ]) });
    const notices = [];
    const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
    await store.load();
    expect(store.log).toEqual([{ id: 'r1', word: 'alpha', rating: 'Good' }]);
    expect(activeReviewLog(store.log).map((entry) => entry.word)).toEqual(['alpha']);
    expect(Object.keys(app.files).some((name) => name.startsWith('log.corrupt-'))).toBe(true);
    expect(notices.length).toBeGreaterThan(0);
  });

  it('should preserve colliding pending log ids when reviews are merged', () => {
    const base = { version: 1, cards: {}, flags: {}, pendingLogs: [{ id: 'same', word: 'alpha', rating: 'Good' }] };
    const incoming = { version: 1, cards: {}, flags: {}, pendingLogs: [{ id: 'same', word: 'beta', rating: 'Again' }] };
    const merged = mergeReview(base, incoming);
    expect(merged.pendingLogs.map((entry) => entry.word)).toEqual(['alpha', 'beta']);
    expect(new Set(merged.pendingLogs.map((entry) => entry.id)).size).toBe(2);
  });

  it('should recover repeated pending ids without colliding with an existing recovery suffix', () => {
    const app = appWithStorage({ 'review.json': JSON.stringify({
      version: 1,
      cards: {},
      flags: {},
      pendingLogs: [
        { id: 'same', word: 'alpha', rating: 'Good' },
        { id: 'same~recovered-1', word: 'legacy', rating: 'Good' },
        { id: 'same', word: 'beta', rating: 'Again' },
      ],
    }) });
    const originalWrite = app.storage.write;
    app.storage.write = async (...args) => {
      if (args[1] === 'log.json') throw Object.assign(new Error('offline'), { code: 'STORAGE_WRITE_FAILED' });
      return originalWrite(...args);
    };
    const notices = [];
    const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
    return store.load().then(() => {
      expect(store.review.pendingLogs.map((entry) => entry.id)).toEqual(['same', 'same~recovered-1', 'same~recovered-2']);
      expect(Object.keys(app.files).some((name) => name.startsWith('review.corrupt-'))).toBe(true);
      expect(notices.join('\n')).toMatch(/ID/u);
    });
  });

  it('should create distinct non-overwriting corrupt backups within the same millisecond', async () => {
    const now = () => new Date('2026-10-15T12:34:56.789Z');
    const app = appWithStorage({ 'review.json': '{broken-one' });
    await new ReviewStore(app, { now }).load();
    app.files['review.json'] = '{broken-two';
    await new ReviewStore(app, { now }).load();
    const backups = Object.entries(app.files).filter(([name]) => name.startsWith('review.corrupt-'));
    expect(backups).toHaveLength(2);
    expect(new Set(backups.map(([, content]) => content))).toEqual(new Set(['{broken-one', '{broken-two']));
  });

  it('should retry a corrupt backup with a fresh exclusive name when creation conflicts', async () => {
    const app = appWithStorage({ 'review.json': '{broken' }, { conflictOnce: true });
    const store = new ReviewStore(app, { now: () => new Date('2026-10-15T12:34:56.789Z') });
    await expect(store.load()).resolves.toBeDefined();
    expect(Object.keys(app.files).filter((name) => name.startsWith('review.corrupt-'))).toHaveLength(1);
  });

  it('should back up valid json when the review container schema is damaged', async () => {
    for (const value of [
      null,
      {},
      { version: 1, cards: 'lost', flags: [] },
      { version: 1, cards: {}, flags: { run: true }, pendingLogs: 'lost' },
    ]) {
      const app = appWithStorage({ 'review.json': JSON.stringify(value) });
      const notices = [];
      const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
      await store.load();
      expect(Object.keys(app.files).some((name) => name.startsWith('review.corrupt-'))).toBe(true);
      expect(notices.join('\n')).toMatch(/损坏/u);
    }
  });

  it('should isolate cards with missing or non finite fsrs fields during load', async () => {
    const valid = newSerializedCard(new Date('2026-10-14T00:00:00Z'));
    const app = appWithStorage({ 'review.json': JSON.stringify({ version: 1, cards: {
      valid,
      missing: { due: '2026-10-15T00:00:00Z', state: 'Review' },
      nonfinite: { ...valid, stability: 'oops' },
      negative: { ...valid, stability: -1 },
      badstate: { ...valid, state: 'Unknown' },
      badlast: { ...valid, last_review: 'not-a-date' },
    }, flags: {} }) });
    const store = new ReviewStore(app);
    await store.load();
    expect(Object.keys(store.review.cards)).toEqual(['valid']);
  });

  it('should isolate invalid fsrs counts difficulty and state review date combinations', async () => {
    const valid = newSerializedCard(new Date('2026-10-14T00:00:00Z'));
    const reviewed = { ...valid, state: 'Review', difficulty: 5, stability: 2, reps: 1, last_review: '2026-10-14T00:00:00.000Z' };
    const app = appWithStorage({ 'review.json': JSON.stringify({ version: 1, cards: {
      valid,
      reviewed,
      fractionalReps: { ...reviewed, reps: 0.5 },
      fractionalLapses: { ...reviewed, lapses: 0.25 },
      highDifficulty: { ...reviewed, difficulty: 11 },
      zeroStability: { ...reviewed, stability: 0 },
      zeroDifficulty: { ...reviewed, difficulty: 0 },
      zeroReps: { ...reviewed, reps: 0 },
      missingReviewDate: { ...reviewed, last_review: null },
    }, flags: {} }) });
    const store = new ReviewStore(app);
    await store.load();
    expect(Object.keys(store.review.cards)).toEqual(['valid', 'reviewed']);
  });

  it('should report and isolate invalid flag and pending log entries while keeping valid items', async () => {
    const notices = [];
    const app = appWithStorage({ 'review.json': JSON.stringify({
      version: 1,
      cards: {},
      flags: { run: 'ignored', bad: true },
      pendingLogs: [{ id: 'ok', word: 'run', rating: 'Good' }, null, { word: 'missing-id' }],
    }) });
    const originalWrite = app.storage.write;
    app.storage.write = async (...args) => {
      if (args[1] === 'log.json') throw Object.assign(new Error('offline'), { code: 'STORAGE_WRITE_FAILED' });
      return originalWrite(...args);
    };
    const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
    await store.load();
    expect(store.review.flags).toEqual({ run: 'ignored' });
    expect(store.review.pendingLogs).toEqual([{ id: 'ok', word: 'run', rating: 'Good' }]);
    expect(notices.join('\n')).toMatch(/3/u);
  });

  it('should keep activation usable and pending logs intact when startup log recovery fails', async () => {
    const pending = { id: 'pending-1', word: 'run', rating: 'Good' };
    const app = appWithStorage({ 'review.json': JSON.stringify({ version: 1, cards: {}, flags: {}, pendingLogs: [pending] }) });
    const originalWrite = app.storage.write;
    app.storage.write = async (...args) => {
      if (args[1] === 'log.json') throw Object.assign(new Error('offline'), { code: 'STORAGE_WRITE_FAILED' });
      return originalWrite(...args);
    };
    const notices = [];
    const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
    await expect(store.load()).resolves.toMatchObject({ pendingLogs: [pending] });
    expect(store.effectiveLog()).toEqual([pending]);
    expect(notices.join('\n')).toMatch(/日志/u);
  });

  it('should discard a delayed mutation result after a root reload advances generation', async () => {
    const app = appWithStorage();
    const store = new ReviewStore(app);
    await store.load();
    let release;
    const originalWrite = app.storage.write;
    app.storage.write = (...args) => {
      const settled = originalWrite(...args);
      return new Promise((resolve, reject) => { release = () => settled.then(resolve, reject); });
    };
    const pending = store.mutateReview({ type: 'setFlag', word: 'alpha', flag: 'ignored' });
    await Promise.resolve();
    app.setRoot('root-b');
    delete app.files['review.json'];
    app.storage.write = originalWrite;
    await store.reloadForRootChange();
    release();
    await expect(pending).resolves.toMatchObject({ rootChanged: true });
    expect(store.rootGeneration).toBe('root-b');
    expect(store.review.flags.alpha).toBeUndefined();
  });

  it('should reject conditional card restoration after a conflict changes the successor card', async () => {
    const first = newSerializedCard(new Date('2026-10-14T00:00:00Z'));
    const successor = { ...first, state: 'Review', stability: 2, difficulty: 5, reps: 1, last_review: '2026-10-14T00:00:00.000Z', due: '2026-10-15T00:00:00.000Z' };
    const external = { ...successor, reps: 2, due: '2026-10-17T00:00:00.000Z' };
    const app = appWithStorage({ 'review.json': JSON.stringify({ version: 1, cards: { run: successor }, flags: {} }) }, { conflictOnce: true });
    const store = new ReviewStore(app);
    await store.load();
    app.files['review.json'] = JSON.stringify({ version: 1, cards: { run: external }, flags: {} });
    const result = await store.mutateReview({ type: 'restoreCardIfFingerprint', word: 'run', expectedFingerprint: JSON.stringify(successor), card: first, logEntry: { id: 'undo', undoOf: 'rating' } });
    expect(result.applied).toBe(false);
    expect(store.review.cards.run).toEqual(external);
    expect(store.review.pendingLogs).toBeUndefined();
  });

  it('should back up unsupported review versions and refuse to overwrite them', async () => {
    const app = appWithStorage({ 'review.json': JSON.stringify({ version: 2, cards: { future: {} }, flags: {} }) });
    const notices = [];
    const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
    await store.load();
    expect(Object.keys(app.files).some((name) => name.startsWith('review.corrupt-'))).toBe(true);
    expect(notices.join('\n')).toMatch(/版本/u);
    await expect(store.mutateReview({ type: 'setFlag', word: 'run', flag: 'ignored' })).rejects.toMatchObject({ code: 'UNSUPPORTED_REVIEW_VERSION' });
  });

  it('should reset log when stored log json is invalid', async () => {
    const app = appWithStorage({ 'log.json': '{no' });
    const notices = [];
    const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
    await store.load();
    expect(store.log).toEqual([]);
    expect(store.logRevision).toBe('r1');
    expect(Object.keys(app.files).some((name) => name.startsWith('log.corrupt-'))).toBe(true);
    expect(notices.at(-1)).toMatch(/log\.json/u);
    await expect(store.appendLog({ id: 'recovered' })).resolves.toEqual([{ id: 'recovered' }]);
  });

  it('should reset log when stored log json is not an array', async () => {
    const app = appWithStorage({ 'log.json': '{"not":"array"}' });
    const store = new ReviewStore(app);
    await store.load();
    expect(store.log).toEqual([]);
    expect(Object.keys(app.files).some((name) => name.startsWith('log.corrupt-'))).toBe(true);
  });

  it('should throw errors without a storage code when saving fails unexpectedly', async () => {
    const app = appWithStorage();
    app.storage.write = async () => { throw new Error('plain'); };
    const store = new ReviewStore(app);
    await store.load();
    await expect(store.saveReview()).rejects.toThrow(/plain/);
  });

  it('should throw non conflict write errors when saving fails unexpectedly', async () => {
    const app = appWithStorage();
    app.storage.write = async () => { throw Object.assign(new Error('boom'), { code: 'OTHER' }); };
    const store = new ReviewStore(app);
    await store.load();
    await expect(store.saveReview()).rejects.toThrow(/boom/);
  });

  it('should use default corrupt notification callback when no callback is provided', async () => {
    const store = new ReviewStore(appWithStorage({ 'review.json': '{bad' }, {}));
    await store.load();
    expect(store.review).toEqual({ version: 1, cards: {}, flags: {} });
  });

  it('should localize the corrupt review notification through uiText', async () => {
    const notices = [];
    const store = new ReviewStore(appWithStorage({ 'review.json': '{bad' }), { locale: 'en', notify: (message) => notices.push(message) });
    await store.load();
    expect(notices[0]).toBe('review.json is damaged. It was backed up and review progress was reset.');
  });

  it('should migrate todays active new ratings when first loading legacy data', async () => {
    const now = new Date('2026-10-15T12:00:00');
    const app = appWithStorage({
      'review.json': JSON.stringify({ version: 1, cards: {}, flags: {} }),
      'log.json': JSON.stringify([
        { id: 'a', word: 'alpha', rating: 'Good', previousState: 'New', reviewedAt: '2026-10-15T01:00:00' },
        { id: 'b', word: 'beta', rating: 'Good', previousState: 'New', reviewedAt: '2026-10-15T02:00:00' },
        { id: 'u', word: 'beta', undoOf: 'b', reviewedAt: '2026-10-15T03:00:00' },
      ]),
    });
    const store = new ReviewStore(app, { now: () => now });
    await store.load();
    expect(store.review.introduced).toEqual({ day: '2026-10-15', words: ['alpha'] });
    expect(JSON.parse(app.files['review.json']).introduced).toEqual({ day: '2026-10-15', words: ['alpha'] });
  });

  it('should add and reversibly remove a word when rating and undoing it today', async () => {
    const now = new Date('2026-10-15T12:00:00');
    const store = new ReviewStore(appWithStorage(), { now: () => now });
    await store.load();
    const rated = await store.mutateReview({ type: 'rateCard', word: 'run', rating: 'Good' });
    expect(rated.review.introduced).toEqual({ day: '2026-10-15', words: ['run'] });
    const fingerprint = JSON.stringify(rated.review.cards.run);
    const undone = await store.mutateReview({ type: 'restoreCardIfFingerprint', word: 'run', card: null, expectedFingerprint: fingerprint, removeIntroduced: true });
    expect(undone.review.introduced).toEqual({ day: '2026-10-15', words: [] });
  });

  it('should discard the previous introduced set when loading on a new local day', async () => {
    const app = appWithStorage({
      'review.json': JSON.stringify({ version: 1, cards: {}, flags: {}, introduced: { day: '2026-10-14', words: ['old'] } }),
    });
    const store = new ReviewStore(app, { now: () => new Date('2026-10-15T00:01:00') });
    await store.load();
    expect(store.review.introduced).toEqual({ day: '2026-10-15', words: [] });
  });

  it('should isolate a damaged introduced field when valid cards and flags are loaded', async () => {
    const card = rateCard(newSerializedCard(new Date('2026-10-14T00:00:00Z')), 'Easy', new Date('2026-10-14T00:00:00Z'));
    const app = appWithStorage({
      'review.json': JSON.stringify({ version: 1, cards: { alpha: card }, flags: { alpha: 'mastered' }, introduced: { day: '2026-10-15', words: [null] } }),
    });
    const store = new ReviewStore(app, { now: () => new Date('2026-10-15T12:00:00') });
    await store.load();
    expect(store.review.cards.alpha).toEqual(card);
    expect(store.review.flags.alpha).toBe('mastered');
    expect(store.review.introduced).toEqual({ day: '2026-10-15', words: [] });
    expect(Object.keys(app.files).some((name) => name.startsWith('review.corrupt-'))).toBe(true);
    await store.mutateReview({ type: 'setFlag', word: 'beta', flag: 'ignored' });
    const written = JSON.parse(app.files['review.json']);
    expect(written.cards.alpha).toEqual(card);
    expect(written.flags).toMatchObject({ alpha: 'mastered', beta: 'ignored' });
  });

  it('should union migrated introductions when two stores replay after a conflict', async () => {
    const day = new Date('2026-10-15T12:00:00');
    const app = appWithStorage({
      'review.json': JSON.stringify({ version: 1, cards: {}, flags: {}, introduced: { day: '2026-10-15', words: ['alpha'] } }),
    });
    const first = new ReviewStore(app, { now: () => day });
    const second = new ReviewStore(app, { now: () => day });
    await Promise.all([first.load(), second.load()]);
    await first.mutateReview({ type: 'rateCard', word: 'xray', rating: 'Good' });
    await second.mutateReview({ type: 'mergeIntroduced', day: '2026-10-15', words: ['alpha'] });
    expect(JSON.parse(app.files['review.json']).introduced.words.sort()).toEqual(['alpha', 'xray']);
  });

  it('should keep a concurrent new-day introduction when another store replays midnight rollover', async () => {
    let now = new Date('2026-10-14T23:59:00');
    const app = appWithStorage({
      'review.json': JSON.stringify({ version: 1, cards: {}, flags: {}, introduced: { day: '2026-10-14', words: ['old'] } }),
    });
    const first = new ReviewStore(app, { now: () => now });
    const second = new ReviewStore(app, { now: () => now });
    await Promise.all([first.load(), second.load()]);
    now = new Date('2026-10-15T00:01:00');
    await first.mutateReview({ type: 'rateCard', word: 'xray', rating: 'Good' });
    const rolled = await second.mutateReview({ type: 'rollIntroducedDay', expectedDay: '2026-10-14', day: '2026-10-15' });
    expect(rolled.applied).toBe(false);
    expect(JSON.parse(app.files['review.json']).introduced).toEqual({ day: '2026-10-15', words: ['xray'] });
  });

  it('should keep persisted log history bounded when count and utf8 bytes are large', async () => {
    const store = new ReviewStore(appWithStorage());
    await store.load();
    const entries = Array.from({ length: 5000 }, (_, index) => ({
      id: `log-${index}`, word: `词${index}${'界'.repeat(80)}`, rating: 'Good', reviewedAt: '2026-10-15T01:00:00', previousState: 'Review',
    }));
    await store.appendLogs(entries);
    const text = JSON.stringify(store.log);
    expect(store.log.length).toBeLessThanOrEqual(2000);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(1024 * 1024);
  });
});
