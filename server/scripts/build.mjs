import { build } from 'esbuild';
import { cp } from 'node:fs/promises';
await build({
  entryPoints: [new URL('../index.mjs', import.meta.url).pathname],
  outfile: new URL('../dist/index.mjs', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    js: "import { createRequire as quotesCreateRequire } from 'node:module'; const require = quotesCreateRequire(import.meta.url);",
  },
  external: ['pg-native'],
});
await cp(new URL('../assets/', import.meta.url), new URL('../dist/assets/', import.meta.url), { recursive: true });
