import { build } from 'esbuild';
await build({
  entryPoints: [new URL('../index.mjs', import.meta.url).pathname],
  outfile: new URL('../dist/index.mjs', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  external: ['pg-native'],
});
