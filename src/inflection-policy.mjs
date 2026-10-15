import {
  AMBIGUOUS_INFLECTION_SURFACES,
  reliableRuleCandidatesByKind,
  reviewedIrregularCandidatesByKind,
} from './inflections.mjs';

const SURFACE_RE = /^(?=.{1,64}$)[a-z]+(?:['’-][a-z]+)*$/u;
const EXCHANGE_KINDS = new Set(['p', 'd', 'i', '3', 's', 'r', 't']);

function normalize(value) {
  return String(value ?? '').normalize('NFC').trim().toLowerCase().replaceAll('’', "'");
}

export function dictionaryExchangeLemma(entry) {
  const match = String(entry?.x ?? '').match(/(?:^|\/)0:([^/]+)/u);
  return match?.[1]?.split(',')[0]?.trim().toLowerCase() || null;
}

export function dictionaryExchangeByKind(entry) {
  const candidates = new Map();
  for (const match of String(entry?.x ?? '').matchAll(/(?:^|\/)(s|d|p|i|3|r|t):([^/]+)/gu)) {
    if (!EXCHANGE_KINDS.has(match[1])) continue;
    const surfaces = candidates.get(match[1]) ?? new Set();
    for (const value of match[2].split(',')) {
      const surface = normalize(value);
      if (SURFACE_RE.test(surface)) surfaces.add(surface);
    }
    if (surfaces.size) candidates.set(match[1], surfaces);
  }
  return candidates;
}

function mergeCandidateSurfaces(target, candidates) {
  for (const surfaces of candidates.values()) for (const surface of surfaces) target.add(surface);
}

function dictionaryRelationKinds(entry) {
  const code = String(entry?.x ?? '').match(/(?:^|\/)1:([^/]+)/u)?.[1] ?? '';
  const kinds = new Set();
  for (const kind of EXCHANGE_KINDS) if (code.includes(kind)) kinds.add(kind);
  return kinds;
}

function paradigmFor({ lemma, entry, pos }) {
  const rules = reliableRuleCandidatesByKind(lemma, pos);
  const reviewed = reviewedIrregularCandidatesByKind(lemma, pos);
  const ownLemma = dictionaryExchangeLemma(entry);
  const exchange = ownLemma && ownLemma !== lemma ? new Map() : dictionaryExchangeByKind(entry);
  if (ownLemma && ownLemma !== lemma) {
    const relationKinds = dictionaryRelationKinds(entry);
    if (['p', 'd', 'i', '3'].some((kind) => relationKinds.has(kind))) for (const kind of ['p', 'd', 'i', '3']) rules.delete(kind);
    if (relationKinds.has('s')) rules.delete('s');
    if (['r', 't'].some((kind) => relationKinds.has(kind))) for (const kind of ['r', 't']) rules.delete(kind);
  }
  return { rules, reviewed, exchange };
}

export function inflectionCandidateSurfaces({ lemma: lemmaValue, entry = null, pos = {} }) {
  const lemma = normalize(lemmaValue);
  const candidates = new Set();
  if (!SURFACE_RE.test(lemma)) return candidates;
  const { rules, reviewed, exchange } = paradigmFor({ lemma, entry, pos });
  for (const [kind, surfaces] of rules) if (!exchange.has(kind)) for (const surface of surfaces) candidates.add(surface);
  mergeCandidateSurfaces(candidates, exchange);
  mergeCandidateSurfaces(candidates, reviewed);
  candidates.delete(lemma);
  return candidates;
}

function addAccepted(accepted, surface, kind, reason, rule) {
  if (!accepted.has(surface)) accepted.set(surface, { surface, kind, reason, rule });
}

function addRejected(rejected, surface, kind, reason, rule) {
  rejected.push({ surface, kind, reason, rule });
}

function surfaceState(surfaceEntries, surface) {
  if (!surfaceEntries.has(surface)) return { available: false, entry: null };
  return { available: true, entry: surfaceEntries.get(surface) };
}

function hasIndependentComparativeConflict(entry) {
  const definitions = `${String(entry?.t ?? '')}\n${String(entry?.d ?? '')}`;
  const nounOrVerb = /(?:^|\n)\s*(?:n|v|vt|vi)\.\s/imu.test(definitions);
  const adjective = /(?:^|\n)\s*(?:a|adj)\.\s/imu.test(definitions);
  return nounOrVerb && !adjective;
}

export function decideInflectionForms({ lemma: lemmaValue, entry = null, pos = {}, surfaceEntries = new Map() }) {
  const lemma = normalize(lemmaValue);
  if (!SURFACE_RE.test(lemma)) return { forms: [], accepted: [], rejected: [] };
  const { rules, reviewed, exchange } = paradigmFor({ lemma, entry, pos });
  const accepted = new Map();
  const rejected = [];

  for (const [kind, surfaces] of exchange) {
    const ruleSurfaces = rules.get(kind) ?? new Set();
    const reviewedSurfaces = reviewed.get(kind) ?? new Set();
    for (const surface of surfaces) {
      if (surface === lemma) continue;
      if (reviewedSurfaces.has(surface)) {
        addAccepted(accepted, surface, kind, 'reviewed-irregular', 3);
        continue;
      }
      const state = surfaceState(surfaceEntries, surface);
      if (!state.available) {
        addRejected(rejected, surface, kind, 'exchange-lookup-unavailable', 1);
      } else if (state.entry && dictionaryExchangeLemma(state.entry) === lemma && !(['r', 't'].includes(kind) && hasIndependentComparativeConflict(state.entry))) {
        addAccepted(accepted, surface, kind, 'exchange-reversed', 1);
      } else if (!state.entry && ruleSurfaces.has(surface)) {
        addAccepted(accepted, surface, kind, 'exchange-rule-no-entry', 1);
      } else {
        addRejected(rejected, surface, kind, state.entry ? 'exchange-conflict' : 'exchange-unverified', 1);
      }
    }
  }

  for (const [kind, surfaces] of rules) {
    if (exchange.has(kind)) continue;
    const reviewedSurfaces = reviewed.get(kind) ?? new Set();
    for (const surface of surfaces) {
      if (surface === lemma) continue;
      if (reviewedSurfaces.has(surface)) {
        addAccepted(accepted, surface, kind, 'reviewed-irregular', 3);
        continue;
      }
      if (!entry) {
        addAccepted(accepted, surface, kind, 'rule-no-dictionary', 2);
        continue;
      }
      const state = surfaceState(surfaceEntries, surface);
      if (!state.available) {
        addRejected(rejected, surface, kind, 'rule-lookup-unavailable', 2);
      } else if (!state.entry) {
        addAccepted(accepted, surface, kind, 'rule-no-entry', 2);
      } else if (dictionaryExchangeLemma(state.entry) === lemma) {
        addAccepted(accepted, surface, kind, 'rule-reversed', 2);
      } else {
        addRejected(rejected, surface, kind, 'rule-conflict', 2);
      }
    }
  }

  for (const [kind, surfaces] of reviewed) {
    for (const surface of surfaces) if (surface !== lemma) addAccepted(accepted, surface, kind, 'reviewed-irregular', 3);
  }

  for (const [surface, item] of [...accepted]) {
    if (!AMBIGUOUS_INFLECTION_SURFACES.has(surface)) continue;
    accepted.delete(surface);
    addRejected(rejected, surface, item.kind, 'reviewed-homograph', 4);
  }

  return {
    forms: [lemma, ...accepted.keys()],
    accepted: [...accepted.values()],
    rejected,
  };
}
