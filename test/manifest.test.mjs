import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'plugin.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

// Auton Knowledge's loader rule (packages/modules/plugins plugin-loader.service.ts NAME_RE):
// a name with a space is refused at install time ("must match /^[a-zA-Z0-9_-]+$/").
describe('plugin.json', () => {
  it('should use a manifest name the host accepts when the plugin is installed', () => {
    expect(manifest.name).toMatch(/^[a-zA-Z0-9_-]+$/u);
  });

  it('should declare the runtime entry, permissions and the same version as package.json', () => {
    expect(manifest.runtime).toEqual({ target: 'auton-knowledge', apiVersion: 1, entry: 'main.mjs' });
    expect(manifest.permissions).toEqual(['knowledge.read', 'knowledge.propose', 'agent.tools']);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.version).toBe('0.7.0');
  });
});
