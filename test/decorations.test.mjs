import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReadingTerms, createReadingDecorationSpec } from '../src/decorations.mjs';

const review = (cards = {}, flags = {}) => ({ version: 1, cards, flags });
const entry = (word, extra = {}) => ({
  word,
  definition: `${word} definition`,
  examples: [`${word} example one`, `${word} example two`, `${word} example three`],
  path: `wiki/vocab/${word}.md`,
  title: word,
  ...extra,
});

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = 'zh';
});

describe('reading decorations', () => {
  it('should build terms from collected words with familiarity tones and generated surfaces', () => {
    const terms = buildReadingTerms({
      entries: [entry('new'), entry('learn'), entry('master'), entry('skip'), entry('run')],
      review: review({
        learn: { state: 'Review', stability: 2 },
        master: { state: 'Review', stability: 30 },
      }, { skip: 'ignored' }),
    });
    const bySurface = new Map(terms.map((item) => [item.surface, item]));
    expect(bySurface.get('new')).toMatchObject({ tone: 'learning', key: 'new' });
    expect(bySurface.get('learn')).toMatchObject({ tone: 'familiar', key: 'learn' });
    expect(bySurface.get('master')).toMatchObject({ tone: 'known', key: 'master' });
    expect(bySurface.get('running')).toMatchObject({ tone: 'learning', key: 'run' });
    expect(bySurface.has('skip')).toBe(false);
    expect(bySurface.has('missing')).toBe(false);
  });

  it('should pass entry pos through when building comparative reading terms', () => {
    const terms = buildReadingTerms({
      entries: [
        { word: 'teach', pos: 'verb' },
        { word: 'big', pos: 'adjective' },
        { word: 'happy' },
      ],
    });
    const surfaces = new Set(terms.map((term) => term.surface));
    expect(surfaces.has('teacher')).toBe(false);
    expect(surfaces.has('bigger')).toBe(true);
    expect(surfaces.has('biggest')).toBe(true);
    expect(surfaces.has('happier')).toBe(false);
  });

  it('should render a card with definition examples badge inflection hint rating undo speech and cleanup', async () => {
    const container = document.createElement('div');
    const state = { entries: [entry('run')], review: review() };
    const onReview = vi.fn(async () => true);
    const onUndo = vi.fn(async () => true);
    const onTermsChanged = vi.fn();
    const speak = vi.fn();
    const spec = createReadingDecorationSpec({
      locale: 'zh',
      getState: () => state,
      onReview,
      onUndo,
      onTermsChanged,
      speak,
    });
    const cleanup = spec.renderCard(container, {
      word: 'Running',
      key: 'run',
      tone: 'learning',
      sentence: 'Running helps.',
      source: { kind: 'document', path: 'wiki/page.md', title: 'Page' },
      close: vi.fn(),
    });

    expect(container.querySelector('.ev-reading-card')?.textContent).toContain('Running → run');
    expect(container.textContent).toContain('run definition');
    expect(container.textContent).toContain('run example one');
    expect(container.textContent).toContain('新词');
    container.querySelector('[data-role="speak"]').click();
    expect(speak).toHaveBeenCalledWith('run');
    container.querySelector('[data-rating="Good"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onReview).toHaveBeenCalledWith('run', 'Good', 'reading-card');
    expect(onTermsChanged).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('已记为认识');
    container.querySelector('[data-role="undo"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onUndo).toHaveBeenCalledWith('run');
    expect(container.textContent).toContain('Running → run');
    cleanup();
    expect(container.textContent).toBe('');
  });

  it('should keep rating and speech actions interactive after undo', async () => {
    const container = document.createElement('div');
    const onReview = vi.fn(async () => true);
    const speak = vi.fn();
    const spec = createReadingDecorationSpec({
      locale: 'zh',
      getState: () => ({ entries: [entry('run')], review: review() }),
      onReview,
      onUndo: vi.fn(async () => true),
      onTermsChanged: vi.fn(),
      speak,
    });
    spec.renderCard(container, {
      word: 'run',
      key: 'run',
      tone: 'learning',
      source: { kind: 'document', path: 'wiki/page.md', title: 'Page' },
      close: vi.fn(),
    });

    container.querySelector('[data-rating="Good"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    container.querySelector('[data-role="undo"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    container.querySelector('[data-rating="Good"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    container.querySelector('[data-role="speak"]').click();

    expect(onReview).toHaveBeenCalledTimes(2);
    expect(onReview).toHaveBeenLastCalledWith('run', 'Good', 'reading-card');
    expect(speak).toHaveBeenCalledWith('run');
  });

  it('should use localized reading card rating labels', () => {
    const expected = {
      en: ['I know it', "Don't know"],
      zh: ['认识', '不认识'],
      ja: ['知っている', '知らない'],
      ko: ['알아요', '몰라요'],
    };
    for (const [locale, labels] of Object.entries(expected)) {
      const container = document.createElement('div');
      const spec = createReadingDecorationSpec({
        locale,
        getState: () => ({ entries: [entry('run')], review: review() }),
      });
      spec.renderCard(container, {
        word: 'run',
        key: 'run',
        tone: 'learning',
        source: { kind: 'document', path: 'wiki/page.md', title: 'Page' },
        close: vi.fn(),
      });
      expect(container.querySelector('[data-rating="Good"]').textContent).toBe(labels[0]);
      expect(container.querySelector('[data-rating="Again"]').textContent).toBe(labels[1]);
    }
  });

  it('should mark a card as unknown with Again and stop propagation for card events', async () => {
    const container = document.createElement('div');
    const outerClick = vi.fn();
    container.addEventListener('click', outerClick);
    const onReview = vi.fn(async () => true);
    const spec = createReadingDecorationSpec({
      locale: 'en',
      getState: () => ({ entries: [entry('alpha')], review: review() }),
      onReview,
      onUndo: vi.fn(),
      onTermsChanged: vi.fn(),
      speak: vi.fn(),
    });
    spec.renderCard(container, {
      word: 'alpha',
      key: 'alpha',
      tone: 'learning',
      source: { kind: 'document', path: 'wiki/page.md', title: 'Page' },
      close: vi.fn(),
    });
    container.querySelector('.ev-reading-card').click();
    expect(outerClick).not.toHaveBeenCalled();
    container.querySelector('[data-rating="Again"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onReview).toHaveBeenCalledWith('alpha', 'Again', 'reading-card');
    expect(container.textContent).toContain('Marked as learning');
  });

  it('should leave the card unchanged when rating or undo callbacks decline', async () => {
    const container = document.createElement('div');
    const spec = createReadingDecorationSpec({
      locale: 'en',
      getState: () => ({ entries: [entry('alpha', { definition: '', examples: [] })], review: review() }),
      onReview: vi.fn(async () => false),
      onUndo: vi.fn(async () => false),
      onTermsChanged: vi.fn(),
      speak: vi.fn(),
    });
    const cleanup = spec.renderCard(container, {
      word: 'alpha',
      key: 'alpha',
      tone: 'learning',
      source: { kind: 'document', path: 'wiki/page.md', title: 'Page' },
      close: vi.fn(),
    });
    expect(container.textContent).not.toContain('definition');
    container.querySelector('[data-rating="Good"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).not.toContain('Marked as known');
    cleanup();
    cleanup();
    expect(container.textContent).toBe('');
  });

  it('should build empty terms and render fallback text when state callbacks are absent', () => {
    expect(buildReadingTerms()).toEqual([]);
    const container = document.createElement('div');
    const spec = createReadingDecorationSpec({});
    spec.renderCard(container, {
      word: 'Alpha',
      key: 'alpha',
      tone: 'learning',
      source: { kind: 'document', path: 'wiki/page.md', title: 'Page' },
      close: vi.fn(),
    });
    expect(container.textContent).toContain('Alpha → alpha');
    expect(container.textContent).toContain('New');
  });

  it('should render an uncollected dictionary card and collect through the proposal callback', async () => {
    const container = document.createElement('div');
    const receipt = { outcome: 'applied', summary: 'ok' };
    const onCollectWord = vi.fn(async () => receipt);
    const spec = createReadingDecorationSpec({
      locale: 'zh',
      getState: () => ({ entries: [], review: review() }),
      lookupDictionary: async () => ({ surface: 'ran', lemma: 'run', entry: { p: 'rʌn', t: 'v. 跑', d: 'move fast' } }),
      onCollectWord,
    });
    spec.renderCard(container, {
      word: 'ran',
      key: 'ran',
      tone: null,
      sentence: 'I ran home.',
      source: { kind: 'document', path: 'wiki/read.md', title: 'Read' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toContain('ran → run');
    expect(container.textContent).toContain('/rʌn/');
    expect(container.textContent).toContain('v. 跑');
    container.querySelector('[data-role="collect-dictionary-word"]').click();
    await Promise.resolve();
    expect(onCollectWord).toHaveBeenCalledWith(expect.objectContaining({ lemma: 'run' }), expect.objectContaining({ sentence: 'I ran home.' }));
    expect(container.textContent).toContain('已收进生词本');
  });

  it('should render dictionary card titles phonetics and definition items as separate elements', async () => {
    const container = document.createElement('div');
    const spec = createReadingDecorationSpec({
      locale: 'zh',
      getState: () => ({ entries: [], review: review() }),
      lookupDictionary: async () => ({
        surface: 'ran',
        lemma: 'run',
        entry: {
          p: 'rʌn',
          t: 'v. 跑\nn. 路程',
          d: 'move fast\noperate',
        },
      }),
    });
    spec.renderCard(container, { word: 'ran', key: 'ran', tone: null });
    await Promise.resolve();
    expect(container.querySelector('.ev-dict-relation')?.textContent).toBe('ran → run');
    expect(container.querySelector('.ev-dict-head .ev-reading-word')?.textContent).toBe('run');
    expect(container.querySelector('.ev-reading-phonetic')?.textContent).toBe('/rʌn/');
    expect([...container.querySelectorAll('.ev-dict-lines-zh .ev-dict-line')].map((node) => node.textContent)).toEqual(['v. 跑', 'n. 路程']);
    expect([...container.querySelectorAll('.ev-dict-lines-en .ev-dict-line')].map((node) => node.textContent)).toEqual(['move fast', 'operate']);
  });

  it('should render English dictionary definitions before Chinese definitions outside zh locale', async () => {
    const container = document.createElement('div');
    createReadingDecorationSpec({
      locale: 'en',
      getState: () => ({ entries: [], review: review() }),
      lookupDictionary: async () => ({ surface: 'run', lemma: 'run', entry: { t: 'v. 跑', d: 'move fast' } }),
    }).renderCard(container, { word: 'run', key: 'run', tone: null });
    await Promise.resolve();
    expect([...container.querySelectorAll('.ev-dict-lines')].map((node) => node.className)).toEqual(['ev-dict-lines ev-dict-lines-en', 'ev-dict-lines ev-dict-lines-zh']);
  });

  it('should omit empty dictionary language groups', async () => {
    const container = document.createElement('div');
    createReadingDecorationSpec({
      locale: 'zh',
      getState: () => ({ entries: [], review: review() }),
      lookupDictionary: async () => ({ surface: 'void', lemma: 'void', entry: { d: 'empty' } }),
    }).renderCard(container, { word: 'void', key: 'void', tone: null });
    await Promise.resolve();
    expect([...container.querySelectorAll('.ev-dict-lines')].map((node) => node.className)).toEqual(['ev-dict-lines ev-dict-lines-en']);
  });

  it('should render collected and missing dictionary states without proposing duplicates', async () => {
    const collected = document.createElement('div');
    const spec = createReadingDecorationSpec({
      locale: 'zh',
      getState: () => ({ entries: [entry('run')], review: review() }),
      lookupDictionary: async () => ({ surface: 'run', lemma: 'run', entry: { t: 'v. 跑', d: 'move fast' } }),
      onCollectWord: vi.fn(),
    });
    spec.renderCard(collected, { word: 'run', key: 'run', tone: null });
    await Promise.resolve();
    expect(collected.textContent).toContain('已在生词本');
    expect(collected.querySelector('[data-role="collect-dictionary-word"]')).toBeNull();

    const missing = document.createElement('div');
    const explain = vi.fn();
    createReadingDecorationSpec({
      locale: 'zh',
      getState: () => ({ entries: [], review: review() }),
      lookupDictionary: async () => null,
      onExplainWord: explain,
    }).renderCard(missing, { word: 'qzxv', key: 'qzxv', tone: null });
    await Promise.resolve();
    expect(missing.textContent).toContain('词典中没有这个词');
    [...missing.querySelectorAll('button')].find((node) => node.textContent === '让 Agent 解释').click();
    expect(explain).toHaveBeenCalledWith('qzxv', expect.any(Object));
  });

  it('should show dictionary retry and non-applied collection receipts', async () => {
    const failed = document.createElement('div');
    let attempts = 0;
    const spec = createReadingDecorationSpec({
      locale: 'zh',
      getState: () => ({ entries: [], review: review() }),
      lookupDictionary: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('chunk missing');
        return { surface: 'run', lemma: 'run', entry: { t: 'v. 跑', d: 'move fast' } };
      },
      onCollectWord: async () => ({ outcome: 'not-reviewed', reason: 'pending' }),
    });
    spec.renderCard(failed, { word: 'run', key: 'run', tone: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failed.textContent).toContain('词典加载失败');
    [...failed.querySelectorAll('button')].find((node) => node.textContent === '重试').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    failed.querySelector('[data-role="collect-dictionary-word"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failed.textContent).toContain('未审阅：pending');

    const cancelled = document.createElement('div');
    createReadingDecorationSpec({
      locale: 'zh',
      getState: () => ({ entries: [], review: review() }),
      lookupDictionary: async () => ({ surface: 'run', lemma: 'run', entry: { t: 'v. 跑', d: 'move fast' } }),
      onCollectWord: async () => ({ outcome: 'rejected', reason: 'no' }),
    }).renderCard(cancelled, { word: 'run', key: 'run', tone: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    cancelled.querySelector('[data-role="collect-dictionary-word"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled.textContent).toContain('已取消');
  });

  it('should show dictionary failures on collected cards and missing collection callbacks', async () => {
    const collected = document.createElement('div');
    createReadingDecorationSpec({
      locale: 'zh',
      getState: () => ({ entries: [entry('run')], review: review() }),
      lookupDictionary: async () => { throw new Error('missing'); },
    }).renderCard(collected, { word: 'run', key: 'run', tone: 'learning' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(collected.textContent).toContain('词典加载失败');

    const unhandled = document.createElement('div');
    createReadingDecorationSpec({
      locale: 'zh',
      getState: () => ({ entries: [], review: review() }),
      lookupDictionary: async () => ({ surface: 'run', lemma: 'run', entry: { t: 'v. 跑', d: 'move fast' } }),
    }).renderCard(unhandled, { word: 'run', key: 'run', tone: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    unhandled.querySelector('[data-role="collect-dictionary-word"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled.textContent).toContain('词典加载失败');
  });
});
