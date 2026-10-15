import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, buildLevelCacheEntry, cacheShardNames, LevelCache, scoreCachedEntry } from '../src/level-cache.mjs';
import { rankMapFromWords } from '../src/rank-candidates.mjs';

function storage() {
  const files = new Map();
  let rootGeneration = 'root-a';
  const calls = [];
  const assertRoot = (root) => {
    if (root !== rootGeneration) throw Object.assign(new Error('root changed'), { code: 'ROOT_CHANGED' });
  };
  return {
    files,
    calls,
    setRoot(next) { rootGeneration = next; },
    async scope() { return { rootGeneration }; },
    async read(root, name) {
      assertRoot(root);
      calls.push(['read', root, name]);
      return files.has(name) ? { found: true, text: files.get(name) } : { found: false };
    },
    async write(root, name, text) {
      assertRoot(root);
      calls.push(['write', root, name]);
      files.set(name, text);
      return { revision: name };
    },
    async list(root) {
      assertRoot(root);
      calls.push(['list', root]);
      return [...files.keys()];
    },
    async remove(root, name) {
      assertRoot(root);
      calls.push(['remove', root, name]);
      files.delete(name);
    },
  };
}

describe('level cache and novel word scoring', () => {
  it('should score rank boundaries and collected mastered states without rereading text when vocabulary size changes', () => {
    const table = rankMapFromWords(['the', 'and', ...Array.from({ length: 998 }, (_, index) => `filler${index}`), 'alpha', 'beta', 'gamma']);
    const entry = buildLevelCacheEntry('the and alpha beta gamma gamma', table, 1);
    expect(scoreCachedEntry(entry, { table, review: { cards: {}, flags: {} }, settings: { vocabularySize: 1001, easyMax: 2, goodMax: 5 } })).toMatchObject({ novel: 3 });
    expect(scoreCachedEntry(entry, { table, review: { cards: {}, flags: { gamma: 'mastered' } }, settings: { vocabularySize: 1001, easyMax: 2, goodMax: 5 }, entries: [{ word: 'gamma' }] })).toMatchObject({ novel: 1 });
    expect(scoreCachedEntry(entry, { table, review: { cards: { beta: { state: 'New' } }, flags: { gamma: 'mastered' } }, settings: { vocabularySize: 1002, easyMax: 2, goodMax: 5 }, entries: [{ word: 'beta' }, { word: 'gamma' }] })).toMatchObject({ novel: 1 });
  });

  it('should count prototype-shaped tokens with finite numeric novel rates', () => {
    const entry = buildLevelCacheEntry(Array.from({ length: 60 }, () => 'constructor').join(' '), [], 1);
    expect(entry.words).toMatchObject({ constructor: 60 });
    const scored = scoreCachedEntry(entry, { table: [], review: JSON.parse('{"cards":{},"flags":{}}'), settings: { vocabularySize: 0, easyMax: 2, goodMax: 5 } });
    expect(scored).toMatchObject({ counted: 60, novel: 60, rate: 100 });
    expect(Number.isFinite(scored.rate)).toBe(true);
  });

  it('should use notebook entries plus FSRS familiarity when deciding whether collected words are novel', () => {
    const table = rankMapFromWords(['the', ...Array.from({ length: 1000 }, (_, index) => `filler${index}`), 'alpha', 'beta', 'gamma', 'delta']);
    const entry = buildLevelCacheEntry('alpha beta gamma delta', table, 1);
    const settings = { vocabularySize: 1005, easyMax: 2, goodMax: 5 };
    const entries = [{ word: 'alpha' }, { word: 'beta' }, { word: 'gamma' }];
    const review = {
      cards: {
        alpha: { state: 'Review', stability: 30 },
        beta: { state: 'New' },
        delta: { state: 'New' },
      },
      flags: { beta: 'ignored' },
    };
    const scored = scoreCachedEntry(entry, { table, review, settings, entries });
    expect(scored.topWords).toEqual(['gamma']);
    expect(scored.novel).toBe(1);
  });

  it('should expose only legal cache shard names when persisting split cache files', () => {
    expect(cacheShardNames()).toEqual(['level-cache-0.json', 'level-cache-1.json', 'level-cache-2.json', 'level-cache-3.json']);
  });

  it('should invalidate by content hash, evict least recently used entries and reload on root changes', async () => {
    const io = storage();
    const cache = new LevelCache(io, { maxShardBytes: 180 });
    await cache.load();
    await cache.set(cache.epoch, 'wiki/a.md', 'h1', { counted: 1, base: 0, words: { alpha: 1 }, usedAt: 1 });
    expect(cache.get('wiki/a.md', 'h1')).not.toBeNull();
    expect(cache.get('wiki/a.md', 'h2')).toBeNull();
    await cache.set(cache.epoch, 'wiki/b.md', 'h1', { counted: 1, base: 0, words: { beta: 1, gamma: 1, delta: 1 }, usedAt: 2 });
    await cache.flush();
    expect([...io.files.keys()].every((name) => cacheShardNames().includes(name))).toBe(true);
    io.setRoot('root-b');
    await cache.handleRootChanged();
    expect(cache.epoch).toBe('root-b');
  });

  it('should evict oldest entries when a shard exceeds its byte budget', async () => {
    const io = storage();
    const cache = new LevelCache(io, { maxShardBytes: 80 });
    await cache.load();
    await cache.set(cache.epoch, 'wiki/a.md', 'h1', { counted: 1, base: 0, words: { alpha: 1 }, usedAt: 1 });
    await cache.set(cache.epoch, 'wiki/e.md', 'h1', { counted: 1, base: 0, words: { beta: 1 }, usedAt: 2 });
    await cache.flush();
    expect(cache.items.size).toBeLessThan(2);
  });

  it('should enforce shard limits by utf8 bytes when paths and titles contain unicode', async () => {
    const io = storage();
    const cache = new LevelCache(io, { maxShardBytes: 400 });
    await cache.load();
    await cache.set(cache.epoch, `wiki/${'界'.repeat(40)}.md`, 'h1', { title: '界'.repeat(80), counted: 1, base: 0, words: {}, usedAt: 1 });
    await cache.flush();
    const written = [...io.files.values()][0];
    expect(new TextEncoder().encode(written).byteLength).toBeLessThanOrEqual(400);
  });

  it('should drop late async writes when the workspace epoch has changed', async () => {
    const cache = new LevelCache(storage());
    await cache.load();
    expect(await cache.set('stale', 'wiki/a.md', 'h1', { counted: 1, base: 0, words: {} })).toBe(false);
  });

  it('should use the storage scoped root generation and defer shard writes until flush when caching documents', async () => {
    const io = storage();
    const cache = new LevelCache(io);
    await cache.load();
    expect(cache.epoch).toBe('root-a');
    await expect(cache.set(cache.epoch, 'wiki/a.md', 'h1', { counted: 1, base: 0, words: { alpha: 1 } })).resolves.toBe(true);
    expect(io.calls.filter(([kind]) => kind === 'write')).toHaveLength(0);
    await cache.flush();
    expect(io.calls.some(([kind, root]) => kind === 'write' && root === 'root-a')).toBe(true);
  });

  it('should reload once when storage reports ROOT_CHANGED and treat corrupt shard JSON as empty', async () => {
    const io = storage();
    io.files.set('level-cache-0.json', '{broken');
    const cache = new LevelCache(io);
    await expect(cache.load()).resolves.toBeUndefined();
    await cache.set(cache.epoch, 'wiki/a.md', 'h1', { counted: 1, base: 0, words: { alpha: 1 } });
    io.setRoot('root-b');
    await expect(cache.flush()).resolves.toBeUndefined();
    expect(cache.epoch).toBe('root-b');
  });

  it('should discard cache shards when their analysis version is missing or unsupported', async () => {
    const io = storage();
    io.files.set('level-cache-0.json', JSON.stringify({ version: 1, items: { 'wiki/old.md': { hash: 'same', counted: 1, base: 1, words: {} } } }));
    io.files.set('level-cache-1.json', JSON.stringify({ version: 1, analysisVersion: 999, items: { 'wiki/future.md': { hash: 'same', counted: 1, base: 1, words: {} } } }));
    io.files.set('level-cache-2.json', JSON.stringify({ version: 1, analysisVersion: ANALYSIS_VERSION, items: { 'wiki/current.md': { hash: 'same', english: true, counted: 1, base: 0, words: { letter: 1 } } } }));
    const cache = new LevelCache(io);
    await cache.load();
    expect(cache.get('wiki/old.md', 'same')).toBeNull();
    expect(cache.get('wiki/future.md', 'same')).toBeNull();
    expect(cache.get('wiki/current.md', 'same')).toMatchObject({ words: { letter: 1 } });
    io.files.set('level-cache-0.json', JSON.stringify({ version: 999, analysisVersion: ANALYSIS_VERSION, items: {} }));
    io.files.set('level-cache-1.json', JSON.stringify({ version: 1, analysisVersion: ANALYSIS_VERSION }));
    io.files.set('level-cache-2.json', JSON.stringify({ version: 1, analysisVersion: ANALYSIS_VERSION, items: [] }));
    await cache.load();
    expect(cache.items.size).toBe(0);
    await cache.flush();
  });

  it('should discard and rewrite semantically invalid cache entries when shard json is valid', async () => {
    const io = storage();
    const name = cacheShardNames()[0];
    io.files.set(name, JSON.stringify({ version: 1, analysisVersion: ANALYSIS_VERSION, items: {
      'wiki/bad.md': { hash: 'same', english: true, counted: 1, base: 0, words: { rare: 'oops' } },
      'wiki/bad-title.md': { hash: 'title', title: 42, english: true, counted: 1, base: 0, words: {} },
      'wiki/bad-time.md': { hash: 'time', usedAt: -1, english: true, counted: 1, base: 0, words: {} },
      'wiki/bad-count.md': { hash: 'count', english: true, counted: 0.5, base: 0, words: {} },
      'wiki/bad-reason.md': { hash: 'reason', english: false, reason: null },
      'wiki/bad-words.md': { hash: 'words', english: true, counted: 1, base: 0, words: [] },
      'wiki/bad-total.md': { hash: 'total', english: true, counted: 1, base: 0, words: { rare: 2 } },
      'wiki/bad-skip.md': { hash: 'skip', english: false, reason: 'garbage' },
    } }));
    const cache = new LevelCache(io);
    await cache.load();
    expect(cache.get('wiki/bad.md', 'same')).toBeNull();
    expect(cache.items.size).toBe(0);
    expect(cache.dirty.has(name)).toBe(true);
    await cache.flush();
    expect(JSON.parse(io.files.get(name)).items).toEqual({});
  });

  it('should prune orphaned paths only for the captured current cache epoch', async () => {
    const cache = new LevelCache(storage());
    await cache.load();
    await cache.set(cache.epoch, 'wiki/live.md', 'live', { english: true, counted: 1, base: 1, words: {} });
    await cache.set(cache.epoch, 'wiki/deleted.md', 'old', { english: true, counted: 1, base: 1, words: {} });
    expect(cache.prune('stale', new Set(['wiki/live.md']))).toBe(false);
    expect(cache.prune(cache.epoch, new Set(['wiki/live.md']))).toBe(true);
    expect(cache.get('wiki/deleted.md', 'old')).toBeNull();
  });

  it('should keep an in-memory cache when plugin storage is missing', async () => {
    const cache = new LevelCache(null);
    await cache.load();
    expect(await cache.set(cache.epoch, 'wiki/a.md', 'h1', { counted: 1, base: 0, words: { alpha: 1 } })).toBe(true);
    await expect(cache.flush()).resolves.toBeUndefined();
    expect(cache.get('wiki/a.md', 'h1')).not.toBeNull();
  });
});
