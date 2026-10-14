import { appendExample, buildNote, parseNote, slugFor, normalizeWord } from './note-format.mjs';
import { familiarityFor } from './familiarity.mjs';
import { uiText } from './ui-text.mjs';

const MAX_ENTRIES = 20;

function unwrap(result) {
  if (result && result._tag === 'Err') throw new Error(String(result.error ?? 'knowledge error'));
  return result;
}

function noticeText(receipt, number, words, t) {
  const list = words.join(', ');
  if (receipt.outcome === 'applied') return t.proposalApplied(number, list);
  if (receipt.outcome === 'rejected') return t.proposalRejected(number, receipt.reason, list);
  if (receipt.outcome === 'not-reviewed') return t.proposalPending(number, list);
  if (receipt.outcome === 'timeout') return t.proposalTimeout(number, list);
  return t.proposalAborted(number, list);
}

function validateEntry(entry) {
  const word = normalizeWord(entry.word);
  if (!/^[a-z][a-z'-]{0,63}$/.test(word)) throw new Error(`invalid word: ${entry.word}`);
  const definition = String(entry.definition ?? '').trim();
  if (!definition || definition.length > 500) throw new Error(`invalid definition for ${word}`);
  const example = entry.example === undefined ? undefined : String(entry.example).trim().replace(/\s+/g, ' ');
  if (example && example.length > 600) throw new Error(`example too long for ${word}`);
  const source = entry.source;
  if (source) {
    if (source.path) {
      if (!source.path.startsWith('wiki/')) throw new Error(`invalid source for ${word}`);
    } else if (source.url) {
      if (/[\s<>]/.test(source.url)) throw new Error(`invalid source for ${word}`);
      let parsed;
      try { parsed = new URL(source.url); } catch { throw new Error(`invalid source for ${word}`); }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`invalid source for ${word}`);
    } else {
      throw new Error(`invalid source for ${word}`);
    }
  }
  return { ...entry, word, definition, example };
}

async function withSoftTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timer);
  return result;
}

async function resolveSource(app, source, notes) {
  if (!source?.path || !source.path.startsWith('wiki/')) return source;
  const doc = await withSoftTimeout(app.knowledge.readDocument({ path: source.path }).then(unwrap).catch(() => null), 3000);
  if (!doc) {
    notes.push(`Source ${source.path} was missing or timed out; the example was kept without a link.`);
    return undefined;
  }
  const rel = source.path.startsWith('wiki/vocab/') ? source.path.slice('wiki/vocab/'.length) : `../${source.path.slice('wiki/'.length)}`;
  return { path: rel, title: doc.meta?.title || source.path };
}

async function mapConcurrent(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readOptional(app, path) {
  try {
    const result = await app.knowledge.readDocument({ path });
    return result?._tag === 'Err' ? null : result;
  } catch {
    return null;
  }
}

export function makeVocabLookup({ index, review, getReview = () => review }) {
  return async function vocabLookup(input) {
    const word = normalizeWord(input?.word);
    const entry = index.get(word);
    const current = getReview();
    const card = current.cards[word];
    const familiarity = familiarityFor(card, current.flags[word]);
    return JSON.stringify({
      collected: Boolean(entry),
      word,
      definition: entry?.definition ?? null,
      familiarity,
      due: card?.due ?? null,
    });
  };
}

export function makeVocabAdd({ app, index, nextNumber, notify, refresh, locale = 'en' }) {
  return async function vocabAdd(input) {
    const entries = input?.entries;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
      throw new Error('entries must contain 1-20 items');
    }
    const t = uiText(locale);
    const notes = [];
    const validated = entries.map(validateEntry);
    const normalized = await mapConcurrent(validated, 4, async (entry) => ({ ...entry, source: await resolveSource(app, entry.source, notes) }));
    const groups = new Map();
    for (const entry of normalized) {
      const group = groups.get(entry.word) ?? { ...entry, examples: [] };
      if (entry.example && !group.examples.some((item) => item.example === entry.example && JSON.stringify(item.source) === JSON.stringify(entry.source))) {
        group.examples.push({ example: entry.example, source: entry.source });
      }
      groups.set(entry.word, group);
    }
    const changes = [];
    const accepted = [];
    for (const entry of groups.values()) {
      const existing = index.get(entry.word);
      const path = existing?.path ?? `wiki/vocab/${slugFor(entry.word)}.md`;
      const doc = existing ? unwrap(await app.knowledge.readDocument({ path })) : await readOptional(app, path);
      let content;
      if (doc) {
        const parsed = parseNote(doc.content);
        if (!parsed.ok) throw new Error(`frontmatter invalid for ${entry.word}: ${parsed.error}`);
        if (parsed.entry.word !== entry.word) {
          notes.push(`Skipped ${entry.word}: slug collision at ${path} with ${parsed.entry.word}.`);
          continue;
        }
        content = doc.content;
      } else {
        content = buildNote({ ...entry, example: undefined, source: undefined });
      }
      for (const item of entry.examples) content = appendExample(content, item.example, item.source);
      changes.push({ path, newContent: content });
      accepted.push(entry.word);
    }
    if (!changes.length) return ['No vocabulary entries were submitted.', ...notes].join('\n');
    const number = nextNumber();
    const words = accepted;
    const proposal = app.knowledge.propose({
      description: t.proposalDescription(number, words.join(', ')),
      changes,
    });
    proposal.then(unwrap).then((receipt) => {
      notify(noticeText(receipt, number, words, t));
      refresh?.();
    }).catch(() => notify(t.proposalFailed(number)));
    return [`Submitted for review #${number}: ${words.length} ${words.length === 1 ? 'word' : 'words'}.`, ...notes].join('\n');
  };
}

export const LOOKUP_SCHEMA = {
  type: 'object',
  properties: { word: { type: 'string', minLength: 1, maxLength: 64 } },
  required: ['word'],
  additionalProperties: false,
};

export const ADD_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          word: { type: 'string', minLength: 1, maxLength: 64 },
          definition: { type: 'string', minLength: 1, maxLength: 500 },
          phonetic: { type: 'string', maxLength: 120 },
          pos: { type: 'string', maxLength: 80 },
          example: { type: 'string', maxLength: 600 },
          source: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              url: { type: 'string' },
              title: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        required: ['word', 'definition'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
};
