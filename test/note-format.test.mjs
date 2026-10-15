import { describe, expect, it } from 'vitest';
import { appendExample, buildNote, parseNote, slugFor, assertEnglishWord } from '../src/note-format.mjs';
import { parseExampleLine } from '../src/context-cloze.mjs';

describe('note format', () => {
  it('should build and parse a note when definition is Chinese', () => {
    const note = buildNote({ word: 'Serendipity', definition: '意外发现美好事物的运气', example: 'It was pure serendipity.' }, '2026-10-14');
    expect(note).toContain('definition: "意外发现美好事物的运气"');
    expect(parseNote(note)).toMatchObject({ ok: true, entry: { word: 'serendipity', definition: '意外发现美好事物的运气' } });
  });

  it('should quote yaml strings when definition contains separators or special characters', () => {
    const note = buildNote({ word: 'edge-case', definition: '--- yes: maybe # tricky' }, '2026-10-14');
    expect(note).toContain('definition: "--- yes: maybe # tricky"');
    expect(parseNote(note).entry.definition).toBe('--- yes: maybe # tricky');
  });

  it('should not append duplicate examples when the same source line already exists', () => {
    const note = buildNote({ word: 'luck', definition: '好运', example: 'Good luck.', source: { url: 'https://example.com' } }, '2026-10-14');
    expect(appendExample(note, 'Good luck.', { url: 'https://example.com' })).toBe(note);
  });

  it('should slug apostrophes and keep hyphens when words contain punctuation', () => {
    expect(slugFor("Mother-in-law")).toBe('mother-in-law');
    expect(slugFor("don't")).toBe('don-t');
    expect(assertEnglishWord('don’t')).toBe("don't");
  });

  it('should preserve source shaped sentences when no source metadata was supplied', () => {
    for (const sentence of ['Read this — [details](wiki/a.md)', 'Visit it — <https://example.com/x>']) {
      const note = buildNote({ word: 'read', definition: '阅读', example: sentence });
      const line = parseNote(note).entry.examples[0];
      expect(parseExampleLine(line)).toEqual({ sentence, source: null });
    }
  });

  it('should reject non English words when building a note', () => {
    expect(() => buildNote({ word: '你好', definition: 'hello' })).toThrow(/invalid English word/);
    expect(() => buildNote({ word: 'valid' })).toThrow(/definition is required/);
  });

  it('should reject append when frontmatter is broken', () => {
    expect(() => appendExample('---\ntype: vocab\n---\n# broken\n', 'x')).toThrow(/frontmatter invalid/);
  });

  it('should append an example section when the note has none', () => {
    const note = '---\ntype: vocab\nword: \"plain\"\ndefinition: \"简单\"\n---\n# plain\n';
    expect(appendExample(note, 'Plain text.')).toContain('## Examples');
  });

  it('should return unchanged content when appended example is empty', () => {
    const note = buildNote({ word: 'plain', definition: '简单' });
    expect(appendExample(note, '')).toBe(note);
  });

  it('should build source links for wiki paths and omit source when absent', () => {
    expect(buildNote({ word: 'path', definition: '路', example: 'Path.', source: { path: '../sources/a.md', title: 'A' } })).toContain('[A](../sources/a.md)');
    expect(buildNote({ word: 'pathless', definition: '路', example: 'Path.', source: { path: '../sources/a.md' } })).toContain('[../sources/a.md](../sources/a.md)');
    expect(buildNote({ word: 'solo', definition: '单独', example: 'Solo.' })).toContain('- Solo.');
    expect(buildNote({ word: 'nosource', definition: '无', example: 'No source.', source: {} })).toContain('- No source.');
  });

  it('should parse unquoted and single quoted scalars when frontmatter is hand edited', () => {
    const parsed = parseNote("---\ntype: vocab\nword: plain\ndefinition: '单独'\nignored-line\n---\n# plain\n\n## Examples\n- one\n");
    expect(parsed).toMatchObject({ ok: true, entry: { word: 'plain', definition: '单独', examples: ['one'] } });
  });

  it('should parse quoted scalar comments and reject unsupported yaml block scalars', () => {
    const commented = parseNote('---\ntype: vocab\nword: "run" # keep this comment\ndefinition: "跑 # not a comment" # comment\n---\n# run\n');
    expect(commented).toMatchObject({ ok: true, entry: { word: 'run', definition: '跑 # not a comment' } });
    expect(parseNote('---\ntype: vocab\nword: run\ndefinition: |\n  line one\n---\n# run\n')).toMatchObject({ ok: false, error: expect.stringContaining('block scalar') });
    expect(parseNote('---\ntype: vocab\nword: run\ndefinition: >\n  folded\n---\n# run\n')).toMatchObject({ ok: false, error: expect.stringContaining('block scalar') });
    for (const marker of ['| # prose', '|-', '|+', '>-', '>+', '|2', '>2-']) {
      expect(parseNote(`---\ntype: vocab\nword: run\ndefinition: ${marker}\n  first\n---\n# run\n`)).toMatchObject({ ok: false, error: expect.stringContaining('block scalar') });
    }
  });

  it('should strip plain scalar comments without treating apostrophes as yaml quotes', () => {
    const parsed = parseNote("---\ntype: vocab\nword: dont\ndefinition: don't run # user comment\nphonetic: rock 'n' roll # note\n---\n# dont\n");
    expect(parsed).toMatchObject({ ok: true, entry: { definition: "don't run", phonetic: "rock 'n' roll" } });
  });

  it('should read and append examples only inside the examples section', () => {
    const note = '---\ntype: vocab\nword: "run"\ndefinition: "跑"\n---\n# run\n\n## Examples\n\n- Run now.\n\n## Notes\n\n- not an example\n';
    expect(parseNote(note)).toMatchObject({ ok: true, entry: { examples: ['Run now.'] } });
    const appended = appendExample(note, 'Run later.');
    expect(appended.indexOf('- Run later.')).toBeLessThan(appended.indexOf('## Notes'));
    expect(appended).toContain('## Notes\n\n- not an example');
  });

  it('should append a sentence when an identical list item exists outside examples', () => {
    const note = '---\ntype: vocab\nword: "same"\ndefinition: "相同"\n---\n# same\n\n## Notes\n\n- Same line.\n\n## Examples\n\n';
    const appended = appendExample(note, 'Same line.');
    expect(appended.match(/- Same line\./gu)).toHaveLength(2);
    expect(parseNote(appended).entry.examples).toEqual(['Same line.']);
  });

  it('should encode markdown source paths containing spaces unicode and parentheses', () => {
    const note = buildNote({ word: 'source', definition: '来源', example: 'Source line.', source: { path: '../sources/资料 a)b.md', title: 'A source' } });
    expect(parseNote(note).entry.examples[0]).toContain('../sources/资料%20a%29b.md');
  });

  it('should use the local calendar date when building notes by default', () => {
    const RealDate = Date;
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ['2026-01-01T00:30:00+09:00'])); }
    };
    try {
      expect(buildNote({ word: 'local', definition: '本地' })).toContain('created: "2026-01-01"');
    } finally {
      globalThis.Date = RealDate;
    }
  });

  it('should report invalid frontmatter when quoted yaml cannot parse', () => {
    expect(parseNote('---\ntype: vocab\nword: \"bad\ndefinition: x\n---\n# bad').ok).toBe(false);
    expect(parseNote("---\ntype: vocab\nword: 'bad\ndefinition: x\n---\n# bad")).toMatchObject({ ok: false, error: 'invalid quoted scalar' });
    expect(parseNote('---\ntype: vocab\nword: plain\n---\n# plain')).toMatchObject({ ok: false, error: 'missing definition' });
  });

  it('should append replacement tokens literally when an example contains dollar patterns', () => {
    const note = buildNote({ word: 'cash', definition: '现金' });
    const appended = appendExample(note, 'Use $1 and $& literally.');
    expect(appended).toContain('- Use $1 and $& literally.');
  });

  it('should parse CRLF notes and preserve CRLF when appending examples', () => {
    const note = buildNote({ word: 'windows', definition: '窗口' }).replaceAll('\n', '\r\n');
    expect(parseNote(note)).toMatchObject({ ok: true, entry: { word: 'windows' } });
    const appended = appendExample(note, 'Windows example.');
    expect(appended).toContain('\r\n- Windows example.\r\n');
    expect(appended.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('should normalize example whitespace and escape brackets in source titles', () => {
    const note = buildNote({ word: 'space', definition: '空格', example: 'A\n  spaced\t example.', source: { path: '../sources/a.md', title: 'A [title]' } });
    expect(note).toContain('- A spaced example. — [A \\[title\\]](../sources/a.md)');
  });
});
