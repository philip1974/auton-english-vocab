import { createEmptyCard, fsrs, generatorParameters, Rating } from 'ts-fsrs';
import { familiarityFor, isReviewable } from './familiarity.mjs';

const params = generatorParameters();
const scheduler = fsrs(params);

function stateName(value) {
  return ['New', 'Learning', 'Review', 'Relearning'][Number(value)] ?? value;
}

export function serializeCard(card) {
  return {
    due: new Date(card.due).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: stateName(card.state),
    last_review: card.last_review ? new Date(card.last_review).toISOString() : null,
  };
}

export function deserializeCard(value) {
  if (!value) return null;
  const states = { New: 0, Learning: 1, Review: 2, Relearning: 3 };
  return {
    ...value,
    due: new Date(value.due),
    state: states[value.state] ?? value.state,
    last_review: value.last_review ? new Date(value.last_review) : undefined,
  };
}

export function newSerializedCard(now = new Date()) {
  return serializeCard(createEmptyCard(now));
}

export function rateCard(serialized, ratingName, now = new Date()) {
  const rating = Rating[ratingName] ?? Rating.Good;
  const card = deserializeCard(serialized) ?? createEmptyCard(now);
  return serializeCard(scheduler.repeat(card, now)[rating].card);
}

export function activeReviewLog(log = []) {
  const undoKey = (id, word) => `${id}\u0000${word}`;
  const undone = new Set(log.filter((entry) => entry?.undoOf && entry.word).map((entry) => undoKey(entry.undoOf, entry.word)));
  const legacyUndone = new Set();
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (!entry?.undo || !entry.word) continue;
    for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
      const rating = log[candidate];
      if (rating?.word !== entry.word || rating?.undo || rating?.undoOf || legacyUndone.has(candidate)) continue;
      if (rating.id && undone.has(undoKey(rating.id, rating.word))) continue;
      legacyUndone.add(candidate);
      break;
    }
  }
  return log.filter((entry, index) => !entry?.undo && !entry?.undoOf && !legacyUndone.has(index) && (!entry?.id || !undone.has(undoKey(entry.id, entry.word))));
}

export function dueQueue(words, review, options = {}, now = new Date()) {
  const newLimit = options.newLimit ?? 50;
  const reviewLimit = options.reviewLimit ?? 200;
  const dueNew = [];
  const dueReview = [];
  for (const item of words) {
    const word = item.word;
    const card = Object.hasOwn(review.cards, word) ? review.cards[word] : undefined;
    const flag = Object.hasOwn(review.flags, word) ? review.flags[word] : undefined;
    if (!isReviewable(card, flag)) continue;
    const familiarity = familiarityFor(card, flag);
    if (!card || familiarity === 'new') dueNew.push({ ...item, familiarity });
    else if (new Date(card.due) <= now) dueReview.push({ ...item, familiarity, due: card.due });
  }
  dueReview.sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const localDay = (date) => {
    const value = new Date(date);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  };
  const today = localDay(now);
  const introduced = new Set(activeReviewLog(options.log)
    .filter((entry) => entry?.word && entry.reviewedAt && localDay(entry.reviewedAt) === today && (entry.previousState === 'New' || entry.previousState === 0))
    .map((entry) => entry.word)).size;
  return [...dueReview.slice(0, reviewLimit), ...dueNew.slice(0, Math.max(0, newLimit - introduced))];
}
