import { assertEnglishWord, isEnglishWordPrefix, normalizeWord } from './note-format.mjs';
import { inflectionKindsFor } from './inflections.mjs';
import { decideInflectionForms, dictionaryExchangeLemma, inflectionCandidateSurfaces } from './inflection-policy.mjs';

const LETTER_RE = /^[a-z]$/u;
const cache = new Map();
const enrichmentCache = new Map();
const IRREGULAR_BASES = new Map([
  ['ran', 'run'],
  ['went', 'go'],
  ['gone', 'go'],
]);
const HYPHEN_ALIASES = new Map([
  ['co-operate', 'cooperate'],
  ['e-mail', 'email'],
]);

function firstLetter(word) {
  const letter = word[0];
  return LETTER_RE.test(letter) ? letter : null;
}

async function defaultImporter(letter) {
  try {
    return await import(new URL(`./dict/${letter}.mjs`, import.meta.url).href);
  } catch (error) {
    if (!String(import.meta.url).includes('/src/')) throw error;
    return import(new URL(`../dict/${letter}.mjs`, import.meta.url).href);
  }
}

export function resetDictionaryCache() {
  cache.clear();
  enrichmentCache.clear();
}

export function loadChunk(letter, importer = defaultImporter) {
  if (!LETTER_RE.test(String(letter))) return Promise.resolve(null);
  if (!cache.has(letter)) {
    const pending = Promise.resolve().then(() => importer(letter)).then((module) => module.default ?? module);
    cache.set(letter, pending.catch((error) => {
      cache.delete(letter);
      throw error;
    }));
  }
  return cache.get(letter);
}

async function entryFor(word, importer) {
  const letter = firstLetter(word);
  if (!letter) return null;
  const chunk = await loadChunk(letter, importer);
  return chunk && Object.hasOwn(chunk, word) ? chunk[word] : null;
}

function exchangeLemma(entry) {
  return dictionaryExchangeLemma(entry);
}

function exchangeKinds(entry) {
  const code = String(entry?.x ?? '').match(/(?:^|\/)1:([^/]+)/u)?.[1] ?? '';
  const kinds = new Set();
  for (const [marker, kind] of [
    ['r', 'comparative'], ['t', 'superlative'], ['i', 'presentParticiple'],
    ['3', 'thirdPerson'], ['s', 'plural'], ['p', 'pastParticiple'], ['d', 'past'],
  ]) if (code.includes(marker)) kinds.add(kind);
  return kinds;
}

