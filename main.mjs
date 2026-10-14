// src/ui-text.mjs
var TEXT = {
  en: {
    needsHost: "Auton Knowledge 0.3.0 or newer is required",
    panelTitle: "English Vocab",
    commandTitle: "English Vocab: start review",
    commandDescription: "Open the English Vocab review panel.",
    collectTitle: "Add to vocabulary",
    collectFailed: "Could not append the vocabulary request to chat.",
    corruptReview: "review.json is damaged. It was backed up and review progress was reset.",
    rootChangedDuringReview: "The knowledge base changed. This rating was not saved.",
    reviewSaveFailed: "Could not save review progress.",
    logSaveFailed: "The card was saved, but the review log could not be saved.",
    flagSaveFailed: "Could not save the vocabulary status.",
    emptyProgress: "This knowledge base does not have review progress yet (progress is saved separately for each knowledge folder).",
    loading: (done, total) => `Reading vocabulary ${done} / ${total}`,
    today: "Today",
    notebook: "Notebook",
    flip: "Flashcard",
    reverse: "Reverse spelling",
    listening: "Listening spelling",
    listeningInterrupts: "Playback cancels any current speech.",
    noEnglishVoice: "No English speech voice is available.",
    replay: "Play again",
    spellingPlaceholder: "Type the word",
    answer: "Answer",
    again: "Again",
    hard: "Hard",
    good: "Good",
    easy: "Easy",
    search: "Search",
    all: "All",
    new: "New",
    learning: "Learning",
    familiar: "Familiar",
    mastered: "Mastered",
    ignored: "Ignored",
    markMastered: "Mark mastered",
    ignore: "Ignore",
    restore: "Restore",
    add: "Add",
    addWord: "Word",
    invalidManualWord: "Enter one English word.",
    noCards: "No due words.",
    proposalApplied: (number, words) => `Vocabulary proposal #${number} was applied: ${words}`,
    proposalRejected: (number, reason, words) => `Vocabulary proposal #${number} was rejected: ${reason || "No reason given"} (${words})`,
    proposalPending: (number, words) => `Vocabulary proposal #${number} was not reviewed because another proposal is pending: ${words}`,
    proposalTimeout: (number, words) => `Vocabulary proposal #${number} timed out: ${words}`,
    proposalAborted: (number, words) => `Vocabulary proposal #${number} was aborted: ${words}`,
    proposalFailed: (number) => `Vocabulary proposal #${number} could not be submitted.`,
    proposalDescription: (number, words) => `English Vocab #${number}: ${words}`,
    request: {
      short: (value) => `Add "${value}" to my English vocabulary.`,
      long: "Choose useful English vocabulary from the selection below.",
      selection: "Selection",
      sentence: "Sentence",
      source: "Source",
      instruction: "Complete the entry and call vocab_add. Fields: word / definition / phonetic? / pos? / example? / source?. Do not edit wiki files directly."
    }
  },
  zh: {
    needsHost: "需要 Auton Knowledge 0.3.0 或更新",
    panelTitle: "英语生词本",
    commandTitle: "英语生词本：开始复习",
    commandDescription: "打开英语生词本复习面板。",
    collectTitle: "收为生词",
    collectFailed: "无法把生词请求追加到对话框。",
    corruptReview: "review.json 已损坏，已备份并从空进度开始。",
    rootChangedDuringReview: "知识库已切换，这次评分未保存。",
    reviewSaveFailed: "复习进度保存失败。",
    logSaveFailed: "卡片已保存，但复习日志保存失败。",
    flagSaveFailed: "生词状态保存失败。",
    emptyProgress: "此知识库还没有复习进度（进度按知识库所在文件夹分开保存）",
    loading: (done, total) => `正在读取生词 ${done} / ${total}`,
    today: "今日复习",
    notebook: "生词本",
    flip: "翻卡",
    reverse: "反向拼写",
    listening: "听音拼写",
    listeningInterrupts: "会打断正在进行的朗读",
    noEnglishVoice: "没有可用的英语声音。",
    replay: "再听一次",
    spellingPlaceholder: "输入这个词",
    answer: "答案",
    again: "Again",
    hard: "Hard",
    good: "Good",
    easy: "Easy",
    search: "搜索",
    all: "全部",
    new: "新词",
    learning: "学习中",
    familiar: "熟悉",
    mastered: "已掌握",
    ignored: "已忽略",
    markMastered: "已掌握",
    ignore: "忽略",
    restore: "恢复",
    add: "添加",
    addWord: "输入词",
    invalidManualWord: "请输入一个英文词。",
    noCards: "没有到期生词。",
    proposalApplied: (number, words) => `生词提案 #${number} 已应用：${words}`,
    proposalRejected: (number, reason, words) => `生词提案 #${number} 被拒绝：${reason || "未给出原因"}（${words}）`,
    proposalPending: (number, words) => `生词提案 #${number} 尚未审阅，另有待审提案：${words}`,
    proposalTimeout: (number, words) => `生词提案 #${number} 审阅超时：${words}`,
    proposalAborted: (number, words) => `生词提案 #${number} 已中止：${words}`,
    proposalFailed: (number) => `生词提案 #${number} 提交失败。`,
    proposalDescription: (number, words) => `英语生词本 #${number}：${words}`,
    request: {
      short: (value) => `请把 "${value}" 收为英语生词。`,
      long: "请从下面选区里挑出值得收录的英语生词。",
      selection: "选区",
      sentence: "原句",
      source: "出处",
      instruction: "请补全条目并调用 vocab_add。字段：word / definition / phonetic? / pos? / example? / source?。不要直接改 wiki 文件。"
    }
  },
  ja: {
    needsHost: "Auton Knowledge 0.3.0 以降が必要です",
    panelTitle: "English Vocab",
    commandTitle: "English Vocab: 復習を開始",
    commandDescription: "English Vocab の復習パネルを開きます。",
    collectTitle: "単語に追加",
    collectFailed: "チャットへ単語リクエストを追加できませんでした。",
    corruptReview: "review.json が破損しています。バックアップして復習進捗を初期化しました。",
    rootChangedDuringReview: "ナレッジベースが切り替わったため、この評価は保存されませんでした。",
    reviewSaveFailed: "復習進捗を保存できませんでした。",
    logSaveFailed: "カードは保存されましたが、復習ログを保存できませんでした。",
    flagSaveFailed: "単語の状態を保存できませんでした。",
    emptyProgress: "このナレッジベースにはまだ復習進捗がありません（進捗はフォルダーごとに保存されます）。",
    loading: (done, total) => `単語を読み込み中 ${done} / ${total}`,
    today: "今日の復習",
    notebook: "単語帳",
    flip: "カード",
    reverse: "逆スペル",
    listening: "リスニング",
    listeningInterrupts: "再生中の読み上げを停止します",
    noEnglishVoice: "英語の音声がありません。",
    replay: "もう一度聞く",
    spellingPlaceholder: "単語を入力",
    answer: "答え",
    again: "Again",
    hard: "Hard",
    good: "Good",
    easy: "Easy",
    search: "検索",
    all: "すべて",
    new: "新規",
    learning: "学習中",
    familiar: "慣れた",
    mastered: "習得済み",
    ignored: "無視",
    markMastered: "習得済み",
    ignore: "無視",
    restore: "戻す",
    add: "追加",
    addWord: "単語",
    invalidManualWord: "英単語を1つ入力してください。",
    noCards: "期限の単語はありません。",
    proposalApplied: (number, words) => `単語提案 #${number} を適用しました：${words}`,
    proposalRejected: (number, reason, words) => `単語提案 #${number} は拒否されました：${reason || "理由なし"}（${words}）`,
    proposalPending: (number, words) => `別の提案が保留中のため、単語提案 #${number} は未レビューです：${words}`,
    proposalTimeout: (number, words) => `単語提案 #${number} はタイムアウトしました：${words}`,
    proposalAborted: (number, words) => `単語提案 #${number} は中止されました：${words}`,
    proposalFailed: (number) => `単語提案 #${number} を送信できませんでした。`,
    proposalDescription: (number, words) => `英単語帳 #${number}：${words}`,
    request: {
      short: (value) => `「${value}」を英単語帳に追加してください。`,
      long: "次の選択範囲から学ぶ価値のある英単語を選んでください。",
      selection: "選択範囲",
      sentence: "文",
      source: "出典",
      instruction: "項目を補完して vocab_add を呼び出してください。フィールド：word / definition / phonetic? / pos? / example? / source?。wiki を直接編集しないでください。"
    }
  },
  ko: {
    needsHost: "Auton Knowledge 0.3.0 이상이 필요합니다",
    panelTitle: "English Vocab",
    commandTitle: "English Vocab: 복습 시작",
    commandDescription: "English Vocab 복습 패널을 엽니다.",
    collectTitle: "단어장에 추가",
    collectFailed: "채팅에 단어 요청을 추가할 수 없습니다.",
    corruptReview: "review.json이 손상되었습니다. 백업 후 복습 진도를 초기화했습니다.",
    rootChangedDuringReview: "지식베이스가 전환되어 이번 평가는 저장되지 않았습니다.",
    reviewSaveFailed: "복습 진도를 저장할 수 없습니다.",
    logSaveFailed: "카드는 저장되었지만 복습 로그를 저장할 수 없습니다.",
    flagSaveFailed: "단어 상태를 저장할 수 없습니다.",
    emptyProgress: "이 지식베이스에는 아직 복습 진도가 없습니다(진도는 폴더별로 따로 저장됩니다).",
    loading: (done, total) => `단어 읽는 중 ${done} / ${total}`,
    today: "오늘 복습",
    notebook: "단어장",
    flip: "카드",
    reverse: "역방향 철자",
    listening: "듣고 쓰기",
    listeningInterrupts: "진행 중인 음성을 중단합니다",
    noEnglishVoice: "사용 가능한 영어 음성이 없습니다.",
    replay: "다시 듣기",
    spellingPlaceholder: "단어 입력",
    answer: "정답",
    again: "Again",
    hard: "Hard",
    good: "Good",
    easy: "Easy",
    search: "검색",
    all: "전체",
    new: "새 단어",
    learning: "학습 중",
    familiar: "익숙함",
    mastered: "마스터",
    ignored: "무시됨",
    markMastered: "마스터",
    ignore: "무시",
    restore: "복원",
    add: "추가",
    addWord: "단어",
    invalidManualWord: "영단어 하나를 입력하세요.",
    noCards: "기한이 된 단어가 없습니다.",
    proposalApplied: (number, words) => `단어 제안 #${number}이 적용되었습니다: ${words}`,
    proposalRejected: (number, reason, words) => `단어 제안 #${number}이 거절되었습니다: ${reason || "사유 없음"} (${words})`,
    proposalPending: (number, words) => `다른 제안이 대기 중이라 단어 제안 #${number}은 검토되지 않았습니다: ${words}`,
    proposalTimeout: (number, words) => `단어 제안 #${number} 검토 시간이 초과되었습니다: ${words}`,
    proposalAborted: (number, words) => `단어 제안 #${number}이 중단되었습니다: ${words}`,
    proposalFailed: (number) => `단어 제안 #${number}을 제출할 수 없습니다.`,
    proposalDescription: (number, words) => `영어 단어장 #${number}: ${words}`,
    request: {
      short: (value) => `"${value}"를 영어 단어장에 추가해 주세요.`,
      long: "아래 선택 영역에서 학습할 만한 영어 단어를 골라 주세요.",
      selection: "선택 영역",
      sentence: "문장",
      source: "출처",
      instruction: "항목을 완성하고 vocab_add를 호출하세요. 필드: word / definition / phonetic? / pos? / example? / source?. wiki 파일을 직접 수정하지 마세요."
    }
  }
};
function uiText(locale = "en") {
  const key = String(locale).toLowerCase().slice(0, 2);
  return TEXT[key] ?? TEXT.en;
}
function currentLocale() {
  return globalThis.document?.documentElement?.lang || "en";
}

