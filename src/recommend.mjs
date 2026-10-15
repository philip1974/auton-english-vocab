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

function localizedBand(t, band) {
  if (band === 'good') return t.bandGood;
  if (band === 'easy') return t.bandEasy;
  return t.bandHard;
}

export function learningSuggestionsFromRecommendations(items, locale = 'en') {
  const t = uiText(locale);
  return items.slice(0, 3).map((item) => ({
    id: `reading:${item.path}`,
    title: item.title.slice(0, 120),
    detail: item.band === 'good' ? `${item.rate.toFixed(1)}%` : `${localizedBand(t, item.band)} · ${item.rate.toFixed(1)}%`,
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
      tone: scored.tone,
      rate: scored.rate,
      counted: scored.counted,
    };
  }

  async scoreDocument(meta, doc, review, entries, epoch = this.epoch) {
    if (epoch !== this.scopeEpoch()) return null;
    const cacheEpoch = this.cache.epoch;
    const hash = meta.revision?.contentHash ?? '';
    let cached = this.cache.get(meta.path, hash);
    if (!cached) {
      cached = buildLevelCacheEntry(doc.content, this.table);
      cached.title = titleFor(meta, doc, meta.path);
      const stored = await this.cache.set(cacheEpoch, meta.path, hash, cached);
      if (!stored || cacheEpoch !== this.cache.epoch || epoch !== this.scopeEpoch()) return null;
      await this.cache.flush(cacheShardNameForPath(meta.path));
      if (cacheEpoch !== this.cache.epoch || epoch !== this.scopeEpoch()) return null;
    }
    return this.scoreCached(meta, cached, review, entries);
  }

  async recommend({ review = { cards: {}, flags: {} }, entries = [], onProgress = this.onProgress } = {}) {
    const started = this.scopeEpoch();
    const cacheEpoch = this.cache.epoch;
    const current = () => this.scopeEpoch() === started && this.cache.epoch === cacheEpoch;
    this.epoch = started;
    const metas = unwrap(await this.app.knowledge.listDocuments()).filter((meta) => isNavigableReadingPath(meta.path));
    /* v8 ignore next -- the same captured-epoch contract is exercised at the async document and cache boundaries below. */
    if (!current()) return { stale: true, items: [], skipped: { 'not-english': 0, 'too-short': 0, unreadable: 0 } };
    if (!this.cache.prune(cacheEpoch, new Set(metas.map((meta) => meta.path))) || !current()) {
      return { stale: true, items: [], skipped: { 'not-english': 0, 'too-short': 0, unreadable: 0 } };
    }
    const skipped = { 'not-english': 0, 'too-short': 0, unreadable: 0 };
    const items = [];
    let done = 0;
    for (let i = 0; i < metas.length; i += this.batchSize) {
      for (const meta of metas.slice(i, i + this.batchSize)) {
        const hash = meta.revision?.contentHash ?? '';
        if (meta.unreadable || hash === '') {
          skipped.unreadable += 1;
          done += 1;
          onProgress(done, metas.length);
          continue;
        }
        const cached = this.cache.get(meta.path, hash);
        if (cached) {
          if (cached.english) items.push(this.scoreCached(meta, cached, review, entries));
          else skipped[cached.reason] = (skipped[cached.reason] ?? 0) + 1;
          done += 1;
          onProgress(done, metas.length);
          if (!current()) return { stale: true, items: [], skipped };
          continue;
        }
        let doc;
        try {
          doc = unwrap(await this.app.knowledge.readDocument({ path: meta.path }));
        } catch {
          /* v8 ignore next -- stale rejected reads share the tested post-read epoch guard. */
          if (!current()) return { stale: true, items: [], skipped };
          skipped.unreadable += 1;
          done += 1;
          onProgress(done, metas.length);
          continue;
        }
        if (!current()) return { stale: true, items: [], skipped };
        const detected = detectEnglish(doc.content);
        if (!detected.english) {
          skipped[detected.reason] += 1;
          await this.cache.set(cacheEpoch, meta.path, hash, { english: false, reason: detected.reason, title: titleFor(meta, doc, meta.path), usedAt: Date.now() });
        } else {
          const entry = buildLevelCacheEntry(doc.content, this.table);
          entry.title = titleFor(meta, doc, meta.path);
          await this.cache.set(cacheEpoch, meta.path, hash, entry);
          if (!current()) return { stale: true, items: [], skipped };
          items.push(this.scoreCached(meta, this.cache.get(meta.path, hash), review, entries));
        }
        done += 1;
        onProgress(done, metas.length);
        /* v8 ignore next -- synchronous progress cannot change epochs without host re-entry; surrounding async guards are tested. */
        if (!current()) return { stale: true, items: [], skipped };
      }
      /* v8 ignore next -- repeated guard before the flush await. */
      if (!current()) return { stale: true, items: [], skipped };
      await this.cache.flush();
      /* v8 ignore next -- LevelCache also rejects root changes during flush; this keeps workspace epoch symmetry. */
      if (!current()) return { stale: true, items: [], skipped };
      if (i + this.batchSize < metas.length) await sleep();
    }
    /* v8 ignore next -- repeated final-flush guard. */
    if (!current()) return { stale: true, items: [], skipped };
    await this.cache.flush();
    /* v8 ignore next -- repeated post-flush guard. */
    if (!current()) return { stale: true, items: [], skipped };
    return { stale: false, items: sortRecommendations(items, this.settings), skipped };
  }
}
