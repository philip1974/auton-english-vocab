export const DEFAULT_LEVEL_SETTINGS = Object.freeze({
  vocabularySize: 3000,
  easyMax: 2,
  goodMax: 5,
});

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/gu;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

function stripMarkdownNoise(markdown) {
  return String(markdown ?? '')
    .replace(/^---[\s\S]*?\n---\s*/u, '')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`[^`]*`/gu, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/https?:\/\/\S+/gu, ' ')
    .replace(/!\[\[.*?\]\]/gu, ' ')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/gu, '$1')
    .replace(/<[^>]+>/gu, ' ');
}

function isHeading(line) {
  return /^\s{0,3}#{1,6}\s+/u.test(line);
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line);
}

export function normalizeWord(value) {
  return String(value ?? '').toLowerCase().replaceAll('’', "'");
}

export function extractReadingTokens(markdown) {
  const cleaned = stripMarkdownNoise(markdown);
  const tokens = [];
  let sentenceStart = true;
  for (const rawLine of cleaned.split(/\n/u)) {
    if (isHeading(rawLine) || isTableDivider(rawLine)) {
      sentenceStart = true;
      continue;
    }
    const line = rawLine.replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/u, '');
    if (!line.trim()) {
      sentenceStart = true;
      continue;
    }
    for (const match of line.matchAll(WORD_RE)) {
      const surface = match[0];
      const before = line.slice(0, match.index);
      if (/[.!?:]\s*$/u.test(before)) sentenceStart = true;
      const properNoun = !sentenceStart && /^[A-Z]/u.test(surface);
      tokens.push({ surface, word: normalizeWord(surface), properNoun, counted: !properNoun });
      sentenceStart = false;
    }
    if (/[.!?:]\s*$/u.test(line.trim())) sentenceStart = true;
  }
  return tokens;
}

export function detectEnglish(markdown) {
  const text = stripMarkdownNoise(markdown);
  const latinWords = [...text.matchAll(WORD_RE)].length;
  const cjkChars = [...text.matchAll(CJK_RE)].length;
  if (latinWords < 50) return { english: false, reason: 'too-short', latinWords, cjkChars };
  const ratio = latinWords / Math.max(1, latinWords + cjkChars);
  if (ratio < 0.7) return { english: false, reason: 'not-english', latinWords, cjkChars };
  return { english: true, latinWords, cjkChars };
}

export function validateLevelSettings(value) {
  const next = { ...DEFAULT_LEVEL_SETTINGS, ...value };
  const allowed = new Set([1000, 2000, 3000, 5000, 8000, 12000, 20000]);
  if (!allowed.has(next.vocabularySize)) return { ok: false, reason: 'vocabulary-size' };
  if (next.easyMax < 0 || next.easyMax >= next.goodMax || next.goodMax > 20) {
    return { ok: false, reason: 'range' };
  }
  return { ok: true, settings: next };
}

export function classifyNovelRate(rate, settings = DEFAULT_LEVEL_SETTINGS) {
  if (rate <= settings.easyMax) return { band: 'easy', tone: 'good' };
  if (rate <= settings.goodMax) return { band: 'good', tone: 'neutral' };
  return { band: 'hard', tone: 'warning' };
}
