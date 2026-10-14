import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentLocale, uiText } from '../src/ui-text.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ui text', () => {
  it('should return localized text when locale is supported', () => {
    expect(uiText('en-US').loading(1, 2)).toBe('Reading vocabulary 1 / 2');
    expect(uiText('zh-CN').loading(1, 2)).toBe('正在读取生词 1 / 2');
    expect(uiText('ja-JP').loading(1, 2)).toBe('単語を読み込み中 1 / 2');
    expect(uiText('ko-KR').loading(1, 2)).toBe('단어 읽는 중 1 / 2');
  });

  it('should localize every review rating outside English', () => {
    expect(uiText('zh')).toMatchObject({ again: '重来', hard: '困难', good: '良好', easy: '简单' });
    expect(uiText('ja')).toMatchObject({ again: 'もう一度', hard: '難しい', good: '正解', easy: '簡単' });
    expect(uiText('ko')).toMatchObject({ again: '다시', hard: '어려움', good: '좋음', easy: '쉬움' });
  });

  it('should expose callable proposal and request text for every supported locale', () => {
    for (const locale of ['en', 'zh', 'ja', 'ko']) {
      const text = uiText(locale);
      const rendered = [
        text.proposalApplied(1, 'alpha'),
        text.proposalRejected(1, '', 'alpha'),
        text.proposalRejected(1, 'reason', 'alpha'),
        text.proposalPending(1, 'alpha'),
        text.proposalTimeout(1, 'alpha'),
        text.proposalAborted(1, 'alpha'),
        text.proposalFailed(1),
        text.proposalDescription(1, 'alpha'),
        text.skippedSummary(1, 2),
        text.recommendationProgress(1, 2),
        text.readingStatus(1, 'easy'),
        text.readingStatus(4, 'good'),
        text.readingStatus(9, 'hard'),
        text.readingStatusTitle(4.2, 100),
        text.request.short('alpha'),
        text.request.long,
        text.request.instruction,
      ];
      expect(rendered.every(Boolean)).toBe(true);
    }
  });

  it('should fall back to English when locale is unsupported', () => {
    expect(uiText('fr').needsHost).toBe(uiText('en').needsHost);
    expect(uiText().needsHost).toBe(uiText('en').needsHost);
  });

  it('should read current locale from document when available', () => {
    document.documentElement.lang = 'ko';
    expect(currentLocale()).toBe('ko');
  });

  it('should use English locale when document is unavailable', () => {
    vi.stubGlobal('document', undefined);
    expect(currentLocale()).toBe('en');
  });
});
