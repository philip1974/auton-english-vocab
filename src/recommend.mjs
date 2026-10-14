import { WORD_FREQ_30K } from './wordfreq.mjs';
import { LevelCache, buildLevelCacheEntry, cacheShardNameForPath, scoreCachedEntry } from './level-cache.mjs';
import { DEFAULT_LEVEL_SETTINGS, detectEnglish } from './reading-level.mjs';
import { uiText } from './ui-text.mjs';

const NAVIGABLE_RE = /^(wiki|docs)\/.+\.md$/u;
const EXCLUDED_RE = /(^wiki\/vocab\/|(?:^|\/)(?:README|index)\.md$|^wiki\/(?:overview|log|AGENTS-RULES)\.md$)/u;
const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

function unwrap(result) {
  if (result && result._tag === 'Err') throw new Error(String(result.error ?? 'knowledge error'));
  return result;
}

export function isNavigableReadingPath(path) {
  return NAVIGABLE_RE.test(path) && !EXCLUDED_RE.test(path);
}

export function titleFor(meta, doc, path) {
  return meta.title || doc.meta?.title || path.split('/').pop().replace(/\.md$/u, '');
}

export function sortRecommendations(items, settings = DEFAULT_LEVEL_SETTINGS) {
  const midpoint = (settings.easyMax + settings.goodMax) / 2;
  const bandOrder = { good: 0, easy: 1, hard: 2 };
  return [...items].sort((a, b) => (
    bandOrder[a.band] - bandOrder[b.band]
    || Math.abs(a.rate - midpoint) - Math.abs(b.rate - midpoint)
    || a.title.localeCompare(b.title)
  ));
}

export function learningSuggestionsFromRecommendations(items) {
  return items.slice(0, 3).map((item) => ({
    id: `reading:${item.path}`,
    title: item.title.slice(0, 120),
    detail: item.band === 'good' ? `${item.rate.toFixed(1)}%` : `${item.bandLabel} · ${item.rate.toFixed(1)}%`,
    documentPath: item.path,
  }));
}

export class ReadingRecommender {
  constructor(app, {
    table = WORD_FREQ_30K,
    settings = DEFAULT_LEVEL_SETTINGS,
    batchSize = 20,
    onProgress = () => undefined,
    locale = 'en',
  } = {}) {
    this.app = app;
    this.table = table;
    this.settings = settings;
    this.batchSize = batchSize;
    this.onProgress = onProgress;
    this.locale = locale;
    this.t = uiText(locale);
    this.cache = new LevelCache(app.storage);
    this.epoch = app.workspace?.scope?.().epoch ?? 'legacy';
  }

  scopeEpoch() {
    return this.app.workspace?.scope?.().epoch ?? this.epoch;
  }

  async reload() {
    await this.cache.load(this.epoch);
    this.epoch = this.app.workspace?.scope?.().epoch ?? 'legacy';
  }

  bandLabel(band) {
    if (band === 'good') return this.t.bandGood;
    if (band === 'easy') return this.t.bandEasy;
    return this.t.bandHard;
  }

  scoreCached(meta, cached, review, entries) {
    const scored = scoreCachedEntry(cached, { table: this.table, review, settings: this.settings, entries });
    return {
      path: meta.path,
      title: cached.title || meta.title || meta.path.split('/').pop().replace(/\.md$/u, ''),
      topWords: scored.topWords.slice(0, 5),
      band: scored.band,
      bandLabel: this.bandLabel(scored.band),
      tone: scored.tone,
      rate: scored.rate,
      counted: scored.counted,
    };
  }

  async scoreDocument(meta, doc, review, entries) {
    const hash = meta.revision?.contentHash ?? '';
    let cached = this.cache.get(meta.path, hash);
    if (!cached) {
      cached = buildLevelCacheEntry(doc.content, this.table);
      cached.title = titleFor(meta, doc, meta.path);
      await this.cache.set(this.cache.epoch, meta.path, hash, cached);
      await this.cache.flush(cacheShardNameForPath(meta.path));
    }
    return this.scoreCached(meta, cached, review, entries);
  }

  async recommend({ review = { cards: {}, flags: {} }, entries = [] } = {}) {
    const started = this.scopeEpoch();
    this.epoch = started;
    const metas = unwrap(await this.app.knowledge.listDocuments()).filter((meta) => isNavigableReadingPath(meta.path));
    const skipped = { 'not-english': 0, 'too-short': 0, unreadable: 0 };
    const items = [];
    let done = 0;
    for (let i = 0; i < metas.length; i += this.batchSize) {
      for (const meta of metas.slice(i, i + this.batchSize)) {
        const hash = meta.revision?.contentHash ?? '';
        if (meta.unreadable || hash === '') {
          skipped.unreadable += 1;
          done += 1;
          this.onProgress(done, metas.length);
          continue;
        }
        const cached = this.cache.get(meta.path, hash);
        if (cached) {
          if (cached.english) items.push(this.scoreCached(meta, cached, review, entries));
          else skipped[cached.reason] = (skipped[cached.reason] ?? 0) + 1;
          done += 1;
          this.onProgress(done, metas.length);
          if (this.scopeEpoch() !== started) return { stale: true, items: [], skipped };
          continue;
        }
        const doc = unwrap(await this.app.knowledge.readDocument({ path: meta.path }));
        const detected = detectEnglish(doc.content);
        if (!detected.english) {
          skipped[detected.reason] += 1;
          await this.cache.set(this.cache.epoch, meta.path, hash, { english: false, reason: detected.reason, title: titleFor(meta, doc, meta.path), usedAt: Date.now() });
        } else {
          const entry = buildLevelCacheEntry(doc.content, this.table);
          entry.title = titleFor(meta, doc, meta.path);
          await this.cache.set(this.cache.epoch, meta.path, hash, entry);
          items.push(this.scoreCached(meta, this.cache.get(meta.path, hash), review, entries));
        }
        done += 1;
        this.onProgress(done, metas.length);
        if (this.scopeEpoch() !== started) return { stale: true, items: [], skipped };
      }
      await this.cache.flush();
      if (i + this.batchSize < metas.length) await sleep();
    }
    await this.cache.flush();
    return { stale: false, items: sortRecommendations(items, this.settings), skipped };
  }
}
