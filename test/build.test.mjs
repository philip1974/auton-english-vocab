import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);

describe('build output', () => {
  it('should rebuild main.mjs deterministically when sources are unchanged', async () => {
    await exec('node', ['build.mjs']);
    const before = await readFile('main.mjs', 'utf8');
    await exec('node', ['build.mjs']);
    const after = await readFile('main.mjs', 'utf8');
    expect(after).toBe(before);
  });

  it('should check the committed bundle without overwriting a stale artifact', async () => {
    const before = await readFile('main.mjs', 'utf8');
    await exec('node', ['build.mjs', '--check']);
    expect(await readFile('main.mjs', 'utf8')).toBe(before);
  });

  it('should document the missing host open document capability as a known limitation', async () => {
    const readme = await readFile('README.md', 'utf8');
    expect(readme).toContain('宿主目前没有向运行时插件开放“打开知识库文档”API');
  });

  it('should scope every style to the plugin panel and use Auton Knowledge theme tokens', async () => {
    const css = await readFile('styles.css', 'utf8');
    expect(css).toContain('[data-plugin-panel="dev.auton.english-vocab:english-vocab"]');
    expect(css).toContain('var(--agent-color-bg-elevated');
    expect(css).toContain('var(--agent-color-text-primary');
    expect(css).toContain('var(--agent-color-accent');
    expect(css).toContain('var(--agent-color-danger');
    expect(css).not.toMatch(/--background-|--text-normal|--interactive-accent/);
    const scope = '[data-plugin-panel="dev.auton.english-vocab:english-vocab"]';
    const cardScope = '.ev-reading-card';
    for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|})([^{}]+)\{/g)) {
      for (const selector of match[1].split(',')) {
        const trimmed = selector.trim();
        expect(trimmed.startsWith(scope) || trimmed.startsWith(cardScope)).toBe(true);
      }
    }
  });
});
