import { uiText, currentLocale } from './ui-text.mjs';
import { ReviewStore } from './review-store.mjs';
import { VocabIndex } from './vocab-index.mjs';
import { rateCard, newSerializedCard } from './scheduler.mjs';
import { renderPanel, hasRequiredHost, appendSelectionRequest } from './panel.mjs';
import { makeVocabAdd, makeVocabLookup, ADD_SCHEMA, LOOKUP_SCHEMA } from './tools.mjs';

const BasePlugin = globalThis.autonKnowledge?.Plugin ?? class {};
const emptyReview = () => ({ version: 1, cards: {}, flags: {} });

export default class EnglishVocabPlugin extends BasePlugin {
  async onload() {
    this.locale = currentLocale();
    this.t = uiText(this.locale);
    this.state = { entries: [], review: emptyReview(), log: [], loading: null, invalid: [] };
    this.listeners = new Set();
    this.submission = 0;
    this.reviewStore = null;
    this.index = null;
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
    await this.initializeState();
    this.registerSelectionAction();
    await this.registerTools();
    this.onEvent?.('knowledge.index-changed', () => this.refreshIndex());
    this.onEvent?.('knowledge.root-changed', () => this.handleRootChanged());
  }

  emitState() {
    for (const listener of this.listeners) listener();
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
    };
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
    this.emitState();
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
      id: 'collect-vocab',
      title: this.t.collectTitle,
      icon: '📖',
      priority: 10,
      surfaces: ['reading', 'web'],
      onSelect: (context) => appendSelectionRequest(this.app, context, (message) => this.notice(message), this.locale),
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
}
