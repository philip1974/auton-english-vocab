// 人工逐项审定：include 仅用于独立常见义项与来源 lemma 无关的同形词。
export const AMBIGUOUS_INFLECTION_DECISIONS = Object.freeze([
  ['does', true, 'do 的第三人称单数，同时也是 doe（母鹿）的复数。'],
  ['found', true, 'find 的过去式和过去分词，同时是常用动词“建立、创立”。'],
  ['left', true, 'leave 的过去式和过去分词，同时常表示“左边、左侧”。'],
  ['thought', false, '名词义“想法”与 think 语义透明。'],
  ['bit', true, 'bite 的过去式，同时是常用名词“少量、马嚼子”。'],
  ['saw', true, 'see 的过去式，同时是常用名词和动词“锯、锯开”。'],
  ['shot', true, 'shoot 的过去式和过去分词，同时是常用名词“射击、尝试、镜头”。'],
  ['training', false, 'train 的规则屈折及语义透明名词化。'],
  ['ground', true, 'grind 的过去式和过去分词，同时是常用名词“土地、地面”。'],
  ['feeling', false, 'feel 的规则屈折及语义透明名词化。'],
  ['felt', true, 'feel 的过去式和过去分词，同时是常用名词“毛毡”。'],
  ['feels', false, '词典 exchange 指回 feel 的规则第三人称形式。'],
  ['programs', false, '词典 exchange 指回 program 的规则复数或第三人称形式。'],
  ['putting', false, 'put 的规则屈折；高尔夫义仍与动作语义相关。'],
  ['fell', true, 'fall 的过去式，同时是独立常用动词“砍倒”。'],
  ['wedding', false, 'wed 的规则屈折及语义透明名词化。'],
  ['rose', true, 'rise 的过去式，同时是常用名词“玫瑰”。'],
  ['engineering', false, 'engineer 的规则屈折及语义透明名词化。'],
  ['marketing', false, 'market 的规则屈折及语义透明名词化。'],
  ['clothes', false, 'clothe 的形式与“衣物”义语义直接相关。'],
  ['feed', true, 'fee 的过去式和过去分词，同时是常用动词、名词“喂养、饲料”。'],
  ['lay', true, 'lie 的过去式，同时是常用独立动词“放置”。'],
  ['sat', false, '独立义主要为缩写或罕见名词，通常是 sit 的过去式。'],
  ['falls', false, '词典 exchange 指回 fall 的规则第三人称或复数形式。'],
  ['spoke', true, 'speak 的过去式，同时是常用名词“轮辐”。'],
  ['painting', false, 'paint 的规则屈折及语义透明名词化。'],
  ['rent', true, 'rend 的过去式和过去分词，同时是常用名词、动词“租金、租用”。'],
  ['manufacturing', false, 'manufacture 的规则屈折及语义透明名词化。'],
  ['chose', false, '独立法律名词义罕见，通常是 choose 的过去式。'],
  ['advertising', false, 'advertise 的规则屈折及语义透明名词化。'],
  ['pants', true, 'pant 的第三人称单数，同时是常用名词“裤子”。'],
  ['bound', true, 'bind 的过去式和过去分词，同时常表示“边界、跳跃、前往”。'],
  ['programming', false, 'program 的规则屈折及语义透明名词化。'],
  ['drove', false, '独立名词义罕见，通常是 drive 的过去式。'],
  ['timing', false, 'time 的规则屈折及语义透明名词化。'],
  ['feeding', false, 'feed/fee 的规则屈折或语义透明名词化。'],
  ['wound', true, 'wind 的过去式和过去分词，同时是常用名词“伤口”。'],
  ['rangers', false, '词典 exchange 指回 ranger 的规则复数。'],
].map(([surface, include, reason]) => Object.freeze({ surface, include, reason })));

export const AMBIGUOUS_INFLECTION_REVIEWS = Object.freeze(
  AMBIGUOUS_INFLECTION_DECISIONS.filter((item) => item.include),
);

export const AMBIGUOUS_INFLECTION_SURFACES = Object.freeze(
  AMBIGUOUS_INFLECTION_REVIEWS.map((item) => item.surface).sort(),
);
