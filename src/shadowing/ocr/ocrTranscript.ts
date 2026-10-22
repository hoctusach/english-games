// Turns the lines an OCR engine read from screenshots of YouTube's "Transcript" panel
// into transcript text with times ("0:16\nand the captain…"), ready for the same
// parser as a pasted transcript.
//
// Screenshots overlap (each one scrolls the panel by a few lines) and the panel has
// things around the text: the phone's status bar, the video, the "Transcript" title,
// a search box, chapter headings, a "Sync to video" button floating over the text, the
// navigation bar. Each screenshot is read on its own, then the entries seen in several
// screenshots are merged by time, keeping the clearest reading of each.

export interface OcrWord {
  text: string;
  // 0–100, as the OCR engine rates its own reading
  confidence: number;
}

export interface OcrLine {
  // top edge of the line, in pixels
  y: number;
  words: OcrWord[];
}

export interface OcrEntry {
  start: number;
  text: string;
  // how clearly the text was read: higher is better
  score: number;
}

export interface OcrGap {
  from: number;
  to: number;
}

// words read less surely than this are noise (the floating button, cut-off edges)
const MIN_WORD_CONFIDENCE = 25;
// a time that jumps further than this inside one screenshot is a misread
const MAX_JUMP_SECONDS = 300;
// a pause between entries longer than this probably means a screenshot is missing
export const DEFAULT_GAP_SECONDS = 30;
// a time with a lost colon is believed only when it follows the previous entry this closely
const LOOSE_WINDOW_SECONDS = 90;

// characters the engine reads where a digit is, with the digit they stand for
const LOOKALIKE_DIGITS: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', '|': '1', g: '8', S: '5', s: '5', B: '8', Z: '2', z: '2' };
const DIGITISH = '[0-9OoIl|gSsBZz]';
const TIME_LIKE = new RegExp(`^${DIGITISH}{1,2}(?::${DIGITISH}{2}){1,2}$`);
// a pill whose colon was lost or misread: "049", "11.17", "1;05"
const TIME_LOOSE = new RegExp(`^(${DIGITISH}{1,2})[:.;,]?(${DIGITISH}{2})$`);

function digitsOf(text: string): string {
  return text.replace(/[A-Za-z|]/g, (c) => LOOKALIKE_DIGITS[c] ?? c);
}

function secondsOf(clock: string): number | null {
  const parts = clock.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[1] < 60 ? parts[0] * 60 + parts[1] : null;
  return parts[1] < 60 && parts[2] < 60 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : null;
}

// The clock text ("m:ss" / "h:mm:ss") a token stands for, with misread digits put right.
// With `loose`, also a time whose colon was lost ("049" is 0:49) or misread ("11.17").
function clockOf(token: string, loose: boolean): string | null {
  const bare = token.replace(/[^0-9A-Za-z|:.;,]/g, '');
  if (TIME_LIKE.test(bare)) return digitsOf(bare);
  if (!loose || !/\d/.test(bare)) return null;
  const match = bare.match(TIME_LOOSE);
  return match ? `${digitsOf(match[1])}:${digitsOf(match[2])}` : null;
}

// "0:16", "10:42", "1:02:03" — also as the OCR tends to misread digits (O for 0, l for 1).
export function parseTimeToken(token: string, loose = false): number | null {
  const clock = clockOf(token, loose);
  return clock === null ? null : secondsOf(clock);
}

// digits the engine mixes up in these small pills
const CONFUSABLE: Record<string, string> = { '0': '86', '1': '7', '2': '47', '3': '85', '4': '29', '5': '63', '6': '580', '7': '12', '8': '360', '9': '04' };

