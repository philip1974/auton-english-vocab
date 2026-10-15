// 人工审定表：仅保留独立常见义项与来源 lemma 无关的同形词。
export const AMBIGUOUS_INFLECTION_REVIEWS = Object.freeze([
  Object.freeze({ surface: 'does', reason: 'do 的第三人称单数，同时也是 doe（母鹿）的复数。' }),
  Object.freeze({ surface: 'fell', reason: 'fall 的过去式，同时是“砍倒”及相关名词、形容词。' }),
  Object.freeze({ surface: 'found', reason: 'find 的过去式和过去分词，同时是“建立、创立”。' }),
  Object.freeze({ surface: 'lay', reason: 'lie 的过去式，同时是常用动词“放置”。' }),
  Object.freeze({ surface: 'left', reason: 'leave 的过去式和过去分词，同时表示“左边、左侧”。' }),
  Object.freeze({ surface: 'rose', reason: 'rise 的过去式，同时是常用名词“玫瑰”。' }),
  Object.freeze({ surface: 'saw', reason: 'see 的过去式，同时是常用名词和动词“锯、锯开”。' }),
  Object.freeze({ surface: 'wound', reason: 'wind 的过去式和过去分词，同时是常用名词“伤口”。' }),
]);

export const AMBIGUOUS_INFLECTION_SURFACES = Object.freeze(
  AMBIGUOUS_INFLECTION_REVIEWS.map((item) => item.surface),
);
