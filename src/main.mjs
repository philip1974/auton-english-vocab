import { uiText, currentLocale } from './ui-text.mjs';
import { ReviewStore } from './review-store.mjs';
import { VocabIndex } from './vocab-index.mjs';
import { renderPanel, hasRequiredHost, appendSelectionRequest } from './panel.mjs';
import { makeVocabAdd, makeVocabLookup, ADD_SCHEMA, LOOKUP_SCHEMA } from './tools.mjs';
import { buildReadingTerms, createReadingDecorationSpec } from './decorations.mjs';
import { DEFAULT_LEVEL_SETTINGS, detectEnglish, validateLevelSettings } from './reading-level.mjs';
import { ReadingRecommender, learningSuggestionsFromRecommendations } from './recommend.mjs';
import { enrichVocabularyEntries, inferPos, lookup, suggest, dictionaryDefinition } from './dictionary.mjs';
import { appendExample, buildNote, parseNote, slugFor, normalizeWord, normalizeSourceTitle } from './note-format.mjs';
import { parseExampleLine } from './context-cloze.mjs';

const BasePlugin = globalThis.autonKnowledge?.Plugin ?? class {};
const emptyReview = () => ({ version: 1, cards: Object.create(null), flags: Object.create(null) });
const REVIEW_MODES = new Set(['context', 'flip', 'reverse', 'listening']);

