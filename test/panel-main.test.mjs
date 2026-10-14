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
  const result = {
    panels: [],
    commands: [],
    events: [],
    opened: [],
    notices: [],
    tools: new Map(),
    storage: {
      writes: [],
      async scope() { return { rootGeneration: 'root' }; },
      async read(root, name) {
        if (name === 'review.json' && storedReview) return { found: true, text: storedReview, revision: 'r' };
        return { found: false };
      },
      async write(root, name, text) { this.writes.push({ root, name, text }); if (name === 'review.json') storedReview = text; return { revision: `r${this.writes.length + 1}` }; },
      async list() { return []; },
      async remove() {},
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
    for (const label of ['Again', 'Hard', 'Good', 'Easy']) {
      const container = document.createElement('div');
      const seen = [];
      renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, onReview: (word, rating) => seen.push(rating), hasEnglishVoice: () => true });
      container.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      [...container.querySelectorAll('button')].find((node) => node.textContent === label).click();
      expect(seen[0]).toBe(label);
    }
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
    expect(rendered.textContent).toContain('英语生词本');
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
