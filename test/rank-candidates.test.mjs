import { describe, expect, it } from 'vitest';
import { rankCandidates, rankMapFromWords, rankOf } from '../src/rank-candidates.mjs';

describe('rank candidates', () => {
  it('should use only the surface word when a denylisted word resembles an inflection', () => {
    const table = rankMapFromWords(['be', 'bed', 'sin', 'sing', 'the', 'thing', 'pres', 'press', 'analysi', 'analysis', 'new', 'news']);
    for (const word of ['bed', 'sing', 'thing', 'press', 'analysis', 'news']) {
      expect(rankCandidates(word)).toEqual([word]);
      expect(rankOf(word, table)).toBe(table.get(word));
    }
  });

  it('should pick the best available base rank for regular and irregular forms when the candidate exists', () => {
    const table = rankMapFromWords(['run', 'study', 'stop', 'big', 'happy', 'take', 'running', 'studies', 'stopped', 'bigger', 'happier', 'taken']);
    expect(rankOf('running', table)).toBe(table.get('run'));
    expect(rankOf('studies', table)).toBe(table.get('study'));
    expect(rankOf('stopped', table)).toBe(table.get('stop'));
    expect(rankOf('bigger', table)).toBe(table.get('big'));
    expect(rankOf('happier', table)).toBe(table.get('happy'));
    expect(rankOf('taken', table)).toBe(table.get('take'));
  });

  it('should not use a generated candidate when that candidate is absent from the table', () => {
    const table = rankMapFromWords(['running']);
    expect(rankOf('running', table)).toBe(1);
  });

  it('should cover conservative suffix branches without inventing absent ranks', () => {
    const table = rankMapFromWords(['move', 'fast', 'happy']);
    expect(rankOf('moving', table)).toBe(1);
    expect(rankOf('fastest', table)).toBe(2);
    expect(rankOf('happiest', table)).toBe(3);
    expect(rankOf('unknowns', table)).toBeNull();
  });
});
