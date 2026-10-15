import { appendExample, assertEnglishWord, buildNote, parseNote, slugFor, normalizeWord, normalizeSourceTitle } from './note-format.mjs';
import { familiarityFor } from './familiarity.mjs';
import { uiText } from './ui-text.mjs';

const MAX_ENTRIES = 20;
const DOCUMENT_SOURCE_RE = /^(?:wiki|docs)\/[^\\\r\n]+$/u;

function toolFailure(code, word = '') {
  throw Object.assign(new Error(code), { code, word });
}

function isSafeDocumentSourcePath(path) {
  return DOCUMENT_SOURCE_RE.test(path) && !String(path).split('/').some((part) => part === '.' || part === '..' || part === '');
}

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
  let word;
  try { word = assertEnglishWord(entry.word); } catch { toolFailure('INVALID_WORD', String(entry?.word ?? '')); }
  const definition = String(entry.definition ?? '').trim();
  if (!definition || definition.length > 500) toolFailure('INVALID_DEFINITION', word);
  const example = entry.example === undefined ? undefined : String(entry.example).trim().replace(/\s+/g, ' ');
  if (example && example.length > 600) toolFailure('EXAMPLE_TOO_LONG', word);
  const source = entry.source;
  if (source) {
    if (source.path) {
      if (!isSafeDocumentSourcePath(source.path)) toolFailure('INVALID_SOURCE', word);
    } else if (source.url) {
      if (/[\s<>]/.test(source.url)) toolFailure('INVALID_SOURCE', word);
      let parsed;
      try { parsed = new URL(source.url); } catch { toolFailure('INVALID_SOURCE', word); }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') toolFailure('INVALID_SOURCE', word);
    } else {
      toolFailure('INVALID_SOURCE', word);
    }
  }
  const normalizedSource = source ? { ...source, ...(source.title === undefined ? {} : { title: normalizeSourceTitle(source.title) }) } : source;
  return { ...entry, word, definition, example, source: normalizedSource };
}

async function withSoftTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timer);
  return result;
}

