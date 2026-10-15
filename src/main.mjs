import { uiText, currentLocale } from './ui-text.mjs';
import { ReviewStore } from './review-store.mjs';
import { VocabIndex } from './vocab-index.mjs';
import { renderPanel, hasRequiredHost, appendSelectionRequest } from './panel.mjs';
import { makeVocabAdd, makeVocabLookup, ADD_SCHEMA, LOOKUP_SCHEMA } from './tools.mjs';
import { buildReadingTerms, createReadingDecorationSpec } from './decorations.mjs';
import { DEFAULT_LEVEL_SETTINGS, detectEnglish } from './reading-level.mjs';
import { ReadingRecommender, learningSuggestionsFromRecommendations } from './recommend.mjs';
import { inferPos, lookup, suggest, dictionaryDefinition } from './dictionary.mjs';
import { appendExample, buildNote, parseNote, slugFor } from './note-format.mjs';
import { parseExampleLine } from './context-cloze.mjs';

const BasePlugin = globalThis.autonKnowledge?.Plugin ?? class {};
const emptyReview = () => ({ version: 1, cards: {}, flags: {} });
const REVIEW_MODES = new Set(['context', 'flip', 'reverse', 'listening']);

function normalizedSentence(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

function cardFingerprint(card) {
  return card ? JSON.stringify(card) : 'missing';
}

function proposalError(error) {
  return String(error?.message ?? error?.code ?? error ?? 'proposal failed');
}

function readingSource(source) {
  if (source?.kind === 'web' && source.url) return { url: source.url, title: source.title };
  if (source?.kind === 'document' && source.path) return { path: source.path, title: source.title };
  // Keep accepting pre-discriminated contexts from older hosts.
  if (source?.path) return { path: source.path, title: source.title };
  if (source?.url) return { url: source.url, title: source.title };
  return null;
}

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
      reviewMode: null,
      levelSettings: DEFAULT_LEVEL_SETTINGS,
      recommendations: null,
      recommendationLoading: null,
      mutationPending: false,
      locale: this.locale,
    };
    this.listeners = new Set();
    this.submission = 0;
    this.reviewStore = null;
    this.index = null;
    this.readingHandle = null;
    this.readingStatusHandle = null;
    this.learningSuggestionsHandle = null;
    this.recommender = null;
    this.mutationTail = Promise.resolve();
    this.pendingMutations = 0;
    this.mutationSequence = 0;
    this.operationNonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.rootGeneration = 0;
    this.recommendationRequest = 0;
    this.latestReadingEvent = null;
    this.readingUndoSnapshots = new Map();
    this.localizedPanelHandle = null;
    this.localizedCommandHandle = null;
    this.selectionActionHandle = null;
    this.registerLocalizedShell();
    if (!hasRequiredHost(this.app)) return;
    await this.loadPreferences();
    await this.initializeState();
    this.syncReadingDecorations();
    this.registerSelectionAction();
    await this.registerTools();
    this.onEvent?.('knowledge.index-changed', () => this.refreshIndex());
    this.onEvent?.('knowledge.root-changed', () => {
      const generation = this.invalidateRoot();
      return this.handleRootChanged(generation);
    });
    this.onEvent?.('appearance.locale-changed', (event) => this.handleLocaleChanged(event));
  }

  registerLocalizedShell() {
    this.localizedPanelHandle?.dispose?.();
    this.localizedCommandHandle?.dispose?.();
    this.localizedPanelHandle = this.addPanel({
      id: 'english-vocab',
      title: this.t.panelTitle,
      location: 'right',
      icon: '📖',
      render: (container) => renderPanel(container, this.panelState()),
    });
    this.localizedCommandHandle = this.addCommand({
      id: 'start-review',
      title: this.t.commandTitle,
      description: this.t.commandDescription,
      callback: () => this.openPanel('english-vocab'),
    });
  }

  emitState() {
    for (const listener of this.listeners ?? []) listener();
  }

  enqueueMutation(task, generation = this.rootGeneration) {
    this.pendingMutations += 1;
    this.state.mutationPending = true;
    this.emitState();
    const execute = () => generation === this.rootGeneration
      ? task(() => generation === this.rootGeneration)
      : false;
    const run = this.mutationTail.then(execute, execute);
    this.mutationTail = run.catch(() => undefined);
    return run.finally(() => {
      this.pendingMutations -= 1;
      this.state.mutationPending = this.pendingMutations > 0;
      this.emitState();
    });
  }

  invalidateRoot() {
    this.rootGeneration += 1;
    this.recommendationRequest += 1;
    this.index?.reset?.();
    this.state.entries = [];
    this.state.invalid = [];
    this.state.review = emptyReview();
    this.state.log = [];
    this.state.recommendations = null;
    this.state.recommendationLoading = null;
    this.latestReadingEvent = null;
    this.readingUndoSnapshots.clear();
    this.readingHandle?.setTerms?.([]);
    this.emitState();
    return this.rootGeneration;
  }

  nextLogId() {
    this.mutationSequence += 1;
    return `review-${this.operationNonce}-${Date.now().toString(36)}-${this.mutationSequence}`;
  }

  workspaceEpoch() {
    try { return this.app.workspace?.scope?.().epoch ?? 'legacy'; } catch { return 'legacy'; }
  }

  async withRootBoundKnowledgeWrite(operation, abortedValue = { outcome: 'aborted', summary: this.t.knowledgeWriteAborted }) {
    const generation = this.rootGeneration;
    const epoch = this.workspaceEpoch();
    const current = () => generation === this.rootGeneration && epoch === this.workspaceEpoch();
    const assertCurrent = () => {
      if (!current()) throw Object.assign(new Error('knowledge root changed'), { code: 'KNOWLEDGE_WRITE_ABORTED' });
    };
    const guard = {
      assertCurrent,
      wait: async (promise) => {
        try {
          const value = await promise;
          assertCurrent();
          return value;
        } catch (error) {
          assertCurrent();
          throw error;
        }
      },
    };
    try {
      assertCurrent();
      return await operation(guard);
    } catch (error) {
      if (error?.code === 'KNOWLEDGE_WRITE_ABORTED') return abortedValue;
      throw error;
    }
  }

  panelState() {
    return {
      app: this.app,
      locale: this.locale,
      getState: () => this.state,
      subscribe: (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); },
      onReview: (word, rating, mode) => this.rateWord(word, rating, mode),
      onFlag: (word, flag) => this.setFlag(word, flag),
      notify: (message) => this.notice(message),
      hasEnglishVoice: () => typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().some((voice) => /^en\b/i.test(voice.lang)),
      speak: (word) => this.speakEnglish(word),
      speakSentence: (sentence) => this.speakEnglish(sentence),
      cancelSpeech: () => this.cancelSpeech(),
      onReviewModeChange: (mode) => this.setReviewMode(mode),
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
      this.state.reviewMode = REVIEW_MODES.has(data?.reviewMode) ? data.reviewMode : null;
      this.state.levelSettings = data?.levelSettings ?? DEFAULT_LEVEL_SETTINGS;
    } catch {
      this.state.highlight = true;
      this.state.lookupAnyWord = true;
      this.state.lookupNoticeShown = false;
      this.state.reviewMode = null;
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
      reviewMode: this.state.reviewMode,
      ...patch,
    };
    await this.saveData?.(next);
    return next;
  }

  async initializeState() {
    this.reviewStore = new ReviewStore(this.app, { locale: this.locale, notify: (message) => this.notice(message) });
    this.state.review = await this.reviewStore.load();
    this.state.log = this.reviewStore.effectiveLog();
    this.index = new VocabIndex(this.app.knowledge, {
      onProgress: (done, total) => { this.state.loading = { done, total }; this.emitState(); },
      onUpdate: (result) => { this.state.entries = result.entries; this.state.invalid = result.invalid; this.emitState(); },
    });
    await this.refreshIndex();
    await this.initializeReadingLevel();
  }

  cancelSpeech() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  speakEnglish(text) {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return false;
    const voice = speechSynthesis.getVoices().find((item) => /^en\b/i.test(item.lang));
    if (!voice) return false;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang || 'en-US';
    speechSynthesis.speak(utterance);
    return true;
  }

  async setReviewMode(mode) {
    if (!REVIEW_MODES.has(mode)) return false;
    this.state.reviewMode = mode;
    try {
      await this.savePreferences({ reviewMode: mode });
    } catch {
      return false;
    }
    this.emitState();
    return true;
  }

  async refreshIndex(generation = this.rootGeneration) {
    if (!this.index) return;
    // A root switch always rebuilds the index; re-check the root here too, so a missed
    // root-changed event cannot leave the old root's progress on screen.
    const moved = this.reviewStore !== null && await this.rootMoved();
    if (generation !== this.rootGeneration) return;
    if (moved) {
      generation = this.invalidateRoot();
      const review = await this.reviewStore.reloadForRootChange();
      if (generation !== this.rootGeneration) return;
      this.state.review = review;
      this.state.log = this.reviewStore.effectiveLog();
      await this.recommender?.reload();
      if (generation !== this.rootGeneration) return;
    }
    try {
      const result = await this.index.refresh();
      if (generation !== this.rootGeneration) return;
      this.state.entries = result.entries;
      this.state.invalid = result.invalid;
      this.updateReadingTerms();
      await this.refreshRecommendations({ silent: true });
      if (generation !== this.rootGeneration) return;
      await this.refreshLatestReadingStatus();
    } finally {
      if (generation === this.rootGeneration) {
        this.state.loading = null;
        this.emitState();
      }
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

  async handleRootChanged(generation = this.invalidateRoot()) {
    if (!this.reviewStore) return;
    const review = await this.reviewStore.reloadForRootChange();
    if (generation !== this.rootGeneration) return;
    this.state.review = review;
    this.state.log = this.reviewStore.effectiveLog();
    this.emitState();
    await this.recommender?.reload();
    if (generation !== this.rootGeneration) return;
    await this.refreshIndex(generation);
  }

  async recoverSilentRootChange() {
    const generation = this.invalidateRoot();
    await this.handleRootChanged(generation);
    if (generation === this.rootGeneration) this.notice(this.t.rootChangedDuringReview);
    return false;
  }

  async rateWord(word, rating, mode) {
    return this.enqueueMutation(async (isCurrent) => {
      const id = this.nextLogId();
      const entry = { id, word, rating, reviewedAt: new Date().toISOString(), mode };
      let result;
      try {
        result = await this.reviewStore.mutateReview({ type: 'rateCard', word, rating, logEntry: entry });
      } catch {
        if (!isCurrent()) return false;
        this.notice(this.t.reviewSaveFailed);
        return false;
      }
      if (!isCurrent()) return false;
      if (result.rootChanged) {
        return this.recoverSilentRootChange();
      }
      this.state.review = result.review;
      this.state.log = this.reviewStore.effectiveLog();
      const previous = result.previousCard ?? null;
      this.updateReadingTerms();
      this.emitState();
      if (mode === 'reading-card') {
        this.readingUndoSnapshots.set(word, {
          card: previous,
          logId: id,
          rootGeneration: this.reviewStore.rootGeneration,
          resultingCard: cardFingerprint(result.review.cards[word]),
        });
      }
      try {
        const log = await this.reviewStore.flushPendingLogs();
        if (!isCurrent()) return false;
        this.state.log = log;
        this.state.review = this.reviewStore.review;
        this.emitState();
      } catch {
        if (!isCurrent()) return false;
        this.notice(this.t.logSaveFailed);
      }
      await this.refreshReadingLevelSurfaces();
      if (!isCurrent()) return false;
      return mode === 'reading-card' ? { ok: true, undoId: id } : true;
    });
  }

  async undoReadingRating(word, expectedId) {
    const generation = this.rootGeneration;
    if (!this.reviewStore || !this.readingUndoSnapshots.has(word)) return false;
    const initial = this.readingUndoSnapshots.get(word);
    if ((expectedId && initial.logId !== expectedId) || !await this.readingUndoSnapshotValid(word, initial) || generation !== this.rootGeneration) {
      if (this.readingUndoSnapshots.get(word) === initial) this.readingUndoSnapshots.delete(word);
      return false;
    }
    return this.enqueueMutation(async (isCurrent) => {
      const snapshot = this.readingUndoSnapshots.get(word);
      if (!snapshot || (expectedId && snapshot.logId !== expectedId) || !await this.readingUndoSnapshotValid(word, snapshot) || !isCurrent()) {
        if (this.readingUndoSnapshots.get(word) === snapshot) this.readingUndoSnapshots.delete(word);
        return false;
      }
      try {
        const operation = {
          type: 'restoreCardIfFingerprint',
          word,
          card: snapshot.card,
          expectedFingerprint: snapshot.resultingCard,
        };
        const logEntry = { id: this.nextLogId(), word, undoOf: snapshot.logId, reviewedAt: new Date().toISOString(), mode: 'reading-card' };
        const result = await this.reviewStore.mutateReview({ ...operation, logEntry });
        if (!isCurrent()) return false;
        this.state.review = result.review;
        this.state.log = this.reviewStore.effectiveLog();
        if (result.rootChanged) {
          this.readingUndoSnapshots.delete(word);
          return this.recoverSilentRootChange();
        }
        if (!result.applied) {
          this.readingUndoSnapshots.delete(word);
          return false;
        }
        const log = await this.reviewStore.flushPendingLogs();
        if (!isCurrent()) return false;
        this.state.log = log;
        this.state.review = this.reviewStore.review;
        this.readingUndoSnapshots.delete(word);
        this.updateReadingTerms();
        this.emitState();
        await this.refreshReadingLevelSurfaces();
        if (!isCurrent()) return false;
        return true;
      } catch {
        if (!isCurrent()) return false;
        this.notice(this.t.reviewSaveFailed);
        return false;
      }
    }, generation);
  }

  async readingUndoSnapshotValid(word, snapshot) {
    try {
      const { rootGeneration } = await this.app.storage.scope();
      return rootGeneration === snapshot.rootGeneration
        && this.reviewStore.rootGeneration === snapshot.rootGeneration
        && cardFingerprint(this.reviewStore.review.cards[word]) === snapshot.resultingCard;
    } catch {
      return false;
    }
  }

  async setFlag(word, flag) {
    return this.enqueueMutation(async (isCurrent) => {
      try {
        const result = await this.reviewStore.mutateReview(flag ? { type: 'setFlag', word, flag } : { type: 'removeFlag', word });
        if (!isCurrent()) return false;
        if (result.rootChanged) {
          return this.recoverSilentRootChange();
        }
        this.state.review = result.review;
        this.state.log = this.reviewStore.effectiveLog();
        this.updateReadingTerms();
        this.emitState();
        await this.refreshReadingLevelSurfaces();
        if (!isCurrent()) return false;
        return true;
      } catch {
        if (!isCurrent()) return false;
        this.notice(this.t.flagSaveFailed);
        return false;
      }
    });
  }

  registerSelectionAction() {
    this.selectionActionHandle?.dispose?.();
    this.selectionActionHandle = this.register(this.app.selectionActions.register({
      id: 'collect-vocab',
      title: this.t.collectTitle,
      icon: '📖',
      priority: 10,
      surfaces: ['reading', 'web'],
      onSelect: (context) => appendSelectionRequest(this.app, context, (message) => this.notice(message), this.locale),
    }));
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
        onUndo: (word, ratingId) => this.undoReadingRating(word, ratingId),
        onTermsChanged: () => this.updateReadingTerms(),
        speak: (word) => this.panelState().speak(word),
        lookupDictionary: (word) => this.lookupDictionary(word),
        onCollectWord: (result, context) => this.collectDictionaryWord(result, context),
        onExplainWord: (word, context) => this.explainDictionaryWord(word, context),
        onAddExample: (word, context) => this.addExampleSentence(word, context),
        openReadingDocument: (path) => this.app.workspace?.openDocument?.(path) ?? false,
        canOpenReadingDocument: () => Boolean(this.app.workspace?.openDocument),
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
    if (typeof this.readingHandle.setWebLookup === 'function') {
      this.readingHandle.setWebLookup(this.state.lookupAnyWord !== false);
    }
    this.updateReadingTerms();
  }

  disposeReadingDecorations() {
    this.readingHandle?.dispose?.();
    this.readingHandle = null;
  }

  updateReadingTerms() {
    if (!this.readingHandle) return false;
    const terms = this.state.highlight === false ? [] : buildReadingTerms(this.state);
    const accepted = this.readingHandle.setTerms(terms);
    if (accepted && !terms.limited) return true;
    if (accepted && terms.limited) {
      if (!this.termsLimitNoticeShown) {
        this.termsLimitNoticeShown = true;
        this.notice(this.t.termsLimited);
      }
      return true;
    }
    const lemmas = terms.filter((term) => term.surface === term.key);
    const fallback = this.readingHandle.setTerms(lemmas);
    if (!this.termsLimitNoticeShown) {
      this.termsLimitNoticeShown = true;
      this.notice(this.t.termsLimited);
    }
    return fallback;
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
    });
    if (this.app.readingStatus?.register) {
      this.readingStatusHandle = this.register(this.app.readingStatus.register({ id: 'reading-level' }));
      this.onEvent?.('knowledge.document-opened', (event) => this.updateReadingStatus(event));
    }
    if (this.app.learningSuggestions?.register) {
      this.learningSuggestionsHandle = this.register(this.app.learningSuggestions.register({ id: 'reading-recommendations', heading: this.t.recommendations }));
    }
    try {
      await this.recommender.reload();
      await this.refreshRecommendations({ silent: true });
      await this.refreshLatestReadingStatus();
    } catch {
      this.state.recommendationLoading = null;
    }
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
    const request = ++this.recommendationRequest;
    const epoch = this.app.workspace?.scope?.().epoch ?? 'legacy';
    if (!silent) {
      this.state.recommendationLoading = { done: 0, total: 0 };
      this.emitState();
    }
    try {
      const result = await this.recommender.recommend({
        review: this.state.review,
        entries: this.state.entries,
        onProgress: (done, total) => {
          if (request !== this.recommendationRequest) return;
          this.state.recommendationLoading = { done, total };
          this.emitState();
        },
      });
      if (request !== this.recommendationRequest || result.stale || (this.app.workspace?.scope?.().epoch ?? 'legacy') !== epoch) return null;
      this.state.recommendations = result;
      this.learningSuggestionsHandle?.set?.(epoch, learningSuggestionsFromRecommendations(result.items));
      return result;
    } catch {
      if (request === this.recommendationRequest && !silent) this.notice(this.t.recommendationFailed);
      return null;
    } finally {
      if (request === this.recommendationRequest) {
        this.state.recommendationLoading = null;
        this.emitState();
      }
    }
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
        index: { get: (word) => this.index?.get(word), isAmbiguous: (word) => this.index?.isAmbiguous(word) === true },
        nextNumber: () => ++this.submission,
        notify: (message) => this.notice(message),
        refresh: () => this.refreshIndex(),
        locale: () => this.locale,
        bindKnowledgeWrite: (operation, abortedValue) => this.withRootBoundKnowledgeWrite(operation, abortedValue),
      }),
    });
  }

  async handleLocaleChanged(event) {
    const locale = typeof event === 'string' ? event : event?.locale;
    this.locale = ['en', 'zh', 'ja', 'ko'].includes(locale) ? locale : 'en';
    this.t = uiText(this.locale);
    this.state.locale = this.locale;
    if (this.reviewStore) this.reviewStore.t = this.t;
    if (this.recommender) {
      this.recommender.locale = this.locale;
      this.recommender.t = this.t;
    }
    this.registerLocalizedShell();
    if (hasRequiredHost(this.app)) this.registerSelectionAction();
    this.disposeReadingDecorations();
    this.syncReadingDecorations();
    if (this.app.learningSuggestions?.register) {
      this.learningSuggestionsHandle?.dispose?.();
      this.learningSuggestionsHandle = this.register(this.app.learningSuggestions.register({ id: 'reading-recommendations', heading: this.t.recommendations }));
      const epoch = this.app.workspace?.scope?.().epoch ?? 'legacy';
      this.learningSuggestionsHandle?.set?.(epoch, learningSuggestionsFromRecommendations(this.state.recommendations?.items ?? []));
    }
    this.emitState();
    await this.refreshLatestReadingStatus();
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

  async addExampleSentence(word, context = {}) {
    return this.withRootBoundKnowledgeWrite(async (guard) => {
      const entry = this.state.entries.find((item) => item.word === word) ?? this.index?.get(word);
      if (!entry?.path || !context.sentence) return { outcome: 'aborted', summary: 'missing vocabulary entry or sentence' };
      let document;
      try {
        document = await guard.wait(this.app.knowledge.readDocument({ path: entry.path }));
      } catch (error) {
        if (error?.code === 'KNOWLEDGE_WRITE_ABORTED') throw error;
        return { outcome: 'aborted', summary: proposalError(error) };
      }
      if (document?._tag === 'Err') return { outcome: 'aborted', summary: proposalError(document.error) };
      const parsed = parseNote(document.content);
      if (!parsed.ok) return { outcome: 'aborted', summary: parsed.error };
      const target = normalizedSentence(context.sentence);
      const duplicate = parsed.entry.examples.some((line) => normalizedSentence(parseExampleLine(line).sentence) === target);
      if (duplicate) return { outcome: 'exists', summary: this.t.exampleExists };
      const newContent = appendExample(document.content, context.sentence, readingSource(context.source));
      if (newContent === document.content) return { outcome: 'exists', summary: this.t.exampleExists };
      guard.assertCurrent();
      const receipt = await guard.wait(this.app.knowledge.propose({
        description: this.t.addExampleDescription(word),
        changes: [{ path: entry.path, newContent }],
      }));
      if (receipt?._tag === 'Err') return { outcome: 'aborted', summary: proposalError(receipt.error) };
      if (receipt?.outcome === 'applied') await guard.wait(this.refreshIndex());
      return receipt;
    });
  }

  async collectDictionaryWord(result, context = {}) {
    return this.withRootBoundKnowledgeWrite(async (guard) => {
      const lemma = result?.lemma;
      const entry = result?.entry;
      if (!lemma || !entry) return { outcome: 'aborted', summary: 'missing dictionary entry' };
      if (this.index?.get(lemma)) return { outcome: 'aborted', summary: this.t.collectedWord };
      const slug = slugFor(lemma);
      let path;
      for (let number = 1; number < 1000; number += 1) {
        const candidate = `wiki/vocab/${slug}${number === 1 ? '' : `-${number}`}.md`;
        let existing;
        try {
          existing = await guard.wait(this.app.knowledge.readDocument({ path: candidate }));
        } catch (error) {
          if (error?.code === 'KNOWLEDGE_WRITE_ABORTED') throw error;
          if (error?.code === 'NOT_FOUND') { path = candidate; break; }
          return { outcome: 'aborted', summary: proposalError(error) };
        }
        if (existing?._tag === 'Err') {
          if (existing.error?.code === 'NOT_FOUND') { path = candidate; break; }
          return { outcome: 'aborted', summary: proposalError(existing.error) };
        }
        const parsed = parseNote(existing.content);
        if (parsed.ok && parsed.entry.word === lemma) return { outcome: 'aborted', summary: this.t.collectedWord };
      }
      if (!path) return { outcome: 'aborted', summary: this.t.collectFailed };
      const chinese = String(entry.t ?? '').split('\n').filter(Boolean).slice(0, 2);
      const english = String(entry.d ?? '').split('\n').filter(Boolean).slice(0, 1);
      const definition = [...chinese, ...english].join('\n') || dictionaryDefinition(entry, this.locale);
      const newContent = buildNote({
        word: lemma,
        definition,
        phonetic: entry.p,
        pos: inferPos(entry),
        example: context.sentence,
        source: readingSource(context.source),
      });
      guard.assertCurrent();
      const receipt = await guard.wait(this.app.knowledge.propose({
        description: this.t.proposalDescription(++this.submission, lemma),
        changes: [{ path, newContent }],
      }));
      if (receipt?._tag === 'Err') return { outcome: 'aborted', summary: String(receipt.error ?? 'proposal failed') };
      if (receipt?.outcome === 'applied') await guard.wait(this.refreshIndex());
      return receipt;
    });
  }

  explainDictionaryWord(word, context = {}) {
    const text = this.t.request.short(word);
    const sentence = context.sentence ? `\n\n${this.t.request.sentence}: ${context.sentence}` : '';
    this.app.chat?.appendToComposer?.(`${text}${sentence}`);
  }
}
