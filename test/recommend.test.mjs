import { describe, expect, it, vi } from 'vitest';
import { isNavigableReadingPath, learningSuggestionsFromRecommendations, ReadingRecommender, sortRecommendations, titleFor } from '../src/recommend.mjs';

const english = (word) => Array.from({ length: 80 }, () => word).join(' ');

function appFor(docs) {
  const read = vi.fn(async ({ path }) => ({ content: docs.find((doc) => doc.path === path).content, meta: { title: docs.find((doc) => doc.path === path).title } }));
  const files = new Map();
  return {
    storage: {
      writes: [],
      async scope() { return { rootGeneration: 'root-a' }; },
      async read(root, name) {
        if (root !== 'root-a') throw Object.assign(new Error('changed'), { code: 'ROOT_CHANGED' });
        return files.has(name) ? { found: true, text: files.get(name) } : { found: false };
      },
      async write(root, name, text) {
        if (root !== 'root-a') throw Object.assign(new Error('changed'), { code: 'ROOT_CHANGED' });
        this.writes.push({ root, name, text });
        files.set(name, text);
        return { revision: 'r' };
      },
      async list() { return [...files.keys()]; },
      async remove(root, name) { files.delete(name); },
    },
    workspace: { value: 'e1', scope() { return { epoch: this.value }; }, openDocument: vi.fn(() => true) },
    knowledge: {
      async listDocuments() { return docs.map(({ path, title, hash = path, unreadable }) => ({ path, title, unreadable, revision: { contentHash: hash } })); },
      readDocument: read,
    },
  };
}