async function resolveSource(app, source, notes, guard, t) {
  if (!source?.path || !isSafeDocumentSourcePath(source.path)) return source;
  const doc = await guard.wait(withSoftTimeout(app.knowledge.readDocument({ path: source.path }).then(unwrap).catch(() => null), 3000));
  if (!doc) {
    notes.push(t.toolSourceOmitted(source.path));
    return undefined;
  }
  const rel = source.path.startsWith('wiki/vocab/')
    ? source.path.slice('wiki/vocab/'.length)
    : source.path.startsWith('wiki/') ? `../${source.path.slice('wiki/'.length)}` : source.path;
  return { path: rel, title: normalizeSourceTitle(source.title || doc.meta?.title || source.path) };
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

async function readOptional(app, path, guard) {
  try {
    const result = await guard.wait(app.knowledge.readDocument({ path }));
    if (result?._tag !== 'Err') return result;
    if (result.error?.code === 'NOT_FOUND') return null;
    throw new Error(String(result.error?.message ?? result.error?.code ?? result.error ?? 'knowledge error'));
  } catch (error) {
    if (error?.code === 'NOT_FOUND') return null;
    throw error;
  }
}

async function availablePath(app, word, guard, reservedPaths) {
  const slug = slugFor(word);
  for (let number = 1; number < 1000; number += 1) {
    const path = `wiki/vocab/${slug}${number === 1 ? '' : `-${number}`}.md`;
    if (reservedPaths.has(path)) continue;
    let doc;
    try { doc = await readOptional(app, path, guard); } catch (error) {
      if (error?.code === 'KNOWLEDGE_WRITE_ABORTED') throw error;
      toolFailure('READ_FAILED', word);
    }
    if (!doc) return { path, doc: null };
    const parsed = parseNote(doc.content);
    if (parsed.ok && parsed.entry.word === word) return { path, doc };
  }
  toolFailure('NO_AVAILABLE_PATH', word);
}

export function makeVocabLookup({ index, review, getReview = () => review, bindRootRead = (operation) => operation() }) {
  return async function vocabLookup(input) {
    return bindRootRead(() => {
      const word = normalizeWord(input?.word);
      const entry = index.get(word);
      const current = getReview();
      const card = Object.hasOwn(current.cards, word) ? current.cards[word] : undefined;
      const flag = Object.hasOwn(current.flags, word) ? current.flags[word] : undefined;
      const familiarity = familiarityFor(card, flag);
      return JSON.stringify({
        collected: Boolean(entry),
        word,
        definition: entry?.definition ?? null,
        familiarity,
        due: card?.due ?? null,
      });
    });
  };
}

export function makeVocabAdd({ app, index, nextNumber, notify, refresh, locale = 'en', bindKnowledgeWrite }) {
  return async function vocabAdd(input) {
    const t = uiText(typeof locale === 'function' ? locale() : locale);
    const bind = bindKnowledgeWrite ?? ((operation) => operation({ assertCurrent: () => undefined, wait: (promise) => promise }));
    try {
      return await bind(async (guard) => {
    const entries = input?.entries;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
      toolFailure('INVALID_ENTRY_COUNT');
    }
    const notes = [];
    const validated = entries.map(validateEntry);
    const normalized = await guard.wait(mapConcurrent(validated, 4, async (entry) => ({
      ...entry,
      source: entry.example ? await resolveSource(app, entry.source, notes, guard, t) : undefined,
    })));
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
    const reservedPaths = new Set();
    for (const entry of groups.values()) {
      if (index.isAmbiguous?.(entry.word)) toolFailure('DUPLICATE_NOTES', entry.word);
      const existing = index.get(entry.word);
      let path;
      let doc;
      if (existing) {
        path = existing.path;
        if (reservedPaths.has(path)) toolFailure('DUPLICATE_PATH', entry.word);
        try { doc = unwrap(await guard.wait(app.knowledge.readDocument({ path }))); } catch (error) {
          if (error?.code === 'KNOWLEDGE_WRITE_ABORTED') throw error;
          toolFailure('READ_FAILED', entry.word);
        }
      } else {
        ({ path, doc } = await availablePath(app, entry.word, guard, reservedPaths));
      }
      reservedPaths.add(path);
      let content;
      if (doc) {
        const parsed = parseNote(doc.content);
        if (!parsed.ok) toolFailure('INVALID_FRONTMATTER', entry.word);
        if (parsed.entry.word !== entry.word) toolFailure('FRONTMATTER_WORD_MISMATCH', entry.word);
        content = doc.content;
      } else {
        content = buildNote({ ...entry, example: undefined, source: undefined });
      }
      for (const item of entry.examples) content = appendExample(content, item.example, item.source);
      if (doc && content === doc.content) continue;
      changes.push({ path, newContent: content });
      accepted.push(entry.word);
    }
    if (!changes.length) return [t.toolNoChanges, ...notes].join('\n');
    if (new Set(changes.map((change) => change.path)).size !== changes.length) toolFailure('DUPLICATE_PATH');
    const number = nextNumber();
    const words = accepted;
    await guard.assertCurrent();
    const proposal = app.knowledge.propose({
      description: t.proposalDescription(number, words.join(', ')),
      changes,
    });
    proposal.then(unwrap).then((receipt) => {
      notify(noticeText(receipt, number, words, t));
      refresh?.();
    }).catch(() => notify(t.proposalFailed(number)));
    return [t.toolSubmitted(number, words.length), ...notes].join('\n');
      }, t.knowledgeWriteAborted);
    } catch (error) {
      if (typeof error?.code === 'string' && ['INVALID_WORD', 'INVALID_DEFINITION', 'EXAMPLE_TOO_LONG', 'INVALID_SOURCE', 'INVALID_ENTRY_COUNT', 'NO_AVAILABLE_PATH', 'DUPLICATE_NOTES', 'DUPLICATE_PATH', 'INVALID_FRONTMATTER', 'FRONTMATTER_WORD_MISMATCH', 'READ_FAILED'].includes(error.code)) {
        throw Object.assign(new Error(t.toolFailure(error.code, error.word)), { code: error.code });
      }
      throw error;
    }
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
