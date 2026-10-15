import { AMBIGUOUS_INFLECTION_SURFACES as REVIEWED_AMBIGUOUS_INFLECTION_SURFACES } from './ambiguous-inflections.reviewed.mjs';

const SURFACE_RE = /^(?=.{1,64}$)[a-z]+(?:['’-][a-z]+)*$/u;
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const DENYLIST = new Set([
  'us', 'as', 'is', 'was', 'has', 'its', 'bus', 'gas', 'yes', 'this', 'thus', 'plus',
  'his', 'hers', 'ours', 'news', 'series', 'species', 'basis', 'analysis',
]);

// These high-frequency surfaces have common standalone meanings in the bundled
// dictionary. Without a reliable local POS tag, treating them as inflections
// creates more false positives than useful matches.
export const AMBIGUOUS_INFLECTION_SURFACES = new Set(REVIEWED_AMBIGUOUS_INFLECTION_SURFACES);

const IRREGULAR_VERBS = new Map(Object.entries({
  abide: ['abode', 'abode'],
  alight: ['alit', 'alit'],
  arise: ['arose', 'arisen'],
  awake: ['awoke', 'awoken'],
  be: ['was', 'been'],
  bear: ['bore', 'borne'],
  beat: ['beat', 'beaten'],
  become: ['became', 'become'],
  behold: ['beheld', 'beheld'],
  bend: ['bent', 'bent'],
  beset: ['beset', 'beset'],
  bet: ['bet', 'bet'],
  bid: ['bid', 'bid'],
  bind: ['bound', 'bound'],
  bite: ['bit', 'bitten'],
  bleed: ['bled', 'bled'],
  blow: ['blew', 'blown'],
  break: ['broke', 'broken'],
  breed: ['bred', 'bred'],
  bring: ['brought', 'brought'],
  broadcast: ['broadcast', 'broadcast'],
  build: ['built', 'built'],
  burn: ['burnt', 'burnt'],
  burst: ['burst', 'burst'],
  buy: ['bought', 'bought'],
  cast: ['cast', 'cast'],
  catch: ['caught', 'caught'],
  choose: ['chose', 'chosen'],
  cling: ['clung', 'clung'],
  clothe: ['clothed', 'clad'],
  come: ['came', 'come'],
  cost: ['cost', 'cost'],
  creep: ['crept', 'crept'],
  cut: ['cut', 'cut'],
  deal: ['dealt', 'dealt'],
  dig: ['dug', 'dug'],
  dive: ['dove', 'dived'],
  do: ['did', 'done'],
  draw: ['drew', 'drawn'],
  dream: ['dreamt', 'dreamt'],
  drink: ['drank', 'drunk'],
  drive: ['drove', 'driven'],
  dwell: ['dwelt', 'dwelt'],
  eat: ['ate', 'eaten'],
  fall: ['fell', 'fallen'],
  feed: ['fed', 'fed'],
  feel: ['felt', 'felt'],
  fight: ['fought', 'fought'],
  find: ['found', 'found'],
  fit: ['fit', 'fit'],
  flee: ['fled', 'fled'],
  fling: ['flung', 'flung'],
  fly: ['flew', 'flown'],
  forbid: ['forbade', 'forbidden'],
  forecast: ['forecast', 'forecast'],
  foretell: ['foretold', 'foretold'],
  forget: ['forgot', 'forgotten'],
  forgive: ['forgave', 'forgiven'],
  freeze: ['froze', 'frozen'],
  get: ['got', 'gotten'],
  give: ['gave', 'given'],
  go: ['went', 'gone'],
  grind: ['ground', 'ground'],
  grow: ['grew', 'grown'],
  hang: ['hung', 'hung'],
  have: ['had', 'had'],
  hear: ['heard', 'heard'],
  hide: ['hid', 'hidden'],
  hit: ['hit', 'hit'],
  hold: ['held', 'held'],
  hurt: ['hurt', 'hurt'],
  input: ['input', 'input'],
  keep: ['kept', 'kept'],
  kneel: ['knelt', 'knelt'],
  know: ['knew', 'known'],
  lay: ['laid', 'laid'],
  lead: ['led', 'led'],
  lean: ['leant', 'leant'],
  leap: ['leapt', 'leapt'],
  learn: ['learnt', 'learnt'],
  leave: ['left', 'left'],
  lend: ['lent', 'lent'],
  let: ['let', 'let'],
  lie: ['lay', 'lain'],
  light: ['lit', 'lit'],
  lose: ['lost', 'lost'],
  make: ['made', 'made'],
  mean: ['meant', 'meant'],
  meet: ['met', 'met'],
  mislead: ['misled', 'misled'],
  mistake: ['mistook', 'mistaken'],
  mow: ['mowed', 'mown'],
  offset: ['offset', 'offset'],
  outgrow: ['outgrew', 'outgrown'],
  outrun: ['outran', 'outrun'],
  overcome: ['overcame', 'overcome'],
  oversleep: ['overslept', 'overslept'],
  overtake: ['overtook', 'overtaken'],
  pay: ['paid', 'paid'],
  prove: ['proved', 'proven'],
  put: ['put', 'put'],
  quit: ['quit', 'quit'],
  read: ['read', 'read'],
  redo: ['redid', 'redone'],
  repay: ['repaid', 'repaid'],
  reset: ['reset', 'reset'],
  retake: ['retook', 'retaken'],
  rewrite: ['rewrote', 'rewritten'],
  ride: ['rode', 'ridden'],
  ring: ['rang', 'rung'],
  rise: ['rose', 'risen'],
  run: ['ran', 'run'],
  saw: ['sawed', 'sawn'],
  say: ['said', 'said'],
  see: ['saw', 'seen'],
  seek: ['sought', 'sought'],
  sell: ['sold', 'sold'],
  send: ['sent', 'sent'],
  set: ['set', 'set'],
  sew: ['sewed', 'sewn'],
  shake: ['shook', 'shaken'],
  shed: ['shed', 'shed'],
  shine: ['shone', 'shone'],
  shoot: ['shot', 'shot'],
  show: ['showed', 'shown'],
  shrink: ['shrank', 'shrunk'],
  shut: ['shut', 'shut'],
  sing: ['sang', 'sung'],
  sink: ['sank', 'sunk'],
  sit: ['sat', 'sat'],
  slay: ['slew', 'slain'],
  sleep: ['slept', 'slept'],
  slide: ['slid', 'slid'],
  sling: ['slung', 'slung'],
  slit: ['slit', 'slit'],
  smell: ['smelt', 'smelt'],
  sneak: ['snuck', 'snuck'],
  sow: ['sowed', 'sown'],
  speak: ['spoke', 'spoken'],
  speed: ['sped', 'sped'],
  spell: ['spelt', 'spelt'],
  spend: ['spent', 'spent'],
  spill: ['spilt', 'spilt'],
  spin: ['spun', 'spun'],
  spit: ['spat', 'spat'],
  split: ['split', 'split'],
  spoil: ['spoilt', 'spoilt'],
  spread: ['spread', 'spread'],
  spring: ['sprang', 'sprung'],
  stand: ['stood', 'stood'],
  stave: ['stove', 'stove'],
  steal: ['stole', 'stolen'],
  stick: ['stuck', 'stuck'],
  sting: ['stung', 'stung'],
  stink: ['stank', 'stunk'],
  stride: ['strode', 'stridden'],
  strike: ['struck', 'struck'],
  string: ['strung', 'strung'],
  strive: ['strove', 'striven'],
  swear: ['swore', 'sworn'],
  sweep: ['swept', 'swept'],
  swell: ['swelled', 'swollen'],
  swim: ['swam', 'swum'],
  swing: ['swung', 'swung'],
  take: ['took', 'taken'],
  teach: ['taught', 'taught'],
  tear: ['tore', 'torn'],
  tell: ['told', 'told'],
  think: ['thought', 'thought'],
  throw: ['threw', 'thrown'],
  thrust: ['thrust', 'thrust'],
  tread: ['trod', 'trodden'],
  understand: ['understood', 'understood'],
  undergo: ['underwent', 'undergone'],
  undertake: ['undertook', 'undertaken'],
  upset: ['upset', 'upset'],
  wake: ['woke', 'woken'],
  wear: ['wore', 'worn'],
  weave: ['wove', 'woven'],
  wed: ['wed', 'wed'],
  weep: ['wept', 'wept'],
  wet: ['wet', 'wet'],
  win: ['won', 'won'],
  wind: ['wound', 'wound'],
  withdraw: ['withdrew', 'withdrawn'],
  withstand: ['withstood', 'withstood'],
  wring: ['wrung', 'wrung'],
  write: ['wrote', 'written'],
}));

const IRREGULAR_NOUNS = new Map(Object.entries({
  analysis: ['analyses'],
  axis: ['axes'],
  crisis: ['crises'],
  child: ['children'], man: ['men'], woman: ['women'], person: ['people'], mouse: ['mice'],
  tooth: ['teeth'], foot: ['feet'], goose: ['geese'], ox: ['oxen'],
}));

const O_ES_NOUNS = new Set(['echo', 'hero', 'potato', 'tomato']);
const VES_NOUNS = new Map([
  ['calf', 'calves'], ['half', 'halves'], ['knife', 'knives'], ['leaf', 'leaves'],
  ['life', 'lives'], ['loaf', 'loaves'], ['self', 'selves'], ['shelf', 'shelves'],
  ['thief', 'thieves'], ['wife', 'wives'], ['wolf', 'wolves'],
]);

const IRREGULAR_COMPARATIVES = new Map(Object.entries({
  good: ['better', 'best'], well: ['better', 'best'], bad: ['worse', 'worst'],
  far: ['farther', 'farthest', 'further', 'furthest'],
}));

const IRREGULAR = new Map([...IRREGULAR_VERBS.entries(), ...Object.entries({
  be: ['am', 'are', 'is', 'was', 'were', 'been', 'being'],
  child: ['children'],
  man: ['men'],
  woman: ['women'],
  person: ['people'],
  mouse: ['mice'],
  tooth: ['teeth'],
  foot: ['feet'],
  goose: ['geese'],
  ox: ['oxen'],
  good: ['better', 'best'],
  well: ['better', 'best'],
  bad: ['worse', 'worst'],
  far: ['farther', 'farthest', 'further', 'furthest'],
})].map(([lemma, forms]) => [lemma, [...new Set(forms)].filter((form) => form !== lemma)]));

function normalize(value) {
  return String(value ?? '').normalize('NFC').trim().toLowerCase().replaceAll('’', "'");
}

function isSurface(value) {
  return SURFACE_RE.test(value);
}

function isConsonant(value) {
  return /^[a-z]$/u.test(value) && !VOWELS.has(value);
}

function endsConsonantY(word) {
  return word.length > 1 && word.endsWith('y') && isConsonant(word.at(-2));
}

function isCvc(word) {
  if (word.length < 3) return false;
  const [a, b, c] = word.slice(-3);
  return isConsonant(a) && VOWELS.has(b) && isConsonant(c) && !['w', 'x', 'y'].includes(c);
}

function addCandidate(set, surface, allowDenied = false) {
  if (isSurface(surface) && (allowDenied || !DENYLIST.has(surface))) set.add(surface);
}

function normalizePos(value) {
  const pos = normalize(value).replace(/\.$/u, '');
  if (['n', 'noun', '名词'].includes(pos)) return 'noun';
  if (['v', 'vt', 'vi', 'verb', '动词'].includes(pos)) return 'verb';
  if (['a', 'adj', 'adjective', '形容词'].includes(pos)) return 'comparative';
  if (['adv', 'adverb', '副词'].includes(pos)) return 'adverb';
  return '';
}

function partsOf(value) {
  const parts = new Set();
  const add = (token) => {
    const part = normalizePos(token);
    if (part) parts.add(part);
  };
  const pos = typeof value === 'object' && value !== null ? value.pos : '';
  for (const token of String(pos ?? '').split(/[\s,;/；|]+/u)) add(token);
  if (parts.size === 0 && typeof value === 'object' && value !== null) {
    const definition = String(value.definition ?? '');
    for (const match of definition.matchAll(/(?:^|[;；\n])\s*(vt|vi|v|n|a|adj|adv|verb|noun|adjective|adverb)\./giu)) add(match[1]);
  }
  return parts;
}

const INFLECTED_VERB_SURFACES = new Set([
  ...[...IRREGULAR_VERBS.values()].flat(), 'am', 'are', 'is', 'does', 'has',
]);
const INFLECTED_NOUN_SURFACES = new Set([...IRREGULAR_NOUNS.values()].flat());

function thirdPerson(lemma) {
  if (lemma === 'be') return 'is';
  if (lemma === 'have') return 'has';
  if (endsConsonantY(lemma)) return `${lemma.slice(0, -1)}ies`;
  return /(s|x|z|ch|sh|o)$/u.test(lemma) ? `${lemma}es` : `${lemma}s`;
}

function presentParticiple(lemma) {
  if (lemma === 'be') return 'being';
  if (lemma.endsWith('ie')) return `${lemma.slice(0, -2)}ying`;
  if (/(?:ee|ye|oe)$/u.test(lemma)) return `${lemma}ing`;
  if (lemma.endsWith('e')) return `${lemma.slice(0, -1)}ing`;
  if (lemma.endsWith('c')) return `${lemma}king`;
  const syllables = lemma.match(/[aeiouy]+/gu)?.length ?? 0;
  if (syllables === 1 && isCvc(lemma)) return `${lemma}${lemma.at(-1)}ing`;
  if (syllables > 1 && isCvc(lemma)) return `${lemma}ing`;
  return `${lemma}ing`;
}

function regularPast(lemma) {
  if (endsConsonantY(lemma)) return `${lemma.slice(0, -1)}ied`;
  if (lemma.endsWith('e')) return `${lemma}d`;
  if (lemma.endsWith('c')) return `${lemma}ked`;
  const syllables = lemma.match(/[aeiouy]+/gu)?.length ?? 0;
  if (syllables === 1 && isCvc(lemma)) return `${lemma}${lemma.at(-1)}ed`;
  if (syllables > 1 && isCvc(lemma)) return `${lemma}ed`;
  return `${lemma}ed`;
}

function generatedForms(lemma, pos) {
  const forms = new Set();
  if (lemma.includes("'")) return forms;
  if (pos === 'noun') {
    if (INFLECTED_NOUN_SURFACES.has(lemma) && !IRREGULAR_NOUNS.has(lemma)) return forms;
    const irregular = IRREGULAR_NOUNS.get(lemma);
    if (irregular) for (const form of irregular) addCandidate(forms, form, true);
    else if (VES_NOUNS.has(lemma)) addCandidate(forms, VES_NOUNS.get(lemma));
    else if (/fe?$/u.test(lemma)) return forms;
    else if (O_ES_NOUNS.has(lemma)) addCandidate(forms, `${lemma}es`);
    else if (endsConsonantY(lemma)) addCandidate(forms, `${lemma.slice(0, -1)}ies`);
    else if (/[^z]z$/u.test(lemma)) addCandidate(forms, `${lemma}zes`);
    else if (lemma.endsWith('s')) return forms;
    else if (/(x|zz|ch|sh)$/u.test(lemma)) addCandidate(forms, `${lemma}es`);
    else addCandidate(forms, `${lemma}s`);
    return forms;
  }
  if (pos === 'comparative') {
    const irregular = IRREGULAR_COMPARATIVES.get(lemma);
    if (irregular) for (const form of irregular) addCandidate(forms, form, true);
    else if (endsConsonantY(lemma)) {
      addCandidate(forms, `${lemma.slice(0, -1)}ier`);
      addCandidate(forms, `${lemma.slice(0, -1)}iest`);
    } else if ((lemma.match(/[aeiouy]+/gu)?.length ?? 0) === 1 && isCvc(lemma)) {
      addCandidate(forms, `${lemma}${lemma.at(-1)}er`);
      addCandidate(forms, `${lemma}${lemma.at(-1)}est`);
    } else if ((lemma.match(/[aeiouy]+/gu)?.length ?? 0) === 1) {
      addCandidate(forms, `${lemma}er`);
      addCandidate(forms, `${lemma}est`);
    }
    return forms;
  }
  if (pos !== 'verb') return forms;
  if (INFLECTED_VERB_SURFACES.has(lemma) && !IRREGULAR_VERBS.has(lemma)) return forms;
  const irregular = IRREGULAR_VERBS.get(lemma);
  for (const form of irregular ?? []) addCandidate(forms, form, true);
  if (lemma === 'be') for (const form of ['am', 'are', 'is', 'was', 'were', 'been', 'being']) addCandidate(forms, form, true);
  addCandidate(forms, thirdPerson(lemma), lemma === 'be' || lemma === 'have');
  addCandidate(forms, presentParticiple(lemma));
  if (!irregular) addCandidate(forms, regularPast(lemma));
  return forms;
}

export function inflectionKindsFor(lemmaValue, surfaceValue) {
  const lemma = normalize(lemmaValue);
  const surface = normalize(surfaceValue);
  const kinds = new Set();
  if (!isSurface(lemma) || !isSurface(surface) || lemma === surface) return kinds;
  if (generatedForms(lemma, 'noun').has(surface)) kinds.add('plural');
  if (thirdPerson(lemma) === surface) kinds.add('thirdPerson');
  if (presentParticiple(lemma) === surface) kinds.add('presentParticiple');
  const irregular = IRREGULAR_VERBS.get(lemma);
  if (irregular?.[0] === surface || (!irregular && regularPast(lemma) === surface)) kinds.add('past');
  if (irregular?.[1] === surface || (!irregular && regularPast(lemma) === surface)) kinds.add('pastParticiple');
  const comparative = IRREGULAR_COMPARATIVES.get(lemma);
  if (comparative?.[0] === surface) kinds.add('comparative');
  if (comparative?.[1] === surface) kinds.add('superlative');
  if (!comparative) {
    const forms = [...generatedForms(lemma, 'comparative')];
    if (forms[0] === surface) kinds.add('comparative');
    if (forms[1] === surface) kinds.add('superlative');
  }
  return kinds;
}

function chooseLemma(surface, current, next, collected) {
  if (!current) return next;
  if (surface === current) return current;
  if (surface === next && collected.has(next)) return next;
  return next.localeCompare(current) < 0 ? next : current;
}

export function buildSurfaceMap(words) {
  const collected = new Set();
  const parts = new Map();
  for (const value of words) {
    const word = normalize(typeof value === 'object' && value !== null ? value.word : value);
    if (!isSurface(word)) continue;
    collected.add(word);
    const found = parts.get(word) ?? new Set();
    for (const part of partsOf(value)) found.add(part);
    parts.set(word, found);
  }
  const candidates = new Map();
  for (const lemma of collected) {
    const surfaces = new Set([lemma]);
    if (lemma.includes("'")) surfaces.add(lemma.replaceAll("'", '’'));
    const generatedParts = parts.get(lemma) ?? new Set();
    for (const part of generatedParts) for (const surface of generatedForms(lemma, part)) surfaces.add(surface);
    for (const surface of surfaces) {
      if (!isSurface(surface)) continue;
      if (surface !== lemma && AMBIGUOUS_INFLECTION_SURFACES.has(surface)) continue;
      candidates.set(surface, chooseLemma(surface, candidates.get(surface), lemma, collected));
    }
  }
  return candidates;
}

export function inflectionPriority(lemma, surface) {
  if (surface === lemma) return 0;
  return (IRREGULAR.get(lemma) ?? []).includes(surface) ? 1 : 2;
}
