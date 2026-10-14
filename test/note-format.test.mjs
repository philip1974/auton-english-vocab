import { describe, expect, it } from 'vitest';
import { appendExample, buildNote, parseNote, slugFor } from '../src/note-format.mjs';

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
  });

  it('should reject non English words when building a note', () => {
    expect(() => buildNote({ word: '你好', definition: 'hello' })).toThrow(/invalid English word/);
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

  it('should report invalid frontmatter when quoted yaml cannot parse', () => {
    expect(parseNote('---\ntype: vocab\nword: \"bad\ndefinition: x\n---\n# bad').ok).toBe(false);
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
