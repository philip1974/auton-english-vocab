const SURFACE_RE = /^[a-z][a-z'’-]{0,63}$/u;
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const DENYLIST = new Set([
  'us', 'as', 'is', 'was', 'has', 'its', 'bus', 'gas', 'yes', 'this', 'thus', 'plus',
  'his', 'hers', 'ours', 'news', 'series', 'species', 'basis', 'analysis',
]);

const IRREGULAR_VERBS = {
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
};

const IRREGULAR = new Map(Object.entries({
  ...IRREGULAR_VERBS,
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
}).map(([lemma, forms]) => [lemma, [...new Set(forms)].filter((form) => form !== lemma)]));

function normalize(value) {
  return String(value ?? '').normalize('NFC').trim().toLowerCase();
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

function addCandidate(set, surface) {
  if (isSurface(surface) && !DENYLIST.has(surface)) set.add(surface);
}

function isComparativePos(value) {
  const pos = normalize(value);
  return ['adj', 'adjective', 'adv', 'adverb', '形容词', '副词'].includes(pos);
}

function generatedForms(lemma, comparative) {
  const forms = new Set();
  for (const form of IRREGULAR.get(lemma) ?? []) addCandidate(forms, form);
  if (lemma.length < 3) return forms;
  if (endsConsonantY(lemma)) {
    addCandidate(forms, `${lemma.slice(0, -1)}ies`);
    addCandidate(forms, `${lemma.slice(0, -1)}ied`);
    if (comparative) {
      addCandidate(forms, `${lemma.slice(0, -1)}ier`);
      addCandidate(forms, `${lemma.slice(0, -1)}iest`);
    }
  } else {
    addCandidate(forms, `${lemma}s`);
    addCandidate(forms, `${lemma}ed`);
    if (comparative) {
      addCandidate(forms, `${lemma}er`);
      addCandidate(forms, `${lemma}est`);
    }
  }
  if (/(s|x|z|ch|sh)$/u.test(lemma)) addCandidate(forms, `${lemma}es`);
  if (lemma.endsWith('ie')) {
    addCandidate(forms, `${lemma.slice(0, -2)}ying`);
  } else if (lemma.endsWith('e')) {
    addCandidate(forms, `${lemma}d`);
    addCandidate(forms, `${lemma.slice(0, -1)}ing`);
  } else {
    addCandidate(forms, `${lemma}ing`);
  }
  if (isCvc(lemma)) {
    addCandidate(forms, `${lemma}${lemma.at(-1)}ed`);
    addCandidate(forms, `${lemma}${lemma.at(-1)}ing`);
    if (comparative) {
      addCandidate(forms, `${lemma}${lemma.at(-1)}er`);
      addCandidate(forms, `${lemma}${lemma.at(-1)}est`);
    }
  }
  return forms;
}

function chooseLemma(surface, current, next, collected) {
  if (!current) return next;
  if (surface === current) return current;
  if (surface === next && collected.has(next)) return next;
  return next.localeCompare(current) < 0 ? next : current;
}

export function buildSurfaceMap(words) {
  const collected = new Set();
  const comparative = new Set();
  for (const value of words) {
    const word = normalize(typeof value === 'object' && value !== null ? value.word : value);
    if (!isSurface(word)) continue;
    collected.add(word);
    if (typeof value === 'object' && value !== null && isComparativePos(value.pos)) comparative.add(word);
  }
  const candidates = new Map();
  for (const lemma of collected) {
    const surfaces = new Set([lemma, ...generatedForms(lemma, comparative.has(lemma))]);
    for (const [base, forms] of IRREGULAR.entries()) {
      if (forms.includes(lemma)) surfaces.add(base);
    }
    for (const surface of surfaces) {
      if (!isSurface(surface) || (surface !== lemma && DENYLIST.has(surface))) continue;
      candidates.set(surface, chooseLemma(surface, candidates.get(surface), lemma, collected));
    }
  }
  return candidates;
}