// node_modules/.pnpm/ts-fsrs@5.2.0/node_modules/ts-fsrs/dist/index.mjs
var u = ((a) => (a[a.New = 0] = "New", a[a.Learning = 1] = "Learning", a[a.Review = 2] = "Review", a[a.Relearning = 3] = "Relearning", a))(u || {});
var l = ((a) => (a[a.Manual = 0] = "Manual", a[a.Again = 1] = "Again", a[a.Hard = 2] = "Hard", a[a.Good = 3] = "Good", a[a.Easy = 4] = "Easy", a))(l || {});
var d = class _d {
  static card(t) {
    return { ...t, state: _d.state(t.state), due: _d.time(t.due), last_review: t.last_review ? _d.time(t.last_review) : void 0 };
  }
  static rating(t) {
    if (typeof t == "string") {
      const e = t.charAt(0).toUpperCase(), i = t.slice(1).toLowerCase(), s = l[`${e}${i}`];
      if (s === void 0) throw new Error(`Invalid rating:[${t}]`);
      return s;
    } else if (typeof t == "number") return t;
    throw new Error(`Invalid rating:[${t}]`);
  }
  static state(t) {
    if (typeof t == "string") {
      const e = t.charAt(0).toUpperCase(), i = t.slice(1).toLowerCase(), s = u[`${e}${i}`];
      if (s === void 0) throw new Error(`Invalid state:[${t}]`);
      return s;
    } else if (typeof t == "number") return t;
    throw new Error(`Invalid state:[${t}]`);
  }
  static time(t) {
    if (typeof t == "object" && t instanceof Date) return t;
    if (typeof t == "string") {
      const e = Date.parse(t);
      if (isNaN(e)) throw new Error(`Invalid date:[${t}]`);
      return new Date(e);
    } else if (typeof t == "number") return new Date(t);
    throw new Error(`Invalid date:[${t}]`);
  }
  static review_log(t) {
    return { ...t, due: _d.time(t.due), rating: _d.rating(t.rating), state: _d.state(t.state), review: _d.time(t.review) };
  }
};
Date.prototype.scheduler = function(a, t) {
  return m(this, a, t);
}, Date.prototype.diff = function(a, t) {
  return v(this, a, t);
}, Date.prototype.format = function() {
  return C(this);
}, Date.prototype.dueFormat = function(a, t, e) {
  return z(this, a, t, e);
};
function m(a, t, e) {
  return new Date(e ? d.time(a).getTime() + t * 24 * 60 * 60 * 1e3 : d.time(a).getTime() + t * 60 * 1e3);
}
function v(a, t, e) {
  if (!a || !t) throw new Error("Invalid date");
  const i = d.time(a).getTime() - d.time(t).getTime();
  let s = 0;
  switch (e) {
    case "days":
      s = Math.floor(i / (24 * 60 * 60 * 1e3));
      break;
    case "minutes":
      s = Math.floor(i / (60 * 1e3));
      break;
  }
  return s;
}
function C(a) {
  const t = d.time(a), e = t.getFullYear(), i = t.getMonth() + 1, s = t.getDate(), r = t.getHours(), n = t.getMinutes(), o = t.getSeconds();
  return `${e}-${b(i)}-${b(s)} ${b(r)}:${b(n)}:${b(o)}`;
}
function b(a) {
  return a < 10 ? `0${a}` : `${a}`;
}
var L = [60, 60, 24, 31, 12];
var N = ["second", "min", "hour", "day", "month", "year"];
function z(a, t, e, i = N) {
  a = d.time(a), t = d.time(t), i.length !== N.length && (i = N);
  let s = a.getTime() - t.getTime(), r;
  for (s /= 1e3, r = 0; r < L.length && !(s < L[r]); r++) s /= L[r];
  return `${Math.floor(s)}${e ? i[r] : ""}`;
}
var T = Object.freeze([l.Again, l.Hard, l.Good, l.Easy]);
var nt = [{ start: 2.5, end: 7, factor: 0.15 }, { start: 7, end: 20, factor: 0.1 }, { start: 20, end: 1 / 0, factor: 0.05 }];
function U(a, t, e) {
  let i = 1;
  for (const n of nt) i += n.factor * Math.max(Math.min(a, n.end) - n.start, 0);
  a = Math.min(a, e);
  let s = Math.max(2, Math.round(a - i));
  const r = Math.min(Math.round(a + i), e);
  return a > t && (s = Math.max(s, t + 1)), s = Math.min(s, r), { min_ivl: s, max_ivl: r };
}
function g(a, t, e) {
  return Math.min(Math.max(a, t), e);
}
function k(a, t) {
  const e = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()), i = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  return Math.floor((i - e) / 864e5);
}
var lt = "5.2.0";
var q = 0.9;
var P = 36500;
var j = false;
var O = true;
var Y = Object.freeze(["1m", "10m"]);
var W = Object.freeze(["10m"]);
var ot = `v${lt} using FSRS-6.0`;
var p = 1e-3;
var M = 100;
var $ = 0.5;
var B = 0.1542;
var D = Object.freeze([0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 1e-3, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, B]);
var X = 2;
var V = (a) => [[p, M], [p, M], [p, M], [p, M], [1, 10], [1e-3, 4], [1e-3, 4], [1e-3, 0.75], [0, 4.5], [0, 0.8], [1e-3, 3.5], [1e-3, 5], [1e-3, 0.25], [1e-3, 0.9], [0, 4], [0, 1], [1, 6], [0, a], [0, a], [0, 0.8], [0.1, 0.8]];
var E = (a, t) => {
  let e = X;
  if (Math.max(0, t) > 1) {
    const i = -(Math.log(a[11]) + Math.log(Math.pow(2, a[13]) - 1) + a[14] * 0.3) / t;
    e = g(+i.toFixed(8), 0.01, 2);
  }
  return V(e).map(([i, s], r) => g(a[r], i, s));
};
var R = (a) => {
  if (a === void 0) return [...D];
  switch (a.length) {
    case 21:
      return [...a];
    case 19:
      return console.debug("[FSRS-6]auto fill w from 19 to 21 length"), [...a, 0, $];
    case 17: {
      const t = [...a];
      return t[4] = +(t[5] * 2 + t[4]).toFixed(8), t[5] = +(Math.log(t[5] * 3 + 1) / 3).toFixed(8), t[6] = +(t[6] + 0.5).toFixed(8), console.debug("[FSRS-6]auto fill w from 17 to 21 length"), t.concat([0, 0, 0, $]);
    }
    default:
      return console.warn("[FSRS]Invalid parameters length, using default parameters"), [...D];
  }
};
var I = (a) => {
  const t = Array.isArray(a?.learning_steps) ? a.learning_steps : Y, e = Array.isArray(a?.relearning_steps) ? a.relearning_steps : W, i = E(R(a?.w), e.length);
  return { request_retention: a?.request_retention || q, maximum_interval: a?.maximum_interval || P, w: i, enable_fuzz: a?.enable_fuzz ?? j, enable_short_term: a?.enable_short_term ?? O, learning_steps: t, relearning_steps: e };
};
function F(a, t) {
  const e = { due: a ? d.time(a) : /* @__PURE__ */ new Date(), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, learning_steps: 0, state: u.New, last_review: void 0 };
  return t && typeof t == "function" ? t(e) : e;
}
var ut = class {
  c;
  s0;
  s1;
  s2;
  constructor(t) {
    const e = ct();
    this.c = 1, this.s0 = e(" "), this.s1 = e(" "), this.s2 = e(" "), t == null && (t = +/* @__PURE__ */ new Date()), this.s0 -= e(t), this.s0 < 0 && (this.s0 += 1), this.s1 -= e(t), this.s1 < 0 && (this.s1 += 1), this.s2 -= e(t), this.s2 < 0 && (this.s2 += 1);
  }
  next() {
    const t = 2091639 * this.s0 + this.c * 23283064365386963e-26;
    return this.s0 = this.s1, this.s1 = this.s2, this.s2 = t - (this.c = t | 0), this.s2;
  }
  set state(t) {
    this.c = t.c, this.s0 = t.s0, this.s1 = t.s1, this.s2 = t.s2;
  }
  get state() {
    return { c: this.c, s0: this.s0, s1: this.s1, s2: this.s2 };
  }
};
function ct() {
  let a = 4022871197;
  return function(t) {
    t = String(t);
    for (let e = 0; e < t.length; e++) {
      a += t.charCodeAt(e);
      let i = 0.02519603282416938 * a;
      a = i >>> 0, i -= a, i *= a, a = i >>> 0, i -= a, a += i * 4294967296;
    }
    return (a >>> 0) * 23283064365386963e-26;
  };
}
function _t(a) {
  const t = new ut(a), e = () => t.next();
  return e.int32 = () => t.next() * 4294967296 | 0, e.double = () => e() + (e() * 2097152 | 0) * 11102230246251565e-32, e.state = () => t.state, e.importState = (i) => (t.state = i, e), e;
}
var H = (a) => {
  const t = typeof a == "number" ? -a : -a[20], e = Math.exp(Math.pow(t, -1) * Math.log(0.9)) - 1;
  return { decay: t, factor: +e.toFixed(8) };
};
function A(a, t, e) {
  const { decay: i, factor: s } = H(a);
  return +Math.pow(1 + s * t / e, i).toFixed(8);
}
var J = class {
  param;
  intervalModifier;
  _seed;
  constructor(t) {
    this.param = new Proxy(I(t), this.params_handler_proxy()), this.intervalModifier = this.calculate_interval_modifier(this.param.request_retention), this.forgetting_curve = A.bind(this, this.param.w);
  }
  get interval_modifier() {
    return this.intervalModifier;
  }
  set seed(t) {
    this._seed = t;
  }
  calculate_interval_modifier(t) {
    if (t <= 0 || t > 1) throw new Error("Requested retention rate should be in the range (0,1]");
    const { decay: e, factor: i } = H(this.param.w);
    return +((Math.pow(t, 1 / e) - 1) / i).toFixed(8);
  }
  get parameters() {
    return this.param;
  }
  set parameters(t) {
    this.update_parameters(t);
  }
  params_handler_proxy() {
    const t = this;
    return { set: function(e, i, s) {
      return i === "request_retention" && Number.isFinite(s) ? t.intervalModifier = t.calculate_interval_modifier(Number(s)) : i === "w" && (s = E(R(s), e.relearning_steps.length), t.forgetting_curve = A.bind(this, s), t.intervalModifier = t.calculate_interval_modifier(Number(e.request_retention))), Reflect.set(e, i, s), true;
    } };
  }
  update_parameters(t) {
    const e = I(t);
    for (const i in e) if (i in this.param) {
      const s = i;
      this.param[s] = e[s];
    }
  }
  init_stability(t) {
    return Math.max(this.param.w[t - 1], 0.1);
  }
  init_difficulty(t) {
    return +(this.param.w[4] - Math.exp((t - 1) * this.param.w[5]) + 1).toFixed(8);
  }
  apply_fuzz(t, e) {
    if (!this.param.enable_fuzz || t < 2.5) return Math.round(t);
    const i = _t(this._seed)(), { min_ivl: s, max_ivl: r } = U(t, e, this.param.maximum_interval);
    return Math.floor(i * (r - s + 1) + s);
  }
  next_interval(t, e) {
    const i = Math.min(Math.max(1, Math.round(t * this.intervalModifier)), this.param.maximum_interval);
    return this.apply_fuzz(i, e);
  }
  linear_damping(t, e) {
    return +(t * (10 - e) / 9).toFixed(8);
  }
  next_difficulty(t, e) {
    const i = -this.param.w[6] * (e - 3), s = t + this.linear_damping(i, t);
    return g(this.mean_reversion(this.init_difficulty(l.Easy), s), 1, 10);
  }
  mean_reversion(t, e) {
    return +(this.param.w[7] * t + (1 - this.param.w[7]) * e).toFixed(8);
  }
  next_recall_stability(t, e, i, s) {
    const r = l.Hard === s ? this.param.w[15] : 1, n = l.Easy === s ? this.param.w[16] : 1;
    return +g(e * (1 + Math.exp(this.param.w[8]) * (11 - t) * Math.pow(e, -this.param.w[9]) * (Math.exp((1 - i) * this.param.w[10]) - 1) * r * n), p, 36500).toFixed(8);
  }
  next_forget_stability(t, e, i) {
    return +g(this.param.w[11] * Math.pow(t, -this.param.w[12]) * (Math.pow(e + 1, this.param.w[13]) - 1) * Math.exp((1 - i) * this.param.w[14]), p, 36500).toFixed(8);
  }
  next_short_term_stability(t, e) {
    const i = Math.pow(t, -this.param.w[19]) * Math.exp(this.param.w[17] * (e - 3 + this.param.w[18])), s = e >= 3 ? Math.max(i, 1) : i;
    return +g(t * s, p, 36500).toFixed(8);
  }
  forgetting_curve;
  next_state(t, e, i) {
    const { difficulty: s, stability: r } = t ?? { difficulty: 0, stability: 0 };
    if (e < 0) throw new Error(`Invalid delta_t "${e}"`);
    if (i < 0 || i > 4) throw new Error(`Invalid grade "${i}"`);
    if (s === 0 && r === 0) return { difficulty: g(this.init_difficulty(i), 1, 10), stability: this.init_stability(i) };
    if (i === 0) return { difficulty: s, stability: r };
    if (s < 1 || r < p) throw new Error(`Invalid memory state { difficulty: ${s}, stability: ${r} }`);
    const n = this.forgetting_curve(e, r), o = this.next_recall_stability(s, r, n, i), h = this.next_forget_stability(s, r, n), c = this.next_short_term_stability(r, i);
    let _ = o;
    if (i === 1) {
      let [y, w] = [0, 0];
      this.param.enable_short_term && (y = this.param.w[17], w = this.param.w[18]);
      const f = r / Math.exp(y * w);
      _ = g(+f.toFixed(8), p, h);
    }
    return e === 0 && this.param.enable_short_term && (_ = c), { difficulty: this.next_difficulty(s, i), stability: _ };
  }
};
function K() {
  const a = this.review_time.getTime(), t = this.current.reps, e = this.current.difficulty * this.current.stability;
  return `${a}_${t}_${e}`;
}
var Q = (a) => {
  const t = a.slice(-1), e = parseInt(a.slice(0, -1), 10);
  if (isNaN(e) || !Number.isFinite(e) || e < 0) throw new Error(`Invalid step value: ${a}`);
  switch (t) {
    case "m":
      return e;
    case "h":
      return e * 60;
    case "d":
      return e * 1440;
    default:
      throw new Error(`Invalid step unit: ${a}, expected m/h/d`);
  }
};
var Z = (a, t, e) => {
  const i = t === u.Relearning || t === u.Review ? a.relearning_steps : a.learning_steps, s = i.length;
  if (s === 0 || e >= s) return {};
  const r = i[0], n = Q, o = () => n(r), h = () => {
    if (s === 1) return Math.round(n(r) * 1.5);
    const f = i[1];
    return Math.round((n(r) + n(f)) / 2);
  }, c = (f) => f < 0 || f >= s ? null : i[f], _ = (f) => n(f), y = {}, w = c(Math.max(0, e));
  if (t === u.Review) return y[l.Again] = { scheduled_minutes: n(w), next_step: 0 }, y;
  {
    y[l.Again] = { scheduled_minutes: o(), next_step: 0 }, y[l.Hard] = { scheduled_minutes: h(), next_step: e };
    const f = c(e + 1);
    if (f) {
      const x = _(f);
      x && (y[l.Good] = { scheduled_minutes: Math.round(x), next_step: e + 1 });
    }
  }
  return y;
};
var S = ((a) => (a.SCHEDULER = "Scheduler", a.LEARNING_STEPS = "LearningSteps", a.SEED = "Seed", a))(S || {});
var G = class {
  last;
  current;
  review_time;
  next = /* @__PURE__ */ new Map();
  algorithm;
  strategies;
  elapsed_days = 0;
  constructor(t, e, i, s) {
    this.algorithm = i, this.last = d.card(t), this.current = d.card(t), this.review_time = d.time(e), this.strategies = s, this.init();
  }
  checkGrade(t) {
    if (!Number.isFinite(t) || t < 0 || t > 4) throw new Error(`Invalid grade "${t}",expected 1-4`);
  }
  init() {
    const { state: t, last_review: e } = this.current;
    let i = 0;
    t !== u.New && e && (i = k(e, this.review_time)), this.current.last_review = this.review_time, this.elapsed_days = i, this.current.elapsed_days = i, this.current.reps += 1;
    let s = K;
    if (this.strategies) {
      const r = this.strategies.get(S.SEED);
      r && (s = r);
    }
    this.algorithm.seed = s.call(this);
  }
  preview() {
    return { [l.Again]: this.review(l.Again), [l.Hard]: this.review(l.Hard), [l.Good]: this.review(l.Good), [l.Easy]: this.review(l.Easy), [Symbol.iterator]: this.previewIterator.bind(this) };
  }
  *previewIterator() {
    for (const t of T) yield this.review(t);
  }
  review(t) {
    const { state: e } = this.last;
    let i;
    switch (this.checkGrade(t), e) {
      case u.New:
        i = this.newState(t);
        break;
      case u.Learning:
      case u.Relearning:
        i = this.learningState(t);
        break;
      case u.Review:
        i = this.reviewState(t);
        break;
    }
    return i;
  }
  buildLog(t) {
    const { last_review: e, due: i, elapsed_days: s } = this.last;
    return { rating: t, state: this.current.state, due: e || i, stability: this.current.stability, difficulty: this.current.difficulty, elapsed_days: this.elapsed_days, last_elapsed_days: s, scheduled_days: this.current.scheduled_days, learning_steps: this.current.learning_steps, review: this.review_time };
  }
};
var tt = class extends G {
  learningStepsStrategy;
  constructor(t, e, i, s) {
    super(t, e, i, s);
    let r = Z;
    if (this.strategies) {
      const n = this.strategies.get(S.LEARNING_STEPS);
      n && (r = n);
    }
    this.learningStepsStrategy = r;
  }
  getLearningInfo(t, e) {
    const i = this.algorithm.parameters;
    t.learning_steps = t.learning_steps || 0;
    const s = this.learningStepsStrategy(i, t.state, this.current.state === u.Learning ? t.learning_steps + 1 : t.learning_steps), r = Math.max(0, s[e]?.scheduled_minutes ?? 0), n = Math.max(0, s[e]?.next_step ?? 0);
    return { scheduled_minutes: r, next_steps: n };
  }
  applyLearningSteps(t, e, i) {
    const { scheduled_minutes: s, next_steps: r } = this.getLearningInfo(this.current, e);
    if (s > 0 && s < 1440) t.learning_steps = r, t.scheduled_days = 0, t.state = i, t.due = m(this.review_time, Math.round(s), false);
    else if (t.state = u.Review, s >= 1440) t.learning_steps = r, t.due = m(this.review_time, Math.round(s), false), t.scheduled_days = Math.floor(s / 1440);
    else {
      t.learning_steps = 0;
      const n = this.algorithm.next_interval(t.stability, this.elapsed_days);
      t.scheduled_days = n, t.due = m(this.review_time, n, true);
    }
  }
  newState(t) {
    const e = this.next.get(t);
    if (e) return e;
    const i = d.card(this.current);
    i.difficulty = g(this.algorithm.init_difficulty(t), 1, 10), i.stability = this.algorithm.init_stability(t), this.applyLearningSteps(i, t, u.Learning);
    const s = { card: i, log: this.buildLog(t) };
    return this.next.set(t, s), s;
  }
  learningState(t) {
    const e = this.next.get(t);
    if (e) return e;
    const { state: i, difficulty: s, stability: r } = this.last, n = d.card(this.current);
    n.difficulty = this.algorithm.next_difficulty(s, t), n.stability = this.algorithm.next_short_term_stability(r, t), this.applyLearningSteps(n, t, i);
    const o = { card: n, log: this.buildLog(t) };
    return this.next.set(t, o), o;
  }
  reviewState(t) {
    const e = this.next.get(t);
    if (e) return e;
    const i = this.elapsed_days, { difficulty: s, stability: r } = this.last, n = this.algorithm.forgetting_curve(i, r), o = d.card(this.current), h = d.card(this.current), c = d.card(this.current), _ = d.card(this.current);
    this.next_ds(o, h, c, _, s, r, n), this.next_interval(h, c, _, i), this.next_state(h, c, _), this.applyLearningSteps(o, l.Again, u.Relearning), o.lapses += 1;
    const y = { card: o, log: this.buildLog(l.Again) }, w = { card: h, log: super.buildLog(l.Hard) }, f = { card: c, log: super.buildLog(l.Good) }, x = { card: _, log: super.buildLog(l.Easy) };
    return this.next.set(l.Again, y), this.next.set(l.Hard, w), this.next.set(l.Good, f), this.next.set(l.Easy, x), this.next.get(t);
  }
  next_ds(t, e, i, s, r, n, o) {
    t.difficulty = this.algorithm.next_difficulty(r, l.Again);
    const h = n / Math.exp(this.algorithm.parameters.w[17] * this.algorithm.parameters.w[18]), c = this.algorithm.next_forget_stability(r, n, o);
    t.stability = g(+h.toFixed(8), p, c), e.difficulty = this.algorithm.next_difficulty(r, l.Hard), e.stability = this.algorithm.next_recall_stability(r, n, o, l.Hard), i.difficulty = this.algorithm.next_difficulty(r, l.Good), i.stability = this.algorithm.next_recall_stability(r, n, o, l.Good), s.difficulty = this.algorithm.next_difficulty(r, l.Easy), s.stability = this.algorithm.next_recall_stability(r, n, o, l.Easy);
  }
  next_interval(t, e, i, s) {
    let r, n;
    r = this.algorithm.next_interval(t.stability, s), n = this.algorithm.next_interval(e.stability, s), r = Math.min(r, n), n = Math.max(n, r + 1);
    const o = Math.max(this.algorithm.next_interval(i.stability, s), n + 1);
    t.scheduled_days = r, t.due = m(this.review_time, r, true), e.scheduled_days = n, e.due = m(this.review_time, n, true), i.scheduled_days = o, i.due = m(this.review_time, o, true);
  }
  next_state(t, e, i) {
    t.state = u.Review, t.learning_steps = 0, e.state = u.Review, e.learning_steps = 0, i.state = u.Review, i.learning_steps = 0;
  }
};
var et = class extends G {
  newState(t) {
    const e = this.next.get(t);
    if (e) return e;
    this.current.scheduled_days = 0, this.current.elapsed_days = 0;
    const i = d.card(this.current), s = d.card(this.current), r = d.card(this.current), n = d.card(this.current);
    return this.init_ds(i, s, r, n), this.next_interval(i, s, r, n, 0), this.next_state(i, s, r, n), this.update_next(i, s, r, n), this.next.get(t);
  }
  init_ds(t, e, i, s) {
    t.difficulty = g(this.algorithm.init_difficulty(l.Again), 1, 10), t.stability = this.algorithm.init_stability(l.Again), e.difficulty = g(this.algorithm.init_difficulty(l.Hard), 1, 10), e.stability = this.algorithm.init_stability(l.Hard), i.difficulty = g(this.algorithm.init_difficulty(l.Good), 1, 10), i.stability = this.algorithm.init_stability(l.Good), s.difficulty = g(this.algorithm.init_difficulty(l.Easy), 1, 10), s.stability = this.algorithm.init_stability(l.Easy);
  }
  learningState(t) {
    return this.reviewState(t);
  }
  reviewState(t) {
    const e = this.next.get(t);
    if (e) return e;
    const i = this.elapsed_days, { difficulty: s, stability: r } = this.last, n = this.algorithm.forgetting_curve(i, r), o = d.card(this.current), h = d.card(this.current), c = d.card(this.current), _ = d.card(this.current);
    return this.next_ds(o, h, c, _, s, r, n), this.next_interval(o, h, c, _, i), this.next_state(o, h, c, _), o.lapses += 1, this.update_next(o, h, c, _), this.next.get(t);
  }
  next_ds(t, e, i, s, r, n, o) {
    t.difficulty = this.algorithm.next_difficulty(r, l.Again);
    const h = this.algorithm.next_forget_stability(r, n, o);
    t.stability = g(n, p, h), e.difficulty = this.algorithm.next_difficulty(r, l.Hard), e.stability = this.algorithm.next_recall_stability(r, n, o, l.Hard), i.difficulty = this.algorithm.next_difficulty(r, l.Good), i.stability = this.algorithm.next_recall_stability(r, n, o, l.Good), s.difficulty = this.algorithm.next_difficulty(r, l.Easy), s.stability = this.algorithm.next_recall_stability(r, n, o, l.Easy);
  }
  next_interval(t, e, i, s, r) {
    let n, o, h, c;
    n = this.algorithm.next_interval(t.stability, r), o = this.algorithm.next_interval(e.stability, r), h = this.algorithm.next_interval(i.stability, r), c = this.algorithm.next_interval(s.stability, r), n = Math.min(n, o), o = Math.max(o, n + 1), h = Math.max(h, o + 1), c = Math.max(c, h + 1), t.scheduled_days = n, t.due = m(this.review_time, n, true), e.scheduled_days = o, e.due = m(this.review_time, o, true), i.scheduled_days = h, i.due = m(this.review_time, h, true), s.scheduled_days = c, s.due = m(this.review_time, c, true);
  }
  next_state(t, e, i, s) {
    t.state = u.Review, t.learning_steps = 0, e.state = u.Review, e.learning_steps = 0, i.state = u.Review, i.learning_steps = 0, s.state = u.Review, s.learning_steps = 0;
  }
  update_next(t, e, i, s) {
    const r = { card: t, log: this.buildLog(l.Again) }, n = { card: e, log: super.buildLog(l.Hard) }, o = { card: i, log: super.buildLog(l.Good) }, h = { card: s, log: super.buildLog(l.Easy) };
    this.next.set(l.Again, r), this.next.set(l.Hard, n), this.next.set(l.Good, o), this.next.set(l.Easy, h);
  }
};
var gt = class {
  fsrs;
  constructor(t) {
    this.fsrs = t;
  }
  replay(t, e, i) {
    return this.fsrs.next(t, e, i);
  }
  handleManualRating(t, e, i, s, r, n, o) {
    if (typeof e > "u") throw new Error("reschedule: state is required for manual rating");
    let h, c;
    if (e === u.New) h = { rating: l.Manual, state: e, due: o ?? i, stability: t.stability, difficulty: t.difficulty, elapsed_days: s, last_elapsed_days: t.elapsed_days, scheduled_days: t.scheduled_days, learning_steps: t.learning_steps, review: i }, c = F(i), c.last_review = i;
    else {
      if (typeof o > "u") throw new Error("reschedule: due is required for manual rating");
      const _ = v(o, i, "days");
      h = { rating: l.Manual, state: t.state, due: t.last_review || t.due, stability: t.stability, difficulty: t.difficulty, elapsed_days: s, last_elapsed_days: t.elapsed_days, scheduled_days: t.scheduled_days, learning_steps: t.learning_steps, review: i }, c = { ...t, state: e, due: o, last_review: i, stability: r || t.stability, difficulty: n || t.difficulty, elapsed_days: s, scheduled_days: _, reps: t.reps + 1 };
    }
    return { card: c, log: h };
  }
  reschedule(t, e) {
    const i = [];
    let s = F(t.due);
    for (const r of e) {
      let n;
      if (r.review = d.time(r.review), r.rating === l.Manual) {
        let o = 0;
        s.state !== u.New && s.last_review && (o = v(r.review, s.last_review, "days")), n = this.handleManualRating(s, r.state, r.review, o, r.stability, r.difficulty, r.due ? d.time(r.due) : void 0);
      } else n = this.replay(s, r.review, r.rating);
      i.push(n), s = n.card;
    }
    return i;
  }
  calculateManualRecord(t, e, i, s) {
    if (!i) return null;
    const { card: r, log: n } = i, o = d.card(t);
    return o.due.getTime() === r.due.getTime() ? null : (o.scheduled_days = v(r.due, o.due, "days"), this.handleManualRating(o, r.state, d.time(e), n.elapsed_days, s ? r.stability : void 0, s ? r.difficulty : void 0, r.due));
  }
};
var it = class extends J {
  strategyHandler = /* @__PURE__ */ new Map();
  Scheduler;
  constructor(t) {
    super(t);
    const { enable_short_term: e } = this.parameters;
    this.Scheduler = e ? tt : et;
  }
  params_handler_proxy() {
    const t = this;
    return { set: function(e, i, s) {
      return i === "request_retention" && Number.isFinite(s) ? t.intervalModifier = t.calculate_interval_modifier(Number(s)) : i === "enable_short_term" ? t.Scheduler = s === true ? tt : et : i === "w" && (s = E(R(s), e.relearning_steps.length), t.forgetting_curve = A.bind(this, s), t.intervalModifier = t.calculate_interval_modifier(Number(e.request_retention))), Reflect.set(e, i, s), true;
    } };
  }
  useStrategy(t, e) {
    return this.strategyHandler.set(t, e), this;
  }
  clearStrategy(t) {
    return t ? this.strategyHandler.delete(t) : this.strategyHandler.clear(), this;
  }
  getScheduler(t, e) {
    const i = this.strategyHandler.get(S.SCHEDULER) || this.Scheduler;
    return new i(t, e, this, this.strategyHandler);
  }
  repeat(t, e, i) {
    const s = this.getScheduler(t, e).preview();
    return i && typeof i == "function" ? i(s) : s;
  }
  next(t, e, i, s) {
    const r = this.getScheduler(t, e), n = d.rating(i);
    if (n === l.Manual) throw new Error("Cannot review a manual rating");
    const o = r.review(n);
    return s && typeof s == "function" ? s(o) : o;
  }
  get_retrievability(t, e, i = true) {
    const s = d.card(t);
    e = e ? d.time(e) : /* @__PURE__ */ new Date();
    const r = s.state !== u.New ? Math.max(v(e, s.last_review, "days"), 0) : 0, n = s.state !== u.New ? this.forgetting_curve(r, +s.stability.toFixed(8)) : 0;
    return i ? `${(n * 100).toFixed(2)}%` : n;
  }
  rollback(t, e, i) {
    const s = d.card(t), r = d.review_log(e);
    if (r.rating === l.Manual) throw new Error("Cannot rollback a manual rating");
    let n, o, h;
    switch (r.state) {
      case u.New:
        n = r.due, o = void 0, h = 0;
        break;
      case u.Learning:
      case u.Relearning:
      case u.Review:
        n = r.review, o = r.due, h = s.lapses - (r.rating === l.Again && r.state === u.Review ? 1 : 0);
        break;
    }
    const c = { ...s, due: n, stability: r.stability, difficulty: r.difficulty, elapsed_days: r.last_elapsed_days, scheduled_days: r.scheduled_days, reps: Math.max(0, s.reps - 1), lapses: Math.max(0, h), learning_steps: r.learning_steps, state: r.state, last_review: o };
    return i && typeof i == "function" ? i(c) : c;
  }
  forget(t, e, i = false, s) {
    const r = d.card(t);
    e = d.time(e);
    const n = r.state === u.New ? 0 : v(e, r.due, "days"), o = { rating: l.Manual, state: r.state, due: r.due, stability: r.stability, difficulty: r.difficulty, elapsed_days: 0, last_elapsed_days: r.elapsed_days, scheduled_days: n, learning_steps: r.learning_steps, review: e }, h = { card: { ...r, due: e, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: i ? 0 : r.reps, lapses: i ? 0 : r.lapses, learning_steps: 0, state: u.New, last_review: r.last_review }, log: o };
    return s && typeof s == "function" ? s(h) : h;
  }
  reschedule(t, e = [], i = {}) {
    const { recordLogHandler: s, reviewsOrderBy: r, skipManual: n = true, now: o = /* @__PURE__ */ new Date(), update_memory_state: h = false } = i;
    r && typeof r == "function" && e.sort(r), n && (e = e.filter((x) => x.rating !== l.Manual));
    const c = new gt(this), _ = c.reschedule(i.first_card || F(), e), y = _.length, w = d.card(t), f = c.calculateManualRecord(w, o, y ? _[y - 1] : void 0, h);
    return s && typeof s == "function" ? { collections: _.map(s), reschedule_item: f ? s(f) : null } : { collections: _, reschedule_item: f };
  }
};
var yt = (a) => new it(a || {});

