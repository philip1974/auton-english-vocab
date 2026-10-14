import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendSelectionRequest, renderPanel } from '../src/panel.mjs';
import { buildNote } from '../src/note-format.mjs';

class FakePlugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this.registered = [];
  }
  register(disposable) { this.registered.push(disposable); return disposable; }
  addPanel(spec) { this.app.panels.push(spec); return this.register({ dispose() {} }); }
  addCommand(spec) { this.app.commands.push(spec); return this.register({ dispose() {} }); }
  onEvent(name, listener) { this.app.events.push({ name, listener }); return this.register({ dispose() {} }); }
  openPanel(id) { this.app.opened.push(id); return true; }
  showNotice(request) { this.app.notices.push(request); return this.register({ dispose() {} }); }
  async addAgentTool(spec) { this.app.tools.set(spec.name, spec); return this.register({ dispose() {} }); }
}

function fullApp() {
  let storedReview = null;
  let rootGeneration = 'root';
  const assertRoot = (root) => {
    if (root !== rootGeneration) throw Object.assign(new Error('root changed'), { code: 'ROOT_CHANGED' });
  };
  const result = {
    panels: [],
    commands: [],
    events: [],
    opened: [],
    notices: [],
    tools: new Map(),
    storage: {
      writes: [],
      setRoot(next) { rootGeneration = next; },
      async scope() { return { rootGeneration: 'root' }; },
      async read(root, name) {
        assertRoot(root);
        if (name === 'review.json' && storedReview) return { found: true, text: storedReview, revision: 'r' };
        return { found: false };
      },
      async write(root, name, text) { assertRoot(root); this.writes.push({ root, name, text }); if (name === 'review.json') storedReview = text; return { revision: `r${this.writes.length + 1}` }; },
      async list(root) { assertRoot(root); return []; },
      async remove(root) { assertRoot(root); },
    },
    selectionActions: { items: [], register(spec) { this.items.push(spec); return { dispose() {} }; } },
    chat: { text: '', appendToComposer(text) { this.text += text; return Boolean(text); } },
    knowledge: {
      async listDocuments() { return [{ path: 'wiki/vocab/alpha.md', title: 'Alpha', revision: { contentHash: 'h' } }]; },
      async readDocument({ path } = {}) {
        if (path?.startsWith('wiki/vocab/') && path !== 'wiki/vocab/alpha.md') return { _tag: 'Err', error: 'not found' };
        return { content: buildNote({ word: 'alpha', definition: '字母', example: 'Alpha test.' }), meta: { title: 'Alpha' } };
      },
      propose() { return Promise.resolve({ outcome: 'applied' }); },
    },
  };
  return result;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = 'zh';
  globalThis.autonKnowledge = { Plugin: FakePlugin };
});

