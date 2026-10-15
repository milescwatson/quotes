import { build } from 'esbuild';
import { cp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
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
  external: ['pg-native', 'sharp'],
});
await cp(new URL('../assets/', import.meta.url), new URL('../dist/assets/', import.meta.url), { recursive: true });

// Sharp is native and must remain external to esbuild. For Lambda, supply a
// separately installed Linux ARM64 runtime; local verification uses host modules.
const runtime = process.env.SHARP_RUNTIME_DIR || new URL('../node_modules/', import.meta.url).pathname;
const copied = new Set();
async function copyPackage(name, optional = false) {
  if (copied.has(name)) return;
  let manifest;
  try { manifest = JSON.parse(await readFile(join(runtime, name, 'package.json'), 'utf8')); }
  catch (error) { if (optional && error.code === 'ENOENT') return; throw error; }
  copied.add(name);
  await cp(join(runtime, name), new URL(`node_modules/${name}`, output), { recursive: true });
  for (const dependency of Object.keys(manifest.dependencies || {})) await copyPackage(dependency);
  for (const dependency of Object.keys(manifest.optionalDependencies || {})) await copyPackage(dependency, true);
}
await copyPackage('sharp');
if (process.env.SHARP_RUNTIME_DIR && !copied.has('@img/sharp-linux-arm64')) throw Error('Linux ARM64 Sharp runtime is required for Lambda.');
