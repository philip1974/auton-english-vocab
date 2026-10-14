import { uiText, currentLocale } from './ui-text.mjs';
import { ReviewStore } from './review-store.mjs';
import { VocabIndex } from './vocab-index.mjs';
import { rateCard, newSerializedCard } from './scheduler.mjs';
import { renderPanel, hasRequiredHost, appendSelectionRequest } from './panel.mjs';
import { makeVocabAdd, makeVocabLookup, ADD_SCHEMA, LOOKUP_SCHEMA } from './tools.mjs';
import { buildReadingTerms, createReadingDecorationSpec } from './decorations.mjs';
import { DEFAULT_LEVEL_SETTINGS, detectEnglish } from './reading-level.mjs';
import { ReadingRecommender, learningSuggestionsFromRecommendations } from './recommend.mjs';
import { inferPos, lookup, suggest, dictionaryDefinition } from './dictionary.mjs';
import { buildNote, slugFor } from './note-format.mjs';

const BasePlugin = globalThis.autonKnowledge?.Plugin ?? class {};
const emptyReview = () => ({ version: 1, cards: {}, flags: {} });

export default class EnglishVocabPlugin extends BasePlugin {
  async onload() {
    this.locale = currentLocale();
    this.t = uiText(this.locale);
    this.state = {
      entries: [],
      review: emptyReview(),
      log: [],
      loading: null,
      invalid: [],
      highlight: true,
      lookupAnyWord: true,
      lookupNoticeShown: false,
      levelSettings: DEFAULT_LEVEL_SETTINGS,
      recommendations: null,
      recommendationLoading: null,
    };
    this.listeners = new Set();
    this.submission = 0;
    this.reviewStore = null;
    this.index = null;
    this.readingHandle = null;
    this.readingStatusHandle = null;
    this.learningSuggestionsHandle = null;
    this.recommender = null;
    this.latestReadingEvent = null;
    this.readingUndoSnapshots = new Map();
    this.addPanel({
      id: 'english-vocab',
      title: this.t.panelTitle,
      location: 'right',
      icon: '📖',
      render: (container) => renderPanel(container, this.panelState()),
    });
    this.addCommand({
      id: 'start-review',
      title: this.t.commandTitle,
      description: this.t.commandDescription,
      callback: () => this.openPanel('english-vocab'),
    });
    if (!hasRequiredHost(this.app)) return;
    await this.loadPreferences();
    await this.initializeState();
    this.syncReadingDecorations();
    this.registerSelectionAction();
    await this.registerTools();
    this.onEvent?.('knowledge.index-changed', () => this.refreshIndex());
    this.onEvent?.('knowledge.root-changed', () => this.handleRootChanged());
  }

  emitState() {
    for (const listener of this.listeners ?? []) listener();
  }

