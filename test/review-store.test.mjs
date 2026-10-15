import { describe, expect, it } from 'vitest';
import { ReviewStore, mergeReview, normalizeReview } from '../src/review-store.mjs';
import { newSerializedCard } from '../src/scheduler.mjs';

function appWithStorage(files = {}, failures = {}) {
  const revisions = {};
  let rootGeneration = 'root-a';
  return {
    setRoot(value) { rootGeneration = value; },
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

  it('should replay sequential ratings and append logs after revision conflicts', async () => {
    const failures = { conflictOnce: true };
    const app = appWithStorage({}, failures);
    const store = new ReviewStore(app, { now: () => new Date('2026-10-14T12:00:00Z') });
    await store.load();
    await store.mutateReview({ type: 'rateCard', word: 'run', rating: 'Good' });
    const first = store.review.cards.run;
    await store.mutateReview({ type: 'rateCard', word: 'run', rating: 'Again' });
    expect(store.review.cards.run.reps).toBe(first.reps + 1);
    await store.appendLog({ id: 'one', word: 'run' });
    app.files['log.json'] = JSON.stringify([{ id: 'external', word: 'run' }]);
    failures.conflictOnce = true;
    await store.appendLog({ id: 'two', word: 'run' });
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

  it('should reload state when root changes during save', async () => {
    const app = appWithStorage();
    const store = new ReviewStore(app);
    await store.load();
    app.setRoot('root-b');
    await store.saveReview({ version: 1, cards: {}, flags: { x: 'ignored' } });
    expect(store.rootGeneration).toBe('root-b');
  });

  it('should trim log to two thousand entries when appending', async () => {
    const store = new ReviewStore(appWithStorage({ 'log.json': JSON.stringify(Array.from({ length: 2000 }, (_, i) => i)) }));
    await store.load();
    await store.appendLog(2000);
    expect(store.log).toHaveLength(2000);
    expect(store.log[0]).toBe(1);
  });

  it('should project pending logs without duplicates and keep legacy entries when a flush is pending', async () => {
    const store = new ReviewStore(appWithStorage({
      'log.json': JSON.stringify([{ id: 'same', word: 'old' }, 1]),
    }));
    await store.load();
    store.review.pendingLogs = [{ id: 'same', word: 'new' }];
    expect(store.effectiveLog()).toEqual([{ id: 'same', word: 'new' }, 1]);
    await expect(store.flushPendingLogs()).resolves.toEqual([{ id: 'same', word: 'old' }, 1]);
    await expect(store.flushPendingLogs()).resolves.toEqual([{ id: 'same', word: 'old' }, 1]);
    expect(normalizeReview({ version: 1, cards: {}, flags: {}, pendingLogs: [null, { word: 'missing-id' }, { id: 'valid' }] }).pendingLogs).toEqual([{ id: 'valid' }]);
    expect(mergeReview(
      { version: 1, cards: {}, flags: {}, pendingLogs: [{ id: 'first' }] },
      { version: 1, cards: {}, flags: {}, pendingLogs: [{ id: 'first', value: 'new' }, { id: 'second' }] },
    ).pendingLogs).toEqual([{ id: 'first', value: 'new' }, { id: 'second' }]);
  });

  it('should merge review flags when merging reviews directly', () => {
    expect(mergeReview({ version: 1, cards: {}, flags: { a: 'ignored' } }, { version: 1, cards: {}, flags: { b: 'mastered' } }).flags).toEqual({ a: 'ignored', b: 'mastered' });
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
      pendingLogs: [{ id: 'ok', word: 'run' }, null, { word: 'missing-id' }],
    }) });
    const originalWrite = app.storage.write;
    app.storage.write = async (...args) => {
      if (args[1] === 'log.json') throw Object.assign(new Error('offline'), { code: 'STORAGE_WRITE_FAILED' });
      return originalWrite(...args);
    };
    const store = new ReviewStore(app, { locale: 'zh', notify: (message) => notices.push(message) });
    await store.load();
    expect(store.review.flags).toEqual({ run: 'ignored' });
    expect(store.review.pendingLogs).toEqual([{ id: 'ok', word: 'run' }]);
    expect(notices.join('\n')).toMatch(/3/u);
  });

  it('should keep activation usable and pending logs intact when startup log recovery fails', async () => {
    const pending = { id: 'pending-1', word: 'run' };
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
});