// src/familiarity.mjs
function familiarityFor(card, flag) {
  if (flag === "ignored") return "ignored";
  if (flag === "mastered") return "mastered";
  if (!card || card.state === "New" || card.state === 0) return "new";
  if (card.state === "Learning" || card.state === "Relearning" || card.state === 1 || card.state === 3) return "learning";
  const stability = Number(card.stability ?? 0);
  return stability >= 21 ? "mastered" : "familiar";
}
function isReviewable(card, flag) {
  return flag !== "ignored" && flag !== "mastered";
}

// src/scheduler.mjs
var params = I();
var scheduler = yt(params);
function stateName(value) {
  return ["New", "Learning", "Review", "Relearning"][Number(value)] ?? value;
}
function serializeCard(card) {
  return {
    due: new Date(card.due).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: stateName(card.state),
    last_review: card.last_review ? new Date(card.last_review).toISOString() : null
  };
}
function deserializeCard(value) {
  if (!value) return null;
  const states = { New: 0, Learning: 1, Review: 2, Relearning: 3 };
  return {
    ...value,
    due: new Date(value.due),
    state: states[value.state] ?? value.state,
    last_review: value.last_review ? new Date(value.last_review) : void 0
  };
}
function newSerializedCard(now = /* @__PURE__ */ new Date()) {
  return serializeCard(F(now));
}
function rateCard(serialized, ratingName, now = /* @__PURE__ */ new Date()) {
  const rating = l[ratingName] ?? l.Good;
  const card = deserializeCard(serialized) ?? F(now);
  return serializeCard(scheduler.repeat(card, now)[rating].card);
}
function dueQueue(words, review, options = {}, now = /* @__PURE__ */ new Date()) {
  const newLimit = options.newLimit ?? 50;
  const reviewLimit = options.reviewLimit ?? 200;
  const dueNew = [];
  const dueReview = [];
  for (const item of words) {
    const word = item.word;
    const card = review.cards[word];
    const flag = review.flags[word];
    if (!isReviewable(card, flag)) continue;
    const familiarity = familiarityFor(card, flag);
    if (!card || familiarity === "new") dueNew.push({ ...item, familiarity });
    else if (new Date(card.due) <= now) dueReview.push({ ...item, familiarity, due: card.due });
  }
  dueReview.sort((a, b2) => String(a.due).localeCompare(String(b2.due)));
  const localDay = (date) => {
    const value = new Date(date);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  };
  const today2 = localDay(now);
  const introduced = new Set((options.log ?? []).filter((entry) => entry?.word && entry.reviewedAt && localDay(entry.reviewedAt) === today2 && (entry.previousState === "New" || entry.previousState === 0 || entry.previousState == null)).map((entry) => entry.word)).size;
  return [...dueReview.slice(0, reviewLimit), ...dueNew.slice(0, Math.max(0, newLimit - introduced))];
}

