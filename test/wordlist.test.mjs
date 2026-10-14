import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('word frequency data', () => {
  it('should provide thirty thousand lowercase unique filtered words when generated from wordfreq', async () => {
    const words = JSON.parse(await readFile('data/en-wordfreq-30k.json', 'utf8'));
    expect(words).toHaveLength(30000);
    expect(new Set(words).size).toBe(30000);
    expect(words.every((word) => /^[a-z]+(?:'[a-z]+)*$/u.test(word))).toBe(true);
    expect(words.every((word) => word === word.toLowerCase())).toBe(true);
  });

  it('should document data attribution and keep package code licensed as MIT when data is CC BY-SA', async () => {
    const license = await readFile('data/LICENSE.md', 'utf8');
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    expect(pkg.license).toBe('MIT');
    expect(license).toContain('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(license).toContain('Robyn Speer');
    expect(license).toContain('https://github.com/rspeer/wordfreq');
    expect(license).toContain('wordfreq` 3.1.1');
    expect(license).toContain('Google Books Ngrams');
    expect(license).toContain('OpenSubtitles');
    expect(license).toContain('SUBTLEX');
    expect(license).toContain('Leeds Internet Corpus');
    expect(license).toContain('Wikipedia');
    expect(license).toContain('ParaCrawl');
  });
});
