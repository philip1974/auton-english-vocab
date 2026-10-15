import { afterEach, describe, expect, it, vi } from 'vitest';
import { dictionaryDefinition, enrichVocabularyEntries, inferPos, loadChunk, lookup, resetDictionaryCache, suggest } from '../src/dictionary.mjs';
import { buildSurfaceMap } from '../src/inflections.mjs';

const chunks = {
  r: {
    run: { p: 'rʌn', t: 'v. 跑\nn. 路程', d: 'move fast', x: '', r: 200 },
    ran: { t: 'v. run的过去式', d: 'past tense of run', x: '0:run', r: 900 },
    runner: { t: 'n. 跑步者', d: 'one who runs' },
  },
  d: {
    do: { t: 'v. 做', d: 'perform an action', r: 20 },
    does: { t: 'n. 母鹿（复数）\nv. do 的第三人称单数', d: 'female deer\nthird-person singular of do', x: '0:do', r: 100 },
    "don't": { t: '不要', d: 'do not', r: 10 },
    deliver: { t: 'v. 递送', d: 'bring goods', r: 200 },
    delivered: { t: 'deliver 的过去式', d: 'past tense of deliver', x: '0:deliver', r: 1 },
  },
  s: {
    see: { t: 'v. 看见', d: 'perceive with the eyes' },
    saw: { t: 'n. 锯\nv. see 的过去式', d: 'a cutting tool\npast tense of see', x: '0:see' },
  },
  l: {
    leave: { t: 'v. 离开', d: 'go away' },
    left: { t: 'adj. 左边的\nleave 的过去式', d: 'on the left side\npast tense of leave', x: '0:leave' },
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

  it('should keep semantic surface entries and expose their inflection relation when exchange metadata also exists', async () => {
    await expect(lookup('does', { importer })).resolves.toMatchObject({ surface: 'does', lemma: 'does', entry: chunks.d.does, inflection: { lemma: 'do', kind: 'thirdPerson' } });
    await expect(lookup('saw', { importer })).resolves.toMatchObject({ surface: 'saw', lemma: 'saw', entry: chunks.s.saw, inflection: { lemma: 'see' } });
    await expect(lookup('left', { importer })).resolves.toMatchObject({ surface: 'left', lemma: 'left', entry: chunks.l.left, inflection: { lemma: 'leave' } });
    await expect(lookup('ran', { importer })).resolves.toMatchObject({ lemma: 'run', entry: chunks.r.run });
  });

  it('should resolve does to do with the committed dictionary instead of trusting the doe exchange', async () => {
    await expect(lookup('does')).resolves.toMatchObject({ surface: 'does', lemma: 'does', inflection: { lemma: 'do', kind: 'thirdPerson' } });
  });

  it('should prefer confirmed exchange lemmas and suppress untyped heuristic relations', async () => {
    await expect(lookup('better')).resolves.toMatchObject({ surface: 'better', lemma: 'better', inflection: { lemma: 'good', kind: 'comparative' } });
    const hers = await lookup('hers');
    expect(hers?.inflection).toBeUndefined();
    const ambiguousImporter = async () => ({ default: {
      axes: { t: 'n. 独立义项\nv. 独立义项', x: '0:axe' },
      axe: { t: 'n. 斧头\nv. 砍' },
    } });
    expect((await lookup('axes', { importer: ambiguousImporter }))?.inflection).toBeUndefined();
  });

  it('should reverse validate real dictionary relations for axes and quizzes', async () => {
    await expect(lookup('axes')).resolves.toMatchObject({
      surface: 'axes', lemma: 'axes', inflection: { lemma: 'ax', kind: 'plural' },
    });
    await expect(lookup('quizzes')).resolves.toMatchObject({
      surface: 'quizzes', lemma: 'quizzes', inflection: { lemma: 'quiz', kind: 'plural' },
    });
  });

  it('should classify every supported semantic surface inflection relation', async () => {
    const kinds = {
      baked: ['bake', '过去式', 'past'],
      broken: ['break', '过去分词', 'pastParticiple'],
      baking: ['bake', '现在分词', 'presentParticiple'],
      bases: ['base', '复数', 'plural'],
      bakes: ['bake', '第三人称单数', 'thirdPerson'],
      bigger: ['big', '比较级', 'comparative'],
      biggest: ['big', '最高级', 'superlative'],
    };
    const local = { b: { bake: { t: 'v. 烘焙' }, break: { t: 'v. 打破' }, base: { t: 'n. 基础' }, big: { t: 'a. 大的' } } };
    const markers = { past: 'd', pastParticiple: 'p', presentParticiple: 'i', plural: 's', thirdPerson: '3', comparative: 'r', superlative: 't' };
    for (const [surface, [lemma, label, kind]] of Object.entries(kinds)) {
      local.b[surface] = { t: `n. 独立义项\n${lemma}的${label}`, x: `0:${lemma}/1:${markers[kind]}` };
    }
    const localImporter = async () => ({ default: local.b });
    for (const [surface, [lemma, , kind]] of Object.entries(kinds)) {
      await expect(lookup(surface, { importer: localImporter })).resolves.toMatchObject({ lemma: surface, inflection: { lemma, kind } });
    }
  });

  it('should normalize curly apostrophes for lookup while preserving the displayed surface', async () => {
    await expect(lookup('Don’t', { importer })).resolves.toMatchObject({ surface: 'don’t', lemma: "don't", entry: chunks.d["don't"] });
    await expect(suggest('don’', 8, { importer })).resolves.toMatchObject([{ word: "don't" }]);
  });

  it('should use only controlled hyphen aliases for lookup and suggestions', async () => {
    const local = {
      c: { cooperate: { t: 'v. 合作' } },
      e: { email: { t: 'n. 电子邮件' } },
      r: { resign: { t: 'v. 辞职' } },
    };
    const localImporter = async (letter) => ({ default: local[letter] ?? {} });
    await expect(lookup('co-operate', { importer: localImporter })).resolves.toMatchObject({ surface: 'co-operate', lemma: 'cooperate' });
    await expect(lookup('e-mail', { importer: localImporter })).resolves.toMatchObject({ surface: 'e-mail', lemma: 'email' });
    await expect(suggest('co-', 8, { importer: localImporter })).resolves.toMatchObject([{ word: 'co-operate' }]);
    await expect(lookup('re-sign', { importer: localImporter })).resolves.toBeNull();
  });

  it('should look up irregular and generated inflection candidates across chunks', async () => {
    await expect(lookup('went', { importer })).resolves.toMatchObject({ surface: 'went', lemma: 'go', entry: chunks.g.go });
    await expect(lookup('running', { importer })).resolves.toMatchObject({ surface: 'running', lemma: 'run', entry: chunks.r.run });
  });

  it('should try reliable common suffix candidates without guessing adjective comparatives', async () => {
    const local = {
      h: { happy: { t: 'adj. 快乐的\nv. 使快乐\nn. 快乐的人', d: 'glad' }, hop: { t: 'v. 跳', d: 'jump' } },
      b: { box: { t: 'n. 盒子', d: 'container' }, big: { t: 'adj. 大的', d: 'large' } },
      l: { like: { t: 'v. 喜欢', d: 'enjoy' } },
    };
    const localImporter = (letter) => Promise.resolve({ default: local[letter] ?? {} });
    await expect(lookup('happies', { importer: localImporter })).resolves.toMatchObject({ lemma: 'happy' });
    await expect(lookup('happied', { importer: localImporter })).resolves.toMatchObject({ lemma: 'happy' });
    await expect(lookup('hopped', { importer: localImporter })).resolves.toMatchObject({ lemma: 'hop' });
    await expect(lookup('boxes', { importer: localImporter })).resolves.toMatchObject({ lemma: 'box' });
    await expect(lookup('bigger', { importer: localImporter })).resolves.toBeNull();
    await expect(lookup('biggest', { importer: localImporter })).resolves.toBeNull();
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
    await expect(lookup(undefined, { importer })).resolves.toBeNull();
    await expect(suggest(undefined, 8, { importer })).resolves.toEqual([]);
  });

  it('should reject words when punctuation is leading trailing or repeated', async () => {
    const localImporter = vi.fn(() => Promise.resolve({ default: {} }));
    await expect(lookup('run-', { importer: localImporter })).resolves.toBeNull();
    await expect(lookup("a''b", { importer: localImporter })).resolves.toBeNull();
    await expect(suggest('a--', 8, { importer: localImporter })).resolves.toEqual([]);
    expect(localImporter).not.toHaveBeenCalled();
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

  it('should evict a rejected chunk promise so a later lookup retries automatically', async () => {
    let attempts = 0;
    const flaky = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary');
      return { default: { zoo: { t: 'n. 动物园' } } };
    };
    await expect(lookup('zoo', { importer: flaky })).rejects.toThrow('temporary');
    await expect(lookup('zoo', { importer: flaky })).resolves.toMatchObject({ lemma: 'zoo' });
  });

  it('should rank base suggestions before pure inflection entries', async () => {
    await expect(suggest('deli', 8, { importer })).resolves.toEqual([
      { word: 'deliver', entry: chunks.d.deliver },
      { word: 'delivered', entry: chunks.d.delivered },
    ]);
  });

  it('should rank the real deliver lemma before delivered for the deli prefix', async () => {
    const items = await suggest('deli', 8);
    expect(items[0]?.word).toBe('deliver');
    expect(items.findIndex((item) => item.word === 'deliver')).toBeLessThan(items.findIndex((item) => item.word === 'delivered'));
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
    expect(inferPos({ t: 'n. 记录\nvt. 记录\nvi. 录音\na. 创纪录的' })).toBe('noun, verb, adjective');
    expect(dictionaryDefinition(null, 'zh')).toBe('');
    expect(dictionaryDefinition({ d: 'n an undivided whole\ns in complete agreement\na unanimous vote\nv join together\nr completely' }, 'en')).toBe('n. an undivided whole\nadj. in complete agreement\nadj. unanimous vote\nv. join together\nadv. completely');
  });

  it('should enrich collected entries with dictionary exchange forms and all parts of speech', async () => {
    const importerWithForms = async () => ({ default: {
      record: { t: 'n. 记录\nvt. 记录\na. 创纪录的', x: 's:records/d:recorded/p:recorded/i:recording/3:records' },
      run: { t: 'vi. 跑', x: 'd:ran/p:run/i:running/3:runs' },
      ran: { t: 'run的过去式', x: '0:run/1:p' },
    } });
    const entries = await enrichVocabularyEntries([
      { word: 'record', pos: 'noun', definition: 'n. 记录' },
      { word: 'run', definition: 'to move fast on foot' },
    ], { importer: importerWithForms });
    expect(entries[0]).toMatchObject({ dictionaryPos: 'noun, verb, adjective', forms: expect.arrayContaining(['record', 'records', 'recorded', 'recording']) });
    expect(entries[1]).toMatchObject({ dictionaryPos: 'verb', forms: expect.arrayContaining(['run', 'ran', 'running', 'runs']) });
  });

  it('should validate real dictionary exchange forms in both directions and keep reliable rules monotonic', async () => {
    resetDictionaryCache();
    const words = ['felt', 'numb', 'clothe', 'her', 'sheep', 'email', 'run', 'go', 'child'];
    const entries = await enrichVocabularyEntries(words.map((word) => ({ word, definition: 'plain' })));
    const forms = new Map(entries.map((entry) => [entry.word, new Set(entry.forms ?? [])]));
    for (const [word, rejected] of Object.entries({ felt: ['feels', 'feeling'], numb: ['number'], clothe: ['cloathing'], her: ['hering'], sheep: ['sheeps'] })) {
      for (const surface of rejected) expect(forms.get(word).has(surface)).toBe(false);
    }
    for (const surface of ['emails', 'emailed', 'emailing']) expect(forms.get('email').has(surface)).toBe(true);
    for (const surface of ['ran', 'running', 'runs']) expect(forms.get('run').has(surface)).toBe(true);
    for (const surface of ['went', 'gone', 'going', 'goes']) expect(forms.get('go').has(surface)).toBe(true);
    expect(forms.get('child').has('children')).toBe(true);
    const before = new Set(buildSurfaceMap([{ word: 'email', pos: 'noun, verb' }]).keys());
    const after = new Set(buildSurfaceMap([entries.find((entry) => entry.word === 'email')]).keys());
    for (const surface of before) expect(after.has(surface)).toBe(true);
  });

  it('should ignore a foreign lemma exchange paradigm while retaining reliable forms', async () => {
    const importerWithForeignLemma = async () => ({ default: {
      felt: { t: 'n. 毛毡\nvt. 制毡\nfeel的过去式', x: '0:feel/1:pd/s:felts/i:feeling/3:feels' },
      feeling: { t: 'n. 感觉', x: '0:feel/1:i' },
      feels: { t: 'feel的第三人称单数', x: '0:feel/1:3' },
    } });
    const [entry] = await enrichVocabularyEntries([{ word: 'felt', pos: 'noun', definition: '毛毡' }], { importer: importerWithForeignLemma });
    expect(entry.forms).toContain('felts');
    expect(entry.forms).not.toEqual(expect.arrayContaining(['feeling', 'feels']));
  });

  it('should keep original entries when dictionary enrichment is missing or temporarily fails', async () => {
    const entries = [{ word: 'missing', definition: 'plain' }];
    await expect(enrichVocabularyEntries(entries, { importer: async () => ({ default: {} }) })).resolves.toEqual(entries);
    await expect(enrichVocabularyEntries(entries, { importer: async () => { throw new Error('chunk failed'); } })).resolves.toEqual(entries);
    await expect(enrichVocabularyEntries([{ word: 'broken', definition: 'plain' }], { importer: async () => ({ default: { broken: { t: 'n. bad', x: 's:not a word' } } }) })).resolves.toMatchObject([{ forms: expect.arrayContaining(['broken', 'brokens']) }]);
  });

  it('should mark enrichment incomplete when reverse validation needs a chunk that temporarily fails', async () => {
    const original = [{ word: 'go', definition: 'move' }];
    const enriched = await enrichVocabularyEntries(original, {
      importer: async (letter) => {
        if (letter === 'w') throw new Error('temporary surface chunk failure');
        return { default: { go: { t: 'v. 去', x: 'p:went' } } };
      },
    });
    expect(enriched[0]).toMatchObject({
      word: 'go',
      dictionaryPos: 'verb',
      forms: expect.arrayContaining(['go', 'goes', 'going']),
    });
    expect(enriched[0].forms).not.toContain('went');
    expect(enriched.incomplete).toBe(true);
  });

  it('should preserve reviewed irregular comparatives when exchange validation sees independent entries', async () => {
    resetDictionaryCache();
    const [entry] = await enrichVocabularyEntries([{ word: 'good', definition: 'positive' }]);
    expect(entry.forms).toEqual(expect.arrayContaining(['good', 'better', 'best']));
  });

  it('should normalize a pure irregular plural to its noun lemma when looking up children', async () => {
    resetDictionaryCache();
    await expect(lookup('children')).resolves.toMatchObject({
      surface: 'children',
      lemma: 'child',
      surfaceEntry: expect.objectContaining({ t: expect.stringMatching(/^pl\./u) }),
    });
    await expect(lookup('people')).resolves.toMatchObject({ surface: 'people', lemma: 'people' });
  });
});