// src/review-store.mjs
var EMPTY = () => ({ version: 1, cards: {}, flags: {} });
function codeOf(error) {
  return error && typeof error === "object" && typeof error.code === "string" ? error.code : "";
}
function newestCard(a, b2) {
  const at = a?.last_review ? Date.parse(a.last_review) : 0;
  const bt = b2?.last_review ? Date.parse(b2.last_review) : 0;
  return bt > at ? b2 : a;
}
var ReviewStore = class {
  constructor(app, { now = () => /* @__PURE__ */ new Date(), notify = () => void 0, locale = "en" } = {}) {
    this.app = app;
    this.now = now;
    this.notify = notify;
    this.t = uiText(locale);
    this.rootGeneration = null;
    this.reviewRevision = void 0;
    this.logRevision = void 0;
    this.review = EMPTY();
    this.log = [];
  }
  async load() {
    this.rootGeneration = (await this.app.storage.scope()).rootGeneration;
    await this.#loadReview();
    await this.#loadLog();
    return this.review;
  }
  async reloadForRootChange() {
    this.rootGeneration = null;
    this.reviewRevision = void 0;
    this.logRevision = void 0;
    this.review = EMPTY();
    this.log = [];
    return this.load();
  }
  async #loadReview() {
    const result = await this.app.storage.read(this.rootGeneration, "review.json");
    if (!result.found) {
      this.review = EMPTY();
      this.reviewRevision = null;
      return;
    }
    this.reviewRevision = result.revision;
    try {
      this.review = normalizeReview(JSON.parse(result.text));
    } catch {
      await this.#backupCorrupt(result.text);
      this.notify(this.t.corruptReview);
      this.review = EMPTY();
      this.reviewRevision = null;
    }
  }
  async #loadLog() {
    const result = await this.app.storage.read(this.rootGeneration, "log.json");
    if (!result.found) {
      this.log = [];
      this.logRevision = null;
      return;
    }
    this.logRevision = result.revision;
    try {
      const parsed = JSON.parse(result.text);
      this.log = Array.isArray(parsed) ? parsed.slice(-2e3) : [];
    } catch {
      this.log = [];
      this.logRevision = null;
    }
  }
  async #backupCorrupt(text) {
    const stamp = this.now().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    await this.app.storage.write(this.rootGeneration, `review.corrupt-${stamp}.json`, text);
    const backups = (await this.app.storage.list(this.rootGeneration)).filter((item) => /^review\.corrupt-\d+\.json$/.test(item.name)).sort((a, b2) => a.name.localeCompare(b2.name));
    for (const item of backups.slice(0, -3)) await this.app.storage.remove(this.rootGeneration, item.name);
  }
  async saveReview(next = this.review) {
    try {
      const written = await this.app.storage.write(this.rootGeneration, "review.json", JSON.stringify(next), {
        expectedRevision: this.reviewRevision
      });
      this.review = normalizeReview(next);
      this.reviewRevision = written.revision;
      return { review: this.review, rootChanged: false };
    } catch (error) {
      if (codeOf(error) === "ROOT_CHANGED") return { review: await this.reloadForRootChange(), rootChanged: true };
      if (codeOf(error) !== "REVISION_CONFLICT") throw error;
      const local = normalizeReview(next);
      await this.#loadReview();
      const merged = mergeReview(this.review, local);
      const written = await this.app.storage.write(this.rootGeneration, "review.json", JSON.stringify(merged), {
        expectedRevision: this.reviewRevision
      });
      this.review = merged;
      this.reviewRevision = written.revision;
      return { review: this.review, rootChanged: false };
    }
  }
  async appendLog(entry) {
    const next = [...this.log, entry].slice(-2e3);
    const written = await this.app.storage.write(this.rootGeneration, "log.json", JSON.stringify(next), {
      expectedRevision: this.logRevision
    });
    this.log = next;
    this.logRevision = written.revision;
    return this.log;
  }
};
function normalizeReview(value) {
  const review = EMPTY();
  if (value?.version === 1 && value.cards && typeof value.cards === "object") {
    for (const [word, card] of Object.entries(value.cards)) {
      const normalized = deserializeCard(card);
      if (normalized) review.cards[word] = serializeCard(normalized);
    }
  }
  if (value?.flags && typeof value.flags === "object") {
    for (const [word, flag] of Object.entries(value.flags)) {
      if (flag === "mastered" || flag === "ignored") review.flags[word] = flag;
    }
  }
  return review;
}
function mergeReview(base, incoming) {
  const merged = normalizeReview(base);
  const other = normalizeReview(incoming);
  for (const [word, card] of Object.entries(other.cards)) merged.cards[word] = newestCard(merged.cards[word], card);
  merged.flags = { ...merged.flags, ...other.flags };
  return merged;
}