function normalizedSentence(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

function cardFingerprint(card) {
  return card ? JSON.stringify(card) : 'missing';
}

function ownValue(record, key) {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function proposalError(error) {
  return String(error?.message ?? error?.code ?? error ?? 'proposal failed');
}

function readingSource(source) {
  const title = normalizeSourceTitle(source?.title);
  if (source?.kind === 'web' && source.url) return { url: source.url, title };
  if (source?.kind === 'document' && source.path) return { path: source.path, title };
  // Keep accepting pre-discriminated contexts from older hosts.
  if (source?.path) return { path: source.path, title };
  if (source?.url) return { url: source.url, title };
  return null;
}

export default class EnglishVocabPlugin extends BasePlugin {
  async onload() {
    this.unloaded = false;
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
    this.indexBinding = null;
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
    this.readingStatusRequest = 0;
    this.readingStatusDirty = false;
    this.indexProjectionReady = false;
    this.readingUndoSnapshots = new Map();
    this.localizedPanelHandle = null;
    this.localizedCommandHandle = null;
    this.selectionActionHandle = null;
    this.initialized = false;
    this.rootChangedPending = false;
    this.indexChangedPending = false;
    this.rootRecoveryPromise = null;
    this.onEvent?.('appearance.locale-changed', (event) => this.handleLocaleChanged(event));
    this.onEvent?.('knowledge.root-changed', () => {
      return this.ensureRootConsistent({ forceRecover: true, invalidate: true });
    });
    this.onEvent?.('knowledge.index-changed', () => {
      this.indexChangedPending = true;
      if (!this.initialized) return false;
      return this.handleIndexChanged();
    });
    this.onEvent?.('knowledge.document-opened', (event) => this.updateReadingStatus(event));
    this.registerLocalizedShell();
    if (!hasRequiredHost(this.app)) return;
    await this.loadPreferences();
    await this.initializeState();
    this.syncReadingDecorations();
    this.registerSelectionAction();
    await this.registerTools();
    this.initialized = true;
    if (this.rootChangedPending) await this.ensureRootConsistent({ forceRecover: true });
    else await this.ensureRootConsistent();
    if (this.indexChangedPending) await this.handleIndexChanged();
    const finalLocale = currentLocale();
    if (finalLocale !== this.locale) await this.handleLocaleChanged(finalLocale);
    if (this.readingStatusDirty) await this.refreshLatestReadingStatus();
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
    if (this.unloaded) return;
    for (const listener of this.listeners ?? []) listener();
  }

  enqueueMutation(task, generation = this.rootGeneration) {
    this.pendingMutations += 1;
    this.state.mutationPending = true;
    this.emitState();
    const execute = () => !this.unloaded && generation === this.rootGeneration
      ? task(() => !this.unloaded && generation === this.rootGeneration)
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
    this.indexBinding = null;
    this.indexProjectionReady = false;
    this.state.entries = [];
    this.state.invalid = [];
    this.state.review = emptyReview();
    this.state.log = [];
    this.state.recommendations = null;
    this.state.recommendationLoading = null;
    this.latestReadingEvent = null;
    this.readingStatusDirty = false;
    this.readingStatusRequest += 1;
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

  rootBindingMatches(binding, { requireIndex = true, expectedBinding } = {}) {
    if (!binding?.stable || !this.reviewStore || binding.storageRootGeneration !== this.reviewStore.rootGeneration) return false;
    if (expectedBinding && (binding.storageRootGeneration !== expectedBinding.storageRootGeneration
      || binding.workspaceEpoch !== expectedBinding.workspaceEpoch)) return false;
    if (!requireIndex) return true;
    return this.indexBinding?.generation === this.rootGeneration
      && this.indexBinding?.epoch === binding.workspaceEpoch
      && this.indexBinding?.storageRootGeneration === binding.storageRootGeneration;
  }

  async ensureRootConsistent({ recover = true, requireIndex = true, expectedBinding, forceRecover = false, invalidate = false } = {}) {
    const invalidatedGeneration = invalidate ? this.invalidateRoot() : null;
    let binding;
    try { binding = await this.captureRootBinding(); } catch { return { ok: false, binding: null }; }
    if (!forceRecover && this.rootBindingMatches(binding, { requireIndex, expectedBinding })) {
      this.rootChangedPending = false;
      return { ok: true, binding };
    }
    this.rootChangedPending = true;
    if (!recover || !this.initialized || !this.reviewStore) return { ok: false, binding };
    if (invalidate || !this.rootRecoveryPromise) {
      const recovery = this.recoverSilentRootChange(invalidatedGeneration ?? undefined);
      const tracked = recovery.finally(() => {
        if (this.rootRecoveryPromise === tracked) this.rootRecoveryPromise = null;
      });
      this.rootRecoveryPromise = tracked;
    }
    await this.rootRecoveryPromise;
    const current = await this.captureRootBinding().catch(() => null);
    if (current && this.rootBindingMatches(current, { requireIndex })) {
      this.rootChangedPending = false;
      return { ok: false, binding };
    }
    if (recover && this.initialized) return this.ensureRootConsistent({ requireIndex });
    return { ok: false, binding };
  }

  async recoverDetectedRootChange() {
    this.rootChangedPending = true;
    await this.ensureRootConsistent({ forceRecover: true });
    return false;
  }

  async rootStillConsistent(binding, { requireIndex = true } = {}) {
    const result = await this.ensureRootConsistent({ recover: false, requireIndex, expectedBinding: binding });
    if (!result.ok) void this.ensureRootConsistent().catch(() => undefined);
    return result.ok;
  }

  async handleIndexChanged() {
    this.indexChangedPending = false;
    const consistent = await this.ensureRootConsistent();
    if (!consistent.ok) return false;
    await this.refreshIndex();
    return true;
  }

  async withRootBoundKnowledgeWrite(operation, abortedValue = { outcome: 'aborted', summary: this.t.knowledgeWriteAborted }) {
    const initial = await this.ensureRootConsistent();
    if (!initial.ok) return abortedValue;
    const generation = this.rootGeneration;
    const binding = initial.binding;
    const assertCurrent = async () => {
      const current = generation === this.rootGeneration
        && (await this.ensureRootConsistent({ recover: false, expectedBinding: binding })).ok;
      if (!current) {
        void this.ensureRootConsistent().catch(() => undefined);
        throw Object.assign(new Error('knowledge root or vocabulary index changed'), { code: 'KNOWLEDGE_WRITE_ABORTED' });
      }
    };
    const guard = {
      assertCurrent,
      wait: async (promise) => {
        try {
          const value = await promise;
          await assertCurrent();
          return value;
        } catch (error) {
          await assertCurrent();
          throw error;
        }
      },
    };
    try {
      await assertCurrent();
      return await operation(guard);
    } catch (error) {
      if (error?.code === 'KNOWLEDGE_WRITE_ABORTED') {
        this.refreshIndex().catch(() => undefined);
        return abortedValue;
      }
      throw error;
    }
  }

  async withRootBoundRead(operation, abortedValue) {
    let consistent = await this.ensureRootConsistent();
    if (!consistent.ok) consistent = await this.ensureRootConsistent({ recover: false });
    return consistent.ok ? operation() : abortedValue;
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
      const levelSettings = validateLevelSettings(data?.levelSettings);
      this.state.levelSettings = levelSettings.ok ? levelSettings.settings : DEFAULT_LEVEL_SETTINGS;
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
      enrichEntries: (entries) => enrichVocabularyEntries(entries),
      onEnrichmentRetry: (indexGeneration) => {
        if (this.index?.generation !== indexGeneration) return false;
        return this.refreshIndex(this.rootGeneration);
      },
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
    try {
      await this.savePreferences({ reviewMode: mode });
    } catch {
      this.notice(this.t.reviewModeSaveFailed);
      return false;
    }
    this.state.reviewMode = mode;
    this.emitState();
    return true;
  }

  async refreshIndex(generation = this.rootGeneration) {
    if (!this.index) return;
    const initial = await this.ensureRootConsistent({ requireIndex: false });
    if (!initial.ok || generation !== this.rootGeneration) return false;
    const binding = initial.binding;
    try {
      this.indexBinding = { generation, epoch: binding.workspaceEpoch, storageRootGeneration: binding.storageRootGeneration };
      this.indexProjectionReady = false;
      let result;
      try {
        result = await this.index.refresh();
      } catch (error) {
        if (error?.code === 'ROOT_CHANGED') return this.recoverDetectedRootChange();
        throw error;
      }
      if (generation !== this.rootGeneration || !(await this.ensureRootConsistent({ requireIndex: false, expectedBinding: binding })).ok) return false;
      this.state.entries = result.entries;
      this.state.invalid = result.invalid;
      this.updateReadingTerms();
      this.indexProjectionReady = true;
      if (generation !== this.rootGeneration || !(await this.ensureRootConsistent({ expectedBinding: binding })).ok) return false;
      await this.refreshRecommendations({ silent: true });
      if (generation !== this.rootGeneration || !(await this.ensureRootConsistent({ expectedBinding: binding })).ok) return false;
      await this.refreshLatestReadingStatus();
      if (generation !== this.rootGeneration || !(await this.ensureRootConsistent({ expectedBinding: binding })).ok) return false;
      if (this.readingStatusDirty) await this.refreshLatestReadingStatus();
      return true;
    } finally {
      if (generation === this.rootGeneration) {
        this.state.loading = null;
        this.emitState();
      }
    }
  }

  async captureRootBinding() {
    const before = this.workspaceEpoch();
    const { rootGeneration: storageRootGeneration } = await this.app.storage.scope();
    const workspaceEpoch = this.workspaceEpoch();
    return { storageRootGeneration, workspaceEpoch, stable: before === workspaceEpoch };
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
    if (generation === this.rootGeneration) this.rootChangedPending = false;
  }

  async recoverSilentRootChange(existingGeneration) {
    const generation = existingGeneration ?? this.invalidateRoot();
    await this.handleRootChanged(generation);
    if (generation === this.rootGeneration) this.notice(this.t.rootChangedDuringReview);
    return false;
  }

  async rateWord(word, rating, mode) {
    return this.enqueueMutation(async (isCurrent) => {
      if (!(await this.ensureRootConsistent()).ok || !isCurrent()) return false;
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
        return this.recoverDetectedRootChange();
      }
      this.state.review = result.review;
      this.state.log = this.reviewStore.effectiveLog();
      const previous = result.previousCard ?? null;
      this.updateReadingTerms();
      this.emitState();
      if (mode === 'reading-card') {
        this.readingUndoSnapshots.set(word, {
          card: previous,
          introduced: !previous || previous.state === 'New',
          logId: id,
          rootGeneration: this.reviewStore.rootGeneration,
          resultingCard: cardFingerprint(ownValue(result.review.cards, word)),
        });
      }
      try {
        const flushed = await this.reviewStore.flushPendingLogs();
        if (!isCurrent()) return false;
        if (flushed.rootChanged) return this.recoverDetectedRootChange();
        this.state.log = flushed.log;
        this.state.review = this.reviewStore.review;
        const persistedId = flushed.idMap.get(id) ?? id;
        const snapshot = this.readingUndoSnapshots.get(word);
        if (snapshot?.logId === id) snapshot.logId = persistedId;
        this.emitState();
      } catch {
        if (!isCurrent()) return false;
        this.notice(this.t.logSaveFailed);
      }
      await this.refreshReadingLevelSurfacesBestEffort();
      if (!isCurrent()) return false;
      const undoId = this.readingUndoSnapshots.get(word)?.logId ?? id;
      return mode === 'reading-card' ? { ok: true, undoId } : true;
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
      if (!(await this.ensureRootConsistent()).ok || !isCurrent()) return false;
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
          removeIntroduced: snapshot.introduced === true,
        };
        const logEntry = { id: this.nextLogId(), word, undoOf: snapshot.logId, reviewedAt: new Date().toISOString(), mode: 'reading-card' };
        const result = await this.reviewStore.mutateReview({ ...operation, logEntry });
        if (!isCurrent()) return false;
        this.state.review = result.review;
        this.state.log = this.reviewStore.effectiveLog();
        if (result.rootChanged) {
          this.readingUndoSnapshots.delete(word);
          return this.recoverDetectedRootChange();
        }
        if (!result.applied) {
          this.readingUndoSnapshots.delete(word);
          return false;
        }
        const flushed = await this.reviewStore.flushPendingLogs();
        if (!isCurrent()) return false;
        if (flushed.rootChanged) {
          this.readingUndoSnapshots.delete(word);
          return this.recoverDetectedRootChange();
        }
        this.state.log = flushed.log;
        this.state.review = this.reviewStore.review;
        this.readingUndoSnapshots.delete(word);
        this.updateReadingTerms();
        this.emitState();
        await this.refreshReadingLevelSurfacesBestEffort();
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
      const consistent = await this.ensureRootConsistent();
      return consistent.ok && consistent.binding.storageRootGeneration === snapshot.rootGeneration
        && cardFingerprint(ownValue(this.reviewStore.review.cards, word)) === snapshot.resultingCard;
    } catch {
      return false;
    }
  }

  async setFlag(word, flag) {
    return this.enqueueMutation(async (isCurrent) => {
      try {
        if (!(await this.ensureRootConsistent()).ok || !isCurrent()) return false;
        const result = await this.reviewStore.mutateReview(flag ? { type: 'setFlag', word, flag } : { type: 'removeFlag', word });
        if (!isCurrent()) return false;
        if (result.rootChanged) {
          return this.recoverDetectedRootChange();
        }
        this.state.review = result.review;
        this.state.log = this.reviewStore.effectiveLog();
        this.updateReadingTerms();
        this.emitState();
        await this.refreshReadingLevelSurfacesBestEffort();
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
    }
    this.registerLocalizedLearningSuggestions({ publish: false });
    try {
      await this.recommender.reload();
      await this.refreshRecommendations({ silent: true });
      await this.refreshLatestReadingStatus();
    } catch {
      this.state.recommendationLoading = null;
    }
  }

  async setLevelSettings(settings) {
    try {
      await this.savePreferences({ levelSettings: settings });
    } catch {
      this.notice(this.t.levelSettingsSaveFailed);
      return false;
    }
    this.state.levelSettings = settings;
    if (this.recommender) this.recommender.settings = settings;
    this.emitState();
    await this.refreshReadingLevelSurfaces();
    return true;
  }

  async refreshReadingLevelSurfaces() {
    await this.refreshRecommendations();
    await this.refreshLatestReadingStatus();
  }

  async refreshReadingLevelSurfacesBestEffort() {
    try {
      await this.refreshReadingLevelSurfaces();
      return true;
    } catch {
      this.notice(this.t.recommendationFailed);
      return false;
    }
  }

  async refreshLatestReadingStatus() {
    if (!this.latestReadingEvent) return false;
    return this.updateReadingStatus(this.latestReadingEvent);
  }

  async refreshRecommendations({ silent = false } = {}) {
    if (!this.recommender) return null;
    const initial = await this.ensureRootConsistent();
    if (!initial.ok) return null;
    const binding = initial.binding;
    const request = ++this.recommendationRequest;
    const epoch = binding.workspaceEpoch;
    if (!silent) {
      this.state.recommendationLoading = { done: 0, total: 0 };
      this.emitState();
    }
    try {
      const result = await this.recommender.recommend({
        review: this.state.review,
        entries: this.state.entries,
        onProgress: (done, total) => {
          if (silent || request !== this.recommendationRequest) return;
          this.state.recommendationLoading = { done, total };
          this.emitState();
        },
      });
      if (request !== this.recommendationRequest || result.stale
        || !(await this.rootStillConsistent(binding))) return null;
      this.state.recommendations = result;
      const accepted = this.learningSuggestionsHandle?.set?.(epoch, learningSuggestionsFromRecommendations(result.items, this.locale));
      if (accepted === false) this.notice(this.t.recommendationFailed);
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
    this.readingStatusRequest = (this.readingStatusRequest ?? 0) + 1;
    const request = this.readingStatusRequest;
    this.latestReadingEvent = { ...event, path };
    this.readingStatusDirty = true;
    if (!this.initialized || !this.readingStatusHandle || !this.recommender || !this.indexProjectionReady) return false;
    const initial = await this.ensureRootConsistent();
    if (!initial.ok) {
      this.latestReadingEvent = { ...event, path };
      this.readingStatusDirty = true;
      const healed = await this.ensureRootConsistent({ recover: false });
      return healed.ok ? this.updateReadingStatus(this.latestReadingEvent) : false;
    }
    const generation = this.rootGeneration;
    const binding = initial.binding;
    const epoch = binding.workspaceEpoch;
    let doc;
    try {
      doc = await this.app.knowledge.readDocument({ path });
    } catch {
      return false;
    }
    if (request !== this.readingStatusRequest || generation !== this.rootGeneration
      || !(await this.rootStillConsistent(binding))) return false;
    if (doc?._tag === 'Err') return false;
    const review = this.state.review;
    const entries = this.state.entries;
    const detected = detectEnglish(doc.content);
    if (!detected.english) {
      const accepted = this.readingStatusHandle.set(epoch, path, null);
      if (request === this.readingStatusRequest && accepted !== false) this.readingStatusDirty = false;
      return accepted;
    }
    const meta = { path, title: doc.meta?.title, revision: { contentHash: event?.contentHash ?? doc.revision?.contentHash ?? '' } };
    const item = await this.recommender.scoreDocument(meta, doc, review, entries, epoch);
    if (!item) return false;
    if (request !== this.readingStatusRequest || generation !== this.rootGeneration || review !== this.state.review
      || !(await this.rootStillConsistent(binding))) return false;
    const accepted = this.readingStatusHandle.set(epoch, path, {
      text: this.t.readingStatus(item.rate, item.band),
      tone: item.tone,
      title: this.t.readingStatusTitle(item.rate, item.counted),
      action: { kind: 'open-panel', panelId: 'english-vocab' },
    });
    if (request === this.readingStatusRequest && accepted !== false) this.readingStatusDirty = false;
    return accepted;
  }

  async registerTools() {
    await this.addAgentTool({
      name: 'vocab_lookup',
      description: 'Look up whether an English word is already in the user vocabulary notebook and return review familiarity.',
      inputSchema: LOOKUP_SCHEMA,
      run: makeVocabLookup({
        index: { get: (word) => this.index?.get(word), resolveSurface: (word) => this.index?.resolveSurface(word) },
        getReview: () => this.state.review,
        bindRootRead: (operation) => this.withRootBoundRead(operation, JSON.stringify({ error: this.t.knowledgeWriteAborted })),
      }),
    });
    await this.addAgentTool({
      name: 'vocab_add',
      description: 'Submit one Auton Knowledge proposal to create or update English vocabulary notes under wiki/vocab/.',
      inputSchema: ADD_SCHEMA,
      run: makeVocabAdd({
        app: this.app,
        index: {
          get: (word) => this.index?.get(word),
          resolveSurface: (word) => this.index?.resolveSurface(word),
          isAmbiguous: (word) => this.index?.isAmbiguous(word) === true,
        },
        nextNumber: () => ++this.submission,
        notify: (message) => this.notice(message),
        refresh: () => this.refreshIndex(),
        locale: () => this.locale,
        bindKnowledgeWrite: (operation, abortedValue) => this.withRootBoundKnowledgeWrite(operation, abortedValue),
      }),
    });
  }

  onunload() {
    this.unloaded = true;
    this.initialized = false;
    this.rootGeneration += 1;
    this.recommendationRequest += 1;
    this.readingStatusRequest += 1;
    this.index?.cancel?.();
    this.cancelSpeech();
    this.readingUndoSnapshots?.clear?.();
    this.latestReadingEvent = null;
    this.readingStatusDirty = false;
    this.indexProjectionReady = false;
    this.rootChangedPending = false;
    this.indexChangedPending = false;
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
    this.registerLocalizedLearningSuggestions();
    this.emitState();
    await this.refreshLatestReadingStatus();
  }

  registerLocalizedLearningSuggestions({ publish = true } = {}) {
    if (!this.recommender || !this.app.learningSuggestions?.register) return null;
    this.learningSuggestionsHandle?.dispose?.();
    this.learningSuggestionsHandle = this.register(this.app.learningSuggestions.register({ id: 'reading-recommendations', heading: this.t.recommendations }));
    if (publish) {
      const epoch = this.workspaceEpoch();
      const accepted = this.learningSuggestionsHandle.set(epoch, learningSuggestionsFromRecommendations(this.state.recommendations?.items ?? [], this.locale));
      if (accepted === false) this.notice(this.t.recommendationFailed);
    }
    return this.learningSuggestionsHandle;
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
      if (normalizeWord(parsed.entry.word) !== normalizeWord(word)) {
        await guard.wait(this.refreshIndex());
        return { outcome: 'aborted', summary: this.t.knowledgeWriteAborted };
      }
      const target = normalizedSentence(context.sentence);
      const duplicate = parsed.entry.examples.some((line) => normalizedSentence(parseExampleLine(line).sentence) === target);
      if (duplicate) return { outcome: 'exists', summary: this.t.exampleExists };
      const newContent = appendExample(document.content, context.sentence, readingSource(context.source));
      if (newContent === document.content) return { outcome: 'exists', summary: this.t.exampleExists };
      await guard.assertCurrent();
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
      if (this.index?.isAmbiguous(lemma)) return { outcome: 'aborted', summary: this.t.duplicateWord };
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
      const definition = dictionaryDefinition(entry, this.locale);
      const newContent = buildNote({
        word: lemma,
        definition,
        phonetic: entry.p,
        pos: inferPos(entry),
        example: context.sentence,
        source: readingSource(context.source),
      });
      await guard.assertCurrent();
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
