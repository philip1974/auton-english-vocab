import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'styles.css'), 'utf8');

// Auton Knowledge defines --agent-border-hairline as a whole border shorthand
// (`border: var(--agent-border-hairline)`); `var(--agent-border-hairline) solid <color>`
// is invalid at computed-value time and the browser drops the border entirely.
describe('styles.css', () => {
  it('should use the host hairline token as a whole border value when drawing borders', () => {
    expect(css).not.toMatch(/var\(--agent-border-hairline[^)]*\)\s+solid/u);
    expect(css).toMatch(/var\(--agent-border-hairline, 1px solid /u);
  });

  it('should avoid literal color fallbacks in plugin styles', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba\(|\bgray\b/u);
  });

  it('should apply context source text and link styling inside reading cards', () => {
    expect(css).toMatch(/\.ev-reading-card \.ev-context-source\s*\{/u);
    expect(css).toMatch(/\.ev-reading-card \.ev-context-source-link::after/u);
    expect(css).toMatch(/\.ev-reading-card \.ev-context-source-text/u);
  });
});
