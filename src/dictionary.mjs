const LETTER_RE = /^[a-z]$/u;
const cache = new Map();
const IRREGULAR_BASES = new Map([
  ['ran', 'run'],
  ['went', 'go'],
  ['gone', 'go'],
]);

function normalizeWord(value) {
  return String(value ?? '').normalize('NFC').trim().toLowerCase();
}

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
}

export function loadChunk(letter, importer = defaultImporter) {
  if (!LETTER_RE.test(String(letter))) return Promise.resolve(null);
  if (!cache.has(letter)) {
    cache.set(letter, Promise.resolve().then(() => importer(letter)).then((module) => module.default ?? module));
  }
  return cache.get(letter);
}

async function entryFor(word, importer) {
  const letter = firstLetter(word);
  if (!letter) return null;
  const chunk = await loadChunk(letter, importer);
  return chunk?.[word] ?? null;
}

function exchangeLemma(entry) {
  const exchange = String(entry?.x ?? '');
  const match = exchange.match(/(?:^|\/)0:([^/]+)/u);
  if (!match) return null;
  return match[1].split(',')[0]?.trim().toLowerCase() || null;
}

function candidateBases(surface) {
  const bases = [];
  const add = (value) => {
    if (value && value !== surface && /^[a-z]+(?:'[a-z]+)*$/u.test(value) && !bases.includes(value)) bases.push(value);
  };
  add(IRREGULAR_BASES.get(surface));
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
  const surface = normalizeWord(word);
  const letter = firstLetter(surface);
  if (!letter) return null;
  const direct = await entryFor(surface, importer);
  if (direct) {
    const lemma = exchangeLemma(direct);
    if (lemma && lemma !== surface) {
      const lemmaEntry = await entryFor(lemma, importer);
      if (lemmaEntry) return { surface, lemma, entry: lemmaEntry, surfaceEntry: direct };
    }
    return { surface, lemma: surface, entry: direct, surfaceEntry: direct };
  }
  for (const lemma of candidateBases(surface)) {
    const entry = await entryFor(lemma, importer);
    if (entry) return { surface, lemma, entry, surfaceEntry: null };
  }
  return null;
}

export async function suggest(prefix, n = 8, { importer = defaultImporter } = {}) {
  const normalized = normalizeWord(prefix);
  const letter = firstLetter(normalized);
  if (!letter || normalized.length < 1) return [];
  const chunk = await loadChunk(letter, importer);
  if (!chunk) return [];
  return Object.entries(chunk)
    .filter(([word]) => word.startsWith(normalized))
    .sort(([leftWord, left], [rightWord, right]) => {
      const leftRank = Number.isFinite(left.r) ? left.r : Number.POSITIVE_INFINITY;
      const rightRank = Number.isFinite(right.r) ? right.r : Number.POSITIVE_INFINITY;
      return leftRank - rightRank || leftWord.localeCompare(rightWord);
    })
    .slice(0, n)
    .map(([word, entry]) => ({ word, entry }));
}

export function dictionaryDefinition(entry, locale = 'en') {
  const chinese = String(entry?.t ?? '').split('\n').filter(Boolean);
  const english = String(entry?.d ?? '').split('\n').filter(Boolean);
  const first = locale.toLowerCase().startsWith('zh') ? chinese : english;
  const second = first === chinese ? english : chinese;
  return [...first, ...second].join('\n');
}

export function inferPos(entry) {
  const first = String(entry?.t ?? '').split('\n').find(Boolean) ?? '';
  const prefix = first.match(/^\s*(n|v|vt|vi|a|adj|adv|prep|conj|pron)\./iu)?.[1]?.toLowerCase();
  return {
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
  }[prefix];
}
