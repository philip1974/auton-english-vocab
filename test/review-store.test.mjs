import { describe, expect, it } from 'vitest';
import { ReviewStore, mergeReview } from '../src/review-store.mjs';

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
        if (options.expectedRevision && options.expectedRevision !== (revisions[name] ?? 'r1')) throw Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' });
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

  it('should merge by newer last_review when revision conflict occurs', async () => {
    const app = appWithStorage({
      'review.json': JSON.stringify({ version: 1, cards: { word: { due: '2026-10-14T00:00:00.000Z', state: 'Review', last_review: '2026-10-14T00:00:00.000Z' } }, flags: {} }),
    }, { conflictOnce: true });
    const store = new ReviewStore(app);
    await store.load();
    await store.saveReview({ version: 1, cards: { word: { due: '2026-10-15T00:00:00.000Z', state: 'Review', last_review: '2026-10-15T00:00:00.000Z' } }, flags: {} });
    expect(store.review.cards.word.last_review).toBe('2026-10-15T00:00:00.000Z');
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

  it('should merge review flags when merging reviews directly', () => {
    expect(mergeReview({ version: 1, cards: {}, flags: { a: 'ignored' } }, { version: 1, cards: {}, flags: { b: 'mastered' } }).flags).toEqual({ a: 'ignored', b: 'mastered' });
  });

  it('should keep existing card when it has the newest review time', () => {
    const merged = mergeReview(
      { version: 1, cards: { word: { due: '2026-10-15T00:00:00.000Z', state: 'Review', last_review: '2026-10-15T00:00:00.000Z' } }, flags: {} },
      { version: 1, cards: { word: { due: '2026-10-14T00:00:00.000Z', state: 'Review', last_review: '2026-10-14T00:00:00.000Z' } }, flags: {} },
    );
    expect(merged.cards.word.due).toBe('2026-10-15T00:00:00.000Z');
  });

  it('should ignore malformed review values when normalizing through load', async () => {
    const store = new ReviewStore(appWithStorage({ 'review.json': JSON.stringify({ version: 1, cards: { bad: null }, flags: { bad: 'other' } }) }));
    await store.load();
    expect(store.review).toEqual({ version: 1, cards: {}, flags: {} });
  });

  it('should reset log when stored log json is invalid', async () => {
    const store = new ReviewStore(appWithStorage({ 'log.json': '{no' }));
    await store.load();
    expect(store.log).toEqual([]);
  });

  it('should reset log when stored log json is not an array', async () => {
    const store = new ReviewStore(appWithStorage({ 'log.json': '{"not":"array"}' }));
    await store.load();
    expect(store.log).toEqual([]);
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
