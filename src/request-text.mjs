import { uiText } from './ui-text.mjs';

function countWords(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function requestLanguage(locale) {
  return uiText(locale).request;
}

export function requestTextFromSelection(context, locale = 'en') {
  const t = requestLanguage(locale);
  const selected = String(context.text ?? '').trim().slice(0, 2000);
  const sentence = String(context.sentence ?? '').trim().slice(0, 600);
  const source = context.source?.kind === 'document'
    ? `${context.source.title || ''}\nsource.path: ${context.source.path || ''}`
    : `${context.source?.title ?? ''}\nsource.url: ${context.source?.url ?? ''}`;
  const task = countWords(selected) <= 3
    ? t.short(selected)
    : t.long;
  return [
    task,
    '',
    `${t.selection}: ${selected}`,
    sentence ? `${t.sentence}: ${sentence}` : '',
    `${t.source}: ${source}`,
    '',
    t.instruction,
  ].filter(Boolean).join('\n');
}

export function requestTextForWord(word, locale = 'en') {
  const t = requestLanguage(locale);
  return [t.short(String(word).trim()), '', t.instruction].join('\n');
}
