import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendSelectionRequest, renderPanel } from '../src/panel.mjs';
import { buildNote } from '../src/note-format.mjs';
import { newSerializedCard } from '../src/scheduler.mjs';

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
  let rootGeneration = 'root';
  let revisionSequence = 0;
  const roots = new Map();
  const rootFiles = (root) => {
    if (!roots.has(root)) roots.set(root, new Map());
    return roots.get(root);
  };
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
      async scope() { return { rootGeneration }; },
      async read(root, name) {
        assertRoot(root);
        const file = rootFiles(root).get(name);
        return file ? { found: true, text: file.text, revision: file.revision } : { found: false };
      },
      async write(root, name, text, options = {}) {
        assertRoot(root);
        const files = rootFiles(root);
        const current = files.get(name);
        if ('expectedRevision' in options) {
          const conflict = options.expectedRevision === null
            ? Boolean(current)
            : !current || current.revision !== options.expectedRevision;
          if (conflict) throw Object.assign(new Error('revision conflict'), { code: 'REVISION_CONFLICT' });
        }
        const revision = `r${++revisionSequence}`;
        this.writes.push({ root, name, text, options });
        files.set(name, { text, revision });
        return { revision };
      },
      async list(root) { assertRoot(root); return [...rootFiles(root)].map(([name, file]) => ({ name, revision: file.revision, bytes: file.text.length })); },
      async remove(root, name) { assertRoot(root); rootFiles(root).delete(name); },
    },
    selectionActions: { items: [], register(spec) { this.items.push(spec); return { dispose() {} }; } },
    chat: { text: '', appendToComposer(text) { this.text += text; return Boolean(text); } },
    knowledge: {
      async listDocuments() { return [{ path: 'wiki/vocab/alpha.md', title: 'Alpha', revision: { contentHash: 'h' } }]; },
      async readDocument({ path } = {}) {
        if (path?.startsWith('wiki/vocab/') && path !== 'wiki/vocab/alpha.md') return { _tag: 'Err', error: { code: 'NOT_FOUND', message: 'not found' } };
        return {
          meta: { path, title: 'Alpha', revision: { contentHash: 'h', mtimeMs: 1 } },
          content: buildNote({ word: 'alpha', definition: '字母', pos: 'noun', example: 'Alpha test.' }),
          headings: [],
          links: [],
          citations: [],
        };
      },
      async propose(request) {
        for (const change of request.changes) {
          const current = await this.readDocument({ path: change.path });
          if (current?._tag !== 'Err' && current.content === change.newContent) {
            return { _tag: 'Err', error: { code: 'CHANGESET_INVALID', message: 'change is identical to source' } };
          }
        }
        return { outcome: 'applied', summary: 'applied', paths: request.changes.map((change) => change.path) };
      },
    },
  };
  return result;
}

async function appliedProposal(app, proposal, summary = 'applied') {
  for (const change of proposal.changes) {
    const current = await app.knowledge.readDocument({ path: change.path });
    if (current?._tag !== 'Err' && current.content === change.newContent) {
      return { _tag: 'Err', error: { code: 'CHANGESET_INVALID', message: 'change is identical to source' } };
    }
  }
  return { outcome: 'applied', summary, paths: proposal.changes.map((change) => change.path) };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = 'zh';
  globalThis.autonKnowledge = { Plugin: FakePlugin };
});

