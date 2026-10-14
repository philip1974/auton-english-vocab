import { describe, expect, it } from 'vitest';
import { buildSurfaceMap } from '../src/inflections.mjs';

describe('inflections', () => {
  it('should generate regular noun verb participle and adjective surfaces when lemma is collected', () => {
    const map = buildSurfaceMap([
      'cat', 'box', 'city', 'stop', 'make', 'die', 'run',
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

  it('should generate comparative forms only when pos is adjective or adverb', () => {
    const map = buildSurfaceMap([
      { word: 'teach', pos: 'verb' },
      { word: 'big', pos: 'AdJeCtIvE' },
      { word: 'quick', pos: '副词' },
      { word: 'happy' },
    ]);
    expect(map.has('teacher')).toBe(false);
    expect(map.get('bigger')).toBe('big');
    expect(map.get('biggest')).toBe('big');
    expect(map.get('quicker')).toBe('quick');
    expect(map.has('happier')).toBe(false);
  });

  it('should include common irregular forms and map collected irregular forms back to their lemma', () => {
    const map = buildSurfaceMap(['go', 'child', 'good']);
    expect(map.get('went')).toBe('go');
    expect(map.get('gone')).toBe('go');
    expect(map.get('children')).toBe('child');
    expect(map.get('better')).toBe('good');
    expect(map.get('best')).toBe('good');
    expect(buildSurfaceMap(['went']).get('go')).toBe('went');
  });

  it('should include expanded common irregular verb forms without duplicate-form conflicts', () => {
    const map = buildSurfaceMap(['arise', 'bear', 'cling', 'forbid', 'lie', 'seek', 'stride', 'undertake', 'weave', 'withdraw', 'read', 'put']);
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
    const exact = buildSurfaceMap(['axis', 'axi']);
    expect(exact.get('axis')).toBe('axis');
    const generated = buildSurfaceMap(['try', 'trie']);
    expect(generated.get('tries')).toBe('trie');
  });

  it('should ignore non English surfaces short generated forms and denylisted false friends', () => {
    const map = buildSurfaceMap(['你好', 'be', 'use', 'bu', 'new']);
    expect(map.has('你好')).toBe(false);
    expect(map.get('be')).toBe('be');
    expect(map.has('bes')).toBe(false);
    expect(map.has('us')).toBe(false);
    expect(map.has('bus')).toBe(false);
    expect(map.has('news')).toBe(false);
  });

  it('should avoid cvc doubling for w x y endings and keep apostrophe words valid', () => {
    const map = buildSurfaceMap([null, "can't", 'mix', 'play', 'snow']);
    expect(map.get("can't")).toBe("can't");
    expect(map.has('mixxed')).toBe(false);
    expect(map.has('playyed')).toBe(false);
    expect(map.has('snowwed')).toBe(false);
    expect(map.get('mixing')).toBe('mix');
  });
});
