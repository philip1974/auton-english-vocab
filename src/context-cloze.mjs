import { buildSurfaceMap } from './inflections.mjs';

const TOKEN_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*/g;
const SOURCE_MARKDOWN_RE = /^(?<sentence>.+?)\s+—\s+\[(?<title>(?:\\.|[^\]])+)\]\((?<path>[^)]+)\)\s*$/u;
const SOURCE_URL_RE = /^(?<sentence>.+?)\s+—\s+<(?<url>https?:\/\/[^>]+)>\s*$/u;
const DEFAULT_MAX_LENGTH = 300;

function stripBullet(text) {
  return String(text ?? '').trim().replace(/^-\s+/, '');
}

function unescapeTitle(title) {
  return String(title ?? '').replace(/\\([\[\]\\])/gu, '$1');
}

function decodeSourcePath(path) {
  try { return decodeURIComponent(path); } catch { return path; }
}

export function parseExampleLine(text) {
  const line = stripBullet(text);
  const noSource = line.match(/^(?<sentence>[\s\S]*?)\s+<!-- ev:no-source -->\s*$/u);
  if (noSource?.groups) return { sentence: noSource.groups.sentence, source: null };
  const markdown = line.match(SOURCE_MARKDOWN_RE);
  if (markdown?.groups) {
    const target = decodeSourcePath(markdown.groups.path.trim());
    return {
      sentence: markdown.groups.sentence.trim(),
      source: /^https?:\/\//u.test(target)
        ? { title: unescapeTitle(markdown.groups.title), url: target }
        : { title: unescapeTitle(markdown.groups.title), path: target },
    };
  }
  const url = line.match(SOURCE_URL_RE);
  if (url?.groups) {
    return {
      sentence: url.groups.sentence.trim(),
      source: { url: url.groups.url.trim() },
    };
  }
  return { sentence: line, source: null };
}

function normalizePath(parts) {
  const normalized = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (normalized.length === 0) return null;
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join('/');
}

function readableMarkdownPath(value) {
  const normalized = normalizePath(String(value ?? '').split('/'));
  if (!normalized) return null;
  if (!normalized.endsWith('.md')) return null;
  if (!/^(wiki|docs)\//u.test(normalized)) return null;
  return normalized;
}

export function resolveExampleSourcePath(notePath, rawPath) {
  const source = String(rawPath ?? '').trim();
  if (!source) return null;
  if (source.startsWith('/')) return null;
  if (/^(wiki|docs)\//u.test(source)) return readableMarkdownPath(source);
  const noteParts = String(notePath ?? '').split('/');
  noteParts.pop();
  return readableMarkdownPath([...noteParts, ...source.split('/')].join('/'));
}

export function surfacesFor(entry) {
  return [...buildSurfaceMap([entry]).keys()].sort();
}

function tokenMatches(sentence, surfaces) {
  const hits = [];
  for (const match of sentence.matchAll(TOKEN_RE)) {
    const surface = match[0];
    if (!surfaces.has(surface.toLowerCase().replaceAll('’', "'")) && !surfaces.has(surface.toLowerCase())) continue;
    hits.push({ start: match.index, end: match.index + surface.length, surface });
  }
  return hits;
}

function replaceHits(sentence, hits) {
  let cursor = 0;
  let text = '';
  for (const hit of hits) {
    text += sentence.slice(cursor, hit.start);
    text += '_____';
    cursor = hit.end;
  }
  return text + sentence.slice(cursor);
}

function findTokenWindow(text, hitStart, hitEnd, maxLength) {
  if (text.length <= maxLength) return { start: 0, end: text.length };
  const center = Math.floor((hitStart + hitEnd) / 2);
  let start = Math.max(0, center - Math.floor(maxLength / 2));
  let end = Math.min(text.length, start + maxLength);
  start = Math.max(0, end - maxLength);
  while (start > 0 && start < end && /\S/u.test(text[start - 1]) && /\S/u.test(text[start])) start += 1;
  while (end < text.length && end > start && /\S/u.test(text[end - 1]) && /\S/u.test(text[end])) end -= 1;
  if (start >= end) return { start: 0, end: text.length };
  return { start, end };
}

function truncateCloze(text, hits, maxLength) {
  if (text.length <= maxLength || hits.length === 0) return text;
  const first = hits[0];
  const last = hits.at(-1);
  const clozedHitStart = first.start;
  const deltaBeforeLast = hits.reduce((sum, hit) => hit.end <= last.start ? sum + (hit.end - hit.start - 5) : sum, 0);
  const clozedHitEnd = last.end - deltaBeforeLast - (last.end - last.start) + 5;
  let window = findTokenWindow(text, clozedHitStart, clozedHitEnd, maxLength);
  const outsideHit = hits.some((hit) => {
    const before = hits.filter((item) => item.end <= hit.start).reduce((sum, item) => sum + (item.end - item.start - 5), 0);
    const start = hit.start - before;
    const end = hit.end - before - (hit.end - hit.start) + 5;
    return start < window.start || end > window.end;
  });
  if (outsideHit) return text;
  return text.slice(window.start, window.end).trim();
}

export function clozeSentence(sentence, entry, options = {}) {
  const original = String(sentence ?? '');
  const surfaces = new Set(surfacesFor(entry));
  const hits = tokenMatches(original, surfaces);
  const text = replaceHits(original, hits);
  return { text: truncateCloze(text, hits, options.maxLength ?? DEFAULT_MAX_LENGTH), hits };
}

export function pickExample(entry, count = 0) {
  const candidates = [];
  for (const line of entry?.examples ?? []) {
    const parsed = parseExampleLine(line);
    const cloze = clozeSentence(parsed.sentence, entry);
    if (cloze.hits.length === 0) continue;
    candidates.push({ ...parsed, cloze });
  }
  if (candidates.length === 0) return null;
  const index = Math.abs(Number(count) || 0) % candidates.length;
  return candidates[index];
}
