import { build } from 'esbuild';
import { readFile, unlink } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

const outfile = process.argv.includes('--check') ? 'main.mjs.check' : 'main.mjs';

await build({
  entryPoints: ['src/main.mjs'],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  charset: 'utf8',
  legalComments: 'none',
  banner: { js: '// English Vocab — code: MIT (see LICENSE). The bundled English word list is adapted from wordfreq 3.1.1\n// (Robyn Speer) and licensed CC BY-SA 4.0; attribution and source notes: data/LICENSE.md.\n// Offline dictionary chunks are derived from ECDICT (MIT); attribution and source notes: dict/LICENSE-ECDICT.md.' },
  sourcemap: false,
  minify: false,
  logLevel: 'silent',
});

if (process.argv.includes('--check')) {
  try {
    const [committed, rebuilt] = await Promise.all([readFile('main.mjs'), readFile(outfile)]);
    if (Buffer.compare(committed, rebuilt) !== 0) throw new Error('main.mjs is out of date; run pnpm build');
  } finally {
    await unlink(outfile).catch(() => undefined);
  }
}
