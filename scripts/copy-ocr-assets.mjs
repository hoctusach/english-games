// Copies what the in-app screenshot reader (tesseract.js) needs into public/ocr/, so
// the app serves it from its own address: nothing is fetched from a third party and
// no binary files are kept in git (public/ocr/ is ignored). Runs before dev and build.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');
const nm = (...parts) => join(root, 'node_modules', ...parts);

const files = [
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  // the same engine with and without WebAssembly SIMD (older phones)
  [nm('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'core-simd.js'],
  [nm('tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'core.js'],
  [nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];

mkdirSync(out, { recursive: true });
let copied = 0;
for (const [from, name] of files) {
  if (!existsSync(from)) {
    console.warn(`copy-ocr-assets: missing ${from} (run npm install)`);
    continue;
  }
  copyFileSync(from, join(out, name));
  copied++;
}
writeFileSync(
  join(out, 'NOTICE.txt'),
  'Screenshot reader: tesseract.js, tesseract.js-core and the English language data are\nApache-2.0 licensed (https://github.com/naptha/tesseract.js).\n',
);
console.log(`copy-ocr-assets: ${copied}/${files.length} files in public/ocr`);
