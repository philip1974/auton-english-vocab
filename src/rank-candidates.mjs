const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

export const RANK_DENYLIST = new Set([
  'bed', 'red', 'need', 'seed', 'feed', 'sing', 'thing', 'king', 'ring', 'bring',
  'string', 'spring', 'nothing', 'morning', 'evening', 'press', 'less', 'bless',
  'unless', 'analysis', 'basis', 'crisis', 'thesis', 'news', 'series', 'species',
  'bus', 'gas', 'yes', 'this', 'his', 'its', 'was', 'has', 'does', 'is', 'us',
  'plus', 'always', 'perhaps', 'during', 'ceiling', 'wedding', 'pudding', 'fed',
  'shed', 'bred', 'sped', 'wed', 'hundred', 'sacred', 'naked', 'wicked',
  'wretched', 'rugged', 'beloved', 'learned', 'aged', 'blessed', 'cursed',
]);

const IRREGULAR_BASE = {
  take: ['taken', 'took'],
  run: ['ran'],
  be: ['am', 'are', 'been', 'being', 'were'],
  go: ['went', 'gone'],
  write: ['wrote', 'written'],
  speak: ['spoke', 'spoken'],
  see: ['saw', 'seen'],
};

const IRREGULAR_SURFACE = new Map();
for (const [base, forms] of Object.entries(IRREGULAR_BASE)) {
  for (const form of forms) IRREGULAR_SURFACE.set(form, base);
}

const COMPARATIVE_BASES = new Set([
  'big', 'fast', 'small', 'tall', 'short', 'long', 'high', 'low', 'young', 'old',
  'large', 'late', 'nice', 'wide', 'close', 'safe', 'simple', 'clever', 'quiet',
]);

function normalize(value) {
  return String(value ?? '').normalize('NFC').toLowerCase().replaceAll('’', "'");
}

function isConsonant(char) {
  return /^[a-z]$/u.test(char) && !VOWELS.has(char);
}

function addCandidate(candidates, value) {
  if (/^[a-z']{3,}$/u.test(value)) candidates.add(value);
}

export function rankMapFromWords(words) {
  return new Map(words.map((word, index) => [word, index + 1]));
}

export function rankCandidates(surface) {
  const word = normalize(surface);
  const candidates = new Set([word]);
  if (IRREGULAR_SURFACE.has(word)) addCandidate(candidates, IRREGULAR_SURFACE.get(word));
  if (word.length < 5 || RANK_DENYLIST.has(word)) return [...candidates];

  if (word.endsWith('ies')) addCandidate(candidates, `${word.slice(0, -3)}y`);
  if (word.endsWith('ied')) addCandidate(candidates, `${word.slice(0, -3)}y`);
  if (word.endsWith('es')) addCandidate(candidates, word.slice(0, -2));
  if (word.endsWith('s') && !word.endsWith('ss')) addCandidate(candidates, word.slice(0, -1));
  if (word.endsWith('ed')) {
    const stem = word.slice(0, -2);
    addCandidate(candidates, stem);
    addCandidate(candidates, `${stem}e`);
    if (stem.length >= 2 && stem.at(-1) === stem.at(-2) && isConsonant(stem.at(-1))) {
      addCandidate(candidates, stem.slice(0, -1));
    }
  }
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    addCandidate(candidates, stem);
    addCandidate(candidates, `${stem}e`);
    if (stem.length >= 2 && stem.at(-1) === stem.at(-2) && isConsonant(stem.at(-1))) {
      addCandidate(candidates, stem.slice(0, -1));
    }
  }
  if (word.endsWith('ier')) addCandidate(candidates, `${word.slice(0, -3)}y`);
  if (word.endsWith('iest')) addCandidate(candidates, `${word.slice(0, -4)}y`);
  for (const suffix of ['er', 'est']) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    if (COMPARATIVE_BASES.has(stem)) addCandidate(candidates, stem);
    if (COMPARATIVE_BASES.has(`${stem}e`)) addCandidate(candidates, `${stem}e`);
    if (stem.length >= 2 && stem.at(-1) === stem.at(-2) && isConsonant(stem.at(-1))) {
      const undoubled = stem.slice(0, -1);
      if (COMPARATIVE_BASES.has(undoubled)) addCandidate(candidates, undoubled);
    }
  }
  return [...candidates];
}

export function rankOf(surface, table) {
  const ranks = table instanceof Map ? table : rankMapFromWords(table);
  let best = ranks.get(normalize(surface)) ?? Infinity;
  for (const candidate of rankCandidates(surface)) {
    const rank = ranks.get(candidate);
    if (rank && rank < best) best = rank;
  }
  return Number.isFinite(best) ? best : null;
}
