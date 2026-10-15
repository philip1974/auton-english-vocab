import { activeReviewLog, dueQueue } from './scheduler.mjs';
import { familiarityFor } from './familiarity.mjs';
import { assertEnglishWord, normalizeWord } from './note-format.mjs';
import { uiText, currentLocale } from './ui-text.mjs';
import { requestTextForWord, requestTextFromSelection } from './request-text.mjs';
import { validateLevelSettings } from './reading-level.mjs';
import { clozeSentence, parseExampleLine, pickExample, resolveExampleSourcePath } from './context-cloze.mjs';
import { normalizeDefinitionLine } from './dictionary.mjs';


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

function reviewCount(log, word) {
  return activeReviewLog(log).filter((item) => item?.word === word).length;
}

/** The "From <article>" line under a context sentence: a link when the host can open it, text otherwise. */
function contextSourceRow(source, notePath, controls, t) {
  if (!source) return null;
  const row = el('div', 'ev-context-source');
  row.append(el('span', 'ev-context-source-label', t.sourceLabel));
  const sourcePath = source.path ? resolveExampleSourcePath(notePath, source.path) : null;
  if (sourcePath && controls.canOpenReadingDocument?.()) {
    const link = button(source.title || sourcePath, () => controls.openReadingDocument?.(sourcePath), 'ev-context-source-link');
    link.title = t.openSource;
    row.append(link);
    return row;
  }
  if (source.path) {
    row.append(el('span', 'ev-context-source-text', source.title || source.path));
    return row;
  }
  if (source.url) {
    let host = source.url;
    try { host = new URL(source.url).hostname || source.url; } catch { /* keep the raw url */ }
    const text = el('span', 'ev-context-source-text', source.title || host);
    text.title = source.url;
    row.append(text);
    return row;
  }
  return null;
}

function visibleExample(entry) {
  for (const line of entry?.examples ?? []) {
    const parsed = parseExampleLine(line);
    const clozed = clozeSentence(parsed.sentence, entry);
    if (clozed.hits.length > 0) return { ...parsed, clozed };
  }
  return null;
}

function clozedExampleText(entry) {
  const example = visibleExample(entry);
  return example?.clozed.text ?? '';
}

function appendHighlightedSentence(parent, sentence, hits) {
  let cursor = 0;
  for (const hit of hits) {
    parent.append(document.createTextNode(sentence.slice(cursor, hit.start)));
    parent.append(el('mark', 'ev-context-hit', sentence.slice(hit.start, hit.end)));
    cursor = hit.end;
  }
  parent.append(document.createTextNode(sentence.slice(cursor)));
}

function defaultModeFor(state, item) {
  if (state.reviewMode) return state.reviewMode;
  return pickExample(item, reviewCount(state.log, item.word)) ? 'context' : 'flip';
}

function dictionaryLineGroups(entry, locale) {
  const zh = String(entry?.t ?? '').split('\n').filter(Boolean);
  const en = String(entry?.d ?? '').split('\n').filter(Boolean).map(normalizeDefinitionLine);
  const groups = locale.toLowerCase().startsWith('zh')
    ? [['zh', zh], ['en', en]]
    : [['en', en], ['zh', zh]];
  return groups.filter(([, lines]) => lines.length > 0);
}

function renderDictionaryDefinition(entry, locale) {
  const wrapper = el('div', 'ev-dict-definition');
  for (const [kind, lines] of dictionaryLineGroups(entry, locale)) {
    const group = el('div', `ev-dict-lines ev-dict-lines-${kind}`);
    for (const line of lines) group.append(el('div', 'ev-dict-line', line));
    wrapper.append(group);
  }
  return wrapper;
}

export function hasRequiredHost(app) {
  return Boolean(app.storage && app.selectionActions && app.chat);
}

