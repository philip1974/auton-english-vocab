import { describe, expect, it } from 'vitest';
import { classifyNovelRate, detectEnglish, extractReadingTokens, validateLevelSettings } from '../src/reading-level.mjs';

const many = (word, count) => Array.from({ length: count }, () => word).join(' ');

describe('reading level text processing', () => {
  it('should strip markdown noise and skip headings when counting words', () => {
    const text = `---\ntitle: Test\n---\n# Proper Title Words\n\nHello [reader](https://example.com). Visit https://example.com.\n\n\`code words\`\n\n\`\`\`\nignored words\n\`\`\`\n\n- Alice studies quietly: Running helps.\n\n| --- | --- |\n\n[[target|Shown Text]] <b>plain</b>`;
    const tokens = extractReadingTokens(text);
    expect(tokens.map((token) => token.word)).toEqual(['hello', 'reader', 'visit', 'alice', 'studies', 'quietly', 'running', 'helps', 'shown', 'text', 'plain']);
    expect(tokens.filter((token) => token.counted).map((token) => token.word)).toEqual(['hello', 'reader', 'visit', 'alice', 'studies', 'quietly', 'running', 'helps', 'shown', 'plain']);
  });

  it('should exclude backtick and tilde fences of different lengths from language and token analysis', () => {
    const code = many('identifier', 60);
    for (const [open, close] of [['~~~js', '~~~'], ['````js', '````']]) {
      const markdown = `中文正文内容\n${open}\n${code}\n${close}\n中文结尾`;
      expect(detectEnglish(markdown)).toMatchObject({ english: false, reason: 'too-short' });
      expect(extractReadingTokens(markdown).map((token) => token.word)).toEqual([]);
    }
  });

  it('should ignore sentence-internal title case words when they look like proper nouns', () => {
    const tokens = extractReadingTokens('Alice met Bob. Bob met Carol: Alice smiled.\n\n- London trains move.');
    expect(tokens.filter((token) => token.counted).map((token) => token.word)).toEqual(['alice', 'met', 'bob', 'met', 'alice', 'smiled', 'london', 'trains', 'move']);
    expect(tokens.find((token) => token.surface === 'Bob' && token.word === 'bob')?.properNoun).toBe(true);
  });

  it('should classify English text by latin word count and cjk denominator when detecting language', () => {
    expect(detectEnglish(many('word', 49))).toMatchObject({ english: false, reason: 'too-short' });
    expect(detectEnglish(`${many('word', 50)} ${'中文'.repeat(30)}`)).toMatchObject({ english: false, reason: 'not-english' });
    expect(detectEnglish(`${many('word', 70)} ${'中文'.repeat(10)}`)).toMatchObject({ english: true });
  });

  it('should keep the default two to five percent reading bands inclusive at boundaries', () => {
    expect(classifyNovelRate(2.0).band).toBe('easy');
    expect(classifyNovelRate(2.01).band).toBe('good');
    expect(classifyNovelRate(5.0).band).toBe('good');
    expect(classifyNovelRate(5.01).band).toBe('hard');
  });

  it('should reject invalid reading level settings when the range or vocabulary size is outside limits', () => {
    expect(validateLevelSettings({ vocabularySize: 3000, easyMax: 1, goodMax: 6 }).ok).toBe(true);
    expect(validateLevelSettings({ vocabularySize: 4000, easyMax: 1, goodMax: 6 })).toMatchObject({ ok: false });
    expect(validateLevelSettings({ vocabularySize: 3000, easyMax: 6, goodMax: 6 })).toMatchObject({ ok: false });
    expect(validateLevelSettings({ vocabularySize: 3000, easyMax: -1, goodMax: 6 })).toMatchObject({ ok: false });
    expect(validateLevelSettings({ vocabularySize: 3000, easyMax: 1, goodMax: 21 })).toMatchObject({ ok: false });
    expect(validateLevelSettings({})).toMatchObject({ ok: false });
    expect(validateLevelSettings({ vocabularySize: 3000, easyMax: Number.NaN, goodMax: 5 })).toMatchObject({ ok: false });
  });
});