describe('reading recommendations', () => {
  it('should filter candidates to navigable wiki and docs markdown while excluding maintenance pages', () => {
    expect(isNavigableReadingPath('wiki/article.md')).toBe(true);
    expect(isNavigableReadingPath('docs/article.md')).toBe(true);
    expect(isNavigableReadingPath('wiki/vocab/alpha.md')).toBe(false);
    expect(isNavigableReadingPath('wiki/README.md')).toBe(false);
    expect(isNavigableReadingPath('wiki/index.md')).toBe(false);
    expect(isNavigableReadingPath('wiki/overview.md')).toBe(false);
  });

  it('should sort suitable readings first then easy and hard by distance to the range midpoint', () => {
    const items = sortRecommendations([
      { title: 'Hard', band: 'hard', rate: 9 },
      { title: 'Easy', band: 'easy', rate: 1 },
      { title: 'Good', band: 'good', rate: 4 },
    ]);
    expect(items.map((item) => item.title)).toEqual(['Good', 'Easy', 'Hard']);
  });

  it('should use document metadata title fallback and sort alphabetically when band distance ties', () => {
    const items = sortRecommendations([{ title: 'Beta', band: 'good', rate: 4 }, { title: 'Alpha', band: 'good', rate: 3 }], { easyMax: 2, goodMax: 5 });
    expect(items.map((item) => item.title)).toEqual(['Alpha', 'Beta']);
    expect(titleFor({}, { meta: { title: 'Doc Meta' } }, 'wiki/fallback.md')).toBe('Doc Meta');
    expect(titleFor({}, { meta: {} }, 'wiki/fallback.md')).toBe('fallback');
  });

  it('should compute progress skipped counts top five novel words and learning suggestions with fallback detail', async () => {
    const app = appFor([
      { path: 'wiki/good.md', title: 'Good', content: `${english('the')} rareone raretwo rarethree rarefour rarefive raresix` },
      { path: 'wiki/easy.md', title: 'Easy', content: english('the') },
      { path: 'docs/hard.md', title: 'Hard', content: `${english('rareone')} ${english('raretwo')}` },
      { path: 'wiki/chinese.md', title: '中文', content: `${Array.from({ length: 50 }, () => 'word').join(' ')} ${'中文'.repeat(80)}` },
      { path: 'wiki/vocab/skip.md', title: 'Skip', content: english('rareone') },
    ]);
    const progress = [];
    const recommender = new ReadingRecommender(app, {
      table: ['the', ...Array.from({ length: 1000 }, (_, index) => `filler${index}`), 'rareone', 'raretwo', 'rarethree', 'rarefour', 'rarefive', 'raresix'],
      settings: { vocabularySize: 1, easyMax: 2, goodMax: 10 },
      locale: 'zh',
      onProgress: (done, total) => progress.push([done, total]),
    });
    await recommender.reload();
    const result = await recommender.recommend();
    expect(result.skipped['not-english']).toBe(1);
    expect(progress.at(-1)).toEqual([4, 4]);
    expect(result.items.map((item) => item.title)).toEqual(['Good', 'Easy', 'Hard']);
    expect(result.items[0].topWords).toEqual(['rarefive', 'rarefour', 'rareone', 'raresix', 'rarethree']);
    const suggestions = learningSuggestionsFromRecommendations(result.items);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]).toMatchObject({ id: 'reading:wiki/good.md', documentPath: 'wiki/good.md' });
    expect(suggestions[1].detail).toContain('偏易');
  });

  it('should reuse cached English and non-English analysis without reading unchanged documents again', async () => {
    const app = appFor([
      { path: 'wiki/good.md', title: 'Good', hash: 'h-good', content: `${english('the')} rareone raretwo rarethree` },
      { path: 'wiki/chinese.md', title: '中文', hash: 'h-cn', content: `${Array.from({ length: 50 }, () => 'word').join(' ')} ${'中文'.repeat(80)}` },
    ]);
    const recommender = new ReadingRecommender(app, {
      table: ['the', ...Array.from({ length: 1000 }, (_, index) => `filler${index}`), 'rareone', 'raretwo', 'rarethree'],
      settings: { vocabularySize: 1, easyMax: 2, goodMax: 10 },
    });
    await recommender.reload();
    await expect(recommender.recommend()).resolves.toMatchObject({ skipped: { 'not-english': 1 } });
    expect(app.knowledge.readDocument).toHaveBeenCalledTimes(2);
    await expect(recommender.recommend()).resolves.toMatchObject({ skipped: { 'not-english': 1 } });
    expect(app.knowledge.readDocument).toHaveBeenCalledTimes(2);
  });

  it('should discard a cached recommendation when progress re-entry changes the workspace epoch', async () => {
    const app = appFor([{ path: 'wiki/cached.md', title: 'Cached', hash: 'same', content: english('the') }]);
    const recommender = new ReadingRecommender(app, { table: ['the'] });
    await recommender.reload();
    await recommender.recommend();
    app.workspace.value = 'e1';
    const result = await recommender.recommend({ onProgress: () => { app.workspace.value = 'e2'; } });
    expect(result).toMatchObject({ stale: true, items: [] });
  });

  it('should skip unreadable or hashless metadata without reading or caching it', async () => {
    const app = appFor([
      { path: 'wiki/good.md', title: 'Good', hash: 'h-good', content: english('the') },
      { path: 'wiki/hashless.md', title: 'Hashless', hash: '', content: english('rareone') },
      { path: 'wiki/unreadable.md', title: 'Unreadable', hash: 'h-u', content: english('raretwo'), unreadable: true },
    ]);
    app.knowledge.listDocuments = async () => [
      { path: 'wiki/good.md', title: 'Good', revision: { contentHash: 'h-good' } },
      { path: 'wiki/hashless.md', title: 'Hashless', revision: { contentHash: '' } },
      { path: 'wiki/unreadable.md', title: 'Unreadable', revision: { contentHash: 'h-u' }, unreadable: true },
    ];
    const recommender = new ReadingRecommender(app, { table: ['the'] });
    await recommender.reload();
    const result = await recommender.recommend();
    expect(result.skipped.unreadable).toBe(2);
    expect(app.knowledge.readDocument).toHaveBeenCalledTimes(1);
  });

  it('should skip individual rejected and error documents without aborting recommendations', async () => {
    const app = appFor([
      { path: 'wiki/good.md', title: 'Good', hash: 'h-good', content: english('the') },
      { path: 'wiki/reject.md', title: 'Reject', hash: 'h-r', content: english('the') },
      { path: 'wiki/error.md', title: 'Error', hash: 'h-e', content: english('the') },
    ]);
    const original = app.knowledge.readDocument;
    app.knowledge.readDocument = async (request) => {
      if (request.path.endsWith('reject.md')) throw new Error('denied');
      if (request.path.endsWith('error.md')) return { _tag: 'Err', error: 'unreadable' };
      return original(request);
    };
    const recommender = new ReadingRecommender(app, { table: ['the'] });
    await recommender.reload();
    await expect(recommender.recommend()).resolves.toMatchObject({ skipped: { unreadable: 2 } });
  });

  it('should batch cache writes by dirty shard instead of rewriting on every document set', async () => {
    const docs = Array.from({ length: 8 }, (_, index) => ({ path: `wiki/${index}.md`, title: String(index), hash: `h-${index}`, content: english('the') }));
    const app = appFor(docs);
    const recommender = new ReadingRecommender(app, { table: ['the'], batchSize: 20 });
    await recommender.reload();
    await recommender.recommend();
    expect(app.storage.writes.length).toBeGreaterThan(0);
    expect(app.storage.writes.length).toBeLessThan(docs.length);
  });

  it('should not flush a scored document when its captured workspace or cache epoch becomes stale', async () => {
    const app = appFor([]);
    const recommender = new ReadingRecommender(app, { table: ['the'] });
    await recommender.reload();
    let release;
    recommender.cache.get = vi.fn(() => null);
    recommender.cache.set = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    recommender.cache.flush = vi.fn();
    const pending = recommender.scoreDocument(
      { path: 'wiki/read.md', title: 'Old', revision: { contentHash: 'same' } },
      { content: english('the'), meta: { title: 'Old' } },
      { cards: {}, flags: {} },
      [],
      'e1',
    );
    app.workspace.value = 'e2';
    recommender.cache.epoch = 'root-b';
    release(true);
    await expect(pending).resolves.toBeNull();
    expect(recommender.cache.flush).not.toHaveBeenCalled();
  });

  it('should localize recommendation band labels for non-Chinese locales', async () => {
    const app = appFor([{ path: 'wiki/good.md', title: 'Good', hash: 'h-good', content: `${english('the')} rareone raretwo rarethree` }]);
    const recommender = new ReadingRecommender(app, {
      table: ['the', ...Array.from({ length: 1000 }, (_, index) => `filler${index}`), 'rareone', 'raretwo', 'rarethree'],
      settings: { vocabularySize: 1, easyMax: 2, goodMax: 10 },
      locale: 'en',
    });
    await recommender.reload();
    const result = await recommender.recommend();
    expect(result.items[0].bandLabel).toBe('Good');
    expect(result.items[0].bandLabel).not.toMatch(/[适偏难易合]/u);
  });

  it('should discard recommendation results when the workspace epoch changes during async work', async () => {
    const app = appFor([{ path: 'wiki/a.md', title: 'A', content: english('the') }, { path: 'wiki/b.md', title: 'B', content: english('the') }]);
    const recommender = new ReadingRecommender(app, { batchSize: 1 });
    await recommender.reload();
    app.knowledge.readDocument = async (request) => {
      const doc = await appFor([{ path: request.path, title: request.path, content: english('the') }]).knowledge.readDocument(request);
      app.workspace.value = 'e2';
      return doc;
    };
    expect(await recommender.recommend()).toMatchObject({ stale: true, items: [] });
  });

  it('should not write an old recommendation document into a reloaded cache epoch', async () => {
    const app = appFor([{ path: 'wiki/a.md', title: 'Old A', hash: 'same', content: english('the') }]);
    const recommender = new ReadingRecommender(app, { table: ['the'] });
    await recommender.reload();
    let release;
    app.knowledge.readDocument = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const pending = recommender.recommend();
    await Promise.resolve();
    app.workspace.value = 'e2';
    recommender.cache.epoch = 'root-b';
    recommender.cache.items = new Map();
    release({ content: english('the'), meta: { title: 'Old A' } });
    await expect(pending).resolves.toMatchObject({ stale: true, items: [] });
    expect(recommender.cache.get('wiki/a.md', 'same')).toBeNull();
  });

  it('should fall back to a legacy epoch and unwrap host errors when optional workspace scope is missing', async () => {
    const app = appFor([{ path: 'wiki/a.md', title: '', content: english('the') }]);
    delete app.workspace;
    const recommender = new ReadingRecommender(app, { table: ['the'] });
    await recommender.reload();
    expect(recommender.scopeEpoch()).toBe('legacy');
    await expect(recommender.recommend()).resolves.toMatchObject({ stale: false });
    app.knowledge.listDocuments = async () => ({ _tag: 'Err', error: 'bad' });
    await expect(recommender.recommend()).rejects.toThrow('bad');
    app.knowledge.listDocuments = async () => ({ _tag: 'Err' });
    await expect(recommender.recommend()).rejects.toThrow('knowledge error');
  });
});
