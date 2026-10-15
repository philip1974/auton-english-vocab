import { describe, expect, it, vi } from 'vitest';
import { makeVocabAdd, makeVocabLookup } from '../src/tools.mjs';
import { buildNote } from '../src/note-format.mjs';
import { uiText } from '../src/ui-text.mjs';

function app(proposalReceipt = { outcome: 'applied' }) {
  const proposals = [];
  const oldContent = buildNote({ word: 'old', definition: '旧', example: 'Old one.' });
  return {
    proposals,
    knowledge: {
      async readDocument({ path }) {
        if (path === 'wiki/sources/missing.md') throw new Error('missing');
        if (path === 'wiki/vocab/old.md') return { content: oldContent, meta: { title: 'Old' } };
        if (path.startsWith('wiki/vocab/')) return { _tag: 'Err', error: { code: 'NOT_FOUND', message: 'not found' } };
        return { content: 'source', meta: { title: 'Source title' } };
      },
      propose(request) {
        const paths = request.changes.map((change) => change.path);
        if (new Set(paths).size !== paths.length) {
          return Promise.resolve({ _tag: 'Err', error: { code: 'CHANGESET_INVALID', message: 'duplicate path' } });
        }
        if (request.changes.some((change) => change.path === 'wiki/vocab/old.md' && change.newContent === oldContent)) {
          return Promise.resolve({ _tag: 'Err', error: { code: 'CHANGESET_INVALID', message: 'change is identical to source' } });
        }
        proposals.push(request);
        return Promise.resolve(proposalReceipt);
      },
    },
  };
}

