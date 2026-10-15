import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

describe('offline dictionary data', () => {
  it('should reproduce annotated ambiguity candidates and validate every reviewed surface against them', async () => {
    await promisify(execFile)('python3', ['scripts/build-ambiguous-inflections.py', '--check']);
    const generated = await import('../src/ambiguous-inflections.generated.mjs');
    const reviewed = await import('../src/ambiguous-inflections.reviewed.mjs');
    expect(generated.AMBIGUOUS_INFLECTION_METADATA).toMatchObject({ frequencyLimit: 5000, source: 'dict/*.mjs + data/en-wordfreq-30k.json' });
    expect(generated.AMBIGUOUS_INFLECTION_CANDIDATES.every((item) => item.surface && item.reasons.length > 0)).toBe(true);
    expect(reviewed.AMBIGUOUS_INFLECTION_DECISIONS).toHaveLength(38);
    expect(reviewed.AMBIGUOUS_INFLECTION_REVIEWS.map((item) => item.surface).sort()).toEqual(['bit', 'bound', 'does', 'feed', 'fell', 'felt', 'found', 'ground', 'lay', 'left', 'pants', 'rent', 'rose', 'saw', 'shot', 'spoke', 'wound']);
  });

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
    const t = (await import('../dict/t.mjs')).default;
    const u = (await import('../dict/u.mjs')).default;
    expect(r.run).toMatchObject({ p: expect.any(String), t: expect.stringContaining('跑'), r: expect.any(Number) });
    expect(r.run.d.split('\n').length).toBeLessThanOrEqual(2);
    expect(e.ephemeral).toMatchObject({ t: expect.stringContaining('短暂') });
    expect(c.candid).toMatchObject({ t: expect.stringContaining('坦白') });
    expect(c.candid.d.split('\n').every((line) => line.startsWith('adj.'))).toBe(true);
    expect(t.the.d).not.toMatch(/See Thee/iu);
    expect(t.the.d).toContain('individualize their meaning.');
    expect(t.the.d.split('\n').every((line) => !/\bor$/u.test(line))).toBe(true);
    expect(u.unanimous.d).toMatch(/^adj\. /u);
    expect(u.unity.d).toMatch(/^n\. /u);
    expect(`${u.unanimous.d}\n${u.unity.d}`).not.toMatch(/^(?:n|v|a|s|r) /mu);
    expect(s.serendipity).toMatchObject({ t: expect.stringContaining('偶然') });
    expect(a['alpha-beta']).toBeUndefined();
    for (const [word, entry] of Object.entries({ ...r, ...e, ...c, ...s, ...a })) {
      expect(word).toBe(word.toLowerCase());
      expect(String(entry.t ?? '').split('\n').some((line) => line.startsWith('[网络]'))).toBe(false);
    }
  });
});
