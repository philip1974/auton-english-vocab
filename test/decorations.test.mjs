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
    await Promise.resolve();
    expect(onReview).toHaveBeenCalledWith('run', 'Good', 'reading-card');
    expect(onTermsChanged).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('已记为认识');
    container.querySelector('[data-role="undo"]').click();
    await Promise.resolve();
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
    await Promise.resolve();
    container.querySelector('[data-role="undo"]').click();
    await Promise.resolve();
    container.querySelector('[data-rating="Good"]').click();
    await Promise.resolve();
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
    await Promise.resolve();
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
    await Promise.resolve();
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
});
