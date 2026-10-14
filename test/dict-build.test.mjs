import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('offline dictionary data', () => {
  it('should commit deterministic letter chunks with a matching manifest and license', async () => {
    const files = await readdir('dict');
    const chunks = files.filter((name) => /^[a-z]\.mjs$/u.test(name)).sort();
    expect(chunks).toHaveLength(26);
    const manifest = JSON.parse(await readFile('dict/manifest.json', 'utf8'));
    expect(manifest.source).toMatchObject({
      url: 'https://github.com/skywind3000/ECDICT',
      commit: 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b',
    });
    let total = 0;
    for (const file of chunks) {
      const letter = file[0];
      const content = await readFile(`dict/${file}`);
      total += manifest.chunks[letter].count;
      expect(content.byteLength).toBe(manifest.chunks[letter].bytes);
      expect(content.byteLength).toBeLessThanOrEqual(1_500_000);
      expect(createHash('sha256').update(content).digest('hex')).toBe(manifest.chunks[letter].sha256);
    }
    expect(total).toBe(manifest.total);
    expect(manifest.maxChunkBytes).toBeLessThanOrEqual(1_500_000);
    const license = await readFile('dict/LICENSE-ECDICT.md', 'utf8');
    expect(license).toContain('MIT License');
    expect(license).toContain('https://github.com/skywind3000/ECDICT');
  });

  it('should include expected sample words and exclude unsupported keys and network translation lines', async () => {
    const r = (await import('../dict/r.mjs')).default;
    const e = (await import('../dict/e.mjs')).default;
    const c = (await import('../dict/c.mjs')).default;
    const s = (await import('../dict/s.mjs')).default;
    const a = (await import('../dict/a.mjs')).default;
    expect(r.run).toMatchObject({ p: expect.any(String), t: expect.stringContaining('跑'), r: expect.any(Number) });
    expect(r.run.d.split('\n').length).toBeLessThanOrEqual(2);
    expect(e.ephemeral).toMatchObject({ t: expect.stringContaining('短暂') });
    expect(c.candid).toMatchObject({ t: expect.stringContaining('坦白') });
    expect(s.serendipity).toMatchObject({ t: expect.stringContaining('偶然') });
    expect(a['alpha-beta']).toBeUndefined();
    for (const [word, entry] of Object.entries({ ...r, ...e, ...c, ...s, ...a })) {
      expect(word).toBe(word.toLowerCase());
      expect(String(entry.t ?? '').split('\n').some((line) => line.startsWith('[网络]'))).toBe(false);
    }
  });
});
