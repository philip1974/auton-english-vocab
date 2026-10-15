import { familiarityFor } from './familiarity.mjs';
import { buildSurfaceMap, inflectionPriority } from './inflections.mjs';
import { uiText } from './ui-text.mjs';
import { parseExampleLine, resolveExampleSourcePath } from './context-cloze.mjs';
import { normalizeDefinitionLine } from './dictionary.mjs';

const TONE_BY_FAMILIARITY = {
  new: 'learning',
  learning: 'learning',
  familiar: 'familiar',
  mastered: 'known',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, onClick, className = '') {
  const node = el('button', `ev-reading-button${className ? ` ${className}` : ''}`, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function ratingButton(text, rating, onClick, className = '') {
  const node = button(text, onClick, className);
  node.dataset.rating = rating;
  return node;
}

function entryMap(entries) {
  return new Map((entries ?? []).map((entry) => [entry.word, entry]));
}

function normalizedSentence(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

function hasExample(entry, sentence) {
  const target = normalizedSentence(sentence);
  return (entry?.examples ?? []).some((line) => normalizedSentence(parseExampleLine(line).sentence) === target);
}

function contextSourceRow(source, notePath, controls, t) {
  if (!source) return null;
  const row = el('div', 'ev-context-source');
  row.append(el('span', 'ev-context-source-label', t.sourceLabel));
  const sourcePath = source.path ? resolveExampleSourcePath(notePath, source.path) : null;
  if (sourcePath && controls.canOpenReadingDocument?.()) {
    const link = button(source.title || sourcePath, () => controls.openReadingDocument?.(sourcePath), 'ev-context-source-link');
    link.title = t.openSource;
    row.append(link);
  } else if (source.path) row.append(el('span', 'ev-context-source-text', source.title || source.path));
  else if (source.url) row.append(el('span', 'ev-context-source-text', source.title || source.url));
  return row;
}

function noteActionContext(context) {
  if (context.source?.kind !== 'web') return context;
  return {
    ...context,
    source: { url: context.source.url, title: context.source.title },
  };
}

function dictionaryLineGroups(entry, locale) {
  const zh = String(entry?.t ?? '').split('\n').filter(Boolean);
  const en = String(entry?.d ?? '').split('\n').filter(Boolean).map(normalizeDefinitionLine);
  const groups = locale.toLowerCase().startsWith('zh')
    ? [['zh', zh], ['en', en]]
    : [['en', en], ['zh', zh]];
  return groups.filter(([, lines]) => lines.length > 0);
}

function renderDefinition(entry, locale) {
  const wrapper = el('div', 'ev-dict-definition');
  for (const [kind, lines] of dictionaryLineGroups(entry, locale)) {
    const group = el('div', `ev-dict-lines ev-dict-lines-${kind}`);
    for (const line of lines) group.append(el('div', 'ev-dict-line', line));
    wrapper.append(group);
  }
  return wrapper;
}

function renderDictionaryBlock(card, result, t, locale, { compact = false, onOpenLemma } = {}) {
  if (!compact && result.surface !== result.lemma) card.append(el('p', 'ev-dict-relation', `${result.surface} → ${result.lemma}`));
  else if (!compact && result.inflection) {
    const relation = el('div', 'ev-dict-relation');
    relation.append(button(t.inflectionOf(result.inflection.lemma, result.inflection.kind), () => onOpenLemma?.(result.inflection.lemma), 'ev-dict-lemma-link'));
    card.append(relation);
  }
  const head = el('div', 'ev-dict-head');
  head.append(el('strong', 'ev-reading-word', result.lemma));
  if (result.entry.p) head.append(el('span', 'ev-reading-phonetic', `/${result.entry.p}/`));
  card.append(head);
  const definition = renderDefinition(result.entry, locale);
  if (compact) {
    const lines = [...definition.querySelectorAll('.ev-dict-line')];
    const visible = el('div', 'ev-dict-definition');
    for (const line of lines.slice(0, 2)) visible.append(line.cloneNode(true));
    if (visible.childElementCount > 0) card.append(visible);
    if (lines.length > 2) {
      const more = el('details', 'ev-dict-more');
      more.append(el('summary', '', t.moreDefinitions));
      const rest = el('div', 'ev-dict-definition');
      for (const line of lines.slice(2)) rest.append(line.cloneNode(true));
      more.append(rest);
      card.append(more);
    }
  } else if (definition.childElementCount > 0) card.append(definition);
}

export function buildReadingTerms({ entries = [], review = { cards: {}, flags: {} } } = {}, limit = 100000) {
  const entriesByWord = entryMap(entries);
  const surfaceMap = buildSurfaceMap(entries);
  const terms = [];
  for (const [surface, key] of surfaceMap.entries()) {
    const entry = entriesByWord.get(key);
    if (!entry) continue;
    const familiarity = familiarityFor(review.cards?.[key], review.flags?.[key]);
    const tone = TONE_BY_FAMILIARITY[familiarity];
    if (!tone) continue;
    terms.push({ surface, tone, key });
  }
  const sorted = terms
    .sort((a, b) => inflectionPriority(a.key, a.surface) - inflectionPriority(b.key, b.surface)
      || a.surface.localeCompare(b.surface) || a.key.localeCompare(b.key));
  const result = sorted.slice(0, limit);
  Object.defineProperty(result, 'limited', { value: sorted.length > limit, enumerable: false });
  return result;
}

export function createReadingDecorationSpec({ locale = 'en', getState, onReview, onUndo, onTermsChanged, speak, lookupDictionary, onCollectWord, onExplainWord, onAddExample, openReadingDocument, canOpenReadingDocument }) {
  const t = uiText(locale);
  return {
    id: 'english-vocab',
    renderCard(container, context) {
      let cleaned = false;
      let ratedUndoId;
      const current = () => getState?.() ?? {};
      const renderCollected = (rated = null) => {
        if (cleaned) return;
        const state = current();
        const entry = entryMap(state.entries).get(context.key);
        container.textContent = '';
        const card = el('section', 'ev-reading-card');
        card.addEventListener('click', (event) => event.stopPropagation());
        const heading = el('div', 'ev-reading-heading');
        const word = el('strong', 'ev-reading-word', context.word === context.key ? context.key : `${context.word} → ${context.key}`);
        const familiarity = familiarityFor(state.review?.cards?.[context.key], state.review?.flags?.[context.key]);
        heading.append(word, el('span', `ev-reading-badge ev-reading-${context.tone}`, t[familiarity] || t[context.tone] || context.tone));
        card.append(heading);
        if (context.tone === null) card.append(el('p', 'ev-reading-note', t.collectedWord));
        if (entry?.definition) card.append(el('p', 'ev-reading-definition', entry.definition));
        for (const line of (entry?.examples ?? []).slice(0, 2)) {
          const example = parseExampleLine(line);
          card.append(el('p', 'ev-reading-example', example.sentence));
          const sourceRow = contextSourceRow(example.source, entry.path, { openReadingDocument, canOpenReadingDocument }, t);
          if (sourceRow) card.append(sourceRow);
        }
        const dictionaryArea = el('div', 'ev-dict');
        lookupDictionary?.(context.word).then((result) => {
          if (cleaned) return;
          dictionaryArea.textContent = '';
          if (result) renderDictionaryBlock(dictionaryArea, result, t, locale, { compact: true });
        }).catch(() => {
          if (cleaned) return;
          dictionaryArea.textContent = t.dictionaryLoadFailed;
        });
        card.append(dictionaryArea);
        const actions = el('div', 'ev-reading-actions');
        const speakButton = button('🔊', () => speak?.(context.key));
        speakButton.dataset.role = 'speak';
        const applyRating = async (rating, marked) => {
          for (const item of actions.querySelectorAll('[data-rating]')) item.disabled = true;
          const result = await onReview?.(context.key, rating, 'reading-card');
          if (cleaned) return;
          if (result) {
            ratedUndoId = typeof result === 'object' ? result.undoId : undefined;
            onTermsChanged?.();
            renderCollected(marked);
          } else {
            for (const item of actions.querySelectorAll('[data-rating]')) item.disabled = false;
          }
        };
        actions.append(
          ratingButton(t.readingKnow, 'Good', () => applyRating('Good', 'good'), 'ev-reading-good'),
          ratingButton(t.readingDontKnow, 'Again', () => applyRating('Again', 'again'), 'ev-reading-again'),
          speakButton,
        );
        for (const rating of actions.querySelectorAll('[data-rating]')) rating.disabled = state.mutationPending === true;
        if (entry && context.sentence && onAddExample && !hasExample(entry, context.sentence)) {
          const status = el('p', 'ev-reading-note');
          const addExample = button(t.addAsExample, async () => {
            addExample.disabled = true;
            const receipt = await onAddExample(context.key, noteActionContext(context)).catch(() => null);
            if (cleaned) return;
            if (receipt?.outcome === 'applied') status.textContent = t.exampleAdded;
            else if (receipt?.outcome === 'exists') status.textContent = t.exampleExists;
            else if (receipt?.outcome === 'rejected' || receipt?.outcome === 'aborted') status.textContent = t.exampleCancelled;
            else status.textContent = t.exampleNotReviewed(receipt?.reason);
          });
          addExample.dataset.role = 'add-example';
          actions.append(addExample);
          card.append(status);
        }
        card.append(actions);
        if (rated) {
          const note = el('p', 'ev-reading-note', rated === 'good' ? t.readingMarkedKnown : t.readingMarkedLearning);
          const undo = button(t.undo, async () => {
            const undone = await (ratedUndoId ? onUndo?.(context.key, ratedUndoId) : onUndo?.(context.key));
            if (cleaned) return;
            if (undone) {
              onTermsChanged?.();
              renderCollected();
            }
          });
          undo.dataset.role = 'undo';
          note.append(' ', undo);
          card.append(note);
        }
        container.append(card);
      };
      const renderDictionaryOnly = () => {
        if (cleaned) return;
        container.textContent = '';
        const card = el('section', 'ev-reading-card');
        card.addEventListener('click', (event) => event.stopPropagation());
        const body = el('div', 'ev-dict');
        card.append(body);
        const draw = () => {
          if (cleaned) return;
          body.textContent = '';
          lookupDictionary?.(context.word).then((result) => {
            if (cleaned) return;
            body.textContent = '';
            if (!result) {
              body.append(el('p', 'ev-reading-note', t.dictionaryNoEntry));
              body.append(button(t.explainWord, () => onExplainWord?.(context.word, context)));
              return;
            }
            renderDictionaryBlock(body, result, t, locale, { onOpenLemma: (lemma) => {
              context = { ...context, word: lemma };
              draw();
            } });
            const state = current();
            const collected = entryMap(state.entries).has(result.lemma);
            if (collected) {
              body.append(el('p', 'ev-reading-note', t.collectedWord));
              return;
            }
            const status = el('p', 'ev-reading-note');
            const collect = button(t.collectWord, async () => {
              collect.disabled = true;
              const receipt = await onCollectWord?.(result, noteActionContext(context));
              if (cleaned) return;
              if (receipt?.outcome === 'applied') status.textContent = t.dictionaryAdded;
              else if (receipt?.outcome === 'rejected' || receipt?.outcome === 'aborted') status.textContent = t.dictionaryCancelled;
              else if (receipt) status.textContent = t.dictionaryNotReviewed(receipt.reason);
              else status.textContent = t.dictionaryLoadFailed;
            });
            collect.dataset.role = 'collect-dictionary-word';
            body.append(collect, status);
          }).catch(() => {
            if (cleaned) return;
            body.textContent = '';
            body.append(el('p', 'ev-reading-note', t.dictionaryLoadFailed), button(t.retry, draw));
          });
        };
        draw();
        container.append(card);
      };
      if (entryMap(current().entries).has(context.key) || context.tone !== null) renderCollected();
      else renderDictionaryOnly();
      return () => {
        if (cleaned) return;
        cleaned = true;
        container.textContent = '';
      };
    },
  };
}