function translatedLemma(entry) {
  const match = String(entry?.t ?? '').match(/([a-z][a-z'-]*)\s*的?\s*(?:过去式|过去分词|现在分词|复数|第三人称单数|比较级|最高级)/iu);
  return match?.[1]?.toLowerCase() ?? null;
}

function isPurePluralInflection(entry, lemmaEntry) {
  const lines = String(entry?.t ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length || !lines.every((line) => /^pl\.\s+/iu.test(line))) return false;
  const lemmas = [...String(entry?.x ?? '').matchAll(/(?:^|\/)0:([^/]+)/gu)];
  const kinds = exchangeKinds(entry);
  return lemmas.length === 1 && kinds.size === 1 && kinds.has('plural') && entrySupportsKinds(lemmaEntry, new Set(['plural']));
}

function isPureInflection(entry, lemmaEntry) {
  const lines = String(entry?.t ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length || !exchangeLemma(entry)) return false;
  if (lines.every((line) => /^pl\.\s+/iu.test(line))) return isPurePluralInflection(entry, lemmaEntry);
  return lines.every((line) => line
    .replace(/^(?:n|v|vt|vi|a|adj|adv|prep|conj|pron)\.\s*/iu, '')
    .match(/^[a-z][a-z'-]*\s*的\s*(?:过去式|过去分词|现在分词|复数|第三人称单数|比较级|最高级)(?:\b|$|[，。,；;])/iu));
}

function entrySupportsKinds(entry, kinds) {
  const definitions = `${String(entry?.t ?? '')}\n${String(entry?.d ?? '')}`;
  const noun = /(?:^|\n)\s*(?:n\.|pl\.)/imu.test(definitions);
  const verb = /(?:^|\n)\s*(?:v\.|vt\.|vi\.)/imu.test(definitions);
  const adjective = /(?:^|\n)\s*(?:a\.|adj\.|adv\.)/imu.test(definitions);
  if (kinds.has('plural') && noun) return true;
  if ([...kinds].some((kind) => ['past', 'pastParticiple', 'presentParticiple', 'thirdPerson'].includes(kind)) && verb) return true;
  return [...kinds].some((kind) => ['comparative', 'superlative'].includes(kind)) && adjective;
}

function inflectionKind(entry, lemma, surface, verifiedKinds = inflectionKindsFor(lemma, surface)) {
  const lines = String(entry?.t ?? '').split('\n');
  const related = lines.find((line) => line.toLowerCase().includes(lemma)) ?? lines.join('\n');
  const label = related.match(/(?:过去式|过去分词|现在分词|复数|第三人称单数|比较级|最高级)/u)?.[0];
  const translated = {
    过去式: 'past', 过去分词: 'pastParticiple', 现在分词: 'presentParticiple', 复数: 'plural',
    第三人称单数: 'thirdPerson', 比较级: 'comparative', 最高级: 'superlative',
  }[label];
  if (translated && verifiedKinds.has(translated)) return translated;
  const code = String(entry?.x ?? '').match(/(?:^|\/)1:([^/]+)/u)?.[1] ?? '';
  const definitions = `${String(entry?.t ?? '')}\n${String(entry?.d ?? '')}`;
  const noun = /(?:^|\n)\s*(?:n\.|pl\.)/imu.test(definitions);
  const verb = /(?:^|\n)\s*(?:v\.|vt\.|vi\.)/imu.test(definitions);
  if (noun && code.includes('s') && verifiedKinds.has('plural')) return 'plural';
  const coded = [
    ['r', 'comparative'], ['t', 'superlative'], ['i', 'presentParticiple'],
    ['3', 'thirdPerson'], ['s', 'plural'], ['p', 'pastParticiple'], ['d', 'past'],
  ];
  for (const [marker, kind] of coded) {
    if (code.includes(marker) && verifiedKinds.has(kind) && (kind !== 'thirdPerson' || verb || !noun)) return kind;
  }
  return verifiedKinds.size === 1 ? [...verifiedKinds][0] : '';
}

function candidateBases(surface) {
  const bases = [];
  const add = (value) => {
    if (value && value !== surface && /^[a-z]+(?:'[a-z]+)*$/u.test(value) && !bases.includes(value)) bases.push(value);
  };
  add(IRREGULAR_BASES.get(surface));
  if (surface.endsWith('zzes') && surface.length > 5) add(surface.slice(0, -3));
  if (surface.endsWith('ies') && surface.length > 4) add(`${surface.slice(0, -3)}y`);
  if (surface.endsWith('ied') && surface.length > 4) add(`${surface.slice(0, -3)}y`);
  if (surface.endsWith('ing') && surface.length > 5) {
    const stem = surface.slice(0, -3);
    add(stem);
    add(`${stem}e`);
    if (stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
  }
  if (surface.endsWith('ed') && surface.length > 4) {
    const stem = surface.slice(0, -2);
    add(stem);
    add(`${stem}e`);
    if (stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
  }
  if (surface.endsWith('es') && surface.length > 4) add(surface.slice(0, -2));
  if (surface.endsWith('oes') && surface.length > 4) add(surface.slice(0, -2));
  if (surface.endsWith('s') && surface.length > 3) add(surface.slice(0, -1));
  if (surface.endsWith('er') && surface.length > 4) {
    const stem = surface.slice(0, -2);
    add(stem);
    if (stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
  }
  if (surface.endsWith('est') && surface.length > 5) {
    const stem = surface.slice(0, -3);
    add(stem);
    if (stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
  }
  return bases;
}

export async function lookup(word, { importer = defaultImporter } = {}) {
  const displaySurface = String(word ?? '').normalize('NFC').trim().toLowerCase();
  let surface;
  try { surface = assertEnglishWord(word); } catch { return null; }
  const letter = firstLetter(surface);
  if (!letter) return null;
  const direct = await entryFor(surface, importer);
  if (direct) {
    const exchange = exchangeLemma(direct);
    const candidates = [translatedLemma(direct), exchange, ...candidateBases(surface)].filter(Boolean);
    let lemma = null;
    let verifiedKinds = new Set();
    for (const candidate of candidates) {
      const kinds = inflectionKindsFor(candidate, surface);
      if (exchange === candidate) for (const kind of exchangeKinds(direct)) kinds.add(kind);
      const candidateEntry = candidate !== surface && kinds.size > 0 ? await entryFor(candidate, importer) : null;
      if (candidateEntry && entrySupportsKinds(candidateEntry, kinds)) {
        lemma = candidate;
        verifiedKinds = kinds;
        break;
      }
    }
    if (lemma && lemma !== surface) {
      const lemmaEntry = await entryFor(lemma, importer);
      if (lemmaEntry && isPureInflection(direct, lemmaEntry)) return { surface: displaySurface, lemma, entry: lemmaEntry, surfaceEntry: direct };
    }
    const kind = lemma && lemma !== surface ? inflectionKind(direct, lemma, surface, verifiedKinds) : '';
    const inflection = kind ? { lemma, kind } : undefined;
    return { surface: displaySurface, lemma: surface, entry: direct, surfaceEntry: direct, ...(inflection ? { inflection } : {}) };
  }
  const alias = HYPHEN_ALIASES.get(surface);
  if (alias) {
    const entry = await entryFor(alias, importer);
    if (entry) return { surface: displaySurface, lemma: alias, entry, surfaceEntry: null };
  }
  for (const lemma of candidateBases(surface)) {
    const kinds = inflectionKindsFor(lemma, surface);
    if (kinds.size === 0) continue;
    const entry = await entryFor(lemma, importer);
    if (entry && entrySupportsKinds(entry, kinds)) return { surface: displaySurface, lemma, entry, surfaceEntry: null };
  }
  return null;
}

export async function suggest(prefix, n = 8, { importer = defaultImporter } = {}) {
  const normalized = normalizeWord(prefix);
  if (normalized && !isEnglishWordPrefix(normalized)) return [];
  const letter = firstLetter(normalized);
  if (!letter || normalized.length < 1) return [];
  const chunk = await loadChunk(letter, importer);
  if (!chunk) return [];
  const matches = Object.entries(chunk).filter(([word]) => word.startsWith(normalized));
  for (const [alias, canonical] of HYPHEN_ALIASES) {
    if (!alias.startsWith(normalized)) continue;
    const entry = await entryFor(canonical, importer);
    if (entry) matches.push([alias, entry]);
  }
  const lemmaTargets = new Set(matches.map(([, entry]) => exchangeLemma(entry)).filter((lemma) => lemma?.startsWith(normalized)));
  return matches
    .sort(([leftWord, left], [rightWord, right]) => {
      const leftLemma = exchangeLemma(left);
      const rightLemma = exchangeLemma(right);
      const leftParadigm = /(?:^|\/)(?:d|i|p|3):/u.test(String(left.x ?? ''));
      const rightParadigm = /(?:^|\/)(?:d|i|p|3):/u.test(String(right.x ?? ''));
      const leftInflection = lemmaTargets.has(leftWord) && leftParadigm ? 0 : lemmaTargets.has(leftWord) ? 1 : leftLemma?.startsWith(normalized) ? 2 : 3;
      const rightInflection = lemmaTargets.has(rightWord) && rightParadigm ? 0 : lemmaTargets.has(rightWord) ? 1 : rightLemma?.startsWith(normalized) ? 2 : 3;
      if (leftInflection !== rightInflection) return leftInflection - rightInflection;
      const leftRank = Number.isFinite(left.r) ? left.r : Number.POSITIVE_INFINITY;
      const rightRank = Number.isFinite(right.r) ? right.r : Number.POSITIVE_INFINITY;
      return leftRank - rightRank || leftWord.localeCompare(rightWord);
    })
    .slice(0, n)
    .map(([word, entry]) => ({ word, entry }));
}

export function dictionaryDefinition(entry, locale = 'en') {
  const chinese = String(entry?.t ?? '').split('\n').filter(Boolean);
  const english = String(entry?.d ?? '').split('\n').filter(Boolean).map(normalizeDefinitionLine);
  const first = locale.toLowerCase().startsWith('zh') ? chinese : english;
  const second = first === chinese ? english : chinese;
  return [...first, ...second].join('\n');
}

export function normalizeDefinitionLine(line) {
  const labels = { n: 'n.', v: 'v.', a: 'adj.', s: 'adj.', r: 'adv.' };
  return String(line).replace(/^([nvasr])\.?\s+/u, (match, label) => `${labels[label]} `);
}

export function inferPos(entry) {
  const names = {
    n: 'noun',
    v: 'verb',
    vt: 'verb',
    vi: 'verb',
    a: 'adjective',
    adj: 'adjective',
    adv: 'adverb',
    prep: 'preposition',
    conj: 'conjunction',
    pron: 'pronoun',
  };
  const found = new Set();
  for (const line of `${String(entry?.t ?? '')}\n${String(entry?.d ?? '')}`.split('\n')) {
    const prefix = line.match(/^\s*(n|v|vt|vi|a|adj|adv|prep|conj|pron)\.?\s/iu)?.[1]?.toLowerCase();
    if (names[prefix]) found.add(names[prefix]);
  }
  return found.size ? [...found].join(', ') : undefined;
}

async function verifiedForms(word, entry, pos, importer) {
  const candidates = inflectionCandidateSurfaces({ lemma: word, entry, pos });
  const surfaceEntries = new Map();
  let incomplete = false;
  for (const surface of candidates) {
    try {
      surfaceEntries.set(surface, await entryFor(surface, importer));
    } catch {
      incomplete = true;
    }
  }
  return { ...decideInflectionForms({ lemma: word, entry, pos, surfaceEntries }), incomplete };
}

export async function enrichVocabularyEntries(entries, { importer = defaultImporter } = {}) {
  let incomplete = false;
  const enriched = await Promise.all(entries.map(async (entry) => {
    const word = normalizeWord(entry?.word);
    let dictionaryEntry;
    try {
      if (importer === defaultImporter) {
        if (!enrichmentCache.has(word)) {
          const pending = entryFor(word, importer);
          enrichmentCache.set(word, pending.catch((error) => {
            /* v8 ignore next -- default module import failures cannot be injected; loadChunk retry and custom importer failure are covered separately. */
            enrichmentCache.delete(word);
            /* v8 ignore next -- preserve the original lazy-import failure for the outer best-effort fallback. */
            throw error;
          }));
        }
        dictionaryEntry = await enrichmentCache.get(word);
      } else dictionaryEntry = await entryFor(word, importer);
    } catch {
      incomplete = true;
      return entry;
    }
    if (!dictionaryEntry) return entry;
    const dictionaryPos = inferPos(dictionaryEntry);
    const verified = await verifiedForms(word, dictionaryEntry, { pos: entry.pos, dictionaryPos }, importer);
    if (verified.incomplete) incomplete = true;
    return {
      ...entry,
      dictionaryPos,
      forms: verified.forms,
    };
  }));
  Object.defineProperty(enriched, 'incomplete', { value: incomplete, enumerable: false });
  return enriched;
}