// src/note-format.mjs
var WORD_RE = /^[a-z][a-z'-]{0,63}$/i;
function normalizeWord(word) {
  return String(word ?? "").normalize("NFC").trim().toLowerCase();
}
function assertEnglishWord(word) {
  const normalized = normalizeWord(word);
  if (!WORD_RE.test(normalized)) throw new Error(`invalid English word: ${word}`);
  return normalized;
}
function slugFor(word) {
  const normalized = assertEnglishWord(word);
  return normalized.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}
function today() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function sourceLink(source) {
  if (!source) return "";
  if (source.url) return `<${source.url}>`;
  if (source.path) return `[${String(source.title || source.path).replace(/[\[\]]/g, "\\$&")}](${source.path})`;
  return "";
}
function exampleLine(example, source) {
  const text = String(example ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const link = sourceLink(source);
  return `- ${text}${link ? ` — ${link}` : ""}`;
}
function buildNote(entry, now = today()) {
  const word = assertEnglishWord(entry.word);
  const definition = String(entry.definition ?? "").trim();
  if (!definition) throw new Error("definition is required");
  const lines = [
    "---",
    "type: vocab",
    `word: ${yamlString(word)}`,
    `definition: ${yamlString(definition)}`
  ];
  if (entry.phonetic) lines.push(`phonetic: ${yamlString(entry.phonetic)}`);
  if (entry.pos) lines.push(`pos: ${yamlString(entry.pos)}`);
  lines.push(`created: ${yamlString(now)}`, "---", `# ${word}`, "", definition, "", "## Examples", "");
  const example = exampleLine(entry.example, entry.source);
  if (example) lines.push(example);
  return `${lines.join("\n")}
`;
}
function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) return JSON.parse(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, "");
}
function parseNote(text) {
  const normalized = String(text).replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { ok: false, error: "missing frontmatter" };
  try {
    const fields = {};
    for (const line of match[1].split("\n")) {
      const index = line.indexOf(":");
      if (index <= 0) continue;
      fields[line.slice(0, index).trim()] = parseYamlScalar(line.slice(index + 1));
    }
    if (fields.type !== "vocab" || !fields.word) return { ok: false, error: "missing word" };
    const word = assertEnglishWord(fields.word);
    const definition = String(fields.definition ?? "").trim();
    if (!definition) return { ok: false, error: "missing definition" };
    const examples = [...match[2].matchAll(/^- (.+)$/gm)].map((item) => item[1].trim());
    return { ok: true, entry: { ...fields, word, definition, examples, body: match[2] } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid frontmatter" };
  }
}
function appendExample(existing, example, source) {
  const parsed = parseNote(existing);
  if (!parsed.ok) throw new Error(`frontmatter invalid: ${parsed.error}`);
  const line = exampleLine(example, source);
  if (!line) return existing;
  if (existing.includes(line) || parsed.entry.examples.includes(line.slice(2))) return existing;
  const newline = String(existing).includes("\r\n") ? "\r\n" : "\n";
  if (existing.includes(`## Examples${newline}`)) {
    return existing.replace(new RegExp(`(## Examples${newline})([\\s\\S]*)$`), (_match, heading, body) => `${heading}${body}${existing.endsWith(newline) ? "" : newline}${line}${newline}`);
  }
  return `${existing.trimEnd()}${newline}${newline}## Examples${newline}${newline}${line}${newline}`;
}

// src/vocab-index.mjs
var VOCAB_PATH = /^wiki\/vocab\/[^/]+\.md$/;
var sleep = () => new Promise((resolve) => setTimeout(resolve, 0));
function unwrap(result) {
  if (result && result._tag === "Err") throw new Error(String(result.error ?? "knowledge error"));
  return result;
}
var VocabIndex = class {
  constructor(knowledge, { batchSize = 50, onProgress = () => void 0, onUpdate = () => void 0 } = {}) {
    this.knowledge = knowledge;
    this.batchSize = batchSize;
    this.onProgress = onProgress;
    this.onUpdate = onUpdate;
    this.cache = /* @__PURE__ */ new Map();
    this.entries = /* @__PURE__ */ new Map();
    this.invalid = [];
    this.refreshing = null;
    this.pending = false;
  }
  async refresh() {
    if (this.refreshing) {
      this.pending = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      let result;
      do {
        this.pending = false;
        result = await this.refreshOnce();
      } while (this.pending);
      return result;
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }
  async refreshOnce() {
    const metas = unwrap(await this.knowledge.listDocuments()).filter((meta) => VOCAB_PATH.test(meta.path));
    this.invalid = [];
    const live = new Set(metas.map((meta) => meta.path));
    for (const path of [...this.cache.keys()]) if (!live.has(path)) this.cache.delete(path);
    let done = 0;
    for (let i = 0; i < metas.length; i += this.batchSize) {
      const batch = metas.slice(i, i + this.batchSize);
      for (const meta of batch) {
        const hash = meta.revision?.contentHash ?? "";
        const cached = this.cache.get(meta.path);
        if (cached?.hash !== hash) {
          try {
            const doc = unwrap(await this.knowledge.readDocument({ path: meta.path }));
            this.cache.set(meta.path, { hash, meta, parsed: parseNote(doc.content) });
          } catch (error) {
            this.cache.set(meta.path, { hash, meta, parsed: { ok: false, error: error instanceof Error ? error.message : String(error) } });
          }
        }
        done += 1;
        this.onProgress(done, metas.length);
        const partial = this.rebuild();
        this.onUpdate(partial);
      }
      if (i + this.batchSize < metas.length) await sleep();
    }
    return this.rebuild();
  }
  rebuild() {
    this.entries = /* @__PURE__ */ new Map();
    this.invalid = [];
    for (const [path, item] of this.cache.entries()) {
      if (!item.parsed.ok) {
        this.invalid.push({ path, error: item.parsed.error });
        continue;
      }
      const entry = { ...item.parsed.entry, path, title: item.meta.title || item.parsed.entry.word };
      if (!this.entries.has(entry.word)) this.entries.set(entry.word, entry);
    }
    return { entries: [...this.entries.values()], invalid: this.invalid };
  }
  get(word) {
    return this.entries.get(String(word).toLowerCase());
  }
};

// src/request-text.mjs
function countWords(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}
function requestLanguage(locale) {
  return uiText(locale).request;
}
function requestTextFromSelection(context, locale = "en") {
  const t = requestLanguage(locale);
  const selected = String(context.text ?? "").trim().slice(0, 2e3);
  const sentence = String(context.sentence ?? "").trim().slice(0, 600);
  const source = context.source?.kind === "document" ? `${context.source.title || ""}
source.path: ${context.source.path || ""}` : `${context.source?.title ?? ""}
source.url: ${context.source?.url ?? ""}`;
  const task = countWords(selected) <= 3 ? t.short(selected) : t.long;
  return [
    task,
    "",
    `${t.selection}: ${selected}`,
    sentence ? `${t.sentence}: ${sentence}` : "",
    `${t.source}: ${source}`,
    "",
    t.instruction
  ].filter(Boolean).join("\n");
}
function requestTextForWord(word, locale = "en") {
  const t = requestLanguage(locale);
  return [t.short(String(word).trim()), "", t.instruction].join("\n");
}

// src/panel.mjs
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== void 0) node.textContent = text;
  return node;
}
function button(text, onClick) {
  const node = el("button", "ev-button", text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}
function cloze(example, word) {
  if (!example) return "";
  return example.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "_____");
}
function hasRequiredHost(app) {
  return Boolean(app.storage && app.selectionActions && app.chat);
}
function renderPanel(container, controls) {
  const t = uiText(currentLocale());
  const read = () => controls.getState?.() ?? controls;
  container.textContent = "";
  container.className = "english-vocab-panel";
  if (!hasRequiredHost(controls.app)) {
    container.append(el("p", "ev-warning", t.needsHost));
    return () => {
      container.textContent = "";
    };
  }
  const title = el("h2", "", t.panelTitle);
  const tabs = el("div", "ev-tabs");
  const body = el("div", "ev-body");
  let mode = "flip";
  let tab = "today";
  let flipped = false;
  let lastSpokenWord = null;
  const review = (rating) => {
    const state = read();
    const item = dueQueue(state.entries, state.review, { log: state.log })[0];
    if (!item) return;
    controls.onReview?.(item.word, rating, mode);
    flipped = false;
    rerender();
  };
  const ratingRow = () => {
    const row = el("div", "ev-rating");
    row.append(button(t.again, () => review("Again")), button(t.hard, () => review("Hard")), button(t.good, () => review("Good")), button(t.easy, () => review("Easy")));
    return row;
  };
  const renderToday = (state) => {
    const modeRow = el("div", "ev-mode");
    for (const [id, label] of [["flip", t.flip], ["reverse", t.reverse], ["listening", t.listening]]) {
      const item2 = button(label, () => {
        mode = id;
        flipped = false;
        rerender();
      });
      item2.disabled = id === "listening" && !controls.hasEnglishVoice?.();
      if (id === mode) item2.setAttribute("aria-pressed", "true");
      modeRow.append(item2);
    }
    body.append(modeRow);
    const hasProgress = Object.keys(state.review.cards).length > 0 || Object.keys(state.review.flags).length > 0 || state.log.length > 0;
    if (state.entries.length > 0 && !hasProgress) body.append(el("p", "ev-note", t.emptyProgress));
    if (mode === "listening") body.append(el("p", "ev-note", controls.hasEnglishVoice?.() ? t.listeningInterrupts : t.noEnglishVoice));
    const item = dueQueue(state.entries, state.review, { log: state.log })[0];
    if (!item) {
      body.append(el("p", "ev-empty", t.noCards));
      return;
    }
    if (mode === "listening" && lastSpokenWord !== item.word) {
      lastSpokenWord = item.word;
      controls.speak?.(item.word);
    }
    const card = el("section", "ev-card");
    const example = item.examples?.[0] || item.example || "";
    if (mode === "flip") {
      card.append(el("h3", "", item.word), el("p", "", cloze(example, item.word)));
      if (flipped) card.append(el("p", "ev-definition", item.definition), ratingRow());
      else card.append(button(t.answer, () => {
        flipped = true;
        rerender();
      }));
    } else {
      card.append(el("p", "ev-definition", item.definition), el("p", "", cloze(example, item.word)));
      const input = el("input", "ev-input");
      input.placeholder = t.spellingPlaceholder;
      const submit = () => review(input.value.trim().toLowerCase() === item.word ? "Good" : "Again");
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") submit();
      });
      card.append(input, button(t.answer, submit));
      if (mode === "listening") card.append(button(t.replay, () => controls.speak?.(item.word)));
    }
    body.append(card);
  };
  const renderNotebook = (state) => {
    const addRow = el("div", "ev-add");
    const addInput = el("input", "ev-input");
    addInput.placeholder = t.addWord;
    addInput.dataset.role = "manual-word";
    addRow.append(addInput, button(t.add, () => {
      let word;
      try {
        word = assertEnglishWord(addInput.value);
      } catch {
        controls.notify?.(t.invalidManualWord);
        return;
      }
      if (!controls.app.chat.appendToComposer(requestTextForWord(word, currentLocale()))) controls.notify?.(t.collectFailed);
    }));
    const search = el("input", "ev-input");
    search.placeholder = t.search;
    const filter = el("select", "ev-input");
    for (const key of ["all", "new", "learning", "familiar", "mastered", "ignored"]) {
      const option = el("option", "", t[key]);
      option.value = key;
      filter.append(option);
    }
    const list = el("div", "ev-list");
    const draw = () => {
      list.textContent = "";
      const current = { entries: [], review: { cards: {}, flags: {} }, ...read() };
      const q2 = search.value.trim().toLowerCase();
      for (const entry of current.entries) {
        const fam = familiarityFor(current.review.cards[entry.word], current.review.flags[entry.word]);
        if (q2 && !entry.word.includes(q2) || filter.value !== "all" && fam !== filter.value) continue;
        const row = el("div", "ev-row");
        row.append(el("strong", "", entry.word), el("span", "", entry.definition), el("small", "", t[fam] || fam));
        row.append(button(t.markMastered, () => setFlag(entry.word, "mastered")), button(t.ignore, () => setFlag(entry.word, "ignored")), button(t.restore, () => setFlag(entry.word, void 0)));
        list.append(row);
      }
    };
    const setFlag = (word, flag) => {
      if (controls.onFlag) controls.onFlag(word, flag);
      else if (flag) state.review.flags[word] = flag;
      else delete state.review.flags[word];
      draw();
    };
    search.addEventListener("input", draw);
    filter.addEventListener("change", draw);
    body.append(addRow, search, filter, list);
    draw();
  };
  const rerender = () => {
    const state = { entries: [], review: { version: 1, cards: {}, flags: {} }, log: [], loading: null, ...read() };
    tabs.textContent = "";
    tabs.append(button(t.today, () => {
      tab = "today";
      rerender();
    }), button(t.notebook, () => {
      tab = "notebook";
      rerender();
    }));
    body.textContent = "";
    if (state.loading) body.append(el("p", "", t.loading(state.loading.done, state.loading.total)));
    if (tab === "today") renderToday(state);
    else renderNotebook(state);
  };
  const onKeydown = (event) => {
    if (tab !== "today") return;
    if (event.key === " ") {
      event.preventDefault();
      flipped = true;
      rerender();
    }
    if (flipped && ["1", "2", "3", "4"].includes(event.key)) review(["Again", "Hard", "Good", "Easy"][Number(event.key) - 1]);
  };
  container.addEventListener("keydown", onKeydown);
  container.append(title, tabs, body);
  const unsubscribe = controls.subscribe?.(rerender) ?? (() => void 0);
  rerender();
  return () => {
    unsubscribe();
    container.removeEventListener("keydown", onKeydown);
    container.textContent = "";
  };
}
function appendSelectionRequest(app, context, notify, locale = currentLocale()) {
  const ok = app.chat.appendToComposer(requestTextFromSelection(context, locale));
  if (!ok) notify?.(uiText(locale).collectFailed);
  return ok;
}

