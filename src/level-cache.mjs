import { buildSurfaceMap } from './inflections.mjs';
import { rankOf, rankMapFromWords } from './rank-candidates.mjs';
import { DEFAULT_LEVEL_SETTINGS, extractReadingTokens, classifyNovelRate } from './reading-level.mjs';
import { familiarityFor } from './familiarity.mjs';

const SHARDS = ['level-cache-0.json', 'level-cache-1.json', 'level-cache-2.json', 'level-cache-3.json'];
export const ANALYSIS_VERSION = 5;
const MAX_SHARD_BYTES = 3.5 * 1024 * 1024;
const utf8Bytes = (value) => new TextEncoder().encode(value).byteLength;

function hashPath(path) {
  let hash = 2166136261;
  for (const char of String(path)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function entryShard(path) {
  return SHARDS[hashPath(path) % SHARDS.length];
}

function isRootChanged(error) {
  return error?.code === 'ROOT_CHANGED';
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isValidCacheEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.hash !== 'string') return false;
  if (entry.title !== undefined && typeof entry.title !== 'string') return false;
  if (entry.usedAt !== undefined && (!Number.isFinite(entry.usedAt) || entry.usedAt < 0)) return false;
  if (entry.english === false) return ['too-short', 'not-english'].includes(entry.reason);
  if (entry.english !== true || !isNonNegativeInteger(entry.counted) || !isNonNegativeInteger(entry.base)) return false;
  if (!entry.words || typeof entry.words !== 'object' || Array.isArray(entry.words)) return false;
  const counts = Object.values(entry.words);
  return counts.every(isNonNegativeInteger) && entry.base + counts.reduce((sum, count) => sum + count, 0) === entry.counted;
}

function familiarityForCollected(review, word, surfaceMap) {
  if (!surfaceMap.has(word)) return null;
  const lemma = surfaceMap.get(word);
  const own = (record, key) => record && Object.hasOwn(record, key) ? record[key] : undefined;
  return familiarityFor(own(review?.cards, lemma) ?? own(review?.cards, word), own(review?.flags, lemma) ?? own(review?.flags, word));
}

export function cacheShardNames() {
  return [...SHARDS];
}

export function cacheShardNameForPath(path) {
  return entryShard(path);
}

export function buildLevelCacheEntry(markdown, table, now = Date.now()) {
  const ranks = table instanceof Map ? table : rankMapFromWords(table);
  const words = Object.create(null);
  let base = 0;
  let counted = 0;
  for (const token of extractReadingTokens(markdown)) {
    if (!token.counted) continue;
    counted += 1;
    const rank = rankOf(token.word, ranks);
    if (rank !== null && rank <= 1000) base += 1;
    else words[token.word] = (Object.hasOwn(words, token.word) ? words[token.word] : 0) + 1;
  }
  return { english: true, counted, base, words, usedAt: now };
}

export function scoreCachedEntry(entry, { table, review, settings = DEFAULT_LEVEL_SETTINGS, entries = [] }) {
  const ranks = table instanceof Map ? table : rankMapFromWords(table);
  const surfaceMap = buildSurfaceMap(entries);
  let novel = 0;
  const novelCounts = new Map();
  for (const [word, count] of Object.entries(entry.words ?? {})) {
    const rank = rankOf(word, ranks);
    const knownByRank = rank !== null && rank <= settings.vocabularySize;
    const familiarity = familiarityForCollected(review, word, surfaceMap);
    const isNovel = familiarity
      ? !['mastered', 'ignored'].includes(familiarity)
      : !knownByRank;
    if (isNovel) {
      novel += count;
      novelCounts.set(word, (novelCounts.get(word) ?? 0) + count);
    }
  }
  const rate = entry.counted > 0 ? (novel / entry.counted) * 100 : 0;
  const topWords = [...novelCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([word]) => word);
  return { counted: entry.counted, novel, rate, topWords, ...classifyNovelRate(rate, settings) };
}

export class LevelCache {
  constructor(storage, { maxShardBytes = MAX_SHARD_BYTES } = {}) {
    this.storage = storage;
    this.maxShardBytes = maxShardBytes;
    this.items = new Map();
    this.epoch = 'memory';
    this.rootGeneration = null;
    this.dirty = new Set();
  }

  async scopeStorage() {
    if (!this.storage?.scope) {
      this.rootGeneration = null;
      this.epoch = 'memory';
      return null;
    }
    const { rootGeneration } = await this.storage.scope();
    this.rootGeneration = rootGeneration;
    this.epoch = rootGeneration;
    return rootGeneration;
  }

  async load() {
    const root = await this.scopeStorage();
    this.items = new Map();
    this.dirty = new Set();
    if (!this.storage || !root) return;
    for (const name of SHARDS) {
      let result;
      try {
        result = await this.storage.read(root, name);
      } catch (error) {
        if (isRootChanged(error)) return this.load();
        throw error;
      }
      if (!result?.found) continue;
      try {
        const parsed = JSON.parse(result.text);
        if (parsed.version !== 1 || parsed.analysisVersion !== ANALYSIS_VERSION || !parsed.items || typeof parsed.items !== 'object' || Array.isArray(parsed.items)) continue;
        for (const [path, entry] of Object.entries(parsed.items ?? {})) {
          if (isValidCacheEntry(entry)) this.items.set(path, entry);
          else this.dirty.add(name);
        }
      } catch {
        // A corrupt cache shard is disposable; rebuilding from source documents is safe.
      }
    }
  }

  async handleRootChanged() {
    await this.load();
  }

  get(path, hash) {
    const entry = this.items.get(path);
    return entry?.hash === hash ? entry : null;
  }

  async set(epoch, path, hash, value) {
    if (epoch !== this.epoch) return false;
    this.items.set(path, { ...value, hash, usedAt: Date.now() });
    this.dirty.add(entryShard(path));
    return true;
  }

  prune(epoch, livePaths) {
    if (epoch !== this.epoch) return false;
    for (const path of this.items.keys()) {
      if (livePaths.has(path)) continue;
      this.items.delete(path);
      this.dirty.add(entryShard(path));
    }
    return true;
  }

  async flush(name) {
    if (!this.storage || !this.rootGeneration) {
      this.dirty.clear();
      return;
    }
    const names = name ? [name] : [...this.dirty];
    for (const shard of names) await this.flushShard(shard);
  }

  async flushShard(name) {
    if (!this.storage || !this.rootGeneration) return;
    const items = {};
    for (const [path, entry] of this.items.entries()) if (entryShard(path) === name) items[path] = entry;
    let text = JSON.stringify({ version: 1, analysisVersion: ANALYSIS_VERSION, items });
    if (utf8Bytes(text) > this.maxShardBytes) {
      const sorted = Object.entries(items).sort((a, b) => (a[1].usedAt ?? 0) - (b[1].usedAt ?? 0));
      while (utf8Bytes(text) > this.maxShardBytes && sorted.length > 0) {
        const [oldPath] = sorted.shift();
        delete items[oldPath];
        this.items.delete(oldPath);
        text = JSON.stringify({ version: 1, analysisVersion: ANALYSIS_VERSION, items });
      }
    }
    try {
      await this.storage.write(this.rootGeneration, name, text);
      this.dirty.delete(name);
    } catch (error) {
      if (!isRootChanged(error)) throw error;
      await this.load();
    }
  }
}