// Other times a token may really have been, one misread digit away.
function repairedTimes(token: string, loose: boolean): number[] {
  const clock = clockOf(token, loose);
  if (!clock) return [];
  const out: number[] = [];
  for (let i = 0; i < clock.length; i++) {
    for (const digit of CONFUSABLE[clock[i]] ?? '') {
      const seconds = secondsOf(clock.slice(0, i) + digit + clock.slice(i + 1));
      if (seconds !== null) out.push(seconds);
    }
  }
  return out;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// Capital I read as a lowercase l or a bar: "l'm" → "I'm", a lone "l" → "I".
function fixWord(text: string): string {
  if (/^[Il|]$/.test(text)) return 'I';
  const contraction = text.match(/^[l|]([’'](?:m|ll|d|ve)\b.*)$/);
  if (contraction) return `I${contraction[1]}`;
  return text.replace(/^[|]+(?=\S)/, '');
}

const CHAPTER = /^(?:chapter|chương|phần)\s*\d+\s*[:.\-–—]?/i;

// The "Sync to video" button floats over the text: its three words are not part of it.
function withoutFloatingButton(words: OcrWord[]): OcrWord[] {
  const out: OcrWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const [a, b, c] = [words[i], words[i + 1], words[i + 2]].map((w) => w?.text.toLowerCase().replace(/\W/g, ''));
    if (a === 'sync' && b === 'to' && c === 'video') {
      i += 2;
      continue;
    }
    out.push({ ...words[i], text: words[i].text.trim() });
  }
  return out.filter((w) => w.text);
}

function lineText(line: OcrLine): string {
  return line.words.map((w) => w.text).join(' ').trim();
}

// The line of the panel's own title ("Transcript"), or of its search box: the text of
// the transcript starts below the last one of these.
function headerIndex(lines: OcrLine[], height?: number): number {
  let found = -1;
  lines.forEach((line, i) => {
    if (height && line.y > height * 0.6) return;
    if (!height && i > 14) return;
    const text = lineText(line).toLowerCase();
    if (/^\W{0,3}transcript\b/.test(text) || /^search\s*(in\s*)?transcript/.test(text)) found = i;
  });
  return found;
}

// The time a pill's text stands for, given the time of the entry before it (-1 for the
// first one in a screenshot): times only go forward, so a reading that goes back or
// jumps far ahead is put right if one misread digit explains it, else it's not a time.
function pickTime(token: string, hasText: boolean, reference: number, following?: number): number | null {
  const fits = (t: number, window: number) => reference < 0 || (t >= reference && t - reference <= window);
  const strict = parseTimeToken(token);
  if (strict !== null && fits(strict, MAX_JUMP_SECONDS)) return strict;
  if (reference >= 0 && hasText) {
    const loose = parseTimeToken(token, true);
    if (loose !== null && fits(loose, LOOSE_WINDOW_SECONDS)) return loose;
  }
  if (!hasText) return null;
  if (reference < 0) {
    // the first pill of a screenshot has nothing before it: a time with a lost colon is
    // believed when the next time on the screen comes soon after it
    const loose = parseTimeToken(token, true);
    return loose !== null && following !== undefined && loose <= following && following - loose <= 60 ? loose : null;
  }
  const repairs = repairedTimes(token, strict === null)
    .filter((t) => fits(t, LOOSE_WINDOW_SECONDS))
    .sort((a, b) => a - b);
  // one candidate, or several that all agree, is believable; a crowd of them is a guess
  return repairs.length > 0 && repairs.length <= 2 ? repairs[0] : null;
}

// The time of the first pill below `line` that reads as a proper time.
function nextTime(lines: OcrLine[], line: OcrLine): number | undefined {
  for (let i = lines.indexOf(line) + 1; i < lines.length; i++) {
    const first = lines[i].words[0];
    const t = first ? parseTimeToken(first.text) : null;
    if (t !== null) return t;
  }
  return undefined;
}

// The entries one screenshot shows, in order of time.
export function entriesFromLines(lines: OcrLine[], height?: number): OcrEntry[] {
  const ordered = [...lines].sort((a, b) => a.y - b.y);
  const first = headerIndex(ordered, height) + 1;
  const bottom = height ? height * 0.95 : Infinity;

  const entries: OcrEntry[] = [];
  let current: { start: number; words: OcrWord[] } | null = null;
  let inChapter = false;
  let lastStart = -1;

  const close = () => {
    if (!current) return;
    const kept = current.words.filter((w) => w.confidence >= MIN_WORD_CONFIDENCE);
    const text = kept
      .map((w) => fixWord(w.text))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      const score = kept.reduce((sum, w) => sum + (w.confidence >= 70 ? 1 : w.confidence >= 45 ? 0.5 : 0.1), 0);
      entries.push({ start: current.start, text, score });
      lastStart = current.start;
    }
    current = null;
  };

  for (const line of ordered.slice(first)) {
    if (line.y > bottom) continue;
    const words = line.words.filter((w) => w.text.trim());
    if (!words.length) continue;

    const clean = withoutFloatingButton(words);
    const text = clean.map((w) => w.text).join(' ');
    if (!text) continue;

    if (CHAPTER.test(text)) {
      close();
      inChapter = true;
      continue;
    }

    const reference: number = current ? (current as { start: number }).start : lastStart;
    const stamp: number | null = clean.length ? pickTime(clean[0].text, clean.length > 1, reference, nextTime(ordered, line)) : null;
    if (stamp === null && clean.length > 1 && parseTimeToken(clean[0].text) !== null) {
      // a pill read as a time that cannot be right: its text can't be placed, so leave it out
      close();
      inChapter = false;
      continue;
    }
    if (stamp !== null) {
      close();
      inChapter = false;
      current = { start: stamp, words: clean.slice(1) };
      continue;
    }
    if (inChapter || !current) continue;
    current.words.push(...clean);
  }
  close();
  return entries;
}

// Entries seen in more than one screenshot are kept once, as the clearest reading.
export function mergeEntries(batches: OcrEntry[][]): OcrEntry[] {
  const byTime = new Map<number, OcrEntry>();
  for (const batch of batches) {
    for (const entry of batch) {
      const seen = byTime.get(entry.start);
      if (!seen || entry.score > seen.score || (entry.score === seen.score && entry.text.length > seen.text.length)) {
        byTime.set(entry.start, entry);
      }
    }
  }
  return [...byTime.values()].sort((a, b) => a.start - b.start);
}

export function findGaps(entries: OcrEntry[], maxSeconds = DEFAULT_GAP_SECONDS): OcrGap[] {
  const gaps: OcrGap[] = [];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].start - entries[i - 1].start > maxSeconds) {
      gaps.push({ from: entries[i - 1].start, to: entries[i].start });
    }
  }
  return gaps;
}

export function toTranscriptText(entries: OcrEntry[]): string {
  return entries.map((e) => `${formatTime(e.start)}\n${e.text}`).join('\n');
}

export interface OcrResult {
  text: string;
  entries: OcrEntry[];
  gaps: OcrGap[];
}

// All screenshots at once: each is a list of lines and the image's height.
export function transcriptFromScreenshots(shots: { lines: OcrLine[]; height?: number }[]): OcrResult {
  const entries = mergeEntries(shots.map((shot) => entriesFromLines(shot.lines, shot.height)));
  return { text: toTranscriptText(entries), entries, gaps: findGaps(entries) };
}