// src/tools.mjs
var MAX_ENTRIES = 20;
function unwrap2(result) {
  if (result && result._tag === "Err") throw new Error(String(result.error ?? "knowledge error"));
  return result;
}
function noticeText(receipt, number, words, t) {
  const list = words.join(", ");
  if (receipt.outcome === "applied") return t.proposalApplied(number, list);
  if (receipt.outcome === "rejected") return t.proposalRejected(number, receipt.reason, list);
  if (receipt.outcome === "not-reviewed") return t.proposalPending(number, list);
  if (receipt.outcome === "timeout") return t.proposalTimeout(number, list);
  return t.proposalAborted(number, list);
}
function validateEntry(entry) {
  const word = normalizeWord(entry.word);
  if (!/^[a-z][a-z'-]{0,63}$/.test(word)) throw new Error(`invalid word: ${entry.word}`);
  const definition = String(entry.definition ?? "").trim();
  if (!definition || definition.length > 500) throw new Error(`invalid definition for ${word}`);
  const example = entry.example === void 0 ? void 0 : String(entry.example).trim().replace(/\s+/g, " ");
  if (example && example.length > 600) throw new Error(`example too long for ${word}`);
  const source = entry.source;
  if (source) {
    if (source.path) {
      if (!source.path.startsWith("wiki/")) throw new Error(`invalid source for ${word}`);
    } else if (source.url) {
      if (/[\s<>]/.test(source.url)) throw new Error(`invalid source for ${word}`);
      let parsed;
      try {
        parsed = new URL(source.url);
      } catch {
        throw new Error(`invalid source for ${word}`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`invalid source for ${word}`);
    } else {
      throw new Error(`invalid source for ${word}`);
    }
  }
  return { ...entry, word, definition, example };
}
async function withSoftTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timer);
  return result;
}
async function resolveSource(app, source, notes) {
  if (!source?.path || !source.path.startsWith("wiki/")) return source;
  const doc = await withSoftTimeout(app.knowledge.readDocument({ path: source.path }).then(unwrap2).catch(() => null), 3e3);
  if (!doc) {
    notes.push(`Source ${source.path} was missing or timed out; the example was kept without a link.`);
    return void 0;
  }
  const rel = source.path.startsWith("wiki/vocab/") ? source.path.slice("wiki/vocab/".length) : `../${source.path.slice("wiki/".length)}`;
  return { path: rel, title: doc.meta?.title || source.path };
}
async function mapConcurrent(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
async function readOptional(app, path) {
  try {
    const result = await app.knowledge.readDocument({ path });
    return result?._tag === "Err" ? null : result;
  } catch {
    return null;
  }
}
function makeVocabLookup({ index, review, getReview = () => review }) {
  return async function vocabLookup(input) {
    const word = normalizeWord(input?.word);
    const entry = index.get(word);
    const current = getReview();
    const card = current.cards[word];
    const familiarity = familiarityFor(card, current.flags[word]);
    return JSON.stringify({
      collected: Boolean(entry),
      word,
      definition: entry?.definition ?? null,
      familiarity,
      due: card?.due ?? null
    });
  };
}
function makeVocabAdd({ app, index, nextNumber, notify, refresh, locale = "en" }) {
  return async function vocabAdd(input) {
    const entries = input?.entries;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
      throw new Error("entries must contain 1-20 items");
    }
    const t = uiText(locale);
    const notes = [];
    const validated = entries.map(validateEntry);
    const normalized = await mapConcurrent(validated, 4, async (entry) => ({ ...entry, source: await resolveSource(app, entry.source, notes) }));
    const groups = /* @__PURE__ */ new Map();
    for (const entry of normalized) {
      const group = groups.get(entry.word) ?? { ...entry, examples: [] };
      if (entry.example && !group.examples.some((item) => item.example === entry.example && JSON.stringify(item.source) === JSON.stringify(entry.source))) {
        group.examples.push({ example: entry.example, source: entry.source });
      }
      groups.set(entry.word, group);
    }
    const changes = [];
    const accepted = [];
    for (const entry of groups.values()) {
      const existing = index.get(entry.word);
      const path = existing?.path ?? `wiki/vocab/${slugFor(entry.word)}.md`;
      const doc = existing ? unwrap2(await app.knowledge.readDocument({ path })) : await readOptional(app, path);
      let content;
      if (doc) {
        const parsed = parseNote(doc.content);
        if (!parsed.ok) throw new Error(`frontmatter invalid for ${entry.word}: ${parsed.error}`);
        if (parsed.entry.word !== entry.word) {
          notes.push(`Skipped ${entry.word}: slug collision at ${path} with ${parsed.entry.word}.`);
          continue;
        }
        content = doc.content;
      } else {
        content = buildNote({ ...entry, example: void 0, source: void 0 });
      }
      for (const item of entry.examples) content = appendExample(content, item.example, item.source);
      changes.push({ path, newContent: content });
      accepted.push(entry.word);
    }
    if (!changes.length) return ["No vocabulary entries were submitted.", ...notes].join("\n");
    const number = nextNumber();
    const words = accepted;
    const proposal = app.knowledge.propose({
      description: t.proposalDescription(number, words.join(", ")),
      changes
    });
    proposal.then(unwrap2).then((receipt) => {
      notify(noticeText(receipt, number, words, t));
      refresh?.();
    }).catch(() => notify(t.proposalFailed(number)));
    return [`Submitted for review #${number}: ${words.length} ${words.length === 1 ? "word" : "words"}.`, ...notes].join("\n");
  };
}
var LOOKUP_SCHEMA = {
  type: "object",
  properties: { word: { type: "string", minLength: 1, maxLength: 64 } },
  required: ["word"],
  additionalProperties: false
};
var ADD_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          word: { type: "string", minLength: 1, maxLength: 64 },
          definition: { type: "string", minLength: 1, maxLength: 500 },
          phonetic: { type: "string", maxLength: 120 },
          pos: { type: "string", maxLength: 80 },
          example: { type: "string", maxLength: 600 },
          source: {
            type: "object",
            properties: {
              path: { type: "string" },
              url: { type: "string" },
              title: { type: "string" }
            },
            additionalProperties: false
          }
        },
        required: ["word", "definition"],
        additionalProperties: false
      }
    }
  },
  required: ["entries"],
  additionalProperties: false
};