describe('panel', () => {
  it('should show host version warning when required APIs are missing', () => {
    const container = document.createElement('div');
    const cleanup = renderPanel(container, { app: {}, entries: [], review: { version: 1, cards: {}, flags: {} } });
    expect(container.textContent).toContain('需要 Auton Knowledge 0.3.0 或更新');
    cleanup();
    expect(container.textContent).toBe('');
  });

  it('should render review modes and score with keyboard when cards are due', () => {
    const container = document.createElement('div');
    const review = { version: 1, cards: {}, flags: {} };
    const seen = [];
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母', examples: ['Alpha test.'] }], review, onReview: (word, rating) => seen.push([word, rating]), hasEnglishVoice: () => false });
    expect(container.textContent).toContain('今日复习');
    expect(container.querySelector('h2')).toBeNull();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    container.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    expect(seen[0]).toEqual(['alpha', 'Good']);
  });

  it('should show loading progress when index refresh is in progress', () => {
    const container = document.createElement('div');
    renderPanel(container, { app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} }, loading: { done: 2, total: 5 } });
    expect(container.textContent).toContain('正在读取生词 2 / 5');
  });

  it('should keep the partially loaded review queue usable while loading continues', () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'alpha', definition: '字母' }],
      review: { version: 1, cards: {}, flags: {} },
      log: [],
      loading: { done: 1, total: 2 },
      hasEnglishVoice: () => true,
    });
    expect(container.textContent).toContain('正在读取生词 1 / 2');
    expect(container.textContent).toContain('alpha');
  });

  it('should score with rating buttons and ignore non review keys when card is flipped', () => {
    for (const [label, rating] of [['重来', 'Again'], ['困难', 'Hard'], ['良好', 'Good'], ['简单', 'Easy']]) {
      const container = document.createElement('div');
      const seen = [];
      renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, onReview: (word, rating) => seen.push(rating), hasEnglishVoice: () => true });
      container.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      [...container.querySelectorAll('button')].find((node) => node.textContent.endsWith(label)).click();
      expect(seen[0]).toBe(rating);
    }
  });

  it('should render a structured review card with equal rating actions and shortcut labels', () => {
    const container = document.createElement('div');
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母', examples: ['Alpha test.'] }], review: { version: 1, cards: {}, flags: {} }, log: [], hasEnglishVoice: () => true });
    expect(container.querySelector('.ev-review-word')?.textContent).toBe('alpha');
    expect(container.querySelector('.ev-example')?.textContent).toContain('_____');
    container.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const ratings = [...container.querySelectorAll('.ev-rating .ev-button')];
    expect(ratings.map((node) => node.textContent)).toEqual(['1 重来', '2 困难', '3 良好', '4 简单']);
    expect(ratings[0].classList.contains('ev-rating-again')).toBe(true);
    expect(ratings[3].classList.contains('ev-rating-easy')).toBe(true);
  });

  it('should show empty state and cleanup when there are no due cards', () => {
    const container = document.createElement('div');
    const cleanup = renderPanel(container, { app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true });
    expect(container.textContent).toContain('没有到期生词');
    cleanup();
    expect(container.textContent).toBe('');
  });

  it('should submit reverse spelling as again when the typed word is wrong', () => {
    const container = document.createElement('div');
    const review = { version: 1, cards: {}, flags: {} };
    const seen = [];
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母', examples: ['Alpha test.'] }], review, onReview: (word, rating) => seen.push([word, rating]), hasEnglishVoice: () => true });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '反向拼写').click();
    const input = container.querySelector('input');
    input.value = 'wrong';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(seen[0]).toEqual(['alpha', 'Again']);
  });

  it('should submit reverse spelling as good when the answer button is clicked with the right word', () => {
    const container = document.createElement('div');
    const seen = [];
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, onReview: (word, rating) => seen.push(rating), hasEnglishVoice: () => true });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '反向拼写').click();
    const input = container.querySelector('input');
    input.value = 'alpha';
    [...container.querySelectorAll('button')].find((node) => node.textContent === '答案').click();
    expect(seen[0]).toBe('Good');
  });

  it('should disable listening mode when no English voice is available', () => {
    const container = document.createElement('div');
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => false });
    expect([...container.querySelectorAll('button')].find((node) => node.textContent === '听音拼写').disabled).toBe(true);
  });

  it('should speak and show interruption note when listening mode is available', () => {
    const container = document.createElement('div');
    const spoken = [];
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true, speak: (word) => spoken.push(word) });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '听音拼写').click();
    expect(spoken).toEqual(['alpha']);
    expect(container.textContent).toContain('会打断正在进行的朗读');
  });

  it('should speak only for a new listening card or when replay is requested', () => {
    const container = document.createElement('div');
    const spoken = [];
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true, speak: (word) => spoken.push(word) });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '听音拼写').click();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(spoken).toEqual(['alpha']);
    [...container.querySelectorAll('button')].find((node) => node.textContent === '再听一次').click();
    expect(spoken).toEqual(['alpha', 'alpha']);
  });

  it('should use a dedicated spelling placeholder and show empty progress for an unstarted root', () => {
    const container = document.createElement('div');
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, log: [], hasEnglishVoice: () => true });
    expect(container.textContent).toContain('此知识库还没有复习进度');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '反向拼写').click();
    expect(container.querySelector('input').placeholder).toBe('输入这个词');
  });

  it('should support notebook search and flag actions when entries are rendered', () => {
    const container = document.createElement('div');
    const review = { version: 1, cards: {}, flags: {} };
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review, hasEnglishVoice: () => true });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    expect(container.textContent).toContain('alpha');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '忽略').click();
    expect(review.flags.alpha).toBe('ignored');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '恢复').click();
    expect(review.flags.alpha).toBeUndefined();
    [...container.querySelectorAll('button')].find((node) => node.textContent === '已掌握').click();
    expect(review.flags.alpha).toBe('mastered');
    const input = [...container.querySelectorAll('input')].find((node) => node.placeholder === '搜索');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.textContent).not.toContain('alpha');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '今日复习').click();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
  });

  it('should not show an open note action when the host has no open document API', () => {
    const container = document.createElement('div');
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    expect([...container.querySelectorAll('button')].some((node) => node.textContent === '打开')).toBe(false);
  });

  it('should render recommended readings, open documents through the host and save level settings when changed', () => {
    const container = document.createElement('div');
    const opened = [];
    const saved = [];
    renderPanel(container, {
      app: { ...fullApp(), workspace: { scope: () => ({ epoch: 'e1' }), openDocument: (path) => { opened.push(path); return true; } } },
      entries: [],
      review: { version: 1, cards: {}, flags: {} },
      levelSettings: { vocabularySize: 3000, easyMax: 2, goodMax: 5 },
      recommendations: { items: [{ title: 'Readable', path: 'wiki/read.md', bandLabel: '适合', rate: 4, topWords: ['rare'] }], skipped: { 'not-english': 1, 'too-short': 2 } },
      onLevelSettingsChange: (settings) => saved.push(settings),
      openReadingDocument: (path) => { opened.push(path); return true; },
      canOpenReadingDocument: () => true,
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '推荐阅读').click();
    expect(container.textContent).toContain('Readable');
    expect(container.textContent).toContain('生词率: rare');
    [...container.querySelectorAll('button')].find((node) => node.textContent === 'Readable').click();
    expect(opened).toEqual(['wiki/read.md']);
    const select = container.querySelector('select');
    select.value = '5000';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(saved.at(-1)).toMatchObject({ vocabularySize: 5000 });
  });

  it('should show recommendation progress, empty state and validation notice when settings are invalid', () => {
    const container = document.createElement('div');
    const notices = [];
    renderPanel(container, {
      app: { ...fullApp(), workspace: { scope: () => ({ epoch: 'e1' }) } },
      entries: [],
      review: { version: 1, cards: {}, flags: {} },
      levelSettings: { vocabularySize: 3000, easyMax: 2, goodMax: 5 },
      recommendationLoading: { done: 1, total: 4 },
      recommendations: { items: [], skipped: {} },
      notify: (message) => notices.push(message),
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '推荐阅读').click();
    expect(container.textContent).toContain('统计中 1 / 4');
    expect(container.textContent).toContain('没有可推荐的英文文章');
    const inputs = container.querySelectorAll('input');
    inputs[0].value = '6';
    inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    expect(notices.at(-1)).toContain('生词率设置保存失败');
  });

  it('should render disabled recommendation titles and default skipped counts when opening is unavailable', () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: { ...fullApp(), workspace: { scope: () => ({ epoch: 'e1' }) } },
      entries: [],
      review: { version: 1, cards: {}, flags: {} },
      levelSettings: { vocabularySize: 3000, easyMax: 2, goodMax: 5 },
      recommendations: { items: [{ title: 'No Open', path: 'wiki/no.md', bandLabel: '偏易', rate: 0, topWords: [] }] },
      canOpenReadingDocument: () => false,
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '推荐阅读').click();
    const title = [...container.querySelectorAll('button')].find((node) => node.textContent === 'No Open');
    expect(title.disabled).toBe(true);
    expect(container.textContent).toContain('生词率: -');
    expect(container.textContent).toContain('已跳过：中文为主 0 / 太短 0');
  });

  it('should persist notebook flag actions and filter by familiarity', async () => {
    const container = document.createElement('div');
    const flags = [];
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'alpha', definition: '字母' }, { word: 'beta', definition: '测试' }],
      review: { version: 1, cards: {}, flags: { beta: 'ignored' } },
      onFlag: async (word, flag) => flags.push([word, flag]),
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const filter = container.querySelector('select');
    filter.value = 'ignored';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    expect(container.textContent).toContain('beta');
    expect(container.textContent).not.toContain('alpha');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '恢复').click();
    expect(flags).toEqual([['beta', undefined]]);
  });

  it('should render compact notebook rows and show only contextually valid flag actions', () => {
    const container = document.createElement('div');
    const review = { version: 1, cards: {}, flags: { mastered: 'mastered', ignored: 'ignored' } };
    renderPanel(container, {
      app: fullApp(),
      entries: [
        { word: 'plain', definition: 'no manual flag' },
        { word: 'mastered', definition: 'manually mastered' },
        { word: 'ignored', definition: 'manually ignored' },
      ],
      review,
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const rows = [...container.querySelectorAll('.ev-row')];
    expect(rows.every((row) => row.querySelector('.ev-row-head') && row.querySelector('.ev-row-definition') && row.querySelector('.ev-row-actions'))).toBe(true);
    expect(rows.every((row) => row.querySelector('.ev-badge'))).toBe(true);
    const labels = (row) => [...row.querySelectorAll('button')].map((node) => node.textContent);
    expect(labels(rows[0])).toEqual(['已掌握', '忽略']);
    expect(labels(rows[1])).toEqual(['忽略', '恢复']);
    expect(labels(rows[2])).toEqual(['已掌握', '恢复']);
  });

  it('should append a manual add request and reject empty or non English words', () => {
    const container = document.createElement('div');
    const app = fullApp();
    const notices = [];
    renderPanel(container, { app, entries: [], review: { version: 1, cards: {}, flags: {} }, notify: (message) => notices.push(message), hasEnglishVoice: () => true });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="manual-word"]');
    const add = [...container.querySelectorAll('button')].find((node) => node.textContent === '添加');
    add.click();
    input.value = '你好';
    add.click();
    expect(app.chat.text).toBe('');
    expect(notices).toHaveLength(2);
    input.value = 'alpha';
    add.click();
    expect(app.chat.text).toContain('alpha');
    expect(app.chat.text).toContain('vocab_add');
  });

  it('should redraw from subscribed live state and unsubscribe during cleanup', () => {
    const container = document.createElement('div');
    let current = { entries: [], review: { version: 1, cards: {}, flags: {} }, log: [], loading: { done: 0, total: 1 } };
    let listener;
    const unsubscribe = vi.fn();
    const cleanup = renderPanel(container, { app: fullApp(), getState: () => current, subscribe: (next) => { listener = next; return unsubscribe; }, hasEnglishVoice: () => true });
    expect(container.textContent).toContain('正在读取生词');
    current = { entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, log: [], loading: null };
    listener();
    expect(container.textContent).toContain('alpha');
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('should show a reading highlight switch only when the host supports decorations', () => {
    const container = document.createElement('div');
    const seen = [];
    renderPanel(container, {
      app: { ...fullApp(), readingDecorations: { register() {} } },
      entries: [],
      review: { version: 1, cards: {}, flags: {} },
      highlight: true,
      onHighlightChange: (value) => seen.push(value),
      hasEnglishVoice: () => true,
    });
    const input = container.querySelector('[data-role="highlight-reading"]');
    expect(container.textContent).toContain('在正文里标出已收的词');
    expect(input.checked).toBe(true);
    input.click();
    expect(seen).toEqual([false]);

    const oldHost = document.createElement('div');
    renderPanel(oldHost, { app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true });
    expect(oldHost.textContent).not.toContain('在正文里标出已收的词');
  });

  it('should append selection request to chat when collecting from selection', () => {
    const app = fullApp();
    expect(appendSelectionRequest(app, { text: 'alpha', source: { kind: 'web', title: 'Page', url: 'https://example.com' } })).toBe(true);
    expect(app.chat.text).toContain('vocab_add');
  });

  it('should notify when appending selection request fails', () => {
    const app = fullApp();
    const notices = [];
    app.chat.appendToComposer = () => false;
    expect(appendSelectionRequest(app, { text: 'alpha', source: { kind: 'web', title: 'Page', url: 'https://example.com' } }, (message) => notices.push(message))).toBe(false);
    expect(notices[0]).toContain('无法');
  });
});

describe('main plugin', () => {
  it('should register panel command selection action tools and events when host is new enough', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    expect(app.panels[0]).toMatchObject({ id: 'english-vocab', location: 'right', icon: '📖' });
    expect(app.commands[0].id).toBe('start-review');
    expect(app.selectionActions.items[0].surfaces).toEqual(['reading', 'web']);
    expect([...app.tools.keys()]).toEqual(['vocab_lookup', 'vocab_add']);
    expect(app.events.map((event) => event.name)).toEqual(['knowledge.index-changed', 'knowledge.root-changed']);
    const rendered = document.createElement('div');
    app.panels[0].render(rendered);
    expect(rendered.textContent).toContain('今日复习');
    expect(rendered.querySelector('h2')).toBeNull();
    const state = plugin.panelState();
    globalThis.speechSynthesis = { getVoices: () => [{ lang: 'en-US' }], cancel: vi.fn(), speak: vi.fn() };
    globalThis.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
    expect(state.hasEnglishVoice()).toBe(true);
    state.speak('alpha');
    expect(globalThis.speechSynthesis.cancel).toHaveBeenCalled();
    delete globalThis.speechSynthesis;
    state.speak('alpha');
    await state.onReview('alpha', 'Good', 'flip');
    await app.events[0].listener();
    await app.events[1].listener();
    expect(plugin.panelState().getState().entries[0].word).toBe('alpha');
    app.commands[0].callback();
    expect(app.opened).toEqual(['english-vocab']);
    plugin.notice('hello');
    expect(app.notices.at(-1).message).toBe('hello');
    app.selectionActions.items[0].onSelect({ text: 'alpha', source: { kind: 'document', title: 'Doc', path: 'wiki/a.md' } });
    expect(app.chat.text).toContain('alpha');
  });

  it('should register reading decorations by default and refresh terms after review index and root changes', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const registrations = [];
    const app = fullApp();
    app.readingDecorations = {
      register(spec) {
        const item = { spec, terms: [], disposed: false };
        registrations.push(item);
        return {
          setTerms(terms) { item.terms = terms; return true; },
          dispose() { item.disposed = true; },
        };
      },
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    expect(plugin.state.highlight).toBe(true);
    expect(registrations).toHaveLength(1);
    expect(registrations[0].terms.some((term) => term.surface === 'alpha' && term.tone === 'learning')).toBe(true);
    await plugin.rateWord('alpha', 'Good', 'flip');
    expect(registrations[0].terms.some((term) => term.surface === 'alpha')).toBe(true);
    await app.events.find((event) => event.name === 'knowledge.index-changed').listener();
    expect(registrations[0].terms.some((term) => term.surface === 'alpha')).toBe(true);
    await app.events.find((event) => event.name === 'knowledge.root-changed').listener();
    expect(registrations[0].terms.some((term) => term.surface === 'alpha')).toBe(true);
  });

  it('should wire registered reading cards to plugin rating undo terms and speech callbacks', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const registrations = [];
    const app = fullApp();
    app.readingDecorations = {
      register(spec) {
        registrations.push(spec);
        return { setTerms: vi.fn(() => true), dispose: vi.fn() };
      },
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    const spoken = [];
    plugin.panelState = () => ({ speak: (word) => spoken.push(word) });
    const container = document.createElement('div');
    registrations[0].renderCard(container, {
      word: 'alpha',
      key: 'alpha',
      tone: 'learning',
      source: { kind: 'document', path: 'wiki/page.md', title: 'Page' },
      close: vi.fn(),
    });
    container.querySelector('[data-role="speak"]').click();
    expect(spoken).toEqual(['alpha']);
    container.querySelector('[data-rating="Good"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plugin.readingUndoSnapshots.has('alpha')).toBe(true);
    container.querySelector('[data-role="undo"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plugin.readingUndoSnapshots.has('alpha')).toBe(false);
  });

  it('should persist highlight preference and dispose or recreate decorations when toggled', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const saved = [];
    const registrations = [];
    const app = fullApp();
    app.readingDecorations = {
      register() {
        const item = { disposed: false };
        registrations.push(item);
        return { setTerms: () => true, dispose: () => { item.disposed = true; } };
      },
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    plugin.loadData = async () => ({ highlight: true });
    plugin.saveData = async (data) => saved.push(data);
    await plugin.onload();
    await plugin.setHighlight(false);
    expect(saved.at(-1)).toEqual({ highlight: false });
    expect(registrations[0].disposed).toBe(true);
    await plugin.setHighlight(true);
    expect(saved.at(-1)).toEqual({ highlight: true });
    expect(registrations).toHaveLength(2);
  });

  it('should load disabled highlight preference and tolerate preference save failures', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.readingDecorations = { register: vi.fn(() => ({ setTerms: vi.fn(), dispose: vi.fn() })) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    plugin.loadData = async () => ({ highlight: false });
    plugin.saveData = async () => { throw new Error('nope'); };
    await plugin.onload();
    expect(plugin.state.highlight).toBe(false);
    expect(app.readingDecorations.register).not.toHaveBeenCalled();
    await plugin.setHighlight(true);
    expect(plugin.state.highlight).toBe(true);
    expect(app.readingDecorations.register).toHaveBeenCalledOnce();
  });

  it('should default highlight on when preference loading fails and use the host helper when present', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.readingDecorations = { register: vi.fn() };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    const handle = { setTerms: vi.fn(() => true), dispose: vi.fn() };
    plugin.loadData = async () => { throw new Error('bad prefs'); };
    plugin.addReadingDecoration = vi.fn(() => handle);
    await plugin.onload();
    expect(plugin.state.highlight).toBe(true);
    expect(plugin.addReadingDecoration).toHaveBeenCalledOnce();
    expect(plugin.updateReadingTerms()).toBe(true);
  });

  it('should hide reading controls and skip registration on older hosts without decorations', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    expect(plugin.readingHandle).toBeNull();
    const rendered = document.createElement('div');
    app.panels[0].render(rendered);
    expect(rendered.textContent).not.toContain('在正文里标出已收的词');
    await plugin.setHighlight(false);
    expect(plugin.state.highlight).toBe(false);
    app.storage.scope = async () => { throw new Error('gone'); };
    await expect(plugin.rootMoved()).resolves.toBe(false);
  });

  it('should undo the latest reading-card rating and append an undo log', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.readingDecorations = { register: () => ({ setTerms: vi.fn(() => true), dispose: vi.fn() }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    expect(await plugin.undoReadingRating('alpha')).toBe(false);
    await plugin.rateWord('alpha', 'Good', 'reading-card');
    expect(plugin.state.review.cards.alpha).toBeTruthy();
    expect(await plugin.undoReadingRating('alpha')).toBe(true);
    expect(plugin.state.review.cards.alpha).toBeUndefined();
    const log = JSON.parse(app.storage.writes.filter((item) => item.name === 'log.json').at(-1).text);
    expect(log.at(-1)).toMatchObject({ word: 'alpha', undo: true, mode: 'reading-card' });
  });

  it('should restore the previous card when undoing a reading-card rating on a reviewed word', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.readingDecorations = { register: () => ({ setTerms: vi.fn(() => true), dispose: vi.fn() }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    const previous = { state: 'Review', stability: 2, due: '2031-01-01T00:00:00.000Z', last_review: '2026-10-01T00:00:00.000Z' };
    plugin.state.review = { version: 1, cards: { alpha: previous }, flags: {} };
    await plugin.rateWord('alpha', 'Again', 'reading-card');
    await plugin.undoReadingRating('alpha');
    expect(plugin.state.review.cards.alpha).toEqual(previous);
  });

  it('should notify when undoing a reading-card rating fails or races a root change', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.readingDecorations = { register: () => ({ setTerms: vi.fn(() => true), dispose: vi.fn() }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await plugin.rateWord('alpha', 'Good', 'reading-card');
    plugin.reviewStore.saveReview = async () => { throw new Error('bad'); };
    expect(await plugin.undoReadingRating('alpha')).toBe(false);
    expect(app.notices.some((item) => item.message.includes('保存失败'))).toBe(true);

    plugin.reviewStore.saveReview = async () => ({ review: { version: 1, cards: {}, flags: {} }, rootChanged: true });
    expect(await plugin.undoReadingRating('alpha')).toBe(false);
    expect(app.notices.some((item) => item.message.includes('知识库已切换'))).toBe(true);
  });

  it('should register tools that can run against plugin state', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await expect(app.tools.get('vocab_lookup').run({ word: 'alpha' })).resolves.toContain('"collected":true');
    await expect(app.tools.get('vocab_add').run({ entries: [{ word: 'beta', definition: '测试' }] })).resolves.toContain('Submitted for review');
  });

  it('should persist ratings and flags, append rating logs, and notify without losing a saved card when log writing fails', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const originalWrite = app.storage.write;
    app.storage.write = async function write(root, name, text, options) {
      if (name === 'log.json') throw Object.assign(new Error('log failed'), { code: 'STORAGE_WRITE_FAILED' });
      return originalWrite.call(this, root, name, text, options);
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await plugin.rateWord('alpha', 'Good', 'flip');
    expect(plugin.state.review.cards.alpha).toBeTruthy();
    expect(app.storage.writes.some((item) => item.name === 'review.json')).toBe(true);
    expect(app.notices.some((item) => item.message.includes('日志'))).toBe(true);
    await plugin.setFlag('alpha', 'ignored');
    expect(plugin.state.review.flags.alpha).toBe('ignored');
    expect(JSON.parse(app.storage.writes.filter((item) => item.name === 'review.json').at(-1).text).flags.alpha).toBe('ignored');
  });

  it('should append a complete rating log entry after saving the card', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await plugin.rateWord('alpha', 'Hard', 'reverse');
    const log = JSON.parse(app.storage.writes.find((item) => item.name === 'log.json').text);
    expect(log[0]).toMatchObject({ word: 'alpha', rating: 'Hard', previousState: 'New', mode: 'reverse' });
    expect(log[0].reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should notify and keep state unchanged when review storage fails', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.storage.write = async () => { throw Object.assign(new Error('failed'), { code: 'STORAGE_WRITE_FAILED' }); };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await expect(plugin.rateWord('alpha', 'Good', 'flip')).resolves.toBe(false);
    expect(plugin.state.review.cards.alpha).toBeUndefined();
    expect(app.notices.some((item) => item.message.includes('保存失败'))).toBe(true);
  });

  it('should notify and keep flags unchanged when status storage fails', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    app.storage.write = async () => { throw Object.assign(new Error('failed'), { code: 'STORAGE_WRITE_FAILED' }); };
    await expect(plugin.setFlag('alpha', 'ignored')).resolves.toBe(false);
    expect(plugin.state.review.flags.alpha).toBeUndefined();
    expect(app.notices.some((item) => item.message.includes('状态保存失败'))).toBe(true);
  });

  it('should discard an in-flight rating when storage reports the knowledge root changed', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    let changed = false;
    const originalWrite = app.storage.write;
    app.storage.write = async function write(root, name, text, options) {
      if (name === 'review.json' && !changed) {
        changed = true;
        throw Object.assign(new Error('changed'), { code: 'ROOT_CHANGED' });
      }
      return originalWrite.call(this, root, name, text, options);
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await plugin.rateWord('alpha', 'Good', 'flip');
    expect(plugin.state.review.cards.alpha).toBeUndefined();
    expect(app.notices.some((item) => item.message.includes('知识库已切换'))).toBe(true);
  });

  it('should make registered lookup observe review state reloaded for a new root', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    plugin.state.review = { version: 1, cards: { alpha: { state: 'Review', stability: 2, due: '2031-01-01T00:00:00.000Z' } }, flags: {} };
    await expect(app.tools.get('vocab_lookup').run({ word: 'alpha' })).resolves.toContain('2031-01-01');
  });

  it('should reload review progress for the new root when the index changes after a root switch without a root-changed event', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    let generation = 'root-a';
    const byRoot = { 'root-a': JSON.stringify({ version: 1, cards: { alpha: { state: 'Review', stability: 2, due: '2031-01-01T00:00:00.000Z', last_review: '2026-10-01T00:00:00.000Z' } }, flags: {} }) };
    app.storage.scope = async () => ({ rootGeneration: generation });
    app.storage.read = async (root, name) => {
      if (root !== generation) throw Object.assign(new Error('changed'), { code: 'ROOT_CHANGED' });
      return name === 'review.json' && byRoot[root] ? { found: true, text: byRoot[root], revision: 'r' } : { found: false };
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    expect(Object.keys(plugin.state.review.cards)).toEqual(['alpha']);

    generation = 'root-b';
    await app.events.find((event) => event.name === 'knowledge.index-changed').listener({ status: null });

    expect(plugin.state.review.cards).toEqual({});
  });

  it('should register reading status with a pure open-panel action and learning suggestions when host ports exist', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.workspace = { scope: () => ({ epoch: 'epoch-1' }), openDocument: vi.fn(() => true) };
    const statusSets = [];
    const suggestionSets = [];
    app.readingStatus = { register: () => ({ set: (...args) => { statusSets.push(args); return true; }, dispose() {} }) };
    app.learningSuggestions = { register: () => ({ set: (...args) => { suggestionSets.push(args); return true; }, dispose() {} }) };
    app.knowledge.listDocuments = async () => [{ path: 'wiki/read.md', title: 'Read', revision: { contentHash: 'h' } }];
    app.knowledge.readDocument = async () => ({ content: `${Array.from({ length: 80 }, () => 'the').join(' ')} rarewordx rarewordy rarewordz rarewordq`, meta: { title: 'Read' } });
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    plugin.recommender.table = ['the', ...Array.from({ length: 1000 }, (_, index) => `filler${index}`), 'rarewordx', 'rarewordy', 'rarewordz', 'rarewordq'];
    plugin.recommender.settings = { vocabularySize: 1000, easyMax: 2, goodMax: 8 };
    await app.events.find((event) => event.name === 'knowledge.document-opened').listener({ path: 'wiki/read.md', contentHash: 'h2' });
    expect(statusSets.at(-1)[2]).toMatchObject({ text: '生词 5%·适合学习', action: { kind: 'open-panel', panelId: 'english-vocab' } });
    await plugin.refreshRecommendations();
    expect(suggestionSets.at(-1)[0]).toBe('epoch-1');
    expect(suggestionSets.at(-1)[1][0]).toMatchObject({ id: 'reading:wiki/read.md', documentPath: 'wiki/read.md' });
  });

  it('should calculate initial recommendations and learning suggestions during onload after the index refresh has completed', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.workspace = { scope: () => ({ epoch: 'epoch-1' }), openDocument: vi.fn(() => true) };
    const suggestionSets = [];
    app.learningSuggestions = { register: () => ({ set: (...args) => { suggestionSets.push(args); return true; }, dispose() {} }) };
    app.knowledge.listDocuments = async () => [{ path: 'wiki/read.md', title: 'Read', revision: { contentHash: 'h' } }];
    app.knowledge.readDocument = async () => ({ content: Array.from({ length: 80 }, () => 'the').join(' '), meta: { title: 'Read' }, revision: { contentHash: 'h' } });
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    expect(plugin.state.recommendations.items[0]).toMatchObject({ path: 'wiki/read.md', title: 'Read' });
    expect(suggestionSets).toHaveLength(1);
    expect(suggestionSets[0][0]).toBe('epoch-1');
    expect(suggestionSets[0][1][0]).toMatchObject({ id: 'reading:wiki/read.md', documentPath: 'wiki/read.md' });
  });

  it('should recalculate recommendations and learning suggestions after knowledge root changes', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    let epoch = 'epoch-1';
    app.workspace = { scope: () => ({ epoch }), openDocument: vi.fn(() => true) };
    const suggestionSets = [];
    app.learningSuggestions = { register: () => ({ set: (...args) => { suggestionSets.push(args); return true; }, dispose() {} }) };
    app.knowledge.listDocuments = async () => [{ path: 'wiki/read.md', title: `Read ${epoch}`, revision: { contentHash: epoch } }];
    app.knowledge.readDocument = async () => ({ content: Array.from({ length: 80 }, () => 'the').join(' '), meta: { title: `Read ${epoch}` }, revision: { contentHash: epoch } });
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    epoch = 'epoch-2';
    await app.events.find((event) => event.name === 'knowledge.root-changed').listener();
    expect(suggestionSets.map(([seenEpoch]) => seenEpoch)).toEqual(['epoch-1', 'epoch-2']);
    expect(plugin.state.recommendations.items[0].title).toBe('Read epoch-2');
  });

  it('should refresh recommendations and recalculate the latest reading status after review state or level settings changes', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.workspace = { scope: () => ({ epoch: 'epoch-1' }), openDocument: vi.fn(() => true) };
    const statusSets = [];
    const suggestionSets = [];
    app.readingStatus = { register: () => ({ set: (...args) => { statusSets.push(args); return true; }, dispose() {} }) };
    app.learningSuggestions = { register: () => ({ set: (...args) => { suggestionSets.push(args); return true; }, dispose() {} }) };
    app.knowledge.listDocuments = async () => [
      { path: 'wiki/read.md', title: 'Read', revision: { contentHash: 'h' } },
      { path: 'wiki/vocab/rarewordx.md', title: 'Rare', revision: { contentHash: 'v' } },
    ];
    app.knowledge.readDocument = async ({ path }) => {
      if (path === 'wiki/vocab/rarewordx.md') return { content: buildNote({ word: 'rarewordx', definition: 'rare' }), meta: { title: 'Rare' } };
      return { content: `${Array.from({ length: 80 }, () => 'the').join(' ')} rarewordx`, meta: { title: 'Read' }, revision: { contentHash: 'h' } };
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    plugin.recommender.table = ['the', ...Array.from({ length: 1000 }, (_, index) => `filler${index}`), 'rarewordx'];
    plugin.recommender.settings = { vocabularySize: 1000, easyMax: 0, goodMax: 2 };
    await plugin.updateReadingStatus({ path: 'wiki/read.md', contentHash: 'h' });
    const before = statusSets.length;
    await plugin.rateWord('rarewordx', 'Good', 'flip');
    expect(statusSets.length).toBeGreaterThan(before);
    const beforeFlag = statusSets.length;
    await plugin.setFlag('rarewordx', 'ignored');
    expect(statusSets.length).toBeGreaterThan(beforeFlag);
    const beforeSettings = statusSets.length;
    await plugin.setLevelSettings({ vocabularySize: 2000, easyMax: 1, goodMax: 4 });
    expect(statusSets.length).toBeGreaterThan(beforeSettings);
    expect(suggestionSets.length).toBeGreaterThan(0);
  });

  it('should remember an early document-opened event and calculate it after reading level support is ready', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.workspace = { scope: () => ({ epoch: 'epoch-1' }) };
    const statusSets = [];
    app.readingStatus = { register: () => ({ set: (...args) => { statusSets.push(args); return true; }, dispose() {} }) };
    app.knowledge.readDocument = async () => ({ content: `${Array.from({ length: 80 }, () => 'the').join(' ')} rarewordx`, meta: { title: 'Read' }, revision: { contentHash: 'h' } });
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    plugin.locale = 'zh';
    plugin.t = { ...module.default.prototype.t, readingStatus: (rate) => `生词 ${Math.round(rate)}%`, readingStatusTitle: () => 'title', recommendations: '推荐阅读' };
    plugin.state = { entries: [], review: { version: 1, cards: {}, flags: {} }, levelSettings: { vocabularySize: 1000, easyMax: 0, goodMax: 5 } };
    plugin.readingStatusHandle = app.readingStatus.register();
    await expect(plugin.updateReadingStatus({ path: 'wiki/read.md', contentHash: 'h' })).resolves.toBe(false);
    plugin.initializeReadingLevel();
    plugin.recommender.table = ['the', ...Array.from({ length: 1000 }, (_, index) => `filler${index}`), 'rarewordx'];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(statusSets.length).toBeGreaterThan(0);
  });

  it('should handle reading level degraded and stale branches without leaking results', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    expect(await plugin.refreshRecommendations()).toBeNull();
    expect(await plugin.updateReadingStatus({ path: 'wiki/a.md' })).toBe(false);

    app.workspace = { epoch: 'e1', scope() { return { epoch: this.epoch }; } };
    app.readingStatus = { register: () => ({ set: vi.fn(() => true), dispose() {} }) };
    plugin.initializeReadingLevel();
    app.knowledge.readDocument = async () => ({ content: 'short text', meta: {} });
    await expect(plugin.updateReadingStatus({ documentPath: 'wiki/short.md' })).resolves.toBe(true);
    app.knowledge.readDocument = async () => ({ _tag: 'Err', error: 'missing' });
    await expect(plugin.updateReadingStatus({ path: 'wiki/missing.md' })).resolves.toBe(false);
    app.knowledge.readDocument = async () => { throw new Error('boom'); };
    await expect(plugin.updateReadingStatus({ path: 'wiki/boom.md' })).resolves.toBe(false);
    await expect(plugin.updateReadingStatus({})).resolves.toBe(false);
  });

  it('should save level settings and report save failures from plugin data storage', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.workspace = { scope: () => ({ epoch: 'epoch-1' }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    const saved = [];
    plugin.saveData = async (value) => saved.push(value);
    await plugin.onload();
    plugin.recommender.recommend = async () => ({ stale: false, items: [], skipped: {} });
    await expect(plugin.setLevelSettings({ vocabularySize: 5000, easyMax: 1, goodMax: 6 })).resolves.toBe(true);
    expect(saved.at(-1).levelSettings).toMatchObject({ vocabularySize: 5000 });
    plugin.saveData = async () => { throw new Error('nope'); };
    await expect(plugin.setLevelSettings({ vocabularySize: 3000, easyMax: 2, goodMax: 5 })).resolves.toBe(false);
    expect(app.notices.some((item) => item.message.includes('生词率设置保存失败'))).toBe(true);
  });

  it('should expose panel controls for flags notices highlights and reading document opening', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.workspace = { scope: () => ({ epoch: 'epoch-1' }), openDocument: vi.fn(() => true) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    plugin.recommender.recommend = async () => ({ stale: false, items: [], skipped: {} });
    const controls = plugin.panelState();
    await controls.onFlag('alpha', 'ignored');
    controls.notify('hello');
    await controls.onHighlightChange(false);
    await controls.onLevelSettingsChange({ vocabularySize: 5000, easyMax: 1, goodMax: 6 });
    await controls.refreshRecommendations();
    expect(controls.openReadingDocument('wiki/a.md')).toBe(true);
    expect(controls.canOpenReadingDocument()).toBe(true);
    expect(app.notices.some((item) => item.message === 'hello')).toBe(true);
    expect(plugin.state.highlight).toBe(false);
  });

  it('should not register dependent capabilities when host APIs are missing', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = { panels: [], commands: [], events: [], opened: [], notices: [], tools: new Map() };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    expect(app.panels).toHaveLength(1);
    expect(app.tools.size).toBe(0);
    await plugin.refreshIndex();
    await plugin.handleRootChanged();
  });

  it('should load the bundled main module when built', async () => {
    vi.resetModules();
    await import('../main.mjs');
    expect(true).toBe(true);
  });
});
