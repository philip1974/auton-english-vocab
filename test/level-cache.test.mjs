import { describe, expect, it } from 'vitest';
import { buildLevelCacheEntry, cacheShardNames, LevelCache, scoreCachedEntry } from '../src/level-cache.mjs';
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

  it('should keep an in-memory cache when plugin storage is missing', async () => {
    const cache = new LevelCache(null);
    await cache.load();
    expect(await cache.set(cache.epoch, 'wiki/a.md', 'h1', { counted: 1, base: 0, words: { alpha: 1 } })).toBe(true);
    await expect(cache.flush()).resolves.toBeUndefined();
    expect(cache.get('wiki/a.md', 'h1')).not.toBeNull();
  });
});
