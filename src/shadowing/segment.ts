import type { Caption, Segment } from '@/shadowing/types';

// Turns transcript lines into sentences to practise. Caption lines are cut wherever
// the screen ran out of room ("so today we're going" / "to talk about"), so they are
// first split into words, each given a time by its position in its line, then
// joined into sentences:
// - with punctuation (subtitles made by people): at . ? ! — long sentences are cut
//   at a comma or line end;
// - without (YouTube's auto-generated captions): at line ends, a few seconds each;
// - always at a long pause.

interface Token {
  word: string;
  start: number;
  end: number;
  // last word of its caption line
  lineEnd: boolean;
  // silence after this word before the next one, in seconds
  gapAfter: number;
}

export interface SegmentOptions {
  // a sentence longer than this is cut at the next comma or line end…
  softMaxSeconds: number;
  softMaxWords: number;
  // …and anywhere past this
  hardMaxSeconds: number;
  hardMaxWords: number;
  // unpunctuated captions: close a chunk at a line end once it is this long
  chunkSeconds: number;
  // a silence this long always ends a sentence
  pauseSeconds: number;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  softMaxSeconds: 9,
  softMaxWords: 22,
  hardMaxSeconds: 14,
  hardMaxWords: 32,
  chunkSeconds: 3.5,
  pauseSeconds: 1.2,
};

const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'st.', 'jr.', 'sr.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'prof.',
  'mt.', 'no.', 'u.s.', 'u.k.', 'a.m.', 'p.m.', 'approx.', 'dept.',
]);

function endsSentence(word: string): boolean {
  const bare = word.replace(/["'”’)\]]+$/, '');
  if (!/[.?!…]$/.test(bare)) return false;
  return !ABBREVIATIONS.has(bare.toLowerCase());
}

function endsClause(word: string): boolean {
  return /[,;:]["'”’)]*$/.test(word);
}

function tokenize(captions: Caption[]): Token[] {
  const tokens: Token[] = [];
  captions.forEach((caption, i) => {
    const next = captions[i + 1];
    const end = Math.max(caption.start + 0.2, caption.end ?? next?.start ?? caption.start + 2);
    const words = caption.text.split(/\s+/).filter(Boolean);
    const chars = words.reduce((sum, word) => sum + word.length + 1, 0);
    let offset = 0;
    words.forEach((word, w) => {
      const from = caption.start + ((end - caption.start) * offset) / chars;
      offset += word.length + 1;
      const to = caption.start + ((end - caption.start) * offset) / chars;
      const last = w === words.length - 1;
      tokens.push({
        word,
        start: from,
        end: last ? end : to,
        lineEnd: last,
        gapAfter: last && next ? Math.max(0, next.start - end) : 0,
      });
    });
  });
  return tokens;
}

export function buildSegments(captions: Caption[], options: Partial<SegmentOptions> = {}): Segment[] {
  const o = { ...DEFAULT_SEGMENT_OPTIONS, ...options };
  const ordered = [...captions].filter((c) => c.text.trim()).sort((a, b) => a.start - b.start);
  const tokens = tokenize(ordered);
  if (!tokens.length) return [];

  // Treat the transcript as punctuated if sentence ends turn up regularly.
  const enders = tokens.filter((tk) => endsSentence(tk.word)).length;
  const punctuated = enders > 0 && tokens.length / enders < 40;

  const segments: Segment[] = [];
  let current: Token[] = [];
  const close = () => {
    if (!current.length) return;
    segments.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((tk) => tk.word).join(' '),
    });
    current = [];
  };

  tokens.forEach((tk, i) => {
    current.push(tk);
    const isLast = i === tokens.length - 1;
    if (isLast) return;
    const words = current.length;
    const seconds = tk.end - current[0].start;

    if (tk.gapAfter >= o.pauseSeconds) return close();
    if (seconds >= o.hardMaxSeconds || words >= o.hardMaxWords) return close();
    if (punctuated) {
      if (endsSentence(tk.word) && (words >= 2 || tk.lineEnd)) return close();
      const long = seconds >= o.softMaxSeconds || words >= o.softMaxWords;
      if (long && (endsClause(tk.word) || tk.lineEnd)) return close();
    } else if (tk.lineEnd && seconds >= o.chunkSeconds) {
      return close();
    }
  });
  close();

  return mergeTinySegments(segments);
}

// A lone "Okay." or "Yes!" between two long sentences is too short to practise on
// its own: join it to the sentence after it (or before, at the very end).
function mergeTinySegments(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const tiny = seg.text.split(' ').length <= 1 && seg.end - seg.start < 1;
    const next = segments[i + 1];
    if (tiny && next && next.start - seg.end < 0.8) {
      segments[i + 1] = { start: seg.start, end: next.end, text: `${seg.text} ${next.text}` };
      continue;
    }
    const prev = out[out.length - 1];
    if (tiny && !next && prev && seg.start - prev.end < 0.8) {
      out[out.length - 1] = { start: prev.start, end: seg.end, text: `${prev.text} ${seg.text}` };
      continue;
    }
    out.push(seg);
  }
  return out;
}

// ---------- editing ----------

export function mergeWithNext(segments: Segment[], index: number): Segment[] {
  const a = segments[index];
  const b = segments[index + 1];
  if (!a || !b) return segments;
  const merged: Segment = { start: a.start, end: Math.max(a.end, b.end), text: `${a.text} ${b.text}` };
  return [...segments.slice(0, index), merged, ...segments.slice(index + 2)];
}

// Cuts a sentence in two near its middle, preferring a punctuation mark; the cut
// time is placed by the share of letters before it.
export function splitSegment(segments: Segment[], index: number): Segment[] {
  const seg = segments[index];
  if (!seg) return segments;
  const words = seg.text.split(' ');
  if (words.length < 2) return segments;

  const total = seg.text.length;
  let best = -1;
  let bestScore = Infinity;
  let chars = 0;
  for (let w = 0; w < words.length - 1; w++) {
    chars += words[w].length + 1;
    const distance = Math.abs(chars / total - 0.5);
    const score = distance - (endsSentence(words[w]) ? 0.3 : endsClause(words[w]) ? 0.15 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = w;
    }
  }
  const headText = words.slice(0, best + 1).join(' ');
  const cut = seg.start + ((seg.end - seg.start) * (headText.length + 1)) / (total + 1);
  const head: Segment = { start: seg.start, end: cut, text: headText };
  const tail: Segment = { start: cut, end: seg.end, text: words.slice(best + 1).join(' ') };
  return [...segments.slice(0, index), head, tail, ...segments.slice(index + 1)];
}

export function removeSegment(segments: Segment[], index: number): Segment[] {
  if (segments.length <= 1) return segments;
  return segments.filter((_, i) => i !== index);
}

// ---------- helpers for the screens ----------

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// The sentence playing at `time`: the last one that has started.
export function segmentIndexAt(segments: Segment[], time: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= time + 0.05) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