describe('tools', () => {
  it('should provide localized submitted and omitted-source tool results in every supported locale', () => {
    for (const locale of ['en', 'zh', 'ja', 'ko']) {
      const text = uiText(locale);
      expect(text.toolSubmitted(3, 2)).toBeTruthy();
      expect(text.toolSourceOmitted('wiki/missing.md')).toContain('wiki/missing.md');
    }
  });

  it('should return lookup details when a word is collected', async () => {
    const lookup = makeVocabLookup({
      index: { get: () => ({ word: 'alpha', definition: 'a' }) },
      review: { cards: { alpha: { state: 'Review', stability: 2, due: 'tomorrow' } }, flags: {} },
    });
    await expect(lookup({ word: 'Alpha' })).resolves.toContain('"collected":true');
  });

  it('should return uncollected lookup details when a word is missing', async () => {
    const lookup = makeVocabLookup({ index: { get: () => null }, review: { cards: {}, flags: {} } });
    await expect(lookup({ word: 'none' })).resolves.toContain('"collected":false');
  });

  it('should assemble one proposal and return immediately when adding entries', async () => {
    vi.useFakeTimers();
    const fake = app({ outcome: 'not-reviewed' });
    const notices = [];
    const add = makeVocabAdd({
      app: fake,
      index: { get: () => null },
      nextNumber: () => 7,
      notify: (message) => notices.push(message),
      refresh: () => notices.push('refresh'),
    });
    const result = await add({ entries: [{ word: 'Alpha', definition: '字母', example: 'Alpha test.', source: { path: 'wiki/sources/foo.md' } }] });
    expect(result).toMatch(/Submitted for review #7: 1 word/);
    expect(fake.proposals).toHaveLength(1);
    expect(fake.proposals[0].changes[0].path).toBe('wiki/vocab/alpha.md');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(notices[0]).toMatch(/not reviewed/);
    vi.useRealTimers();
  });

  it('should normalize a curly apostrophe before proposing an agent vocabulary entry', async () => {
    const fake = app();
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 8, notify: () => undefined });
    await add({ entries: [{ word: 'don’t', definition: '不要' }] });
    expect(fake.proposals[0].changes[0]).toMatchObject({ path: 'wiki/vocab/don-t.md' });
    expect(fake.proposals[0].changes[0].newContent).toContain('word: "don\'t"');
  });

  it('should reserve colliding slugs within one vocab add proposal', async () => {
    const fake = app();
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 10, notify: () => undefined });
    await add({ entries: [
      { word: 'don-t', definition: 'dash' },
      { word: "don't", definition: 'do not' },
    ] });
    expect(fake.proposals[0].changes.map((change) => change.path)).toEqual(['wiki/vocab/don-t.md', 'wiki/vocab/don-t-2.md']);
  });

  it('should make the knowledge fake reject duplicate proposal paths like the host', async () => {
    const result = await app().knowledge.propose({ changes: [
      { path: 'wiki/vocab/run.md', newContent: 'one' },
      { path: 'wiki/vocab/run.md', newContent: 'two' },
    ] });
    expect(result).toEqual({ _tag: 'Err', error: { code: 'CHANGESET_INVALID', message: 'duplicate path' } });
  });

  it('should append to an existing note when word is already indexed', async () => {
    const fake = app();
    const add = makeVocabAdd({
      app: fake,
      index: { get: () => ({ word: 'old', path: 'wiki/vocab/old.md' }) },
      nextNumber: () => 1,
      notify: () => undefined,
    });
    await add({ entries: [{ word: 'old', definition: '旧', example: 'Old again.' }] });
    expect(fake.proposals[0].changes[0].newContent).toContain('Old again.');
  });

  it('should skip unchanged notes and still submit changed entries without identical changes', async () => {
    const fake = app();
    const add = makeVocabAdd({
      app: fake,
      index: { get: (word) => word === 'old' ? { word: 'old', path: 'wiki/vocab/old.md' } : null },
      nextNumber: () => 13,
      notify: () => undefined,
    });
    const mixed = await add({ entries: [{ word: 'old', definition: '旧' }, { word: 'beta', definition: '测试' }] });
    expect(mixed).toContain('1 word');
    expect(fake.proposals[0].changes).toEqual([expect.objectContaining({ path: 'wiki/vocab/beta.md' })]);
    const proposalCount = fake.proposals.length;
    await expect(add({ entries: [{ word: 'old', definition: '旧' }] })).resolves.toMatch(/No vocabulary entries changed/u);
    expect(fake.proposals).toHaveLength(proposalCount);
  });

  it('should remove a missing wiki source link and explain when source verification fails', async () => {
    const add = makeVocabAdd({
      app: app(),
      index: { get: () => null },
      nextNumber: () => 2,
      notify: () => undefined,
    });
    await expect(add({ entries: [{ word: 'Beta', definition: '测试', example: 'Beta test.', source: { path: 'wiki/sources/missing.md' } }] })).resolves.toMatch(/without a link/);
  });

  it('should localize vocab add results and only mention omitted sources when an example exists', async () => {
    const addJapanese = makeVocabAdd({
      app: app(),
      index: { get: () => null },
      nextNumber: () => 11,
      notify: () => undefined,
      locale: 'ja',
    });
    const withoutExample = await addJapanese({ entries: [{ word: 'beta', definition: 'テスト', source: { path: 'wiki/sources/missing.md' } }] });
    expect(withoutExample).toContain('レビューに提出');
    expect(withoutExample).not.toContain('Submitted for review');
    expect(withoutExample).not.toContain('wiki/sources/missing.md');

    const withExample = await addJapanese({ entries: [{ word: 'gamma', definition: 'テスト', example: 'Gamma.', source: { path: 'wiki/sources/missing.md' } }] });
    expect(withExample).toContain('wiki/sources/missing.md');
    expect(withExample).toContain('リンク');

    const noChanges = makeVocabAdd({
      app: app(),
      index: { get: () => ({ word: 'old', path: 'wiki/vocab/old.md' }) },
      nextNumber: () => 12,
      notify: () => undefined,
      locale: 'ko',
    });
    await expect(noChanges({ entries: [{ word: 'old', definition: '旧' }] })).resolves.toContain('변경된 단어');
  });

  it('should reject invalid source paths when entries are unsafe', async () => {
    const add = makeVocabAdd({ app: app(), index: { get: () => null }, nextNumber: () => 1, notify: () => undefined });
    await expect(add({ entries: [{ word: 'Beta', definition: '测试', source: { path: '../secret' } }] })).rejects.toThrow(/invalid source/);
  });

  it('should preserve safe docs sources and normalize their title to one line', async () => {
    const fake = app();
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 9, notify: () => undefined });
    await add({ entries: [{ word: 'run', definition: '跑', example: 'Run.', source: { path: 'docs/article.md', title: 'Article\n title' } }] });
    expect(fake.proposals[0].changes[0].newContent).toContain('- Run. — [Article title](docs/article.md)');
  });

  it('should produce distinct notices when proposal outcomes differ', async () => {
    for (const [outcome, pattern] of [
      ['applied', /was applied/],
      ['rejected', /was rejected: no/],
      ['timeout', /timed out/],
      ['aborted', /was aborted/],
    ]) {
      const notices = [];
      const add = makeVocabAdd({
        app: app({ outcome, reason: 'no' }),
        index: { get: () => null },
        nextNumber: () => 3,
        notify: (message) => notices.push(message),
      });
      await add({ entries: [{ word: 'gamma', definition: '测试' }] });
      await Promise.resolve();
      expect(notices[0]).toMatch(pattern);
    }
  });

  it('should hide unknown proposal errors and rejected notices without a reason', async () => {
    const notices = [];
    const add = makeVocabAdd({
      app: app({ outcome: 'rejected' }),
      index: { get: () => null },
      nextNumber: () => 6,
      notify: (message) => notices.push(message),
    });
    await add({ entries: [{ word: 'theta', definition: '测试' }] });
    await Promise.resolve();
    expect(notices[0]).toContain('No reason given');

    const errApp = app({ _tag: 'Err', error: 'hidden' });
    const addErr = makeVocabAdd({ app: errApp, index: { get: () => null }, nextNumber: () => 7, notify: (message) => notices.push(message) });
    await addErr({ entries: [{ word: 'iota', definition: '测试' }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(notices.at(-1)).toContain('could not be submitted');
  });

  it('should reject invalid entry counts and definitions when input is malformed', async () => {
    const add = makeVocabAdd({ app: app(), index: { get: () => null }, nextNumber: () => 1, notify: () => undefined });
    await expect(add({})).rejects.toThrow(/1-20/);
    await expect(add({ entries: [] })).rejects.toThrow(/1-20/);
    await expect(add({ entries: [{ word: 'a', definition: '' }] })).rejects.toThrow(/invalid definition/);
    await expect(add({ entries: [{ word: 'x'.repeat(65), definition: 'x' }] })).rejects.toThrow(/invalid word/);
    await expect(add({ entries: [{ word: 'run-', definition: 'x' }] })).rejects.toThrow(/invalid word/);
    await expect(add({ entries: [{ word: 'a--b', definition: 'x' }] })).rejects.toThrow(/invalid word/);
    await expect(add({ entries: [{ word: 'beta', definition: 'x', example: 'x'.repeat(601) }] })).rejects.toThrow(/example too long/);
  });

  it('should notify failure when proposal promise rejects', async () => {
    const fake = app();
    fake.knowledge.propose = () => Promise.reject(new Error('nope'));
    const notices = [];
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 4, notify: (message) => notices.push(message) });
    await add({ entries: [{ word: 'delta', definition: '测试' }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(notices[0]).toMatch(/could not be submitted/);
  });

  it('should reject existing notes with broken frontmatter when appending', async () => {
    const fake = app();
    fake.knowledge.readDocument = async () => ({ content: '---\ntype: vocab\n---\n# bad' });
    const add = makeVocabAdd({ app: fake, index: { get: () => ({ path: 'wiki/vocab/bad.md' }) }, nextNumber: () => 1, notify: () => undefined });
    await expect(add({ entries: [{ word: 'bad', definition: '坏' }] })).rejects.toThrow(/frontmatter invalid/);
  });

  it('should preserve http source links and vocab relative links when resolving sources', async () => {
    const fake = app();
    fake.knowledge.readDocument = async ({ path }) => path === 'wiki/vocab/source.md'
      ? { content: buildNote({ word: 'source', definition: '来源' }), meta: { title: 'Source note' } }
      : { _tag: 'Err', error: { code: 'NOT_FOUND', message: 'not found' } };
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 5, notify: () => undefined });
    await add({ entries: [
      { word: 'epsilon', definition: '测试', example: 'Epsilon.', source: { url: 'https://example.com/e' } },
      { word: 'zeta', definition: '测试', example: 'Zeta.', source: { path: 'wiki/vocab/source.md' } },
    ] });
    expect(fake.proposals[0].changes[0].newContent).toContain('<https://example.com/e>');
    expect(fake.proposals[0].changes[1].newContent).toContain('](source.md)');
  });

  it('should use source path as title fallback when document title is missing', async () => {
    const fake = app();
    fake.knowledge.readDocument = async ({ path }) => path === 'wiki/sources/k.md' ? { content: 'source', meta: {} } : { _tag: 'Err', error: { code: 'NOT_FOUND', message: 'not found' } };
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 8, notify: () => undefined });
    await add({ entries: [{ word: 'kappa', definition: '测试', example: 'Kappa.', source: { path: 'wiki/sources/k.md' } }] });
    expect(fake.proposals[0].changes[0].newContent).toContain('[wiki/sources/k.md]');
  });

  it('should read review state through a getter after the active root changes', async () => {
    let review = { cards: {}, flags: {} };
    const lookup = makeVocabLookup({ index: { get: () => null }, getReview: () => review });
    review = { cards: { alpha: { state: 'Review', stability: 2, due: '2030-01-01T00:00:00.000Z' } }, flags: {} };
    await expect(lookup({ word: 'alpha' })).resolves.toContain('2030-01-01');
  });

  it('should merge duplicate words into one change and deduplicate their examples', async () => {
    const fake = app();
    fake.knowledge.readDocument = async ({ path }) => path.startsWith('wiki/vocab/') ? { _tag: 'Err', error: { code: 'NOT_FOUND', message: 'not found' } } : { content: 'source', meta: { title: 'Source' } };
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 9, notify: () => undefined });
    await add({ entries: [
      { word: 'Echo', definition: '回声', example: 'First echo.' },
      { word: 'echo', definition: '回声', example: 'Second echo.' },
      { word: 'echo', definition: '回声', example: 'First echo.' },
    ] });
    expect(fake.proposals[0].changes).toHaveLength(1);
    expect(fake.proposals[0].changes[0].newContent.match(/First echo\./g)).toHaveLength(1);
    expect(fake.proposals[0].changes[0].newContent).toContain('Second echo.');
  });

  it('should append an unindexed existing note and use a unique suffix for a slug collision', async () => {
    const fake = app();
    fake.knowledge.readDocument = async ({ path }) => {
      if (path === 'wiki/vocab/don-t.md') return { content: buildNote({ word: 'don-t', definition: 'dash' }), meta: { title: 'Dash' } };
      if (path === 'wiki/vocab/orphan.md') return { content: buildNote({ word: 'orphan', definition: '孤儿' }), meta: { title: 'Orphan' } };
      return { _tag: 'Err', error: { code: 'NOT_FOUND', message: 'not found' } };
    };
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 10, notify: () => undefined });
    const result = await add({ entries: [
      { word: 'orphan', definition: '孤儿', example: 'Orphan example.' },
      { word: "don't", definition: '不要', example: "Don't overwrite." },
    ] });
    expect(fake.proposals[0].changes).toHaveLength(2);
    expect(fake.proposals[0].changes[0].newContent).toContain('Orphan example.');
    expect(fake.proposals[0].changes[1].path).toBe('wiki/vocab/don-t-2.md');
    expect(result).not.toMatch(/slug collision/i);
  });

  it('should abort path probing on read errors other than not found', async () => {
    const fake = app();
    fake.knowledge.readDocument = async () => ({ _tag: 'Err', error: { code: 'READ_FAILED', message: 'disk unavailable' } });
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 1, notify: () => undefined });
    await expect(add({ entries: [{ word: "don't", definition: '不要' }] })).rejects.toThrow(/disk unavailable/);
    expect(fake.proposals).toEqual([]);
  });

  it('should refuse to append when duplicate vocabulary notes make the target ambiguous', async () => {
    const fake = app();
    const add = makeVocabAdd({
      app: fake,
      index: { get: () => null, isAmbiguous: () => true },
      nextNumber: () => 1,
      notify: () => undefined,
    });
    await expect(add({ entries: [{ word: 'run', definition: '跑', example: 'Run.' }] })).rejects.toThrow(/duplicate vocabulary notes/u);
    expect(fake.proposals).toEqual([]);
  });

  it('should verify wiki sources with no more than four concurrent reads', async () => {
    let active = 0;
    let maximum = 0;
    const fake = app();
    fake.knowledge.readDocument = async ({ path }) => {
      if (path.startsWith('wiki/vocab/')) return { _tag: 'Err', error: { code: 'NOT_FOUND', message: 'not found' } };
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { content: 'source', meta: { title: path } };
    };
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 11, notify: () => undefined });
    await add({ entries: Array.from({ length: 8 }, (_, i) => ({ word: `word${String.fromCharCode(97 + i)}`, definition: 'x', example: 'x', source: { path: `wiki/sources/${i}.md` } })) });
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(4);
  });

  it('should reject malformed web source URLs and normalize valid example whitespace', async () => {
    const add = makeVocabAdd({ app: app(), index: { get: () => null }, nextNumber: () => 1, notify: () => undefined });
    await expect(add({ entries: [{ word: 'beta', definition: 'x', source: { url: 'https://example.com/a b' } }] })).rejects.toThrow(/invalid source/);
    await expect(add({ entries: [{ word: 'beta', definition: 'x', source: { url: 'https://example.com/<x>' } }] })).rejects.toThrow(/invalid source/);
  });

  it('should localize the tool result and proposal notice when the locale is Japanese', async () => {
    const notices = [];
    const fake = app({ outcome: 'applied' });
    fake.knowledge.readDocument = async () => ({ _tag: 'Err', error: { code: 'NOT_FOUND', message: 'not found' } });
    const add = makeVocabAdd({ app: fake, index: { get: () => null }, nextNumber: () => 12, notify: (message) => notices.push(message), locale: 'ja' });
    const result = await add({ entries: [{ word: 'alpha', definition: 'x' }] });
    await Promise.resolve();
    expect(result).toBe('レビューに提出しました #12：1語。');
    expect(notices[0]).toMatch(/#12/);
    expect(notices[0]).not.toMatch(/已应用/);
    expect(fake.proposals[0].description).toMatch(/^英単語帳 #12/);
  });
});
