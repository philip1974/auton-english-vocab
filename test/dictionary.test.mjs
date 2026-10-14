import { afterEach, describe, expect, it, vi } from 'vitest';
import { dictionaryDefinition, inferPos, loadChunk, lookup, resetDictionaryCache, suggest } from '../src/dictionary.mjs';

const chunks = {
  r: {
    run: { p: 'rʌn', t: 'v. 跑\nn. 路程', d: 'move fast', x: '', r: 200 },
    ran: { t: 'v. run的过去式', d: 'past tense of run', x: '0:run', r: 900 },
    runner: { t: 'n. 跑步者', d: 'one who runs' },
  },
  g: {
    go: { t: 'v. 去', d: 'move from one place to another', x: '', r: 50 },
  },
  e: {
    ephemeral: { t: 'adj. 短暂的', d: 'lasting for a short time', r: 10000 },
    ephemera: { t: 'n. 短期使用的东西', d: 'collectible paper items' },
    epic: { t: 'n. 史诗', d: 'a long poem', r: 3000 },
  },
};

function importer(letter) {
  if (letter === 'z') throw new Error('missing chunk');
  return Promise.resolve({ default: chunks[letter] ?? {} });
}

afterEach(() => resetDictionaryCache());

describe('dictionary', () => {
  it('should look up direct entries and exchange lemmas when entries exist', async () => {
    await expect(lookup('Run', { importer })).resolves.toMatchObject({ surface: 'run', lemma: 'run', entry: chunks.r.run });
    await expect(lookup('ran', { importer })).resolves.toMatchObject({ surface: 'ran', lemma: 'run', entry: chunks.r.run, surfaceEntry: chunks.r.ran });
  });

  it('should look up irregular and generated inflection candidates across chunks', async () => {
    await expect(lookup('went', { importer })).resolves.toMatchObject({ surface: 'went', lemma: 'go', entry: chunks.g.go });
    await expect(lookup('running', { importer })).resolves.toMatchObject({ surface: 'running', lemma: 'run', entry: chunks.r.run });
  });

  it('should try common suffix candidates for past plural comparative and superlative forms', async () => {
    const local = {
      h: { happy: { t: 'adj. 快乐的', d: 'glad' }, hop: { t: 'v. 跳', d: 'jump' } },
      b: { box: { t: 'n. 盒子', d: 'container' }, big: { t: 'adj. 大的', d: 'large' } },
      l: { like: { t: 'v. 喜欢', d: 'enjoy' } },
    };
    const localImporter = (letter) => Promise.resolve({ default: local[letter] ?? {} });
    await expect(lookup('happies', { importer: localImporter })).resolves.toMatchObject({ lemma: 'happy' });
    await expect(lookup('happied', { importer: localImporter })).resolves.toMatchObject({ lemma: 'happy' });
    await expect(lookup('hopped', { importer: localImporter })).resolves.toMatchObject({ lemma: 'hop' });
    await expect(lookup('boxes', { importer: localImporter })).resolves.toMatchObject({ lemma: 'box' });
    await expect(lookup('bigger', { importer: localImporter })).resolves.toMatchObject({ lemma: 'big' });
    await expect(lookup('biggest', { importer: localImporter })).resolves.toMatchObject({ lemma: 'big' });
    await expect(lookup('liked', { importer: localImporter })).resolves.toMatchObject({ lemma: 'like' });
  });

  it('should return null for non alphabetic starts and unknown words', async () => {
    await expect(loadChunk('1', importer)).resolves.toBeNull();
    await expect(loadChunk('m', () => Promise.resolve({ plain: { t: 'adj. 普通的' } }))).resolves.toEqual({ plain: { t: 'adj. 普通的' } });
    resetDictionaryCache();
    await expect(suggest('1r', 8, { importer })).resolves.toEqual([]);
    await expect(lookup('1run', { importer })).resolves.toBeNull();
    await expect(lookup('zzzz', { importer })).rejects.toThrow('missing chunk');
    resetDictionaryCache();
    await expect(lookup('qzxv', { importer })).resolves.toBeNull();
  });

  it('should sort suggestions by rank, missing rank, and word when prefix matches', async () => {
    await expect(suggest('ep', 8, { importer })).resolves.toEqual([
      { word: 'epic', entry: chunks.e.epic },
      { word: 'ephemeral', entry: chunks.e.ephemeral },
      { word: 'ephemera', entry: chunks.e.ephemera },
    ]);
  });

  it('should cache a chunk once and retry after a failed load cache reset', async () => {
    const spy = vi.fn(importer);
    await lookup('run', { importer: spy });
    await suggest('ru', 2, { importer: spy });
    expect(spy).toHaveBeenCalledTimes(1);
    resetDictionaryCache();
    await expect(lookup('zoo', { importer: spy })).rejects.toThrow('missing chunk');
    resetDictionaryCache();
    await expect(lookup('run', { importer: spy })).resolves.toMatchObject({ lemma: 'run' });
  });

  it('should format definition order by locale and infer part of speech from translation prefixes', () => {
    expect(dictionaryDefinition(chunks.e.ephemeral, 'zh')).toBe('adj. 短暂的\nlasting for a short time');
    expect(dictionaryDefinition(chunks.e.ephemeral, 'en')).toBe('lasting for a short time\nadj. 短暂的');
    expect(inferPos(chunks.e.ephemeral)).toBe('adjective');
    expect(inferPos({ t: 'n. 名词' })).toBe('noun');
    expect(inferPos({ t: 'vt. 做' })).toBe('verb');
    expect(inferPos({ t: 'vi. 做' })).toBe('verb');
    expect(inferPos({ t: 'adv. 快速地' })).toBe('adverb');
    expect(inferPos({ t: 'prep. 在之前' })).toBe('preposition');
    expect(inferPos({ t: 'conj. 和' })).toBe('conjunction');
    expect(inferPos({ t: 'pron. 你' })).toBe('pronoun');
    expect(inferPos({ t: '无前缀' })).toBeUndefined();
    expect(dictionaryDefinition(null, 'zh')).toBe('');
  });
});
