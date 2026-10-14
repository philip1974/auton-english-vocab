import { describe, expect, it } from 'vitest';
import { requestTextFromSelection } from '../src/request-text.mjs';

describe('request text', () => {
  it('should ask to collect the selected word when selection has at most three words', () => {
    expect(requestTextFromSelection({ text: 'make up', sentence: 'I can make up a story.', source: { kind: 'document', title: 'Doc', path: 'wiki/sources/a.md' } }, 'zh')).toMatch(/请把 "make up" 收为英语生词/);
  });

  it('should ask the agent to choose words when selection is longer', () => {
    expect(requestTextFromSelection({ text: 'This paragraph contains several useful expressions', source: { kind: 'web', title: 'Page', url: 'https://example.com' } }, 'zh')).toMatch(/挑出值得收录/);
  });

  it('should omit an empty sentence when building request text', () => {
    expect(requestTextFromSelection({ text: 'word', sentence: '', source: { kind: 'document', title: 'Doc', path: 'wiki/doc.md' } }, 'zh')).not.toMatch(/原句:/);
  });

  it('should tolerate missing source fields when building request text', () => {
    expect(requestTextFromSelection({ text: 'word', source: {} }, 'zh')).toContain('source.url:');
  });

  it('should name the exact source field and vocab_add entry fields when building a request', () => {
    const documentText = requestTextFromSelection({ text: 'word', source: { kind: 'document', title: 'Doc', path: 'wiki/sources/a.md' } }, 'en');
    const webText = requestTextFromSelection({ text: 'word', source: { kind: 'web', title: 'Web', url: 'https://example.com/a' } }, 'en');
    expect(documentText).toContain('source.path: wiki/sources/a.md');
    expect(webText).toContain('source.url: https://example.com/a');
    expect(documentText).toContain('word / definition / phonetic? / pos? / example? / source?');
  });

  it('should write selection requests in the requested UI language', () => {
    const context = { text: 'word', source: { kind: 'document', title: 'Doc', path: 'wiki/doc.md' } };
    expect(requestTextFromSelection(context, 'en')).toContain('Add "word"');
    expect(requestTextFromSelection(context, 'zh')).toContain('请把 "word"');
  });
});
