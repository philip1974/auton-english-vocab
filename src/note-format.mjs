const WORD_RE = /^(?=.{1,64}$)[a-z]+(?:['-][a-z]+)*$/i;
const WORD_PREFIX_RE = /^(?=.{1,64}$)[a-z]+(?:['-][a-z]+)*(?:['-])?$/i;

export function normalizeWord(word) {
  return String(word ?? '').normalize('NFC').trim().toLowerCase().replaceAll('’', "'");
}

export function assertEnglishWord(word) {
  const normalized = normalizeWord(word);
  if (!WORD_RE.test(normalized)) throw new Error(`invalid English word: ${word}`);
  return normalized;
}

export function isEnglishWordPrefix(word) {
  return WORD_PREFIX_RE.test(normalizeWord(word));
}

export function slugFor(word) {
  const normalized = assertEnglishWord(word);
  return normalized.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeSourceTitle(value, maxLength = 160) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, maxLength);
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function sourceLink(source) {
  if (!source) return '';
  const title = normalizeSourceTitle(source.title);
  if (source.url) {
    if (!title) return `<${source.url}>`;
    const url = String(source.url).replaceAll('(', '%28').replaceAll(')', '%29');
    return `[${title.replace(/[\[\]]/g, '\\$&')}](${url})`;
  }
  if (source.path) {
    const path = String(source.path).replaceAll('%', '%25').replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29');
    return `[${(title || String(source.path)).replace(/[\[\]]/g, '\\$&')}](${path})`;
  }
  return '';
}

export function exampleLine(example, source) {
  let text = String(example ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const link = sourceLink(source);
  if (!link && /\s—\s(?:\[(?:\\.|[^\]])+\]\([^)]+\)|<https?:\/\/[^>]+>)\s*$/u.test(text)) text += ' <!-- ev:no-source -->';
  return `- ${text}${link ? ` — ${link}` : ''}`;
}

export function buildNote(entry, now = today()) {
  const word = assertEnglishWord(entry.word);
  const definition = String(entry.definition ?? '').trim();
  if (!definition) throw new Error('definition is required');
  const lines = [
    '---',
    'type: vocab',
    `word: ${yamlString(word)}`,
    `definition: ${yamlString(definition)}`,
  ];
  if (entry.phonetic) lines.push(`phonetic: ${yamlString(entry.phonetic)}`);
  if (entry.pos) lines.push(`pos: ${yamlString(entry.pos)}`);
  lines.push(`created: ${yamlString(now)}`, '---', `# ${word}`, '', definition, '', '## Examples', '');
  const example = exampleLine(entry.example, entry.source);
  if (example) lines.push(example);
  return `${lines.join('\n')}\n`;
}

function parseYamlScalar(value) {
  const input = value.trim();
  if (!input.startsWith('"') && !input.startsWith("'")) {
    const comment = input.search(/\s+#/u);
    const trimmed = (comment < 0 ? input : input.slice(0, comment)).trim();
    if (/^[|>](?:[+-]?\d?|\d[+-]?)?$/u.test(trimmed)) throw new Error('unsupported YAML block scalar');
    return trimmed;
  }
  let quote = null;
  let escaped = false;
  let end = input.length;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && character === '\\') { escaped = true; continue; }
    if (character === '"' || character === "'") quote = quote === character ? null : quote ?? character;
    if (!quote && character === '#' && index > 0 && /\s/u.test(input[index - 1])) { end = index; break; }
  }
  const trimmed = input.slice(0, end).trim();
  if (trimmed.startsWith('"')) return JSON.parse(trimmed);
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'")) throw new Error('invalid quoted scalar');
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function examplesSection(body) {
  let offset = 0;
  let start = null;
  let fence = null;
  for (const line of body.split('\n')) {
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence.character && marker.length >= fence.length && /^\s*$/u.test(line.slice(line.indexOf(marker) + marker.length))) fence = null;
    } else if (marker) {
      fence = { character: marker[0], length: marker.length };
    } else if (start === null && /^## Examples\s*$/u.test(line)) {
      start = lineEnd;
    } else if (start !== null && /^#{1,2}\s+.+$/u.test(line)) {
      return { start, end: lineStart, content: body.slice(start, lineStart) };
    }
    offset = lineEnd + 1;
  }
  return start === null ? null : { start, end: body.length, content: body.slice(start) };
}

export function parseNote(text) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { ok: false, error: 'missing frontmatter' };
  try {
    const fields = Object.create(null);
    for (const line of match[1].split('\n')) {
      if (!line.trim() || /^\s*#/u.test(line)) continue;
      const index = line.indexOf(':');
      const key = line.slice(0, Math.max(0, index)).trim();
      if (index <= 0 || /^\s/u.test(line) || !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key)) throw new Error(`unsupported frontmatter line: ${line}`);
      fields[key] = parseYamlScalar(line.slice(index + 1));
    }
    if (fields.type !== 'vocab' || !fields.word) return { ok: false, error: 'missing word' };
    const word = assertEnglishWord(fields.word);
    const definition = String(fields.definition ?? '').trim();
    if (!definition) return { ok: false, error: 'missing definition' };
    const section = examplesSection(match[2]);
    const examples = section ? [...section.content.matchAll(/^- (.+)$/gm)].map((item) => item[1].trim()) : [];
    return { ok: true, entry: { ...fields, word, definition, examples, body: match[2] } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid frontmatter' };
  }
}

export function appendExample(existing, example, source) {
  const parsed = parseNote(existing);
  if (!parsed.ok) throw new Error(`frontmatter invalid: ${parsed.error}`);
  const line = exampleLine(example, source);
  if (!line) return existing;
  if (parsed.entry.examples.includes(line.slice(2))) return existing;
  const newline = String(existing).includes('\r\n') ? '\r\n' : '\n';
  const normalized = String(existing).replaceAll('\r\n', '\n');
  const frontmatterEnd = normalized.indexOf('\n---\n') + 5;
  const body = normalized.slice(frontmatterEnd);
  const section = examplesSection(body);
  if (section) {
    const absoluteEnd = frontmatterEnd + section.end;
    const before = normalized.slice(0, absoluteEnd).replace(/\s*$/u, '');
    const after = normalized.slice(absoluteEnd);
    return `${before}\n\n${line}\n${after.replace(/^\n*/u, '\n')}`.replaceAll('\n', newline);
  }
  return `${existing.trimEnd()}${newline}${newline}## Examples${newline}${newline}${line}${newline}`;
}
