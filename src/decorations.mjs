import { familiarityFor } from './familiarity.mjs';
import { buildSurfaceMap } from './inflections.mjs';
import { uiText } from './ui-text.mjs';

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

export function buildReadingTerms({ entries = [], review = { cards: {}, flags: {} } } = {}) {
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
  return terms.sort((a, b) => a.surface.localeCompare(b.surface) || a.key.localeCompare(b.key));
}

export function createReadingDecorationSpec({ locale = 'en', getState, onReview, onUndo, onTermsChanged, speak }) {
  const t = uiText(locale);
  return {
    id: 'english-vocab',
    renderCard(container, context) {
      let cleaned = false;
      const current = () => getState?.() ?? {};
      const render = (rated = null) => {
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
        if (entry?.definition) card.append(el('p', 'ev-reading-definition', entry.definition));
        for (const example of (entry?.examples ?? []).slice(0, 2)) card.append(el('p', 'ev-reading-example', example));
        const actions = el('div', 'ev-reading-actions');
        const speakButton = button('🔊', () => speak?.(context.key));
        speakButton.dataset.role = 'speak';
        actions.append(
          ratingButton(t.readingKnow, 'Good', async () => {
            if (await onReview?.(context.key, 'Good', 'reading-card')) {
              onTermsChanged?.();
              render('good');
            }
          }, 'ev-reading-good'),
          ratingButton(t.readingDontKnow, 'Again', async () => {
            if (await onReview?.(context.key, 'Again', 'reading-card')) {
              onTermsChanged?.();
              render('again');
            }
          }, 'ev-reading-again'),
          speakButton,
        );
        card.append(actions);
        if (rated) {
          const note = el('p', 'ev-reading-note', rated === 'good' ? t.readingMarkedKnown : t.readingMarkedLearning);
          const undo = button(t.undo, async () => {
            if (await onUndo?.(context.key)) {
              onTermsChanged?.();
              render();
            }
          });
          undo.dataset.role = 'undo';
          note.append(' ', undo);
          card.append(note);
        }
        container.append(card);
      };
      render();
      return () => {
        if (cleaned) return;
        cleaned = true;
        container.textContent = '';
      };
    },
  };
}