// src/main.mjs
var BasePlugin = globalThis.autonKnowledge?.Plugin ?? class {
};
var emptyReview = () => ({ version: 1, cards: {}, flags: {} });
var EnglishVocabPlugin = class extends BasePlugin {
  async onload() {
    this.locale = currentLocale();
    this.t = uiText(this.locale);
    this.state = { entries: [], review: emptyReview(), log: [], loading: null, invalid: [] };
    this.listeners = /* @__PURE__ */ new Set();
    this.submission = 0;
    this.reviewStore = null;
    this.index = null;
    this.addPanel({
      id: "english-vocab",
      title: this.t.panelTitle,
      location: "right",
      icon: "📖",
      render: (container) => renderPanel(container, this.panelState())
    });
    this.addCommand({
      id: "start-review",
      title: this.t.commandTitle,
      description: this.t.commandDescription,
      callback: () => this.openPanel("english-vocab")
    });
    if (!hasRequiredHost(this.app)) return;
    await this.initializeState();
    this.registerSelectionAction();
    await this.registerTools();
    this.onEvent?.("knowledge.index-changed", () => this.refreshIndex());
    this.onEvent?.("knowledge.root-changed", () => this.handleRootChanged());
  }
  emitState() {
    for (const listener of this.listeners) listener();
  }
  panelState() {
    return {
      app: this.app,
      getState: () => this.state,
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      onReview: (word, rating, mode) => this.rateWord(word, rating, mode),
      onFlag: (word, flag) => this.setFlag(word, flag),
      notify: (message) => this.notice(message),
      hasEnglishVoice: () => typeof speechSynthesis !== "undefined" && speechSynthesis.getVoices().some((voice) => /^en\b/i.test(voice.lang)),
      speak: (word) => {
        if (typeof speechSynthesis === "undefined") return;
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = "en-US";
        speechSynthesis.speak(utterance);
      }
    };
  }
  async initializeState() {
    this.reviewStore = new ReviewStore(this.app, { locale: this.locale, notify: (message) => this.notice(message) });
    this.state.review = await this.reviewStore.load();
    this.state.log = this.reviewStore.log;
    this.index = new VocabIndex(this.app.knowledge, {
      onProgress: (done, total) => {
        this.state.loading = { done, total };
        this.emitState();
      },
      onUpdate: (result) => {
        this.state.entries = result.entries;
        this.state.invalid = result.invalid;
        this.emitState();
      }
    });
    await this.refreshIndex();
  }
  async refreshIndex() {
    if (!this.index) return;
    try {
      const result = await this.index.refresh();
      this.state.entries = result.entries;
      this.state.invalid = result.invalid;
    } finally {
      this.state.loading = null;
      this.emitState();
    }
  }
  async handleRootChanged() {
    if (!this.reviewStore) return;
    this.state.review = await this.reviewStore.reloadForRootChange();
    this.state.log = this.reviewStore.log;
    this.emitState();
    await this.refreshIndex();
  }
  async rateWord(word, rating, mode) {
    const previous = this.state.review.cards[word];
    const next = {
      version: 1,
      cards: { ...this.state.review.cards, [word]: rateCard(previous ?? newSerializedCard(), rating) },
      flags: { ...this.state.review.flags }
    };
    let result;
    try {
      result = await this.reviewStore.saveReview(next);
    } catch {
      this.notice(this.t.reviewSaveFailed);
      return false;
    }
    this.state.review = result.review;
    this.state.log = this.reviewStore.log;
    this.emitState();
    if (result.rootChanged) {
      this.notice(this.t.rootChangedDuringReview);
      return false;
    }
    const entry = { word, rating, reviewedAt: (/* @__PURE__ */ new Date()).toISOString(), previousState: previous?.state ?? "New", mode };
    try {
      this.state.log = await this.reviewStore.appendLog(entry);
      this.emitState();
    } catch {
      this.notice(this.t.logSaveFailed);
    }
    return true;
  }
  async setFlag(word, flag) {
    const flags = { ...this.state.review.flags };
    if (flag) flags[word] = flag;
    else delete flags[word];
    try {
      const result = await this.reviewStore.saveReview({ ...this.state.review, flags });
      this.state.review = result.review;
      this.state.log = this.reviewStore.log;
      this.emitState();
      if (result.rootChanged) this.notice(this.t.rootChangedDuringReview);
      return !result.rootChanged;
    } catch {
      this.notice(this.t.flagSaveFailed);
      return false;
    }
  }
  registerSelectionAction() {
    this.app.selectionActions.register({
      id: "collect-vocab",
      title: this.t.collectTitle,
      icon: "📖",
      priority: 10,
      surfaces: ["reading", "web"],
      onSelect: (context) => appendSelectionRequest(this.app, context, (message) => this.notice(message), this.locale)
    });
  }
  async registerTools() {
    await this.addAgentTool({
      name: "vocab_lookup",
      description: "Look up whether an English word is already in the user vocabulary notebook and return review familiarity.",
      inputSchema: LOOKUP_SCHEMA,
      run: makeVocabLookup({ index: { get: (word) => this.index?.get(word) }, getReview: () => this.state.review })
    });
    await this.addAgentTool({
      name: "vocab_add",
      description: "Submit one Auton Knowledge proposal to create or update English vocabulary notes under wiki/vocab/.",
      inputSchema: ADD_SCHEMA,
      run: makeVocabAdd({
        app: this.app,
        index: { get: (word) => this.index?.get(word) },
        nextNumber: () => ++this.submission,
        notify: (message) => this.notice(message),
        refresh: () => this.refreshIndex(),
        locale: this.locale
      })
    });
  }
  notice(message) {
    this.showNotice?.({ message, title: this.t.panelTitle, kind: "info", timeoutMs: 6e3 });
  }
};
export {
  EnglishVocabPlugin as default
};
