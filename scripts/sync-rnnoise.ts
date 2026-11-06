/**
 * Copy the RNNoise worklet and WASM from @sapphi-red/web-noise-suppressor into
 * public/vendor/rnnoise/, where the voice service loads them (an AudioWorklet
 * module has to be a real URL). Run after upgrading the package:
 *   bun scripts/sync-rnnoise.ts
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const from = join(import.meta.dir, '..', 'node_modules', '@sapphi-red', 'web-noise-suppressor', 'dist');
const to = join(import.meta.dir, '..', 'public', 'vendor', 'rnnoise');
mkdirSync(to, { recursive: true });
for (const [src, dest] of [
  ['rnnoise/workletProcessor.js', 'rnnoiseWorklet.js'],
  ['rnnoise.wasm', 'rnnoise.wasm'],
  ['rnnoise_simd.wasm', 'rnnoise_simd.wasm'],
] as const) {
  copyFileSync(join(from, src), join(to, dest));
  console.log(`public/vendor/rnnoise/${dest}`);
}