export function renderPanel(container, controls) {
  let locale = controls.locale ?? currentLocale();
  let t = uiText(locale);
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
  let mode = null;
  let explicitMode = null;
  let renderedWord = null;
  let tab = 'today';
  let flipped = false;
  let lastSpokenWord = null;
  let dictionaryResult = null;
  let dictionaryQuery = '';
  let dictionarySuggestions = [];
  let dictionaryError = null;
  let dictionaryCollecting = false;
  let dictionaryCollectStatus = '';
  let suggestionRequest = 0;
  let lookupRequest = 0;
  let refreshTimer = null;
  let cleaned = false;
  const phonetics = new Map();

  const scheduleReviewRefresh = (state) => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
    if (cleaned || tab !== 'today') return;
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    let wakeAt = midnight.getTime();
    for (const entry of state.entries) {
      const card = state.review.cards && Object.hasOwn(state.review.cards, entry.word) ? state.review.cards[entry.word] : undefined;
      const due = Date.parse(card?.due);
      if (Number.isFinite(due) && due > now.getTime() && due < wakeAt) wakeAt = due;
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      rerender();
    }, Math.max(1, wakeAt - now.getTime()));
    refreshTimer?.unref?.();
  };

  const review = (rating) => {
    const state = read();
    if (state.mutationPending) return;
    const item = dueQueue(state.entries, state.review, { log: state.log })[0];
    if (!item) return;
    controls.cancelSpeech?.();
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
    for (const rating of row.querySelectorAll('button')) rating.disabled = read().mutationPending === true;
    return row;
  };

  const renderToday = (state) => {
    const item = dueQueue(state.entries, state.review, { log: state.log })[0];
    const validModes = ['context', 'flip', 'reverse', 'listening'];
    if (renderedWord !== null && renderedWord !== item?.word) {
      controls.cancelSpeech?.();
      flipped = false;
      lastSpokenWord = null;
    }
    renderedWord = item?.word ?? null;
    if (validModes.includes(state.reviewMode)) {
      explicitMode = state.reviewMode;
    }
    mode = explicitMode ?? (item ? defaultModeFor(state, item) : 'context');
    const modeRow = el('div', 'ev-mode');
    for (const [id, label] of [['context', t.context], ['flip', t.flip], ['reverse', t.reverse], ['listening', t.listening]]) {
      const modeButton = button(label, () => {
        controls.cancelSpeech?.();
        mode = id;
        explicitMode = id;
        flipped = false;
        controls.onReviewModeChange?.(id);
        rerender();
      });
      modeButton.disabled = id === 'listening' && !controls.hasEnglishVoice?.();
      if (id === mode) modeButton.setAttribute('aria-pressed', 'true');
      modeRow.append(modeButton);
    }
    body.append(modeRow);
    const hasProgress = Object.keys(state.review.cards).length > 0 || Object.keys(state.review.flags).length > 0 || state.log.length > 0;
    if (state.entries.length > 0 && !hasProgress) body.append(el('p', 'ev-note', t.emptyProgress));
    if (mode === 'listening') body.append(el('p', 'ev-note', controls.hasEnglishVoice?.() ? t.listeningInterrupts : t.noEnglishVoice));
    if (!item) {
      body.append(el('p', 'ev-empty', state.entries.length === 0 ? t.emptyNotebook : t.noCards));
      return;
    }
    if (mode === 'listening' && lastSpokenWord !== item.word) {
      lastSpokenWord = item.word;
      controls.speak?.(item.word);
    }
    const card = el('section', 'ev-card');
    if (mode === 'context') {
      const picked = pickExample(item, reviewCount(state.log, item.word));
      if (picked) {
        if (!flipped) {
          card.append(el('p', 'ev-context-sentence', picked.cloze.text));
          const sourceRow = contextSourceRow(picked.source, item.path, controls, t);
          if (sourceRow) card.append(sourceRow);
          card.append(button(t.answer, () => { controls.cancelSpeech?.(); flipped = true; rerender(); }));
        } else {
          card.append(el('h3', 'ev-review-word', item.word));
          const phonetic = item.phonetic || phonetics.get(item.word);
          if (phonetic) card.append(el('p', 'ev-reading-phonetic', `/${phonetic}/`));
          if (!item.phonetic && !phonetics.has(item.word) && controls.lookupDictionary) {
            phonetics.set(item.word, '');
            Promise.resolve(controls.lookupDictionary(item.word)).then((result) => {
              phonetics.set(item.word, result?.entry?.p ?? '');
              rerender();
            }).catch(() => undefined);
          }
          card.append(el('p', 'ev-definition', item.definition));
          const sentence = el('p', 'ev-context-answer');
          appendHighlightedSentence(sentence, picked.sentence, picked.cloze.hits);
          card.append(sentence);
          const speak = button(t.speakSentence, () => controls.speakSentence?.(picked.sentence));
          speak.disabled = !controls.hasEnglishVoice?.();
          card.append(speak, ratingRow());
        }
      } else if (!flipped) {
        card.append(el('p', 'ev-definition', item.definition), el('p', 'ev-note', t.noExampleYet), button(t.answer, () => { controls.cancelSpeech?.(); flipped = true; rerender(); }));
      } else {
        card.append(el('h3', 'ev-review-word', item.word), el('p', 'ev-definition', item.definition), ratingRow());
      }
    } else if (mode === 'flip') {
      card.append(el('h3', 'ev-review-word', item.word));
      const example = clozedExampleText(item);
      if (example) card.append(el('p', 'ev-example', example));
      if (flipped) card.append(el('p', 'ev-definition', item.definition), ratingRow());
      else card.append(button(t.answer, () => { controls.cancelSpeech?.(); flipped = true; rerender(); }));
    } else {
      const example = clozedExampleText(item);
      card.append(el('p', 'ev-definition', item.definition));
      if (example) card.append(el('p', 'ev-example', example));
      const input = el('input', 'ev-input');
      input.placeholder = t.spellingPlaceholder;
      input.dataset.role = 'spelling-answer';
      const submit = () => review(normalizeWord(input.value) === normalizeWord(item.word) ? 'Good' : 'Again');
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
      card.append(input, button(t.answer, submit));
      if (mode === 'listening') card.append(button(t.replay, () => controls.speak?.(item.word)));
    }
    body.append(card);
  };

  const renderNotebook = (state) => {
    const lookupBox = el('section', 'ev-dict-lookup');
    lookupBox.append(el('h3', 'ev-section-title', t.dictionaryTitle));
    const lookupInput = el('input', 'ev-input');
    lookupInput.placeholder = t.dictionarySearch;
    lookupInput.dataset.role = 'dictionary-search';
    const suggestions = el('div', 'ev-dict-suggestions');
    const resultBox = el('div', 'ev-dict-result');
    const showResult = (result) => {
      resultBox.textContent = '';
      if (!result) {
        resultBox.append(el('p', 'ev-empty', t.dictionaryNoEntry));
        return;
      }
      const title = el('div', 'ev-dict-head');
      title.append(el('strong', 'ev-row-word', result.surface === result.lemma ? result.lemma : `${result.surface} → ${result.lemma}`));
      if (result.entry.p) title.append(el('small', 'ev-reading-phonetic', `/${result.entry.p}/`));
      resultBox.append(title);
      if (result.inflection) resultBox.append(button(t.inflectionOf(result.inflection.lemma, result.inflection.kind), () => {
        lookupInput.value = result.inflection.lemma;
        runLookup(result.inflection.lemma);
      }, 'ev-dict-lemma-link'));
      resultBox.append(renderDictionaryDefinition(result.entry, locale));
      const collected = state.entries.some((entry) => entry.word === result.lemma);
      if (collected) resultBox.append(el('p', 'ev-note', t.collectedWord));
      else {
        const collect = button(t.collectWord, async () => {
          if (dictionaryCollecting) return;
          dictionaryCollecting = true;
          collect.disabled = true;
          let receipt = null;
          try { receipt = await controls.onCollectDictionaryWord?.(result, { word: result.surface, key: result.lemma, tone: null }); } catch { /* retry remains available */ }
          if (dictionaryResult !== result) return;
          if (receipt?.outcome === 'applied') dictionaryCollectStatus = t.dictionaryAdded;
          else if (receipt?.outcome === 'rejected' || receipt?.outcome === 'aborted') dictionaryCollectStatus = t.dictionaryCancelled;
          else if (receipt) dictionaryCollectStatus = t.dictionaryNotReviewed(receipt.reason);
          else dictionaryCollectStatus = t.dictionaryLoadFailed;
          dictionaryCollecting = receipt?.outcome === 'applied';
          rerender();
        });
        collect.disabled = dictionaryCollecting;
        resultBox.append(collect);
        if (dictionaryCollectStatus) resultBox.append(el('p', 'ev-note', dictionaryCollectStatus));
      }
    };
    const runLookup = async (word) => {
      const request = ++lookupRequest;
      const query = String(word ?? '').trim().toLowerCase();
      dictionaryQuery = query;
      dictionaryError = null;
      dictionaryResult = null;
      dictionarySuggestions = [];
      dictionaryCollecting = false;
      dictionaryCollectStatus = '';
      let result;
      try { result = await controls.lookupDictionary?.(query); } catch {
        if (request !== lookupRequest || dictionaryQuery !== query) return;
        dictionaryError = { kind: 'lookup', query };
        rerender();
        return;
      }
      if (request !== lookupRequest || dictionaryQuery !== query) return;
      dictionaryResult = result;
      rerender();
    };
    const showSuggestions = (items) => {
      suggestions.textContent = '';
      if (!items.length && dictionaryQuery.length >= 2) {
        suggestions.append(el('p', 'ev-empty', t.dictionaryNoEntry));
        return;
      }
      for (const item of items) {
        suggestions.append(button(item.word, () => { lookupInput.value = item.word; runLookup(item.word); }, 'ev-dict-chip'));
      }
    };
    const runSuggest = async (value = lookupInput.value) => {
      const request = ++suggestionRequest;
      const q = String(value ?? '').trim().toLowerCase();
      dictionaryQuery = q;
      lookupRequest += 1;
      dictionaryResult = null;
      dictionarySuggestions = [];
      dictionaryError = null;
      dictionaryCollecting = false;
      dictionaryCollectStatus = '';
      suggestions.textContent = '';
      resultBox.textContent = '';
      if (q.length < 2) return;
      let items;
      try { items = await controls.suggestDictionary?.(q, 8) ?? []; } catch {
        if (request !== suggestionRequest || dictionaryQuery !== q) return;
        dictionaryError = { kind: 'suggest', query: q };
        rerender();
        return;
      }
      if (request !== suggestionRequest || dictionaryQuery !== q) return;
      dictionarySuggestions = items;
      rerender();
    };
    lookupInput.addEventListener('input', () => runSuggest());
    lookupInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runLookup(lookupInput.value);
    });
    lookupBox.append(lookupInput, suggestions, resultBox);
    body.append(lookupBox);
    if (dictionaryError) {
      resultBox.append(el('p', 'ev-empty', t.dictionaryLoadFailed), button(t.retry, () => {
        lookupInput.value = dictionaryError.query;
        if (dictionaryError.kind === 'lookup') runLookup(dictionaryError.query);
        else runSuggest(dictionaryError.query);
      }));
    } else if (dictionaryResult) showResult(dictionaryResult);
    else if (dictionarySuggestions.length || dictionaryQuery.length >= 2) showSuggestions(dictionarySuggestions);

    const addRow = el('div', 'ev-add');
    const addInput = el('input', 'ev-input');
    addInput.placeholder = t.addWord;
    addInput.dataset.role = 'manual-word';
    addRow.append(addInput, button(t.add, () => {
      let word;
      try { word = assertEnglishWord(addInput.value); } catch { controls.notify?.(t.invalidManualWord); return; }
      if (!controls.app.chat.appendToComposer(requestTextForWord(word, locale))) controls.notify?.(t.collectFailed);
    }));
    const search = el('input', 'ev-input');
    search.placeholder = t.search;
    search.dataset.role = 'notebook-search';
    const filter = el('select', 'ev-input');
    filter.dataset.role = 'notebook-filter';
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
        const card = Object.hasOwn(current.review.cards, entry.word) ? current.review.cards[entry.word] : undefined;
        const currentFlag = Object.hasOwn(current.review.flags, entry.word) ? current.review.flags[entry.word] : undefined;
        const fam = familiarityFor(card, currentFlag);
        if ((q && !entry.word.includes(q)) || (filter.value !== 'all' && fam !== filter.value)) continue;
        const row = el('div', 'ev-row');
        const head = el('div', 'ev-row-head');
        head.append(el('strong', 'ev-row-word', entry.word), el('small', 'ev-badge', t[fam] || fam));
        const actions = el('div', 'ev-row-actions');
        const flag = currentFlag;
        if (fam !== 'mastered' && flag !== 'ignored') actions.append(button(t.markMastered, () => setFlag(entry.word, 'mastered')));
        if (flag !== 'ignored') actions.append(button(t.ignore, () => setFlag(entry.word, 'ignored')));
        if (flag === 'mastered' || flag === 'ignored') actions.append(button(flag === 'mastered' ? t.restoreReview : t.restore, () => setFlag(entry.word, undefined)));
        row.append(head, el('div', 'ev-row-definition', entry.definition), actions);
        list.append(row);
      }
    };
    const setFlag = (word, flag) => {
      if (controls.onFlag) controls.onFlag(word, flag);
      else {
        state.review.flags = Object.assign(Object.create(null), state.review.flags);
        if (flag) state.review.flags[word] = flag;
        else delete state.review.flags[word];
      }
      draw();
    };
    search.addEventListener('input', draw);
    filter.addEventListener('change', draw);
    const notebookTools = el('section', 'ev-notebook-tools');
    notebookTools.append(addRow, search, filter);
    body.append(notebookTools, list);
    draw();
    if (state.invalid?.length) {
      const invalid = el('details', 'ev-invalid-notes');
      invalid.append(el('summary', '', t.invalidNotes(state.invalid.length)));
      for (const item of state.invalid) {
        const row = el('div', 'ev-invalid-note');
        row.append(el('strong', '', item.path), el('span', '', t.invalidNoteReason(item)));
        const raw = el('small', 'ev-note', String(item.error ?? ''));
        raw.dataset.rawError = String(item.error ?? '');
        row.append(raw);
        invalid.append(row);
      }
      body.append(invalid);
    }
  };

  const renderRecommendations = (state) => {
    const settings = state.levelSettings;
    const settingsBox = el('section', 'ev-settings');
    settingsBox.append(el('h3', '', t.readingSettings));
    const vocab = el('select', 'ev-input');
    vocab.dataset.role = 'level-vocabulary-size';
    for (const value of [1000, 2000, 3000, 5000, 8000, 12000, 20000]) {
      const option = el('option', '', String(value));
      option.value = String(value);
      option.selected = value === settings.vocabularySize;
      vocab.append(option);
    }
    const easy = el('input', 'ev-input');
    easy.dataset.role = 'level-easy-max';
    easy.type = 'number';
    easy.min = '0';
    easy.max = '20';
    easy.step = '0.5';
    easy.value = String(settings.easyMax);
    const hard = el('input', 'ev-input');
    hard.dataset.role = 'level-good-max';
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
    const skipped = result?.skipped ?? {};
    const appendSkipped = () => {
      const details = el('details', 'ev-skipped');
      details.append(el('summary', '', t.skippedSummary(skipped['not-english'] ?? 0, skipped['too-short'] ?? 0, skipped.unreadable ?? 0)));
      body.append(details);
    };
    if (!result?.items?.length) {
      body.append(el('p', 'ev-empty', t.noRecommendations));
      if (result && Object.values(skipped).some((count) => count > 0)) appendSkipped();
      return;
    }
    const list = el('div', 'ev-list');
    for (const item of result.items) {
      const row = el('article', 'ev-row');
      const head = el('div', 'ev-row-head');
      const title = button(item.title, () => controls.openReadingDocument?.(item.path), 'ev-link-button');
      title.disabled = !controls.canOpenReadingDocument?.();
      const bandLabel = item.band === 'good' ? t.bandGood : item.band === 'easy' ? t.bandEasy : t.bandHard;
      head.append(title, el('small', 'ev-badge', `${bandLabel} · ${item.rate.toFixed(1)}%`));
      const detail = el('div', 'ev-row-definition', `${t.novelRate}: ${item.topWords.join(', ') || '-'}`);
      row.append(head, detail);
      list.append(row);
    }
    body.append(list);
    appendSkipped();
  };

  const rerender = () => {
    locale = read().locale ?? controls.locale ?? currentLocale();
    t = uiText(locale);
    const savedInputs = new Map([...body.querySelectorAll('[data-role]')].map((node) => [node.dataset.role, {
      value: node.value,
      start: node.selectionStart,
      end: node.selectionEnd,
      focused: document.activeElement === node,
      word: renderedWord,
    }]));
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
      if (typeof controls.app?.readingDecorations?.register === 'function') {
        const lookupLabel = el('label', 'ev-toggle');
        const lookupInput = document.createElement('input');
        lookupInput.type = 'checkbox';
        lookupInput.checked = state.lookupAnyWord !== false;
        lookupInput.dataset.role = 'lookup-any-word';
        lookupInput.addEventListener('click', () => controls.onLookupAnyWordChange?.(lookupInput.checked));
        lookupLabel.append(lookupInput, el('span', '', t.lookupAnyWord));
        toolbar.append(lookupLabel);
      }
      if (state.highlight !== false && state.entries.some((entry) => normalizeWord(entry.word).includes('-'))) {
        toolbar.append(el('p', 'ev-note', t.hyphenHighlightLimited));
      }
    }
    tabs.textContent = '';
    tabs.append(button(t.today, () => { tab = 'today'; rerender(); }), button(t.notebook, () => { tab = 'notebook'; rerender(); }));
    if (controls.app?.workspace?.scope) tabs.append(button(t.recommendations, () => { tab = 'recommendations'; rerender(); }));
    body.textContent = '';
    if (state.loading) body.append(el('p', '', t.loading(state.loading.done, state.loading.total)));
    if (tab === 'today') renderToday(state);
    else if (tab === 'notebook') renderNotebook(state);
    else renderRecommendations(state);
    for (const [role, saved] of savedInputs) {
      const node = body.querySelector(`[data-role="${role}"]`);
      if (!node) continue;
      if (role === 'spelling-answer' && saved.word !== renderedWord) continue;
      node.value = saved.value;
      if (typeof saved.start === 'number' && typeof node.setSelectionRange === 'function') node.setSelectionRange(saved.start, saved.end);
      if (saved.focused) node.focus();
      if (role === 'notebook-search' || role === 'notebook-filter') node.dispatchEvent(new Event(role === 'notebook-filter' ? 'change' : 'input'));
    }
    scheduleReviewRefresh(state);
  };

  const onKeydown = (event) => {
    if (tab !== 'today') return;
    if (read().mutationPending) return;
    if (event.key === ' ') { event.preventDefault(); flipped = true; rerender(); }
    if (flipped && ['1', '2', '3', '4'].includes(event.key)) review(['Again', 'Hard', 'Good', 'Easy'][Number(event.key) - 1]);
  };
  container.addEventListener('keydown', onKeydown);
  container.append(toolbar, tabs, body);
  const unsubscribe = controls.subscribe?.(rerender) ?? (() => undefined);
  rerender();
  return () => {
    cleaned = true;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
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