  panelState() {
    return {
      app: this.app,
      getState: () => this.state,
      subscribe: (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); },
      onReview: (word, rating, mode) => this.rateWord(word, rating, mode),
      onFlag: (word, flag) => this.setFlag(word, flag),
      notify: (message) => this.notice(message),
      hasEnglishVoice: () => typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().some((voice) => /^en\b/i.test(voice.lang)),
      speak: (word) => {
        if (typeof speechSynthesis === 'undefined') return;
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = 'en-US';
        speechSynthesis.speak(utterance);
      },
      onHighlightChange: (value) => this.setHighlight(value),
      onLookupAnyWordChange: (value) => this.setLookupAnyWord(value),
      onLevelSettingsChange: (settings) => this.setLevelSettings(settings),
      lookupDictionary: (word) => this.lookupDictionary(word),
      suggestDictionary: (prefix, n) => this.suggestDictionary(prefix, n),
      onCollectDictionaryWord: (result, context) => this.collectDictionaryWord(result, context),
      refreshRecommendations: () => this.refreshRecommendations(),
      openReadingDocument: (path) => this.app.workspace?.openDocument?.(path) ?? false,
      canOpenReadingDocument: () => Boolean(this.app.workspace?.openDocument),
    };
  }

  async loadPreferences() {
    try {
      const data = await this.loadData?.();
      this.state.highlight = data?.highlight !== false;
      this.state.lookupAnyWord = data?.lookupAnyWord !== false;
      this.state.lookupNoticeShown = data?.lookupNoticeShown === true;
      this.state.levelSettings = data?.levelSettings ?? DEFAULT_LEVEL_SETTINGS;
    } catch {
      this.state.highlight = true;
      this.state.lookupAnyWord = true;
      this.state.lookupNoticeShown = false;
      this.state.levelSettings = DEFAULT_LEVEL_SETTINGS;
    }
  }

  async savePreferences(patch = {}) {
    const existing = await this.loadData?.().catch(() => ({})) ?? {};
    const next = {
      ...existing,
      highlight: this.state.highlight,
      lookupAnyWord: this.state.lookupAnyWord,
      levelSettings: this.state.levelSettings,
      lookupNoticeShown: this.state.lookupNoticeShown,
      ...patch,
    };
    await this.saveData?.(next);
    return next;
  }

  async initializeState() {
    this.reviewStore = new ReviewStore(this.app, { locale: this.locale, notify: (message) => this.notice(message) });
    this.state.review = await this.reviewStore.load();
    this.state.log = this.reviewStore.log;
    this.index = new VocabIndex(this.app.knowledge, {
      onProgress: (done, total) => { this.state.loading = { done, total }; this.emitState(); },
      onUpdate: (result) => { this.state.entries = result.entries; this.state.invalid = result.invalid; this.emitState(); },
    });
    await this.refreshIndex();
    await this.initializeReadingLevel();
  }

  async refreshIndex() {
    if (!this.index) return;
    // A root switch always rebuilds the index; re-check the root here too, so a missed
    // root-changed event cannot leave the old root's progress on screen.
    if (this.reviewStore !== null && await this.rootMoved()) {
      this.state.review = await this.reviewStore.reloadForRootChange();
      this.state.log = this.reviewStore.log;
    }
    try {
      const result = await this.index.refresh();
      this.state.entries = result.entries;
      this.state.invalid = result.invalid;
      this.updateReadingTerms();
      await this.refreshRecommendations({ silent: true });
      await this.refreshLatestReadingStatus();
    } finally {
      this.state.loading = null;
      this.emitState();
    }
  }

  async rootMoved() {
    try {
      const { rootGeneration } = await this.app.storage.scope();
      return rootGeneration !== this.reviewStore.rootGeneration;
    } catch {
      return false;
    }
  }

  async handleRootChanged() {
    if (!this.reviewStore) return;
    this.state.review = await this.reviewStore.reloadForRootChange();
    this.state.log = this.reviewStore.log;
    this.updateReadingTerms();
    this.emitState();
    await this.recommender?.reload();
    await this.refreshIndex();
  }

  async rateWord(word, rating, mode) {
    const previous = this.state.review.cards[word];
    const next = {
      version: 1,
      cards: { ...this.state.review.cards, [word]: rateCard(previous ?? newSerializedCard(), rating) },
      flags: { ...this.state.review.flags },
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
    if (mode === 'reading-card') this.readingUndoSnapshots.set(word, previous ?? null);
    this.updateReadingTerms();
    this.emitState();
    if (result.rootChanged) {
      this.notice(this.t.rootChangedDuringReview);
      return false;
    }
    const entry = { word, rating, reviewedAt: new Date().toISOString(), previousState: previous?.state ?? 'New', mode };
    try {
      this.state.log = await this.reviewStore.appendLog(entry);
      this.emitState();
    } catch {
      this.notice(this.t.logSaveFailed);
    }
    await this.refreshReadingLevelSurfaces();
    return true;
  }

  async undoReadingRating(word) {
    if (!this.reviewStore || !this.readingUndoSnapshots.has(word)) return false;
    const previous = this.readingUndoSnapshots.get(word);
    const cards = { ...this.state.review.cards };
    if (previous) cards[word] = previous;
    else delete cards[word];
    try {
      const result = await this.reviewStore.saveReview({ ...this.state.review, cards });
      this.state.review = result.review;
      this.state.log = this.reviewStore.log;
      if (result.rootChanged) {
        this.notice(this.t.rootChangedDuringReview);
        return false;
      }
      this.state.log = await this.reviewStore.appendLog({ word, undo: true, reviewedAt: new Date().toISOString(), mode: 'reading-card' });
      this.readingUndoSnapshots.delete(word);
      this.updateReadingTerms();
      this.emitState();
      await this.refreshReadingLevelSurfaces();
      return true;
    } catch {
      this.notice(this.t.reviewSaveFailed);
      return false;
    }
  }

  async setFlag(word, flag) {
    const flags = { ...this.state.review.flags };
    if (flag) flags[word] = flag;
    else delete flags[word];
    try {
      const result = await this.reviewStore.saveReview({ ...this.state.review, flags });
      this.state.review = result.review;
      this.state.log = this.reviewStore.log;
      this.updateReadingTerms();
      this.emitState();
      await this.refreshReadingLevelSurfaces();
      if (result.rootChanged) this.notice(this.t.rootChangedDuringReview);
      return !result.rootChanged;
    } catch {
      this.notice(this.t.flagSaveFailed);
      return false;
    }
  }

  registerSelectionAction() {
    this.app.selectionActions.register({
      id: 'collect-vocab',
      title: this.t.collectTitle,
      icon: '📖',
      priority: 10,
      surfaces: ['reading', 'web'],
      onSelect: (context) => appendSelectionRequest(this.app, context, (message) => this.notice(message), this.locale),
    });
  }

  readingSupported() {
    return Boolean(this.app?.readingDecorations?.register);
  }

  syncReadingDecorations() {
    if (!this.readingSupported() || (this.state.highlight === false && this.state.lookupAnyWord === false)) {
      this.disposeReadingDecorations();
      return;
    }
    if (!this.readingHandle) {
      const spec = createReadingDecorationSpec({
        locale: this.locale,
        getState: () => this.state,
        onReview: (word, rating, mode) => this.rateWord(word, rating, mode),
        onUndo: (word) => this.undoReadingRating(word),
        onTermsChanged: () => this.updateReadingTerms(),
        speak: (word) => this.panelState().speak(word),
        lookupDictionary: (word) => this.lookupDictionary(word),
        onCollectWord: (result, context) => this.collectDictionaryWord(result, context),
        onExplainWord: (word, context) => this.explainDictionaryWord(word, context),
      });
      this.readingHandle = this.addReadingDecoration
        ? this.addReadingDecoration(spec)
        : this.register(this.app.readingDecorations.register(spec));
    }
    if (typeof this.readingHandle.setLookupAnyWord === 'function') {
      const enabled = this.readingHandle.setLookupAnyWord(this.state.lookupAnyWord !== false);
      if (enabled && this.state.lookupAnyWord !== false && !this.state.lookupNoticeShown) {
        this.state.lookupNoticeShown = true;
        this.notice(this.t.lookupNotice);
        this.savePreferences({ lookupNoticeShown: true }).catch(() => undefined);
      }
    }
    this.updateReadingTerms();
  }

  disposeReadingDecorations() {
    this.readingHandle?.dispose?.();
    this.readingHandle = null;
  }

  updateReadingTerms() {
    if (!this.readingHandle) return false;
    return this.readingHandle.setTerms(this.state.highlight === false ? [] : buildReadingTerms(this.state));
  }

  async setHighlight(value) {
    this.state.highlight = Boolean(value);
    try {
      await this.savePreferences();
    } catch {
      // Preference persistence is best-effort; the visible state still follows the toggle.
    }
    this.syncReadingDecorations();
    this.emitState();
  }

  async setLookupAnyWord(value) {
    this.state.lookupAnyWord = Boolean(value);
    try {
      await this.savePreferences();
    } catch {
      // Preference persistence is best-effort; the visible state still follows the toggle.
    }
    this.syncReadingDecorations();
    this.emitState();
  }

  readingLevelSupported() {
    return Boolean(this.app?.workspace?.scope && this.app?.knowledge?.listDocuments && this.app?.knowledge?.readDocument);
  }

  async initializeReadingLevel() {
    if (!this.readingLevelSupported()) return;
    this.recommender = new ReadingRecommender(this.app, {
      settings: this.state.levelSettings,
      locale: this.locale,
      onProgress: (done, total) => {
        this.state.recommendationLoading = { done, total };
        this.emitState();
      },
    });
    if (this.app.readingStatus?.register) {
      this.readingStatusHandle = this.register(this.app.readingStatus.register({ id: 'reading-level' }));
      this.onEvent?.('knowledge.document-opened', (event) => this.updateReadingStatus(event));
    }
    if (this.app.learningSuggestions?.register) {
      this.learningSuggestionsHandle = this.register(this.app.learningSuggestions.register({ id: 'reading-recommendations', heading: this.t.recommendations }));
    }
    await this.recommender.reload();
    await this.refreshRecommendations({ silent: true });
    await this.refreshLatestReadingStatus();
  }

  async setLevelSettings(settings) {
    this.state.levelSettings = settings;
    if (this.recommender) this.recommender.settings = settings;
    try {
      await this.savePreferences({ levelSettings: settings });
    } catch {
      this.notice(this.t.levelSettingsSaveFailed);
      return false;
    }
    this.emitState();
    await this.refreshReadingLevelSurfaces();
    return true;
  }

  async refreshReadingLevelSurfaces() {
    await this.refreshRecommendations();
    await this.refreshLatestReadingStatus();
  }

  async refreshLatestReadingStatus() {
    if (!this.latestReadingEvent) return false;
    return this.updateReadingStatus(this.latestReadingEvent);
  }

  async refreshRecommendations({ silent = false } = {}) {
    if (!this.recommender) return null;
    const epoch = this.app.workspace?.scope?.().epoch ?? 'legacy';
    if (!silent) {
      this.state.recommendationLoading = { done: 0, total: 0 };
      this.emitState();
    }
    const result = await this.recommender.recommend({ review: this.state.review, entries: this.state.entries });
    if (result.stale || (this.app.workspace?.scope?.().epoch ?? 'legacy') !== epoch) return null;
    this.state.recommendations = result;
    this.state.recommendationLoading = null;
    this.learningSuggestionsHandle?.set?.(epoch, learningSuggestionsFromRecommendations(result.items));
    this.emitState();
    return result;
  }

  async updateReadingStatus(event) {
    const path = event?.path ?? event?.documentPath;
    if (!path) return false;
    this.latestReadingEvent = { ...event, path };
    if (!this.readingStatusHandle || !this.recommender) return false;
    const epoch = this.app.workspace?.scope?.().epoch ?? 'legacy';
    let doc;
    try {
      doc = await this.app.knowledge.readDocument({ path });
    } catch {
      return false;
    }
    if (doc?._tag === 'Err') return false;
    const detected = detectEnglish(doc.content);
    if (!detected.english) return this.readingStatusHandle.set(epoch, path, null);
    const meta = { path, title: doc.meta?.title, revision: { contentHash: event?.contentHash ?? doc.revision?.contentHash ?? '' } };
    const item = await this.recommender.scoreDocument(meta, doc, this.state.review, this.state.entries);
    if ((this.app.workspace?.scope?.().epoch ?? 'legacy') !== epoch) return false;
    return this.readingStatusHandle.set(epoch, path, {
      text: this.t.readingStatus(item.rate, item.band),
      tone: item.tone,
      title: this.t.readingStatusTitle(item.rate, item.counted),
      action: { kind: 'open-panel', panelId: 'english-vocab' },
    });
  }

  async registerTools() {
    await this.addAgentTool({
      name: 'vocab_lookup',
      description: 'Look up whether an English word is already in the user vocabulary notebook and return review familiarity.',
      inputSchema: LOOKUP_SCHEMA,
      run: makeVocabLookup({ index: { get: (word) => this.index?.get(word) }, getReview: () => this.state.review }),
    });
    await this.addAgentTool({
      name: 'vocab_add',
      description: 'Submit one Auton Knowledge proposal to create or update English vocabulary notes under wiki/vocab/.',
      inputSchema: ADD_SCHEMA,
      run: makeVocabAdd({
        app: this.app,
        index: { get: (word) => this.index?.get(word) },
        nextNumber: () => ++this.submission,
        notify: (message) => this.notice(message),
        refresh: () => this.refreshIndex(),
        locale: this.locale,
      }),
    });
  }

  notice(message) {
    this.showNotice?.({ message, title: this.t.panelTitle, kind: 'info', timeoutMs: 6000 });
  }

  lookupDictionary(word) {
    return lookup(word);
  }

  suggestDictionary(prefix, n) {
    return suggest(prefix, n);
  }

  async collectDictionaryWord(result, context = {}) {
    const lemma = result?.lemma;
    const entry = result?.entry;
    if (!lemma || !entry) return { outcome: 'aborted', summary: 'missing dictionary entry' };
    if (this.index?.get(lemma)) return { outcome: 'aborted', summary: this.t.collectedWord };
    const path = `wiki/vocab/${slugFor(lemma)}.md`;
    const existing = await this.app.knowledge.readDocument({ path }).catch(() => null);
    if (existing && existing._tag !== 'Err') return { outcome: 'aborted', summary: this.t.collectedWord };
    const chinese = String(entry.t ?? '').split('\n').filter(Boolean).slice(0, 2);
    const english = String(entry.d ?? '').split('\n').filter(Boolean).slice(0, 1);
    const definition = [...chinese, ...english].join('\n') || dictionaryDefinition(entry, this.locale);
    const newContent = buildNote({
      word: lemma,
      definition,
      phonetic: entry.p,
      pos: inferPos(entry),
      example: context.sentence,
      source: context.source,
    });
    const receipt = await this.app.knowledge.propose({
      description: this.t.proposalDescription(++this.submission, lemma),
      changes: [{ path, newContent }],
    });
    if (receipt?._tag === 'Err') return { outcome: 'aborted', summary: String(receipt.error ?? 'proposal failed') };
    if (receipt?.outcome === 'applied') await this.refreshIndex();
    return receipt;
  }

  explainDictionaryWord(word, context = {}) {
    const text = this.t.request.short(word);
    const sentence = context.sentence ? `\n\n${this.t.request.sentence}: ${context.sentence}` : '';
    this.app.chat?.appendToComposer?.(`${text}${sentence}`);
  }
}
