const WORD_RE = /^[a-z][a-z'-]{0,63}$/i;

export function normalizeWord(word) {
  return String(word ?? '').normalize('NFC').trim().toLowerCase();
}

export function assertEnglishWord(word) {
  const normalized = normalizeWord(word);
  if (!WORD_RE.test(normalized)) throw new Error(`invalid English word: ${word}`);
  return normalized;
}

export function slugFor(word) {
  const normalized = assertEnglishWord(word);
  return normalized.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sourceLink(source) {
  if (!source) return '';
  if (source.url) return `<${source.url}>`;
  if (source.path) return `[${String(source.title || source.path).replace(/[\[\]]/g, '\\$&')}](${source.path})`;
  return '';
}

export function exampleLine(example, source) {
  const text = String(example ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const link = sourceLink(source);
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
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) return JSON.parse(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, '');
}

export function parseNote(text) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { ok: false, error: 'missing frontmatter' };
  try {
    const fields = {};
    for (const line of match[1].split('\n')) {
      const index = line.indexOf(':');
      if (index <= 0) continue;
      fields[line.slice(0, index).trim()] = parseYamlScalar(line.slice(index + 1));
    }
    if (fields.type !== 'vocab' || !fields.word) return { ok: false, error: 'missing word' };
    const word = assertEnglishWord(fields.word);
    const definition = String(fields.definition ?? '').trim();
    if (!definition) return { ok: false, error: 'missing definition' };
    const examples = [...match[2].matchAll(/^- (.+)$/gm)].map((item) => item[1].trim());
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
  if (existing.includes(line) || parsed.entry.examples.includes(line.slice(2))) return existing;
  const newline = String(existing).includes('\r\n') ? '\r\n' : '\n';
  if (existing.includes(`## Examples${newline}`)) {
    return existing.replace(new RegExp(`(## Examples${newline})([\\s\\S]*)$`), (_match, heading, body) => `${heading}${body}${existing.endsWith(newline) ? '' : newline}${line}${newline}`);
  }
  return `${existing.trimEnd()}${newline}${newline}## Examples${newline}${newline}${line}${newline}`;
}
