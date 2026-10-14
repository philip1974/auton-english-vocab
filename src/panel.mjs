import { dueQueue } from './scheduler.mjs';
import { familiarityFor } from './familiarity.mjs';
import { assertEnglishWord } from './note-format.mjs';
import { uiText, currentLocale } from './ui-text.mjs';
import { requestTextForWord, requestTextFromSelection } from './request-text.mjs';
import { validateLevelSettings } from './reading-level.mjs';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, onClick, className = '') {
  const node = el('button', `ev-button${className ? ` ${className}` : ''}`, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function cloze(example, word) {
  if (!example) return '';
  return example.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '_____');
}

export function hasRequiredHost(app) {
  return Boolean(app.storage && app.selectionActions && app.chat);
}

export function renderPanel(container, controls) {
  const t = uiText(currentLocale());
  const read = () => controls.getState?.() ?? controls;
  container.textContent = '';
  container.className = 'english-vocab-panel';
  if (!hasRequiredHost(controls.app)) {
    container.append(el('p', 'ev-warning', t.needsHost));
    return () => { container.textContent = ''; };
  }
  const tabs = el('div', 'ev-tabs');
  const body = el('div', 'ev-body');
  const toolbar = el('div', 'ev-toolbar');
  let mode = 'flip';
  let tab = 'today';
  let flipped = false;
  let lastSpokenWord = null;

  const review = (rating) => {
    const state = read();
    const item = dueQueue(state.entries, state.review, { log: state.log })[0];
    if (!item) return;
    controls.onReview?.(item.word, rating, mode);
    flipped = false;
    rerender();
  };

  const ratingRow = () => {
    const row = el('div', 'ev-rating');
    row.append(
      button(`1 ${t.again}`, () => review('Again'), 'ev-rating-again'),
      button(`2 ${t.hard}`, () => review('Hard')),
      button(`3 ${t.good}`, () => review('Good')),
      button(`4 ${t.easy}`, () => review('Easy'), 'ev-rating-easy'),
    );
    return row;
  };

  const renderToday = (state) => {
    const modeRow = el('div', 'ev-mode');
    for (const [id, label] of [['flip', t.flip], ['reverse', t.reverse], ['listening', t.listening]]) {
      const item = button(label, () => { mode = id; flipped = false; rerender(); });
      item.disabled = id === 'listening' && !controls.hasEnglishVoice?.();
      if (id === mode) item.setAttribute('aria-pressed', 'true');
      modeRow.append(item);
    }
    body.append(modeRow);
    const hasProgress = Object.keys(state.review.cards).length > 0 || Object.keys(state.review.flags).length > 0 || state.log.length > 0;
    if (state.entries.length > 0 && !hasProgress) body.append(el('p', 'ev-note', t.emptyProgress));
    if (mode === 'listening') body.append(el('p', 'ev-note', controls.hasEnglishVoice?.() ? t.listeningInterrupts : t.noEnglishVoice));
    const item = dueQueue(state.entries, state.review, { log: state.log })[0];
    if (!item) {
      body.append(el('p', 'ev-empty', t.noCards));
      return;
    }
    if (mode === 'listening' && lastSpokenWord !== item.word) {
      lastSpokenWord = item.word;
      controls.speak?.(item.word);
    }
    const card = el('section', 'ev-card');
    const example = item.examples?.[0] || item.example || '';
    if (mode === 'flip') {
      card.append(el('h3', 'ev-review-word', item.word), el('p', 'ev-example', cloze(example, item.word)));
      if (flipped) card.append(el('p', 'ev-definition', item.definition), ratingRow());
      else card.append(button(t.answer, () => { flipped = true; rerender(); }));
    } else {
      card.append(el('p', 'ev-definition', item.definition), el('p', '', cloze(example, item.word)));
      const input = el('input', 'ev-input');
      input.placeholder = t.spellingPlaceholder;
      const submit = () => review(input.value.trim().toLowerCase() === item.word ? 'Good' : 'Again');
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
      card.append(input, button(t.answer, submit));
      if (mode === 'listening') card.append(button(t.replay, () => controls.speak?.(item.word)));
    }
    body.append(card);
  };

  const renderNotebook = (state) => {
    const addRow = el('div', 'ev-add');
    const addInput = el('input', 'ev-input');
    addInput.placeholder = t.addWord;
    addInput.dataset.role = 'manual-word';
    addRow.append(addInput, button(t.add, () => {
      let word;
      try { word = assertEnglishWord(addInput.value); } catch { controls.notify?.(t.invalidManualWord); return; }
      if (!controls.app.chat.appendToComposer(requestTextForWord(word, currentLocale()))) controls.notify?.(t.collectFailed);
    }));
    const search = el('input', 'ev-input');
    search.placeholder = t.search;
    const filter = el('select', 'ev-input');
    for (const key of ['all', 'new', 'learning', 'familiar', 'mastered', 'ignored']) {
      const option = el('option', '', t[key]);
      option.value = key;
      filter.append(option);
    }
    const list = el('div', 'ev-list');
    const draw = () => {
      list.textContent = '';
      const current = { entries: [], review: { cards: {}, flags: {} }, ...read() };
      const q = search.value.trim().toLowerCase();
      for (const entry of current.entries) {
        const fam = familiarityFor(current.review.cards[entry.word], current.review.flags[entry.word]);
        if ((q && !entry.word.includes(q)) || (filter.value !== 'all' && fam !== filter.value)) continue;
        const row = el('div', 'ev-row');
        const head = el('div', 'ev-row-head');
        head.append(el('strong', 'ev-row-word', entry.word), el('small', 'ev-badge', t[fam] || fam));
        const actions = el('div', 'ev-row-actions');
        const flag = current.review.flags[entry.word];
        if (flag !== 'mastered') actions.append(button(t.markMastered, () => setFlag(entry.word, 'mastered')));
        if (flag !== 'ignored') actions.append(button(t.ignore, () => setFlag(entry.word, 'ignored')));
        if (flag === 'mastered' || flag === 'ignored') actions.append(button(t.restore, () => setFlag(entry.word, undefined)));
        row.append(head, el('div', 'ev-row-definition', entry.definition), actions);
        list.append(row);
      }
    };
    const setFlag = (word, flag) => {
      if (controls.onFlag) controls.onFlag(word, flag);
      else if (flag) state.review.flags[word] = flag;
      else delete state.review.flags[word];
      draw();
    };
    search.addEventListener('input', draw);
    filter.addEventListener('change', draw);
    body.append(addRow, search, filter, list);
    draw();
  };

  const renderRecommendations = (state) => {
    const settings = state.levelSettings;
    const settingsBox = el('section', 'ev-settings');
    settingsBox.append(el('h3', '', t.readingSettings));
    const vocab = el('select', 'ev-input');
    for (const value of [1000, 2000, 3000, 5000, 8000, 12000, 20000]) {
      const option = el('option', '', String(value));
      option.value = String(value);
      option.selected = value === settings.vocabularySize;
      vocab.append(option);
    }
    const easy = el('input', 'ev-input');
    easy.type = 'number';
    easy.min = '0';
    easy.max = '20';
    easy.step = '0.5';
    easy.value = String(settings.easyMax);
    const hard = el('input', 'ev-input');
    hard.type = 'number';
    hard.min = '0';
    hard.max = '20';
    hard.step = '0.5';
    hard.value = String(settings.goodMax);
    const save = () => {
      const result = validateLevelSettings({ vocabularySize: Number(vocab.value), easyMax: Number(easy.value), goodMax: Number(hard.value) });
      if (!result.ok) {
        controls.notify?.(t.levelSettingsSaveFailed);
        return;
      }
      controls.onLevelSettingsChange?.(result.settings);
    };
    for (const input of [vocab, easy, hard]) input.addEventListener('change', save);
    const line = el('div', 'ev-setting-line');
    line.append(el('label', '', t.vocabularySize), vocab, el('label', '', t.goodRange), easy, hard);
    settingsBox.append(line, el('p', 'ev-note', t.defaultRangeNote));
    body.append(settingsBox);

    body.append(button(t.refresh, () => controls.refreshRecommendations?.()));
    if (state.recommendationLoading) body.append(el('p', 'ev-note', t.recommendationProgress(state.recommendationLoading.done, state.recommendationLoading.total)));
    const result = state.recommendations;
    if (!result?.items?.length) {
      body.append(el('p', 'ev-empty', t.noRecommendations));
      return;
    }
    const list = el('div', 'ev-list');
    for (const item of result.items) {
      const row = el('article', 'ev-row');
      const head = el('div', 'ev-row-head');
      const title = button(item.title, () => controls.openReadingDocument?.(item.path), 'ev-link-button');
      title.disabled = !controls.canOpenReadingDocument?.();
      head.append(title, el('small', 'ev-badge', `${item.bandLabel} · ${item.rate.toFixed(1)}%`));
      const detail = el('div', 'ev-row-definition', `${t.novelRate}: ${item.topWords.join(', ') || '-'}`);
      row.append(head, detail);
      list.append(row);
    }
    body.append(list);
    const skipped = result.skipped ?? {};
    body.append(el('details', 'ev-skipped'));
    body.lastElementChild.append(el('summary', '', t.skippedSummary(skipped['not-english'] ?? 0, skipped['too-short'] ?? 0)));
  };

  const rerender = () => {
    const state = { entries: [], review: { version: 1, cards: {}, flags: {} }, log: [], loading: null, ...read() };
    toolbar.textContent = '';
    if (controls.app?.readingDecorations) {
      const label = el('label', 'ev-toggle');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.highlight !== false;
      input.dataset.role = 'highlight-reading';
      input.addEventListener('click', () => controls.onHighlightChange?.(input.checked));
      label.append(input, el('span', '', t.highlightReading));
      toolbar.append(label);
    }
    tabs.textContent = '';
    tabs.append(button(t.today, () => { tab = 'today'; rerender(); }), button(t.notebook, () => { tab = 'notebook'; rerender(); }));
    if (controls.app?.workspace?.scope) tabs.append(button(t.recommendations, () => { tab = 'recommendations'; rerender(); }));
    body.textContent = '';
    if (state.loading) body.append(el('p', '', t.loading(state.loading.done, state.loading.total)));
    if (tab === 'today') renderToday(state);
    else if (tab === 'notebook') renderNotebook(state);
    else renderRecommendations(state);
  };

  const onKeydown = (event) => {
    if (tab !== 'today') return;
    if (event.key === ' ') { event.preventDefault(); flipped = true; rerender(); }
    if (flipped && ['1', '2', '3', '4'].includes(event.key)) review(['Again', 'Hard', 'Good', 'Easy'][Number(event.key) - 1]);
  };
  container.addEventListener('keydown', onKeydown);
  container.append(toolbar, tabs, body);
  const unsubscribe = controls.subscribe?.(rerender) ?? (() => undefined);
  rerender();
  return () => {
    unsubscribe();
    container.removeEventListener('keydown', onKeydown);
    container.textContent = '';
  };
}

export function appendSelectionRequest(app, context, notify, locale = currentLocale()) {
  const ok = app.chat.appendToComposer(requestTextFromSelection(context, locale));
  if (!ok) notify?.(uiText(locale).collectFailed);
  return ok;
}
