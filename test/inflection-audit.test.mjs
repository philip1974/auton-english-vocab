import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { inferPos } from '../src/dictionary.mjs';
import { decideInflectionForms, inflectionCandidateSurfaces, OBVIOUS_INVALID_INFLECTION_SURFACES } from '../src/inflection-policy.mjs';
import { AMBIGUOUS_INFLECTION_DECISIONS } from '../src/ambiguous-inflections.reviewed.mjs';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

async function bundledDictionary() {
  const dictionary = new Map();
  for (const letter of LETTERS) {
    const chunk = (await import(`../dict/${letter}.mjs`)).default;
    for (const [word, entry] of Object.entries(chunk)) dictionary.set(word, entry);
  }
  return dictionary;
}

describe('corpus inflection audit', () => {
  it('should use only known-pos reliable rules when the lemma has no dictionary entry', () => {
    expect(decideInflectionForms({ lemma: 'walk', pos: { pos: 'verb' } }).forms).toEqual(expect.arrayContaining(['walk', 'walks', 'walking', 'walked']));
    expect(decideInflectionForms({ lemma: 'walk' }).forms).toEqual(['walk']);
  });

  it('should publish no unverified collisions or known misspellings when auditing the top two thousand lemmas', async () => {
    const words = JSON.parse(await readFile('data/en-wordfreq-30k.json', 'utf8')).slice(0, 2000);
    const dictionary = await bundledDictionary();
    const published = new Map();
    const rejected = [];
    let missingRuleAccepted = 0;
    for (const lemma of words) {
      const entry = dictionary.get(lemma);
      if (!entry) continue;
      const pos = { dictionaryPos: inferPos(entry) };
      const candidates = inflectionCandidateSurfaces({ lemma, entry, pos });
      const surfaceEntries = new Map([...candidates].map((surface) => [surface, dictionary.get(surface) ?? null]));
      const decision = decideInflectionForms({ lemma, entry, pos, surfaceEntries });
      published.set(lemma, decision);
      rejected.push(...decision.rejected.map((item) => ({ lemma, ...item })));
      missingRuleAccepted += decision.accepted.filter((item) => item.reason === 'rule-no-entry').length;
    }

    const conflicts = [];
    for (const [lemma, decision] of published) {
      for (const item of decision.accepted) {
        if (item.surface === lemma || item.reason === 'reviewed-irregular') continue;
        const surfaceEntry = dictionary.get(item.surface);
        const reverse = String(surfaceEntry?.x ?? '').match(/(?:^|\/)0:([^/]+)/u)?.[1]?.split(',')[0]?.trim().toLowerCase();
        if (surfaceEntry && reverse !== lemma) conflicts.push(`${lemma}->${item.surface}`);
      }
    }
    expect(conflicts).toEqual([]);

    const derived = new Set([...published.values()].flatMap((decision) => decision.accepted.map((item) => item.surface)));
    for (const typo of ['uping', 'uped', 'controling', 'controled', 'programing', 'forgeting', 'radioes', 'begining', 'begined', 'transfering', 'transfered', 'runner', 'runnest', 'dos', 'gos', 'hering', 'sheeps', 'cloathing']) expect(derived.has(typo)).toBe(false);
    for (const [lemma, forms] of Object.entries({
      big: ['bigger', 'biggest'], happy: ['happier', 'happiest'], easy: ['easier', 'easiest'],
      new: ['newer', 'newest'], great: ['greater', 'greatest'], fast: ['faster', 'fastest'],
      long: ['longer', 'longest'], close: ['closer', 'closest'], light: ['lighter'],
      cool: ['cooler', 'coolest'], clean: ['cleaner'],
    })) for (const surface of forms) expect(published.get(lemma)?.forms).toContain(surface);

    for (const surface of OBVIOUS_INVALID_INFLECTION_SURFACES) expect(derived.has(surface)).toBe(false);

    const reviewedReasons = new Map(AMBIGUOUS_INFLECTION_DECISIONS.filter((item) => item.include).map((item) => [item.surface, item.reason]));
    const unauditedComparatives = [];
    for (const lemma of words) {
      const entry = dictionary.get(lemma);
      if (!entry) continue;
      for (const match of String(entry.x ?? '').matchAll(/(?:^|\/)(r|t):([^/]+)/gu)) {
        for (const surface of match[2].split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)) {
          const reverse = String(dictionary.get(surface)?.x ?? '').match(/(?:^|\/)0:([^/]+)/u)?.[1]?.split(',')[0]?.trim().toLowerCase();
          if (reverse !== lemma) continue;
          if (!published.get(lemma)?.forms.includes(surface) && !reviewedReasons.has(surface)) unauditedComparatives.push(`${lemma}->${surface}`);
        }
      }
    }
    expect(unauditedComparatives).toEqual([]);

    expect(rejected.filter((item) => item.rule === 1 || item.rule === 2).length).toBeGreaterThan(0);
    expect(missingRuleAccepted).toBeGreaterThan(0);
  });
});