describe('panel', () => {
  it('should choose each card automatic mode without persisting it until the user selects a mode', () => {
    const container = document.createElement('div');
    let listener;
    let state = {
      entries: [
        { word: 'candid', definition: '坦率的', examples: [] },
        { word: 'run', pos: 'verb', definition: '跑', examples: ['I run daily.'] },
      ],
      review: { version: 1, cards: {}, flags: {} },
      log: [],
    };
    const persistMode = vi.fn();
    renderPanel(container, {
      app: fullApp(),
      getState: () => state,
      subscribe: (next) => { listener = next; return () => undefined; },
      onReviewModeChange: persistMode,
      hasEnglishVoice: () => true,
    });
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('翻卡');
    state = { ...state, review: { ...state.review, flags: { candid: 'ignored' } } };
    listener();
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('语境');
    expect(persistMode).not.toHaveBeenCalled();

    [...container.querySelectorAll('.ev-mode button')].find((node) => node.textContent === '翻卡').click();
    expect(persistMode).toHaveBeenCalledWith('flip');
    state = { ...state, review: { ...state.review, flags: {} } };
    listener();
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('翻卡');
  });

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
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母', examples: ['Alpha test.'] }], review: { version: 1, cards: {}, flags: {} }, log: [], reviewMode: 'flip', hasEnglishVoice: () => true });
    expect(container.querySelector('.ev-review-word')?.textContent).toBe('alpha');
    expect(container.querySelector('.ev-example')?.textContent).toContain('_____');
    container.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const ratings = [...container.querySelectorAll('.ev-rating .ev-button')];
    expect(ratings.map((node) => node.textContent)).toEqual(['1 重来', '2 困难', '3 良好', '4 简单']);
    expect(ratings[0].classList.contains('ev-rating-again')).toBe(true);
    expect(ratings[3].classList.contains('ev-rating-easy')).toBe(true);
  });

  it('should hide every target surface on the context front and reveal highlighted sentence when answered', () => {
    const container = document.createElement('div');
    const opened = vi.fn();
    const reviewed = vi.fn();
    const cancelSpeech = vi.fn();
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'run', pos: 'verb', definition: '跑', path: 'wiki/vocab/run.md', examples: ['She was running late. — [Daily](../reading/daily.md)'] }],
      review: { version: 1, cards: {}, flags: {} },
      log: [],
      openReadingDocument: opened,
      canOpenReadingDocument: () => true,
      onReview: reviewed,
      cancelSpeech,
      hasEnglishVoice: () => true,
    });
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('语境');
    expect(container.querySelector('.ev-context-sentence')?.textContent).toBe('She was _____ late.');
    expect(container.querySelector('.ev-card')?.textContent).not.toMatch(/\b(?:run|runs|ran|running)\b/i);
    [...container.querySelectorAll('button')].find((node) => node.textContent === 'Daily').click();
    expect(opened).toHaveBeenCalledWith('wiki/reading/daily.md');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '答案').click();
    expect(container.querySelector('mark.ev-context-hit')?.textContent).toBe('running');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '3 良好').click();
    expect(reviewed).toHaveBeenCalledWith('run', 'Good', 'context');
    expect(cancelSpeech).toHaveBeenCalled();
  });

  it('should render the context source as a labelled link when the article can be opened', () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'run', pos: 'verb', definition: '跑', path: 'wiki/vocab/run.md', examples: ['She was running late. — [Daily](../reading/daily.md)'] }],
      review: { version: 1, cards: {}, flags: {} },
      log: [],
      openReadingDocument: vi.fn(),
      canOpenReadingDocument: () => true,
    });
    const row = container.querySelector('.ev-context-source');
    expect(row?.querySelector('.ev-context-source-label')?.textContent).toBe('出自');
    const link = row?.querySelector('button.ev-context-source-link');
    expect(link?.textContent).toBe('Daily');
    expect(link?.getAttribute('title')).toBe('打开来源');
  });

  it('should render the context source as plain text when the host cannot open documents', () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'run', pos: 'verb', definition: '跑', path: 'wiki/vocab/run.md', examples: ['She was running late. — [Daily](../reading/daily.md)'] }],
      review: { version: 1, cards: {}, flags: {} },
      log: [],
      canOpenReadingDocument: () => false,
    });
    expect(container.querySelector('.ev-context-source button')).toBeNull();
    expect(container.querySelector('.ev-context-source-text')?.textContent).toBe('Daily');
  });

  it('should show definition without leaking the word when selected context mode has no usable example', () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'run', definition: '快速移动', examples: ['Nothing useful here.'] }],
      review: { version: 1, cards: {}, flags: {} },
      log: [],
      reviewMode: 'context',
      hasEnglishVoice: () => false,
    });
    expect(container.querySelector('.ev-card')?.textContent).toContain('这个词还没有例句');
    expect(container.querySelector('.ev-card')?.textContent).not.toMatch(/\brun\b/i);
    [...container.querySelectorAll('button')].find((node) => node.textContent === '答案').click();
    expect(container.querySelector('.ev-review-word')?.textContent).toBe('run');
  });

  it('should show url sources and load dictionary phonetics on the context answer', async () => {
    const container = document.createElement('div');
    const speakSentence = vi.fn();
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'run', pos: 'verb', definition: '跑', examples: ['Run today. — <https://example.com/run>'] }],
      review: { version: 1, cards: {}, flags: {} },
      log: [],
      lookupDictionary: vi.fn(async () => ({ entry: { p: 'rʌn' } })),
      speakSentence,
      hasEnglishVoice: () => true,
    });
    expect(container.querySelector('.ev-context-source-text')?.textContent).toBe('example.com');
    expect(container.querySelector('.ev-context-source-text')?.getAttribute('title')).toBe('https://example.com/run');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '答案').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('.ev-reading-phonetic')?.textContent).toBe('/rʌn/');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '朗读整句').click();
    expect(speakSentence).toHaveBeenCalledWith('Run today.');
  });

  it('should show an unsafe source title as plain text without offering to open it', () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'run', pos: 'verb', definition: '跑', path: 'wiki/vocab/run.md', examples: ['Run today. — [Outside](../../secret.md)'] }],
      review: { version: 1, cards: {}, flags: {} },
      log: [],
      openReadingDocument: vi.fn(),
      canOpenReadingDocument: () => true,
      hasEnglishVoice: () => true,
    });
    expect(container.querySelector('.ev-context-source-text')?.textContent).toBe('Outside');
    expect([...container.querySelectorAll('button')].some((node) => node.textContent === 'Outside')).toBe(false);
  });

  it('should persist mode changes and cancel speech when switching modes', () => {
    const container = document.createElement('div');
    const onReviewModeChange = vi.fn();
    const cancelSpeech = vi.fn();
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'run', pos: 'verb', definition: '跑', examples: ['They ran home.'] }],
      review: { version: 1, cards: {}, flags: {} },
      log: [],
      reviewMode: 'flip',
      onReviewModeChange,
      cancelSpeech,
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '反向拼写').click();
    expect(onReviewModeChange).toHaveBeenCalledWith('reverse');
    expect(cancelSpeech).toHaveBeenCalledOnce();
  });

  it('should choose the default mode again and cancel speech when an unconfigured user changes cards', () => {
    const container = document.createElement('div');
    let listener;
    let current = {
      entries: [{ word: 'run', pos: 'verb', definition: '跑', examples: ['They ran home.'] }],
      review: { version: 1, cards: {}, flags: {} },
      log: [],
      reviewMode: null,
    };
    const cancelSpeech = vi.fn();
    renderPanel(container, {
      app: fullApp(),
      getState: () => current,
      subscribe: (next) => { listener = next; return () => undefined; },
      cancelSpeech,
      hasEnglishVoice: () => true,
    });
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('语境');
    current = {
      ...current,
      entries: [{ word: 'alpha', definition: '字母', examples: [] }],
    };
    listener();
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('翻卡');
    expect(cancelSpeech).toHaveBeenCalledOnce();
  });

  it('should cloze whole inflections and remove source markdown in legacy review modes', () => {
    for (const modeLabel of ['翻卡', '反向拼写', '听音拼写']) {
      const container = document.createElement('div');
      renderPanel(container, {
        app: fullApp(),
        entries: [{ word: 'run', pos: 'verb', definition: '跑', examples: ['She was running and ran. — [Daily](wiki/daily.md)'] }],
        review: { version: 1, cards: {}, flags: {} },
        log: [],
        reviewMode: 'flip',
        hasEnglishVoice: () => true,
        speak: vi.fn(),
      });
      if (modeLabel !== '翻卡') [...container.querySelectorAll('button')].find((node) => node.textContent === modeLabel).click();
      expect(container.querySelector('.ev-example')?.textContent).toBe('She was _____ and _____.');
      expect(container.querySelector('.ev-card')?.textContent).not.toContain('[Daily]');
    }
  });

  it('should show empty state and cleanup when there are no due cards', () => {
    const container = document.createElement('div');
    const cleanup = renderPanel(container, { app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true });
    expect(container.textContent).toContain('生词本还是空的');
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('语境');
    cleanup();
    expect(container.textContent).toBe('');
  });

  it('should keep the no due words message when the notebook contains vocabulary', () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'alpha', definition: '字母' }],
      review: { version: 1, cards: {}, flags: { alpha: 'ignored' } },
      hasEnglishVoice: () => true,
    });
    expect(container.textContent).toContain('没有到期生词');
    expect(container.textContent).not.toContain('生词本还是空的');
  });

  it('should clear a preserved spelling answer when the review word changes', () => {
    const container = document.createElement('div');
    let listener;
    let current = { entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, reviewMode: 'reverse' };
    renderPanel(container, {
      app: fullApp(), getState: () => current,
      subscribe: (next) => { listener = next; return () => undefined; },
      hasEnglishVoice: () => true,
    });
    container.querySelector('[data-role="spelling-answer"]').value = 'alpha';
    current = { ...current, entries: [{ word: 'beta', definition: '测试' }] };
    listener();
    expect(container.querySelector('[data-role="spelling-answer"]').value).toBe('');
  });

  it('should not restore an old dictionary result after the lookup text changes and state rerenders', async () => {
    const container = document.createElement('div');
    let listener;
    const current = { entries: [], review: { version: 1, cards: {}, flags: {} } };
    renderPanel(container, {
      app: fullApp(), getState: () => current,
      subscribe: (next) => { listener = next; return () => undefined; },
      lookupDictionary: async (word) => ({ surface: word, lemma: word, entry: { t: `${word} definition` } }),
      suggestDictionary: async () => [], hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'saw';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    expect(container.querySelector('.ev-dict-result').textContent).toContain('saw');
    input.value = 'le';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    listener();
    expect(container.querySelector('.ev-dict-result').textContent).not.toContain('saw');
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
      recommendations: { items: [{ title: 'Readable', path: 'wiki/read.md', bandLabel: '适合', rate: 4, topWords: ['rare'] }], skipped: { 'not-english': 1, 'too-short': 2, unreadable: 3 } },
      onLevelSettingsChange: (settings) => saved.push(settings),
      openReadingDocument: (path) => { opened.push(path); return true; },
      canOpenReadingDocument: () => true,
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '推荐阅读').click();
    expect(container.textContent).toContain('Readable');
    expect(container.textContent).toContain('生词: rare');
    expect(container.textContent).toContain('不可读 3');
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
    expect(container.textContent).toContain('生词: -');
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
    const review = { version: 1, cards: { inferred: { state: 'Review', stability: 30 } }, flags: { mastered: 'mastered', ignored: 'ignored' } };
    renderPanel(container, {
      app: fullApp(),
      entries: [
        { word: 'plain', definition: 'no manual flag' },
        { word: 'mastered', definition: 'manually mastered' },
        { word: 'ignored', definition: 'manually ignored' },
        { word: 'inferred', definition: 'fsrs mastered' },
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
    expect(labels(rows[1])).toEqual(['忽略', '恢复复习']);
    expect(labels(rows[2])).toEqual(['恢复']);
    expect(labels(rows[3])).toEqual(['忽略']);
  });

  it('should show invalid vocabulary notes with localized categories and raw details', () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: fullApp(), entries: [], invalid: [{ path: 'wiki/vocab/broken.md', error: 'unsupported YAML block scalar' }],
      review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    expect(container.textContent).toContain('无效笔记（1）');
    expect(container.textContent).toContain('wiki/vocab/broken.md');
    expect(container.textContent).toContain('笔记格式无效');
    expect(container.querySelector('[data-raw-error]')?.dataset.rawError).toBe('unsupported YAML block scalar');
  });

  it('should localize parse and document read failure categories without labeling every error as yaml', () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: fullApp(), entries: [], invalid: [
        { path: 'wiki/vocab/parse.md', kind: 'parse', error: 'missing frontmatter' },
        { path: 'wiki/vocab/large.md', kind: 'read', code: 'DOCUMENT_TOO_LARGE', error: 'large' },
        { path: 'wiki/vocab/binary.md', kind: 'read', code: 'DOCUMENT_NOT_TEXT', error: 'binary' },
        { path: 'wiki/vocab/offline.md', kind: 'read', code: 'READ_FAILED', error: 'offline' },
      ],
      review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    expect(container.textContent).toContain('笔记格式无效');
    expect(container.textContent).toContain('文件过大');
    expect(container.textContent).toContain('不是文本文件');
    expect(container.textContent).toContain('文件读取失败');
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

  it('should look up dictionary suggestions in the notebook and collect a selected word', async () => {
    const container = document.createElement('div');
    const collected = [];
    renderPanel(container, {
      app: fullApp(),
      entries: [],
      review: { version: 1, cards: {}, flags: {} },
      lookupDictionary: async (word) => ({ surface: word, lemma: 'ephemeral', entry: { p: 'iˈfemərəl', t: 'adj. 短暂的', d: 'lasting briefly' } }),
      suggestDictionary: async () => [{ word: 'ephemeral', entry: {} }],
      onCollectDictionaryWord: (result) => collected.push(result.lemma),
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'eph';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    expect(container.textContent).toContain('词典');
    expect(container.querySelector('.ev-dict-chip')?.textContent).toBe('ephemeral');
    container.querySelector('.ev-dict-chip').click();
    await Promise.resolve();
    expect(container.querySelector('.ev-dict-result')).toBeTruthy();
    expect(container.querySelector('.ev-dict-result .ev-dict-head .ev-row-word')?.textContent).toBe('ephemeral');
    expect(container.querySelector('.ev-dict-result .ev-reading-phonetic')?.textContent).toBe('/iˈfemərəl/');
    expect(container.querySelectorAll('.ev-dict-result .ev-dict-line')).toHaveLength(2);
    expect(container.textContent).toContain('adj. 短暂的');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '收词').click();
    expect(collected).toEqual(['ephemeral']);
  });

  it('should render the latest pending dictionary result into the current dom after a state rerender', async () => {
    const container = document.createElement('div');
    let listener;
    let resolveLookup;
    const pending = new Promise((resolve) => { resolveLookup = resolve; });
    renderPanel(container, {
      app: fullApp(),
      entries: [],
      review: { version: 1, cards: {}, flags: {} },
      subscribe: (next) => { listener = next; return () => undefined; },
      lookupDictionary: () => pending,
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'run';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    listener();
    resolveLookup({ surface: 'run', lemma: 'run', entry: { t: 'v. 跑', d: 'move' } });
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('.ev-dict-result .ev-row-word')?.textContent).toBe('run');
  });

  it('should show a persistent retry state when panel dictionary lookup or suggestions reject', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const lookupDictionary = vi.fn()
      .mockRejectedValueOnce(new Error('chunk fail'))
      .mockResolvedValueOnce({ surface: 'run', lemma: 'run', entry: { t: 'v. 跑' } });
    const suggestDictionary = vi.fn()
      .mockRejectedValueOnce(new Error('chunk fail'))
      .mockResolvedValueOnce([{ word: 'running', entry: {} }]);
    renderPanel(container, {
      app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} }, lookupDictionary, suggestDictionary, hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    let input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'run';
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toContain('词典加载失败');
    expect(container.querySelector('[data-role="dictionary-search"]').value).toBe('run');
    expect(document.activeElement).toBe(container.querySelector('[data-role="dictionary-search"]'));
    [...container.querySelectorAll('button')].find((node) => node.textContent === '重试').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('.ev-dict-result .ev-row-word')?.textContent).toBe('run');

    input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'runn';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toContain('词典加载失败');
    [...container.querySelectorAll('button')].find((node) => node.textContent === '重试').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('.ev-dict-chip')?.textContent).toBe('running');
  });

  it('should allow only one in-flight notebook collection and keep retry state aligned with proposal outcomes', async () => {
    const container = document.createElement('div');
    let release;
    const onCollectDictionaryWord = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    renderPanel(container, {
      app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} },
      lookupDictionary: async () => ({ surface: 'run', lemma: 'run', entry: { t: 'v. 跑' } }),
      onCollectDictionaryWord,
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'run';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    const collect = [...container.querySelectorAll('button')].find((node) => node.textContent === '收词');
    collect.click();
    collect.click();
    expect(collect.disabled).toBe(true);
    expect(onCollectDictionaryWord).toHaveBeenCalledOnce();
    release({ outcome: 'not-reviewed', reason: 'busy' });
    await Promise.resolve();
    let retry = [...container.querySelectorAll('button')].find((node) => node.textContent === '收词');
    expect(retry.disabled).toBe(false);

    onCollectDictionaryWord.mockRejectedValueOnce(new Error('temporary failure'));
    retry.click();
    await Promise.resolve();
    await Promise.resolve();
    retry = [...container.querySelectorAll('button')].find((node) => node.textContent === '收词');
    expect(retry.disabled).toBe(false);
    expect(container.textContent).toContain('词典加载失败');

    onCollectDictionaryWord.mockResolvedValueOnce({ outcome: 'applied' });
    retry.click();
    await Promise.resolve();
    await Promise.resolve();
    expect([...container.querySelectorAll('button')].find((node) => node.textContent === '收词').disabled).toBe(true);
    expect(container.textContent).toContain('已收进生词本');
  });

  it('should rerender at local midnight and the nearest due time without a state event', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-15T23:59:59'));
      const container = document.createElement('div');
      const log = Array.from({ length: 50 }, (_, index) => ({ word: `old-${index}`, previousState: 'New', reviewedAt: '2026-10-15T12:00:00' }));
      const cleanup = renderPanel(container, {
        app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, log, hasEnglishVoice: () => true,
      });
      expect(container.querySelector('.ev-card')).toBeNull();
      await vi.advanceTimersByTimeAsync(1100);
      expect(container.querySelector('.ev-card')?.textContent).toContain('alpha');
      cleanup();
      expect(vi.getTimerCount()).toBe(0);

      vi.setSystemTime(new Date('2026-10-16T12:00:00'));
      const dueContainer = document.createElement('div');
      const dueCleanup = renderPanel(dueContainer, {
        app: fullApp(),
        entries: [{ word: 'beta', definition: '字母' }],
        review: { version: 1, cards: { beta: { ...newSerializedCard(new Date()), state: 'Review', stability: 2, difficulty: 5, reps: 1, last_review: new Date(Date.now() - 86_400_000).toISOString(), due: new Date(Date.now() + 1000).toISOString() } }, flags: {} },
        log: [], hasEnglishVoice: () => true,
      });
      expect(dueContainer.querySelector('.ev-card')).toBeNull();
      await vi.advanceTimersByTimeAsync(1100);
      expect(dueContainer.querySelector('.ev-card')?.textContent).toContain('beta');
      dueCleanup();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should accept a curly apostrophe as the same spelling answer as a straight apostrophe', () => {
    const container = document.createElement('div');
    const reviewed = vi.fn();
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: "don't", definition: '不要' }],
      review: { version: 1, cards: {}, flags: {} },
      reviewMode: 'reverse',
      onReview: reviewed,
      hasEnglishVoice: () => true,
    });
    const input = container.querySelector('[data-role="spelling-answer"]');
    input.value = 'don’t';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(reviewed).toHaveBeenCalledWith("don't", 'Good', 'reverse');
  });

  it('should explain the host highlighting limitation when the notebook contains a hyphenated word', () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: { ...fullApp(), readingDecorations: { register: vi.fn() } },
      entries: [{ word: 'mother-in-law', definition: '岳母或婆婆' }],
      review: { version: 1, cards: {}, flags: {} },
      hasEnglishVoice: () => true,
    });
    expect(container.textContent).toContain('连字符词可用于语境复习，但宿主正文标记会按单词拆分');
  });

  it('should show dictionary empty and collected states in the notebook', async () => {
    const container = document.createElement('div');
    renderPanel(container, {
      app: fullApp(),
      entries: [{ word: 'known', definition: '已知' }],
      review: { version: 1, cards: {}, flags: {} },
      lookupDictionary: async (word) => (word === 'known' ? { surface: 'known', lemma: 'known', entry: { t: 'adj. 已知的', d: 'known' } } : null),
      suggestDictionary: async () => [],
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'q';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    expect(container.querySelector('.ev-dict-chip')).toBeNull();
    input.value = 'qz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    expect(container.textContent).toContain('词典中没有这个词');
    input.value = 'known';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    expect(container.textContent).toContain('已在生词本');
    input.value = 'missing';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    expect(container.textContent).toContain('词典中没有这个词');
  });

  it('should render panel dictionary definitions in English order when locale is English', async () => {
    document.documentElement.lang = 'en';
    const container = document.createElement('div');
    renderPanel(container, {
      app: fullApp(),
      entries: [],
      review: { version: 1, cards: {}, flags: {} },
      lookupDictionary: async () => ({ surface: 'run', lemma: 'run', entry: { t: 'v. 跑', d: 'move fast' } }),
      suggestDictionary: async () => [{ word: 'run', entry: {} }],
      hasEnglishVoice: () => true,
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === 'Notebook').click();
    expect(container.textContent).toContain('Dictionary');
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'ru';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    container.querySelector('.ev-dict-chip').click();
    await Promise.resolve();
    expect([...container.querySelectorAll('.ev-dict-result .ev-dict-lines')].map((node) => node.className)).toEqual(['ev-dict-lines ev-dict-lines-en', 'ev-dict-lines ev-dict-lines-zh']);
  });

  it('should open a semantic dictionary inflection relation from the notebook', async () => {
    const container = document.createElement('div');
    const lookupDictionary = vi.fn(async (word) => word === 'saw'
      ? { surface: 'saw', lemma: 'saw', inflection: { lemma: 'see', kind: 'past' }, entry: { t: 'n. 锯', d: 'a cutting tool' } }
      : { surface: 'see', lemma: 'see', entry: { t: 'v. 看见', d: 'perceive with the eyes' } });
    renderPanel(container, { app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} }, lookupDictionary, hasEnglishVoice: () => true });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'saw';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    container.querySelector('.ev-dict-lemma-link').click();
    await Promise.resolve();
    expect(lookupDictionary).toHaveBeenLastCalledWith('see');
    expect(container.querySelector('.ev-dict-head .ev-row-word')?.textContent).toBe('see');
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

  it('should preserve notebook input values selection and focus when state emits', () => {
    const container = document.createElement('div');
    document.body.append(container);
    let listener;
    const state = { entries: [], review: { version: 1, cards: {}, flags: {} }, log: [] };
    renderPanel(container, { app: fullApp(), getState: () => state, subscribe: (next) => { listener = next; return () => undefined; }, hasEnglishVoice: () => true });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'deliv';
    input.focus();
    input.setSelectionRange(2, 4);
    listener();
    const restored = container.querySelector('[data-role="dictionary-search"]');
    expect(restored.value).toBe('deliv');
    expect(document.activeElement).toBe(restored);
    expect([restored.selectionStart, restored.selectionEnd]).toEqual([2, 4]);
  });

  it('should discard stale dictionary suggestions when a newer query finishes first', async () => {
    const container = document.createElement('div');
    const resolvers = new Map();
    renderPanel(container, {
      app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true,
      suggestDictionary: (query) => new Promise((resolve) => resolvers.set(query, resolve)),
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'de'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = 'deli'; input.dispatchEvent(new Event('input', { bubbles: true }));
    resolvers.get('deli')([{ word: 'deliver', entry: {} }]);
    await Promise.resolve();
    resolvers.get('de')([{ word: 'delay', entry: {} }]);
    await Promise.resolve();
    expect([...container.querySelectorAll('.ev-dict-chip')].map((node) => node.textContent)).toEqual(['deliver']);
  });

  it('should discard a stale enter lookup when a newer query finishes first', async () => {
    const container = document.createElement('div');
    const resolvers = new Map();
    renderPanel(container, {
      app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true,
      lookupDictionary: (query) => new Promise((resolve) => resolvers.set(query, resolve)),
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'saw'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.value = 'left'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    resolvers.get('left')({ surface: 'left', lemma: 'left', entry: { t: 'adj. 左边的' } });
    await Promise.resolve();
    resolvers.get('saw')({ surface: 'saw', lemma: 'saw', entry: { t: 'n. 锯' } });
    await Promise.resolve();
    expect(container.querySelector('.ev-dict-head .ev-row-word')?.textContent).toBe('left');
  });

  it('should discard a stale inflection link lookup when a newer query finishes first', async () => {
    const container = document.createElement('div');
    const resolvers = new Map();
    renderPanel(container, {
      app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true,
      lookupDictionary: (query) => query === 'saw'
        ? Promise.resolve({ surface: 'saw', lemma: 'saw', entry: { t: 'n. 锯' }, inflection: { lemma: 'see', kind: 'past' } })
        : new Promise((resolve) => resolvers.set(query, resolve)),
    });
    [...container.querySelectorAll('button')].find((node) => node.textContent === '生词本').click();
    const input = container.querySelector('[data-role="dictionary-search"]');
    input.value = 'saw'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    container.querySelector('.ev-dict-lemma-link').click();
    input.value = 'left'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    resolvers.get('left')({ surface: 'left', lemma: 'left', entry: { t: 'adj. 左边的' } });
    await Promise.resolve();
    resolvers.get('see')({ surface: 'see', lemma: 'see', entry: { t: 'v. 看见' } });
    await Promise.resolve();
    expect(container.querySelector('.ev-dict-head .ev-row-word')?.textContent).toBe('left');
  });

  it('should disable panel rating buttons and shortcuts while a mutation is pending', () => {
    const container = document.createElement('div');
    const onReview = vi.fn();
    renderPanel(container, { app: fullApp(), entries: [{ word: 'alpha', definition: '字母' }], review: { version: 1, cards: {}, flags: {} }, log: [], reviewMode: 'flip', mutationPending: true, onReview, hasEnglishVoice: () => true });
    container.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect([...container.querySelectorAll('.ev-rating button')].every((node) => node.disabled)).toBe(true);
    container.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    expect(onReview).not.toHaveBeenCalled();
  });

  it('should show a reading highlight switch only when the host supports decorations', () => {
    const container = document.createElement('div');
    const seen = [];
    const lookupSeen = [];
    renderPanel(container, {
      app: { ...fullApp(), readingDecorations: { register() {} } },
      entries: [],
      review: { version: 1, cards: {}, flags: {} },
      highlight: true,
      onHighlightChange: (value) => seen.push(value),
      onLookupAnyWordChange: (value) => lookupSeen.push(value),
      hasEnglishVoice: () => true,
    });
    const input = container.querySelector('[data-role="highlight-reading"]');
    const lookup = container.querySelector('[data-role="lookup-any-word"]');
    expect(container.textContent).toContain('在正文里标出已收的词');
    expect(input.checked).toBe(true);
    expect(lookup.checked).toBe(true);
    input.click();
    expect(seen).toEqual([false]);
    lookup.click();
    expect(lookupSeen).toEqual([false]);

    const oldHost = document.createElement('div');
    renderPanel(oldHost, { app: fullApp(), entries: [], review: { version: 1, cards: {}, flags: {} }, hasEnglishVoice: () => true });
    expect(oldHost.textContent).not.toContain('在正文里标出已收的词');
    expect(oldHost.textContent).not.toContain('点任意词查词典');
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
  it('should register the selection action disposable for plugin unload', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const disposable = { dispose: vi.fn() };
    app.selectionActions.register = vi.fn(() => disposable);
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    expect(plugin.registered).toContain(disposable);
  });
  it('should serialize two rapid ratings and log both applied operations', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    let active = 0;
    let maximum = 0;
    let reps = 0;
    const log = [];
    plugin.reviewStore.mutateReview = vi.fn(async (operation) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      reps += 1;
      active -= 1;
      plugin.reviewStore.review = { version: 1, cards: { alpha: { state: 'Learning', reps } }, flags: {} };
      log.push(operation.logEntry);
      return { review: plugin.reviewStore.review, previousCard: reps === 1 ? null : { state: 'Learning', reps: reps - 1 }, rootChanged: false };
    });
    plugin.reviewStore.flushPendingLogs = vi.fn(async () => [...log]);
    const first = plugin.rateWord('alpha', 'Good', 'flip');
    const second = plugin.rateWord('alpha', 'Again', 'flip');
    expect(plugin.state.mutationPending).toBe(true);
    await Promise.all([first, second]);
    expect(maximum).toBe(1);
    expect(plugin.state.review.cards.alpha.reps).toBe(2);
    expect(log).toHaveLength(2);
    expect(new Set(log.map((entry) => entry.id)).size).toBe(2);
    expect(plugin.state.mutationPending).toBe(false);
  });

  it('should discard every queued old root mutation and clear old root projections synchronously', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const terms = [];
    app.readingDecorations = { register: () => ({ setTerms: (next) => { terms.push(next); return true; }, dispose() {} }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    let releaseMutation;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const calls = [];
    plugin.reviewStore.mutateReview = vi.fn(async (operation) => {
      calls.push(operation.word);
      markStarted();
      await new Promise((resolve) => { releaseMutation = resolve; });
      return { review: { version: 1, cards: { [operation.word]: { state: 'Learning' } }, flags: {} }, previousCard: null, rootChanged: false };
    });
    const first = plugin.rateWord('alpha', 'Good', 'flip');
    await started;
    const second = plugin.rateWord('beta', 'Good', 'flip');
    plugin.state.invalid = [{ path: 'old.md' }];
    plugin.state.recommendations = { items: [{ path: 'old.md' }] };
    plugin.latestReadingEvent = { path: 'old.md' };
    plugin.readingUndoSnapshots.set('alpha', { logId: 'old' });
    app.storage.setRoot('root-b');
    const rootChange = app.events.find((event) => event.name === 'knowledge.root-changed').listener();
    expect(plugin.state.entries).toEqual([]);
    expect(plugin.state.invalid).toEqual([]);
    expect(plugin.state.recommendations).toBeNull();
    expect(plugin.latestReadingEvent).toBeNull();
    expect(plugin.readingUndoSnapshots.size).toBe(0);
    expect(terms.at(-1)).toEqual([]);
    releaseMutation();
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    await rootChange;
    expect(calls).toEqual(['alpha']);
  });

  it('should discard a delayed earlier root reload after a newer root generation has loaded', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const plugin = new module.default(fullApp(), { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    let releaseFirst;
    let calls = 0;
    plugin.reviewStore.reloadForRootChange = vi.fn(() => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { releaseFirst = () => resolve({ version: 1, cards: { old: { state: 'New' } }, flags: {} }); });
      return Promise.resolve({ version: 1, cards: { current: { state: 'New' } }, flags: {} });
    });
    const listener = plugin.app.events.find((event) => event.name === 'knowledge.root-changed').listener;
    const first = listener();
    const second = listener();
    await second;
    expect(plugin.state.review.cards.current).toBeTruthy();
    releaseFirst();
    await first;
    expect(plugin.state.review.cards.old).toBeUndefined();
    expect(plugin.state.review.cards.current).toBeTruthy();
  });

  it('should stop stale index and recommender continuations at their generation boundaries', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const plugin = new module.default(fullApp(), { id: 'dev.auton.english-vocab' });
    await plugin.onload();

    let releaseMoved;
    plugin.rootMoved = () => new Promise((resolve) => { releaseMoved = resolve; });
    const staleIndex = plugin.refreshIndex(plugin.rootGeneration);
    plugin.invalidateRoot();
    releaseMoved(false);
    await staleIndex;

    plugin.reviewStore.reloadForRootChange = async () => ({ version: 1, cards: {}, flags: {} });
    let releaseReload;
    plugin.recommender = { reload: () => new Promise((resolve) => { releaseReload = resolve; }) };
    const generation = plugin.invalidateRoot();
    const staleRecommendations = plugin.handleRootChanged(generation);
    await Promise.resolve();
    await Promise.resolve();
    plugin.invalidateRoot();
    releaseReload();
    await staleRecommendations;
    expect(plugin.state.entries).toEqual([]);
  });

  it('should keep automatic review modes out of saved preferences and persist only an explicit click', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    plugin.saveData = vi.fn(async () => undefined);
    await plugin.onload();
    plugin.state.entries = [
      { word: 'candid', definition: '坦率的', examples: [] },
      { word: 'run', pos: 'verb', definition: '跑', examples: ['I run daily.'] },
    ];
    plugin.state.review = { version: 1, cards: {}, flags: {} };
    const container = document.createElement('div');
    app.panels[0].render(container);
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('翻卡');
    plugin.state.review.flags.candid = 'ignored';
    plugin.emitState();
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('语境');
    expect(plugin.saveData).not.toHaveBeenCalled();
    [...container.querySelectorAll('.ev-mode button')].find((node) => node.textContent === '翻卡').click();
    await Promise.resolve();
    expect(plugin.saveData).toHaveBeenCalledWith(expect.objectContaining({ reviewMode: 'flip' }));
  });

  it('should load and merge review mode preferences without erasing unrelated data', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    plugin.loadData = vi.fn(async () => ({ reviewMode: 'reverse', custom: 'keep-me' }));
    plugin.saveData = vi.fn(async () => undefined);
    await plugin.onload();
    expect(plugin.state.reviewMode).toBe('reverse');
    await plugin.panelState().onReviewModeChange('context');
    expect(plugin.saveData).toHaveBeenLastCalledWith(expect.objectContaining({ reviewMode: 'context', custom: 'keep-me' }));
  });

  it('should speak sentences with an English voice and expose speech cancellation', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const plugin = new module.default(fullApp(), { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    const englishVoice = { lang: 'en-GB', name: 'English' };
    globalThis.speechSynthesis = { getVoices: () => [{ lang: 'ko-KR' }, englishVoice], cancel: vi.fn(), speak: vi.fn() };
    globalThis.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
    const controls = plugin.panelState();
    controls.speakSentence('She was running late.');
    const utterance = globalThis.speechSynthesis.speak.mock.calls[0][0];
    expect(utterance).toMatchObject({ text: 'She was running late.', lang: 'en-GB', voice: englishVoice });
    controls.cancelSpeech();
    expect(globalThis.speechSynthesis.cancel).toHaveBeenCalledTimes(2);
    delete globalThis.speechSynthesis;
    delete globalThis.SpeechSynthesisUtterance;
    expect(controls.speakSentence('No runtime voice.')).toBe(false);
    controls.cancelSpeech();
  });

  it('should reject invalid review modes and keep visible state when preference saving fails', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const plugin = new module.default(fullApp(), { id: 'dev.auton.english-vocab' });
    plugin.loadData = vi.fn(async () => ({}));
    plugin.saveData = vi.fn(async () => { throw new Error('disk full'); });
    await plugin.onload();
    await expect(plugin.setReviewMode('unknown')).resolves.toBe(false);
    await expect(plugin.setReviewMode('context')).resolves.toBe(false);
    expect(plugin.state.reviewMode).toBe('context');
    globalThis.speechSynthesis = { getVoices: () => [{ lang: 'ko-KR' }], cancel: vi.fn(), speak: vi.fn() };
    globalThis.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
    expect(plugin.speakEnglish('Run.')).toBe(false);
    delete globalThis.speechSynthesis;
    delete globalThis.SpeechSynthesisUtterance;
  });

  it('should reread the latest note and propose only path and appended content when adding an example', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const proposals = [];
    app.knowledge.propose = vi.fn(async (proposal) => {
      proposals.push(proposal);
      return appliedProposal(app, proposal, 'added');
    });
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    const receipt = await plugin.addExampleSentence('alpha', {
      sentence: 'Alpha appears here.',
      source: { kind: 'document', path: 'wiki/read.md', title: 'Read' },
    });
    expect(receipt).toMatchObject({ outcome: 'applied' });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].changes[0]).toEqual({
      path: 'wiki/vocab/alpha.md',
      newContent: expect.stringContaining('- Alpha appears here. — [Read](wiki/read.md)'),
    });
    expect(proposals[0].changes[0]).not.toHaveProperty('expectedRevision');
  });

  it('should skip proposals when the latest note already contains the normalized example sentence', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const content = buildNote({ word: 'alpha', definition: '字母', example: 'Alpha appears here.' }).replace('Alpha appears here.', 'Alpha   appears here.');
    app.knowledge.readDocument = vi.fn(async (request) => ({
      meta: { path: request.path, title: 'Alpha', revision: { contentHash: 'new', mtimeMs: 2 } },
      content,
      headings: [],
      links: [],
      citations: [],
    }));
    app.knowledge.propose = vi.fn();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await expect(plugin.addExampleSentence('alpha', { sentence: ' Alpha appears   here. ' })).resolves.toMatchObject({ outcome: 'exists' });
    expect(app.knowledge.propose).not.toHaveBeenCalled();
  });

  it('should return controlled receipts when adding an example cannot read parse or submit', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await expect(plugin.addExampleSentence('missing', { sentence: 'Missing.' })).resolves.toMatchObject({ outcome: 'aborted' });
    app.knowledge.readDocument = async () => { throw new Error('read failed'); };
    await expect(plugin.addExampleSentence('alpha', { sentence: 'Alpha new.' })).resolves.toMatchObject({ outcome: 'aborted', summary: 'read failed' });
    app.knowledge.readDocument = async () => ({ _tag: 'Err', error: { code: 'DENIED', message: 'denied' } });
    await expect(plugin.addExampleSentence('alpha', { sentence: 'Alpha new.' })).resolves.toMatchObject({ outcome: 'aborted', summary: 'denied' });
    app.knowledge.readDocument = async () => ({ meta: { path: 'wiki/vocab/alpha.md', title: 'Alpha', revision: { contentHash: 'x', mtimeMs: 1 } }, content: 'broken', headings: [], links: [], citations: [] });
    await expect(plugin.addExampleSentence('alpha', { sentence: 'Alpha new.' })).resolves.toMatchObject({ outcome: 'aborted', summary: 'missing frontmatter' });
    app.knowledge.readDocument = async () => ({ meta: { path: 'wiki/vocab/alpha.md', title: 'Alpha', revision: { contentHash: 'x', mtimeMs: 1 } }, content: buildNote({ word: 'alpha', definition: '字母' }), headings: [], links: [], citations: [] });
    app.knowledge.propose = async () => ({ _tag: 'Err', error: { code: 'BUSY', message: 'busy' } });
    await expect(plugin.addExampleSentence('alpha', { sentence: 'Alpha new.', source: { url: 'https://example.com/a' } })).resolves.toMatchObject({ outcome: 'aborted', summary: 'busy' });
    await expect(plugin.addExampleSentence('alpha', { sentence: '   ' })).resolves.toMatchObject({ outcome: 'exists' });
  });

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
    expect(app.events.map((event) => event.name)).toEqual(['knowledge.index-changed', 'knowledge.root-changed', 'appearance.locale-changed']);
    const rendered = document.createElement('div');
    app.panels[0].render(rendered);
    expect(rendered.textContent).toContain('今日复习');
    expect(rendered.querySelector('h2')).toBeNull();
    const state = plugin.panelState();
    expect(state.canOpenReadingDocument()).toBe(false);
    expect(state.openReadingDocument('wiki/read.md')).toBe(false);
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

  it('should fall back to lemma-only reading terms and notify once when the host rejects a large term set', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const handle = { setTerms: vi.fn((terms) => terms.every((term) => term.surface === term.key)), dispose: vi.fn() };
    app.readingDecorations = { register: () => handle };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    expect(handle.setTerms.mock.calls.some(([terms]) => terms.some((term) => term.surface !== term.key))).toBe(true);
    expect(handle.setTerms.mock.calls.some(([terms]) => terms.length > 0 && terms.every((term) => term.surface === term.key))).toBe(true);
    plugin.updateReadingTerms();
    expect(app.notices.filter((item) => item.message.includes('生词本过大'))).toHaveLength(1);
  });

  it('should notify once when reading terms are truncated before the host accepts them', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const handle = { setTerms: vi.fn(() => true), dispose: vi.fn() };
    app.readingDecorations = { register: () => handle };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    const wordAt = (number) => {
      let value = number;
      let word = '';
      do { word = String.fromCharCode(97 + (value % 26)) + word; value = Math.floor(value / 26); } while (value > 0);
      return `term-${word}`;
    };
    plugin.state.entries = Array.from({ length: 100001 }, (_, index) => ({ word: wordAt(index), definition: 'n. term' }));
    plugin.updateReadingTerms();
    expect(handle.setTerms.mock.calls.at(-1)[0]).toHaveLength(100000);
    expect(app.notices.filter((item) => item.message.includes('生词本过大'))).toHaveLength(1);
  });

  it('should keep activation successful when initial recommendations reject', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.workspace = { scope: () => ({ epoch: 'e1' }) };
    const listDocuments = app.knowledge.listDocuments;
    let calls = 0;
    app.knowledge.listDocuments = async () => {
      calls += 1;
      if (calls > 1) throw new Error('offline');
      return listDocuments();
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await expect(plugin.onload()).resolves.toBeUndefined();
    expect(app.panels).toHaveLength(1);
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(plugin.readingUndoSnapshots.has('alpha')).toBe(true);
    container.querySelector('[data-role="undo"]').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(plugin.readingUndoSnapshots.has('alpha')).toBe(false);
  });

  it('should wire registered uncollected reading cards to plugin dictionary callbacks', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const registrations = [];
    const app = fullApp();
    app.readingDecorations = {
      register(spec) {
        registrations.push(spec);
        return { setTerms: vi.fn(() => true), setLookupAnyWord: vi.fn(() => true), dispose: vi.fn() };
      },
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    plugin.lookupDictionary = async (word) => (word === 'missing' ? null : { surface: word, lemma: 'run', entry: { t: 'v. 跑', d: 'move fast' } });
    plugin.collectDictionaryWord = vi.fn(async () => ({ outcome: 'timeout', summary: 'slow', reason: 'slow' }));
    const container = document.createElement('div');
    registrations[0].renderCard(container, { word: 'ran', key: 'ran', tone: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    container.querySelector('[data-role="collect-dictionary-word"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plugin.collectDictionaryWord).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('未审阅：slow');

    const missing = document.createElement('div');
    registrations[0].renderCard(missing, { word: 'missing', key: 'missing', tone: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    [...missing.querySelectorAll('button')].find((node) => node.textContent === '让 Agent 解释').click();
    expect(app.chat.text).toContain('missing');
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
    expect(saved.at(-1)).toMatchObject({ highlight: false, lookupAnyWord: true, levelSettings: expect.any(Object), lookupNoticeShown: expect.any(Boolean) });
    expect(registrations[0].disposed).toBe(false);
    await plugin.setHighlight(true);
    expect(saved.at(-1)).toMatchObject({ highlight: true, lookupAnyWord: true });
    expect(registrations).toHaveLength(1);
  });

  it('should enable lookup-any-word when supported, persist preferences by merging fields, and show the first notice once', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const saved = [];
    const registrations = [];
    const app = fullApp();
    app.readingDecorations = {
      register() {
        const handle = {
          setTerms: vi.fn(() => true),
          setLookupAnyWord: vi.fn(() => true),
          setWebLookup: vi.fn(() => true),
          dispose: vi.fn(),
        };
        registrations.push(handle);
        return handle;
      },
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    plugin.loadData = async () => ({ highlight: true, lookupAnyWord: true, levelSettings: { vocabularySize: 5000, easyMax: 2, goodMax: 5 }, custom: 'kept' });
    plugin.saveData = async (data) => saved.push(data);
    await plugin.onload();
    expect(registrations[0].setLookupAnyWord).toHaveBeenCalledWith(true);
    expect(registrations[0].setWebLookup).toHaveBeenCalledWith(true);
    expect(app.notices.some((item) => item.message.includes('任意英文词'))).toBe(true);
    expect(saved.at(-1)).toMatchObject({ custom: 'kept', highlight: true, lookupAnyWord: true, lookupNoticeShown: true });
    await plugin.setLookupAnyWord(false);
    expect(registrations[0].setWebLookup).toHaveBeenLastCalledWith(false);
    expect(saved.at(-1)).toMatchObject({ custom: 'kept', lookupAnyWord: false, highlight: true });
  });

  it('should skip web lookup registration when the host does not expose setWebLookup', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const handle = { setTerms: vi.fn(() => true), setLookupAnyWord: vi.fn(() => true), dispose: vi.fn() };
    app.readingDecorations = { register: vi.fn(() => handle) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await expect(plugin.onload()).resolves.toBeUndefined();
    expect(handle.setLookupAnyWord).toHaveBeenCalledWith(true);
  });

  it('should dispose reading decorations when both highlighting and lookup-any-word are off', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const handles = [];
    const app = fullApp();
    app.readingDecorations = {
      register() {
        const handle = { setTerms: vi.fn(() => true), setLookupAnyWord: vi.fn(() => true), dispose: vi.fn() };
        handles.push(handle);
        return handle;
      },
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    plugin.loadData = async () => ({ highlight: false, lookupAnyWord: false, lookupNoticeShown: true });
    await plugin.onload();
    expect(handles).toHaveLength(0);
    await plugin.setLookupAnyWord(true);
    expect(handles).toHaveLength(1);
    await plugin.setLookupAnyWord(false);
    expect(handles[0].dispose).toHaveBeenCalledOnce();
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
    expect(app.readingDecorations.register).toHaveBeenCalledOnce();
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
    const mutate = plugin.reviewStore.mutateReview.bind(plugin.reviewStore);
    plugin.reviewStore.mutateReview = vi.fn(mutate);
    expect(await plugin.undoReadingRating('alpha')).toBe(true);
    expect(plugin.reviewStore.mutateReview).toHaveBeenCalledWith(expect.objectContaining({ type: 'restoreCardIfFingerprint', expectedFingerprint: expect.any(String) }));
    expect(plugin.state.review.cards.alpha).toBeUndefined();
    const log = JSON.parse(app.storage.writes.filter((item) => item.name === 'log.json').at(-1).text);
    expect(log.at(-1)).toMatchObject({ word: 'alpha', undoOf: log[0].id, mode: 'reading-card' });
  });

  it('should rebuild localized panel command selection and reading registrations when locale changes', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.workspace = { scope: () => ({ epoch: 'locale-epoch' }) };
    const suggestionHandles = [];
    app.learningSuggestions = { register: vi.fn(() => {
      const handle = { set: vi.fn(), dispose: vi.fn() };
      suggestionHandles.push(handle);
      return handle;
    }) };
    const readingHandles = [];
    const readingSpecs = [];
    app.readingDecorations = { register: vi.fn((spec) => {
      readingSpecs.push(spec);
      const handle = { setTerms: vi.fn(() => true), dispose: vi.fn() };
      readingHandles.push(handle);
      return handle;
    }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    const rendered = document.createElement('div');
    app.panels.at(-1).render(rendered);
    expect(rendered.textContent).toContain('今日复习');
    await app.events.find((event) => event.name === 'appearance.locale-changed').listener({ locale: 'en' });
    expect(plugin.locale).toBe('en');
    expect(app.commands.at(-1).title).toContain('start review');
    expect(app.selectionActions.items.at(-1).title).toBe('Add to vocabulary');
    expect(readingHandles[0].dispose).toHaveBeenCalledOnce();
    expect(readingHandles).toHaveLength(2);
    expect(suggestionHandles[0].dispose).toHaveBeenCalledOnce();
    expect(suggestionHandles).toHaveLength(2);
    expect(rendered.textContent).toContain('Today');
    const card = document.createElement('div');
    readingSpecs.at(-1).renderCard(card, { word: 'alpha', key: 'alpha', tone: 'learning' });
    expect(card.textContent).toContain('I know it');
    await app.tools.get('vocab_add').run({ entries: [{ word: 'beta', definition: 'test' }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(app.notices.some((item) => item.message.includes('Vocabulary proposal'))).toBe(true);
    await app.events.find((event) => event.name === 'appearance.locale-changed').listener('unsupported');
    expect(plugin.locale).toBe('en');
  });

  it('should restore the previous card when undoing a reading-card rating on a reviewed word', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.readingDecorations = { register: () => ({ setTerms: vi.fn(() => true), dispose: vi.fn() }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    const previous = { ...newSerializedCard(new Date('2026-10-01T00:00:00Z')), state: 'Review', stability: 2, due: '2031-01-01T00:00:00.000Z', last_review: '2026-10-01T00:00:00.000Z' };
    plugin.state.review = { version: 1, cards: { alpha: previous }, flags: {} };
    plugin.reviewStore.review = plugin.state.review;
    await plugin.rateWord('alpha', 'Again', 'reading-card');
    await plugin.undoReadingRating('alpha');
    expect(plugin.state.review.cards.alpha).toEqual(previous);
  });

  it('should reject reading undo snapshots after root changes or successor card changes', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.readingDecorations = { register: () => ({ setTerms: vi.fn(() => true), dispose: vi.fn() }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await plugin.rateWord('alpha', 'Good', 'reading-card');
    plugin.reviewStore.review.cards.alpha = { ...plugin.reviewStore.review.cards.alpha, due: '2035-01-01T00:00:00.000Z' };
    plugin.state.review = plugin.reviewStore.review;
    expect(await plugin.undoReadingRating('alpha')).toBe(false);
    await plugin.rateWord('alpha', 'Good', 'reading-card');
    app.storage.setRoot('root-b');
    await plugin.handleRootChanged();
    expect(plugin.readingUndoSnapshots.size).toBe(0);
    expect(await plugin.undoReadingRating('alpha')).toBe(false);
  });

  it('should avoid keeping an undo snapshot when a rating reports a root change', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const plugin = new module.default(fullApp(), { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    plugin.reviewStore.mutateReview = vi.fn(async () => ({ review: { version: 1, cards: {}, flags: {} }, previousCard: null, rootChanged: true }));
    expect(await plugin.rateWord('alpha', 'Good', 'reading-card')).toBe(false);
    expect(plugin.readingUndoSnapshots.size).toBe(0);
  });

  it('should notify when undoing a reading-card rating fails or races a root change', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.readingDecorations = { register: () => ({ setTerms: vi.fn(() => true), dispose: vi.fn() }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await plugin.rateWord('alpha', 'Good', 'reading-card');
    plugin.reviewStore.mutateReview = async () => { throw new Error('bad'); };
    expect(await plugin.undoReadingRating('alpha')).toBe(false);
    expect(app.notices.some((item) => item.message.includes('保存失败'))).toBe(true);

    plugin.reviewStore.mutateReview = async () => ({ review: { version: 1, cards: {}, flags: {} }, rootChanged: true });
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

  it('should submit dictionary collection as a knowledge proposal with note metadata and skip existing words', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const proposals = [];
    const app = fullApp();
    app.knowledge.propose = async (proposal) => {
      proposals.push(proposal);
      return appliedProposal(app, proposal, 'accepted');
    };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    const receipt = await plugin.collectDictionaryWord(
      { surface: 'ran', lemma: 'run', entry: { p: 'rʌn', t: 'v. 跑\nn. 路程', d: 'move fast', x: '0:run' } },
      { sentence: 'I ran home.', source: { kind: 'document', path: 'wiki/read.md', title: 'Read' } },
    );
    expect(receipt).toMatchObject({ outcome: 'applied' });
    expect(proposals[0].changes[0].path).toBe('wiki/vocab/run.md');
    expect(proposals[0].changes[0].newContent).toContain('word: "run"');
    expect(proposals[0].changes[0].newContent).toContain('phonetic: "rʌn"');
    expect(proposals[0].changes[0].newContent).toContain('pos: "verb"');
    expect(proposals[0].changes[0].newContent).toContain('I ran home.');
    expect(proposals[0].changes[0].newContent).toContain('[Read](wiki/read.md)');
    expect(await plugin.collectDictionaryWord({ surface: 'alpha', lemma: 'alpha', entry: { t: 'n. 字母', d: 'letter' } })).toMatchObject({ outcome: 'aborted' });
    expect(proposals).toHaveLength(1);
  });

  it('should write a web url source when collecting a dictionary word from web lookup', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const proposals = [];
    app.knowledge.propose = vi.fn(async (proposal) => {
      proposals.push(proposal);
      return appliedProposal(app, proposal, 'accepted');
    });
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await plugin.collectDictionaryWord(
      { surface: 'serendipity', lemma: 'serendipity', entry: { t: 'n. 意外发现美好事物', d: 'a fortunate discovery' } },
      {
        sentence: 'It was pure serendipity.',
        source: {
          kind: 'web',
          url: 'https://example.com/article',
          title: 'Article',
          ownerPluginId: 'dev.auton.browser-panel',
        },
      },
    );
    expect(proposals[0].changes[0].newContent).toContain('- It was pure serendipity. — [Article](https://example.com/article)');
  });

  it('should write a web url source when adding an example from web lookup', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const proposals = [];
    app.knowledge.propose = vi.fn(async (proposal) => {
      proposals.push(proposal);
      return appliedProposal(app, proposal, 'added');
    });
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await plugin.addExampleSentence('alpha', {
      sentence: 'Alpha appears on the web.',
      source: {
        kind: 'web',
        url: 'https://example.com/alpha',
        title: 'Alpha page',
        ownerPluginId: 'dev.auton.browser-panel',
      },
    });
    expect(proposals[0].changes[0].newContent).toContain('- Alpha appears on the web. — [Alpha page](https://example.com/alpha)');
  });

  it('should deduplicate an example by sentence when web source differs', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    const content = buildNote({
      word: 'alpha',
      definition: '字母',
      example: 'Alpha appears here.',
      source: { path: 'wiki/read.md', title: 'Read' },
    });
    app.knowledge.readDocument = vi.fn(async ({ path }) => ({
      meta: { path, title: 'Alpha', revision: { contentHash: 'new', mtimeMs: 2 } },
      content,
      headings: [],
      links: [],
      citations: [],
    }));
    app.knowledge.propose = vi.fn();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await expect(plugin.addExampleSentence('alpha', {
      sentence: 'Alpha appears here.',
      source: { kind: 'web', url: 'https://example.com/alpha', title: 'Alpha page', ownerPluginId: 'dev.auton.browser-panel' },
    })).resolves.toMatchObject({ outcome: 'exists' });
    expect(app.knowledge.propose).not.toHaveBeenCalled();
  });

  it('should handle dictionary proposal errors and explain words without a sentence', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.knowledge.propose = async () => ({ _tag: 'Err', error: 'denied' });
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await expect(plugin.collectDictionaryWord(null)).resolves.toMatchObject({ outcome: 'aborted' });
    await expect(plugin.collectDictionaryWord({ surface: 'void', lemma: 'void', entry: { d: 'empty' } })).resolves.toMatchObject({ outcome: 'aborted', summary: 'denied' });
    plugin.explainDictionaryWord('void');
    expect(app.chat.text).toContain('void');
  });

  it('should abort dictionary collection when path probing returns a non not-found error', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.knowledge.readDocument = async () => ({ _tag: 'Err', error: { code: 'READ_FAILED', message: 'cannot inspect path' } });
    app.knowledge.propose = vi.fn();
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    await expect(plugin.collectDictionaryWord({ surface: 'beta', lemma: 'beta', entry: { t: 'n. 测试' } })).resolves.toMatchObject({ outcome: 'aborted', summary: 'cannot inspect path' });
    expect(app.knowledge.propose).not.toHaveBeenCalled();
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
    expect(plugin.state.log).toEqual([expect.objectContaining({ word: 'alpha', rating: 'Good' })]);
    expect(app.storage.writes.some((item) => item.name === 'review.json')).toBe(true);
    expect(JSON.parse(app.storage.writes.filter((item) => item.name === 'review.json').at(-1).text).pendingLogs).toHaveLength(1);
    expect(app.notices.some((item) => item.message.includes('日志'))).toBe(true);
    await plugin.setFlag('alpha', 'ignored');
    expect(plugin.state.review.flags.alpha).toBe('ignored');
    expect(plugin.state.log).toEqual([expect.objectContaining({ word: 'alpha', rating: 'Good' })]);
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

  it('should fully recover the new root after rating or flagging detects a silent root switch', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    for (const action of ['rate', 'flag']) {
      const app = fullApp();
      const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
      await plugin.onload();
      app.storage.setRoot('root-b');
      const betaCard = newSerializedCard(new Date('2026-10-15T00:00:00Z'));
      await app.storage.write('root-b', 'review.json', JSON.stringify({ version: 1, cards: { beta: betaCard }, flags: {} }), { expectedRevision: null });
      app.knowledge.listDocuments = async () => [{ path: 'wiki/vocab/beta.md', title: 'Beta', revision: { contentHash: 'b' } }];
      app.knowledge.readDocument = async () => ({ meta: { title: 'Beta' }, content: buildNote({ word: 'beta', definition: '贝塔' }) });
      const result = action === 'rate'
        ? await plugin.rateWord('alpha', 'Good', 'flip')
        : await plugin.setFlag('alpha', 'ignored');
      expect(result).toBe(false);
      expect(plugin.state.review.cards.beta).toEqual(betaCard);
      expect(plugin.state.entries.map((entry) => entry.word)).toEqual(['beta']);
      expect(plugin.reviewStore.rootGeneration).toBe('root-b');
    }
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
    const byRoot = { 'root-a': JSON.stringify({ version: 1, cards: { alpha: { ...newSerializedCard(new Date('2026-10-01T00:00:00Z')), state: 'Review', stability: 2, due: '2031-01-01T00:00:00.000Z', last_review: '2026-10-01T00:00:00.000Z' } }, flags: {} }) };
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

  it('should clear recommendation loading preserve prior results and notify when manual refresh fails', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.workspace = { scope: () => ({ epoch: 'epoch-1' }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    const previous = { stale: false, items: [{ title: 'Previous' }], skipped: {} };
    plugin.state.recommendations = previous;
    plugin.recommender.recommend = async () => { throw new Error('offline'); };
    await expect(plugin.refreshRecommendations()).resolves.toBeNull();
    expect(plugin.state.recommendationLoading).toBeNull();
    expect(plugin.state.recommendations).toBe(previous);
    expect(app.notices.some((item) => item.message.includes('推荐阅读刷新失败'))).toBe(true);
  });

  it('should keep the newest same-epoch recommendation result when requests finish out of order', async () => {
    vi.resetModules();
    const module = await import('../src/main.mjs');
    const app = fullApp();
    app.workspace = { scope: () => ({ epoch: 'epoch-1' }) };
    const plugin = new module.default(app, { id: 'dev.auton.english-vocab' });
    await plugin.onload();
    const resolvers = [];
    plugin.recommender.recommend = () => new Promise((resolve) => resolvers.push(resolve));
    const suggestions = [];
    plugin.learningSuggestionsHandle = { set: (...args) => suggestions.push(args) };
    const older = plugin.refreshRecommendations();
    const newer = plugin.refreshRecommendations();
    resolvers[1]({ stale: false, items: [{ title: 'new', path: 'wiki/new.md', band: 'good', bandLabel: '适合', rate: 3 }], skipped: {} });
    await newer;
    resolvers[0]({ stale: false, items: [{ title: 'old', path: 'wiki/old.md', band: 'good', bandLabel: '适合', rate: 3 }], skipped: {} });
    await older;
    expect(plugin.state.recommendations.items[0].title).toBe('new');
    expect(suggestions).toHaveLength(1);
    expect(plugin.state.recommendationLoading).toBeNull();
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
