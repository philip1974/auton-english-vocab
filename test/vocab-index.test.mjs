import { describe, expect, it } from 'vitest';
import { VocabIndex } from '../src/vocab-index.mjs';
import { buildNote } from '../src/note-format.mjs';

describe('vocab index', () => {
  it('should read changed vocab documents by content hash when refreshing', async () => {
    const reads = [];
    const docs = new Map([
      ['wiki/vocab/a.md', { hash: 'h1', title: 'A', content: buildNote({ word: 'alpha', definition: 'a' }) }],
      ['wiki/vocab/b.md', { hash: 'h2', title: 'B', content: buildNote({ word: 'beta', definition: 'b' }) }],
    ]);
    const index = new VocabIndex({
      async listDocuments() {
        return [...docs.entries()].map(([path, doc]) => ({ path, title: doc.title, revision: { contentHash: doc.hash } }));
      },
      async readDocument({ path }) {
        reads.push(path);
        return { meta: { path, title: docs.get(path).title }, content: docs.get(path).content };
      },
    }, { batchSize: 1 });
    await index.refresh();
    docs.get('wiki/vocab/b.md').hash = 'h3';
    docs.get('wiki/vocab/b.md').title = 'New heading';
    await index.refresh();
    expect(reads).toEqual(['wiki/vocab/a.md', 'wiki/vocab/b.md', 'wiki/vocab/b.md']);
  });

  it('should drop removed cached paths and keep the first duplicate word when refreshing', async () => {
    let metas = [
      { path: 'wiki/vocab/one.md', title: 'One', revision: {} },
      { path: 'wiki/vocab/two.md', title: 'Two', revision: {} },
    ];
    const index = new VocabIndex({
      async listDocuments() { return metas; },
      async readDocument({ path }) {
        return { meta: { path }, content: buildNote({ word: 'same', definition: path }) };
      },
    });
    await index.refresh();
    metas = [{ path: 'wiki/vocab/two.md', title: 'Two', revision: {} }];
    const result = await index.refresh();
    expect(result.entries).toHaveLength(1);
    expect([...index.cache.keys()]).toEqual(['wiki/vocab/two.md']);
  });

  it('should keep word as the card key when title changes', async () => {
    const note = buildNote({ word: 'stable', definition: 'fixed' }).replace('# stable', '# user heading');
    const index = new VocabIndex({
      async listDocuments() { return [{ path: 'wiki/vocab/stable.md', title: 'User Heading', revision: { contentHash: 'h' } }]; },
      async readDocument() { return { content: note }; },
    });
    await index.refresh();
    expect(index.get('stable')).toMatchObject({ word: 'stable', title: 'User Heading' });
  });

  it('should report invalid notes when word frontmatter is missing', async () => {
    const index = new VocabIndex({
      async listDocuments() { return [{ path: 'wiki/vocab/broken.md', title: 'Broken', revision: { contentHash: 'h' } }]; },
      async readDocument() { return { content: '---\ntype: vocab\ndefinition: x\n---\n# x' }; },
    });
    const result = await index.refresh();
    expect(result.invalid[0]).toMatchObject({ path: 'wiki/vocab/broken.md' });
  });

  it('should unwrap ipc errors when list documents fails', async () => {
    const index = new VocabIndex({ async listDocuments() { return { _tag: 'Err', error: 'bad' }; } });
    await expect(index.refresh()).rejects.toThrow(/bad/);
  });

  it('should keep refreshing other notes and report one invalid item when a document read fails', async () => {
    const index = new VocabIndex({
      async listDocuments() { return [
        { path: 'wiki/vocab/a.md', title: 'A', revision: { contentHash: 'h1' } },
        { path: 'wiki/vocab/b.md', title: 'B', revision: { contentHash: 'h2' } },
      ]; },
      async readDocument({ path }) { return path.endsWith('/a.md') ? { _tag: 'Err', error: 'read bad' } : { content: buildNote({ word: 'beta', definition: 'b' }) }; },
    });
    const result = await index.refresh();
    expect(result.entries.map((entry) => entry.word)).toEqual(['beta']);
    expect(result.invalid[0]).toMatchObject({ path: 'wiki/vocab/a.md', error: expect.stringContaining('read bad') });
  });

  it('should publish partial entries and serialize a coalesced refresh requested while busy', async () => {
    let version = 1;
    let release;
    let markStarted;
    const firstRead = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { markStarted = resolve; });
    const updates = [];
    const index = new VocabIndex({
      async listDocuments() { return [{ path: 'wiki/vocab/a.md', title: 'A', revision: { contentHash: `h${version}` } }]; },
      async readDocument() { const requested = version; markStarted(); if (requested === 1) await firstRead; return { content: buildNote({ word: requested === 1 ? 'alpha' : 'beta', definition: 'x' }) }; },
    }, { onUpdate: (result) => updates.push(result.entries.map((entry) => entry.word)) });
    const first = index.refresh();
    await started;
    version = 2;
    const second = index.refresh();
    release();
    await Promise.all([first, second]);
    expect(updates).toContainEqual(['alpha']);
    expect(index.get('beta')).toBeTruthy();
  });
});
