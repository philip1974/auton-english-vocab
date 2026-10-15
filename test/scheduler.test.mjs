import { describe, expect, it } from 'vitest';
import { createEmptyCard, fsrs, generatorParameters, Rating } from 'ts-fsrs';
import { familiarityFor } from '../src/familiarity.mjs';
import { activeReviewLog, deserializeCard, dueQueue, newSerializedCard, rateCard } from '../src/scheduler.mjs';

function expectRoundTripSequence(sequence) {
  const engine = fsrs(generatorParameters());
  const start = new Date('2026-10-14T00:00:00Z');
  let original = createEmptyCard(start);
  let serialized = newSerializedCard(start);
  for (const [rating, minutes] of sequence) {
    const now = new Date(start.getTime() + minutes * 60_000);
    original = engine.repeat(original, now)[Rating[rating]].card;
    serialized = rateCard(serialized, rating, now);
    expect(deserializeCard(serialized)).toEqual(original);
  }
}

describe('scheduler and familiarity', () => {
  it('should advance a card when a rating is applied', () => {
    const first = newSerializedCard(new Date('2026-10-14T00:00:00Z'));
    const rated = rateCard(first, 'Good', new Date('2026-10-14T00:00:00Z'));
    expect(rated.reps).toBeGreaterThan(0);
    expect(rated.due).toMatch(/^2026-/);
  });

  it.each([
    ['Good then Hard', [['Good', 0], ['Hard', 10]]],
    ['Good then Good', [['Good', 0], ['Good', 10]]],
    ['Again then Good', [['Again', 0], ['Good', 1]]],
    ['Relearning', [['Easy', 0], ['Again', 1440], ['Good', 1450]]],
  ])('should preserve the original FSRS card across serialized %s ratings', (_label, sequence) => {
    expectRoundTripSequence(sequence);
  });

  it('should map cards to familiarity when states and flags differ', () => {
    expect(familiarityFor(null)).toBe('new');
    expect(familiarityFor({ state: 'Learning' })).toBe('learning');
    expect(familiarityFor({ state: 'Review', stability: 10 })).toBe('familiar');
    expect(familiarityFor({ state: 'Review' })).toBe('familiar');
    expect(familiarityFor({ state: 'Review', stability: 21 })).toBe('mastered');
    expect(familiarityFor({}, 'ignored')).toBe('ignored');
    expect(familiarityFor({}, 'mastered')).toBe('mastered');
  });

  it('should sort due review cards before new words when building a queue', () => {
    const review = { version: 1, cards: {
      beta: { ...newSerializedCard(new Date('2026-10-01T00:00:00Z')), state: 'Review', due: '2026-10-13T00:00:00.000Z' },
      alpha: { ...newSerializedCard(new Date('2026-10-01T00:00:00Z')), state: 'Review', due: '2026-10-12T00:00:00.000Z' },
    }, flags: { ignored: 'ignored', mastered: 'mastered' } };
    const words = ['newbie', 'beta', 'ignored', 'alpha', 'mastered'].map((word) => ({ word, definition: word }));
    expect(dueQueue(words, review, {}, new Date('2026-10-14T00:00:00Z')).map((item) => item.word)).toEqual(['alpha', 'beta', 'newbie']);
  });

  it('should apply queue limits when many cards are available', () => {
    const words = ['a', 'b', 'c'].map((word) => ({ word, definition: word }));
    expect(dueQueue(words, { version: 1, cards: {}, flags: {} }, { newLimit: 2 })).toHaveLength(2);
  });

  it('should treat prototype-shaped vocabulary keys as ordinary new words', () => {
    const words = ['constructor', '__proto__', 'toString', 'hasOwnProperty'].map((word) => ({ word, definition: word }));
    const review = JSON.parse('{"version":1,"cards":{},"flags":{}}');
    expect(dueQueue(words, review, { newLimit: 10 }).map((item) => item.word)).toEqual(words.map((item) => item.word));
  });

  it('should keep inferred mastered cards reviewable when they are due without a manual flag', () => {
    const card = { ...newSerializedCard(new Date('2026-09-01T00:00:00Z')), state: 'Review', stability: 30, due: '2026-10-13T00:00:00.000Z' };
    const queue = dueQueue([{ word: 'durable', definition: '持久的' }], { version: 1, cards: { durable: card }, flags: {} }, {}, new Date('2026-10-14T00:00:00Z'));
    expect(queue.map((item) => item.word)).toEqual(['durable']);
    expect(queue[0].familiarity).toBe('mastered');
  });

  it('should reduce the daily new word allowance by words first rated today', () => {
    const words = ['a', 'b', 'c'].map((word) => ({ word, definition: word }));
    const log = [
      { word: 'old', reviewedAt: '2026-10-14T01:00:00.000Z', previousState: 'New' },
      { word: 'old', reviewedAt: '2026-10-14T02:00:00.000Z', previousState: 'Learning' },
    ];
    const queue = dueQueue(words, { version: 1, cards: {}, flags: {} }, { newLimit: 2, log }, new Date('2026-10-14T12:00:00'));
    expect(queue.map((item) => item.word)).toEqual(['a']);
  });

  it('should not count legacy ratings without an explicit previous new state against the daily allowance', () => {
    const words = ['a', 'b'].map((word) => ({ word, definition: word }));
    const log = Array.from({ length: 50 }, (_, index) => ({ word: `old${index}`, rating: 'Good', reviewedAt: '2026-10-15T01:00:00' }));
    expect(dueQueue(words, { version: 1, cards: {}, flags: {} }, { newLimit: 50, log }, new Date('2026-10-15T12:00:00'))).toHaveLength(2);
  });

  it('should ignore undone ratings for daily allowance and review counts', () => {
    const words = ['a', 'b'].map((word) => ({ word, definition: word }));
    const log = [
      { id: 'rated-1', word: 'old', reviewedAt: '2026-10-14T01:00:00.000Z', previousState: 'New' },
      { id: 'undo-1', word: 'old', reviewedAt: '2026-10-14T02:00:00.000Z', undoOf: 'rated-1' },
    ];
    expect(dueQueue(words, { version: 1, cards: {}, flags: {} }, { newLimit: 2, log }, new Date('2026-10-14T12:00:00'))).toHaveLength(2);
  });

  it('should require a current undo to match both rating id and word', () => {
    const rating = { id: 'r1', word: 'alpha', rating: 'Good' };
    expect(activeReviewLog([rating, { id: 'undo', word: 'beta', undoOf: 'r1' }])).toEqual([rating]);
  });

  it('should pair a legacy undo with the latest unmatched same-word rating when ids are absent', () => {
    const log = [
      { word: 'old', rating: 'Good', previousState: 'New', reviewedAt: '2026-10-15T01:00:00Z' },
      { word: 'other', rating: 'Good', previousState: 'New', reviewedAt: '2026-10-15T01:00:30Z' },
      { word: 'old', undo: true, reviewedAt: '2026-10-15T01:01:00Z' },
    ];
    expect(activeReviewLog(log)).toEqual([log[1]]);
    const words = ['a', 'b'].map((word) => ({ word, definition: word }));
    expect(dueQueue(words, { version: 1, cards: {}, flags: {} }, { newLimit: 2, log }, new Date('2026-10-15T12:00:00Z'))).toHaveLength(1);
  });

  it('should default to good when rating name is unknown', () => {
    const rated = rateCard(newSerializedCard(new Date('2026-10-14T00:00:00Z')), 'Mystery', new Date('2026-10-14T00:00:00Z'));
    expect(rated.reps).toBe(1);
  });
});
