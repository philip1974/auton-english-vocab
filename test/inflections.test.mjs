import { describe, expect, it } from 'vitest';
import { AMBIGUOUS_INFLECTION_SURFACES, buildSurfaceMap } from '../src/inflections.mjs';

describe('inflections', () => {
  it('should generate regular noun verb participle and adjective surfaces when lemma is collected', () => {
    const map = buildSurfaceMap([
      { word: 'cat', pos: 'noun' }, { word: 'box', pos: 'noun' }, { word: 'city', pos: 'noun' },
      { word: 'stop', pos: 'verb' }, { word: 'make', pos: 'verb' }, { word: 'die', pos: 'verb' }, { word: 'run', pos: 'verb' },
      { word: 'big', pos: 'adjective' },
      { word: 'happy', pos: '形容词' },
    ]);
    expect(map.get('cats')).toBe('cat');
    expect(map.get('boxes')).toBe('box');
    expect(map.get('cities')).toBe('city');
    expect(map.get('stopped')).toBe('stop');
    expect(map.get('making')).toBe('make');
    expect(map.get('dying')).toBe('die');
    expect(map.get('running')).toBe('run');
    expect(map.get('bigger')).toBe('big');
    expect(map.get('happiest')).toBe('happy');
  });

  it('should generate comparative forms only when pos is adjective and keep adverbs conservative', () => {
    const map = buildSurfaceMap([
      { word: 'teach', pos: 'verb' },
      { word: 'big', pos: 'AdJeCtIvE' },
      { word: 'quick', pos: '副词' },
      { word: 'happy' },
    ]);
    expect(map.has('teacher')).toBe(false);
    expect(map.get('bigger')).toBe('big');
    expect(map.get('biggest')).toBe('big');
    expect(map.has('quicker')).toBe(false);
    expect(map.has('happier')).toBe(false);
  });

  it('should generate tested is plurals without publishing mechanical fake forms', () => {
    const map = buildSurfaceMap([
      { word: 'axis', pos: 'noun' },
      { word: 'analysis', pos: 'noun' },
      { word: 'crisis', pos: 'noun' },
      { word: 'quickly', pos: 'adverb' },
    ]);
    expect(map.get('axes')).toBe('axis');
    expect(map.get('analyses')).toBe('analysis');
    expect(map.get('crises')).toBe('crisis');
    for (const fake of ['axises', 'analysises', 'crisises', 'quicklier', 'quickliest']) expect(map.has(fake)).toBe(false);
  });

  it('should handle prototype-shaped words without reading inherited irregular tables', () => {
    const map = buildSurfaceMap(['constructor', '__proto__', 'toString', 'hasOwnProperty'].map((word) => ({ word, pos: 'noun' })));
    expect(map.get('constructor')).toBe('constructor');
    expect(map.get('constructors')).toBe('constructor');
    expect(map.get('tostring')).toBe('tostring');
    expect(map.get('hasownproperty')).toBe('hasownproperty');
    expect(map.has('__proto__')).toBe(false);
  });

  it('should include common irregular forms and map collected irregular forms back to their lemma', () => {
    const map = buildSurfaceMap([{ word: 'go', pos: 'verb' }, { word: 'child', pos: 'noun' }, { word: 'good', pos: 'adjective' }]);
    expect(map.get('went')).toBe('go');
    expect(map.get('gone')).toBe('go');
    expect(map.get('children')).toBe('child');
    expect(map.get('better')).toBe('good');
    expect(map.get('best')).toBe('good');
    expect(buildSurfaceMap(['went']).has('go')).toBe(false);
    expect(buildSurfaceMap(['ran']).get('ran')).toBe('ran');
  });

  it('should not map ambiguous independent words to an inflection lemma', () => {
    expect([...AMBIGUOUS_INFLECTION_SURFACES]).toEqual(expect.arrayContaining(['does', 'left', 'saw', 'rose', 'found', 'lay', 'wound', 'fell']));
    const cases = [
      ['do', 'does'], ['leave', 'left'], ['see', 'saw'], ['rise', 'rose'],
      ['find', 'found'], ['lie', 'lay'], ['wind', 'wound'], ['fall', 'fell'],
    ];
    const map = buildSurfaceMap(cases.map(([word]) => ({ word, pos: 'verb' })));
    for (const [, surface] of cases) expect(map.has(surface)).toBe(false);
  });

  it('should generate unambiguous third person es forms for verbs ending in o', () => {
    const map = buildSurfaceMap([{ word: 'do', pos: 'verb' }, { word: 'go', pos: 'verb' }]);
    expect(map.has('does')).toBe(false);
    expect(map.get('goes')).toBe('go');
  });

  it('should generate only tested spellings for o fe f zz and c endings', () => {
    const map = buildSurfaceMap([
      { word: 'tomato', pos: 'noun' }, { word: 'potato', pos: 'noun' },
      { word: 'quiz', pos: 'noun' }, { word: 'knife', pos: 'noun' },
      { word: 'panic', pos: 'verb' },
    ]);
    for (const [surface, lemma] of [['tomatoes', 'tomato'], ['potatoes', 'potato'], ['quizzes', 'quiz'], ['knives', 'knife'], ['panicked', 'panic'], ['panicking', 'panic']]) {
      expect(map.get(surface)).toBe(lemma);
    }
    for (const fake of ['tomatos', 'potatos', 'quizes', 'knifes', 'paniced', 'panicing']) expect(map.has(fake)).toBe(false);
  });

  it('should include expanded common irregular verb forms without duplicate-form conflicts', () => {
    const map = buildSurfaceMap(['arise', 'bear', 'cling', 'forbid', 'lie', 'seek', 'stride', 'undertake', 'weave', 'withdraw', 'read', 'put'].map((word) => ({ word, pos: 'verb' })));
    expect(map.get('arose')).toBe('arise');
    expect(map.get('borne')).toBe('bear');
    expect(map.get('clung')).toBe('cling');
    expect(map.get('forbidden')).toBe('forbid');
    expect(map.get('lain')).toBe('lie');
    expect(map.get('sought')).toBe('seek');
    expect(map.get('stridden')).toBe('stride');
    expect(map.get('undertaken')).toBe('undertake');
    expect(map.get('woven')).toBe('weave');
    expect(map.get('withdrawn')).toBe('withdraw');
    expect(map.get('read')).toBe('read');
    expect(map.get('put')).toBe('put');
  });

  it('should prefer an exact collected word and otherwise choose the alphabetically first lemma for conflicts', () => {
    const exact = buildSurfaceMap([{ word: 'axis', pos: 'noun' }, { word: 'axi', pos: 'noun' }]);
    expect(exact.get('axis')).toBe('axis');
    const generated = buildSurfaceMap([{ word: 'try', pos: 'verb' }, { word: 'trie', pos: 'verb' }]);
    expect(generated.get('tries')).toBe('trie');
  });

  it('should ignore non English surfaces short generated forms and denylisted false friends', () => {
    const map = buildSurfaceMap(['你好', { word: 'be', pos: 'verb' }, { word: 'use', pos: 'verb' }, 'bu', { word: 'new', pos: 'noun' }]);
    expect(map.has('你好')).toBe(false);
    expect(map.get('be')).toBe('be');
    expect(map.has('bes')).toBe(false);
    expect(map.has('us')).toBe(false);
    expect(map.has('bus')).toBe(false);
    expect(map.has('news')).toBe(false);
  });

  it('should avoid cvc doubling for w x y endings and keep apostrophe words valid', () => {
    const map = buildSurfaceMap([null, "can't", ...['mix', 'play', 'snow'].map((word) => ({ word, pos: 'verb' }))]);
    expect(map.get("can't")).toBe("can't");
    expect(map.has('mixxed')).toBe(false);
    expect(map.has('playyed')).toBe(false);
    expect(map.has('snowwed')).toBe(false);
    expect(map.get('mixing')).toBe('mix');
  });

  it('should constrain generated forms by normalized part of speech and avoid open doubling', () => {
    const nouns = buildSurfaceMap([{ word: 'saw', pos: 'noun' }, { word: 'book', pos: 'noun' }]);
    expect(nouns.get('saws')).toBe('saw');
    expect(nouns.has('sawed')).toBe(false);
    expect(nouns.has('sawn')).toBe(false);
    expect(nouns.has('booked')).toBe(false);
    const adjectives = buildSurfaceMap([{ word: 'good', pos: 'adjective' }]);
    expect(adjectives.get('better')).toBe('good');
    expect(adjectives.has('goods')).toBe(false);
    expect(adjectives.has('gooded')).toBe(false);
    const verbs = buildSurfaceMap([{ word: 'open', pos: 'verb' }]);
    expect(verbs.get('opened')).toBe('open');
    expect(verbs.get('opening')).toBe('open');
    expect(verbs.has('openned')).toBe(false);
    expect(verbs.has('openning')).toBe(false);
    expect([...buildSurfaceMap([{ word: 'plain' }]).keys()]).toEqual(['plain']);
  });

  it('should generate only valid conservative forms for irregular words contractions and long adjectives', () => {
    const map = buildSurfaceMap([
      { word: 'see', pos: 'verb' }, { word: 'run', pos: 'verb' }, { word: 'write', pos: 'verb' },
      { word: 'child', pos: 'noun' }, { word: 'beautiful', pos: 'adjective' },
      { word: "can't", pos: 'verb' }, { word: 'does', pos: 'verb' },
    ]);
    expect([...map.keys()]).toEqual(expect.arrayContaining(['see', 'sees', 'seeing', 'seen', 'run', 'runs', 'running', 'ran', 'write', 'writes', 'writing', 'wrote', 'written', 'child', 'children', 'beautiful', "can't", 'does']));
    expect(map.has('saw')).toBe(false);
    for (const fake of ['seed', 'seing', 'runed', 'runing', 'runned', 'writed', 'childs', 'beautifuler', 'beautifulest', "can'ted", "can'ting", 'doeses', 'doesed']) expect(map.has(fake)).toBe(false);
  });

  it('should infer missing parts of speech from definition prefixes before generating forms', () => {
    const map = buildSurfaceMap([
      { word: 'deliberate', definition: 'v. 仔细考虑；a. 故意的' },
      { word: 'book', definition: 'n. 书' },
    ]);
    expect(map.get('deliberated')).toBe('deliberate');
    expect(map.get('deliberating')).toBe('deliberate');
    expect(map.get('books')).toBe('book');
    expect(map.has('booked')).toBe(false);
  });

  it('should normalize abbreviated adjective and transitive or intransitive verb prefixes when pos is absent', () => {
    const map = buildSurfaceMap([
      { word: 'happy', definition: 'a. 快乐的' },
      { word: 'consider', definition: 'vt. 考虑' },
      { word: 'arrive', definition: 'vi. 到达' },
    ]);
    expect(map.get('happier')).toBe('happy');
    expect(map.get('happiest')).toBe('happy');
    expect(map.get('considered')).toBe('consider');
    expect(map.get('considering')).toBe('consider');
    expect(map.get('arrived')).toBe('arrive');
    expect(map.get('arriving')).toBe('arrive');
  });

  it('should publish straight and curly apostrophe surfaces without generating contraction inflections', () => {
    const map = buildSurfaceMap([{ word: "don't", pos: 'verb' }]);
    expect(map.get("don't")).toBe("don't");
    expect(map.get('don’t')).toBe("don't");
    expect(map.has("don'ted")).toBe(false);
  });

  it('should keep already inflected nouns conservative and handle short irregular verb rules', () => {
    const map = buildSurfaceMap([
      { word: 'children', pos: 'noun' },
      { word: 'have', pos: 'verb' },
      { word: 'go', pos: 'verb' },
    ]);
    expect([...map.keys()]).toEqual(expect.arrayContaining(['children', 'have', 'having', 'had', 'go', 'goes', 'going', 'went', 'gone']));
    expect(map.has('childrens')).toBe(false);
  });

  it('should retain explicit be and have irregular surfaces even when generic ambiguity rules deny them', () => {
    const map = buildSurfaceMap([{ word: 'be', pos: 'verb' }, { word: 'have', pos: 'verb' }]);
    expect(map.get('is')).toBe('be');
    expect(map.get('was')).toBe('be');
    expect(map.get('has')).toBe('have');
  });
});
