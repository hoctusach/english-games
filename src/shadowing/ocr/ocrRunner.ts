import { transcriptFromScreenshots, type OcrLine, type OcrResult } from '@/shadowing/ocr/ocrTranscript';

// Reads screenshots of YouTube's transcript panel on the device, with tesseract.js (an
// OCR engine compiled to WebAssembly). Its files are served from the app's own
// address (public/ocr, copied there by scripts/copy-ocr-assets.mjs), so nothing is
// sent anywhere and, once fetched, it works offline. This file is loaded only when
// the reader is used.

export interface OcrProgress {
  stage: 'loading' | 'reading';
  done: number;
  total: number;
}

export interface ScreenshotsResult extends OcrResult {
  images: number;
}

const MAX_WIDTH = 1800;

function asset(name: string): string {
  return new URL(`${import.meta.env.BASE_URL}ocr/${name}`, location.href).href;
}

// WebAssembly SIMD (every phone of the last few years): a faster build of the engine.
function hasSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to an <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Dark mode screenshots (light text on dark) are turned dark on light, which the
// engine reads far better; everything goes to grey.
async function prepare(file: File): Promise<{ canvas: HTMLCanvasElement; height: number }> {
  const bitmap = await loadBitmap(file);
  const width0 = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const height0 = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = width0 > MAX_WIDTH ? MAX_WIDTH / width0 : width0 < 700 ? 2 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width0 * scale);
  canvas.height = Math.round(height0 * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ('close' in bitmap) bitmap.close();

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const lowerFrom = Math.floor(canvas.height * 0.4) * canvas.width;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < px.length; i += 4) {
    const grey = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = grey;
    if (i / 4 >= lowerFrom) {
      sum += grey;
      count++;
    }
  }
  const dark = count > 0 && sum / count < 128;
  for (let i = 0; i < px.length; i += 4) {
    const grey = dark ? 255 - px[i] : px[i];
    px[i] = px[i + 1] = px[i + 2] = grey;
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, height: canvas.height };
}

export async function readScreenshots(
  files: File[],
  onProgress?: (progress: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<ScreenshotsResult> {
  const total = files.length;
  onProgress?.({ stage: 'loading', done: 0, total });
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    workerPath: asset('worker.min.js'),
    corePath: asset(hasSimd() ? 'core-simd.js' : 'core.js'),
    langPath: asset('').replace(/\/$/, ''),
    gzip: true,
    workerBlobURL: false,
  });

  try {
    const shots: { lines: OcrLine[]; height: number }[] = [];
    for (let i = 0; i < files.length; i++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      onProgress?.({ stage: 'reading', done: i, total });
      const { canvas, height } = await prepare(files[i]);
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const lines: OcrLine[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            lines.push({
              y: line.bbox.y0,
              words: line.words.map((w) => ({ text: w.text, confidence: w.confidence })),
            });
          }
        }
      }
      shots.push({ lines, height });
    }
    onProgress?.({ stage: 'reading', done: total, total });
    return { ...transcriptFromScreenshots(shots), images: total };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
