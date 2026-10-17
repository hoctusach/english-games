import type { Caption, TranscriptFormat } from '@/shadowing/types';

// Reads a transcript the player pasted or picked as a file:
// - YouTube's "Show transcript" panel copied as text: a time line ("0:05", "1:02:07")
//   then the words, or both on one line ("0:05 hello there");
// - .srt subtitle files;
// - .vtt subtitle files, including YouTube's auto-generated ones whose cues repeat
//   the previous line ("rolling" captions).
// Captions come back in time order, cleaned of tags, sound labels and entities.

export interface ParsedTranscript {
  format: TranscriptFormat;
  captions: Caption[];
}

const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?`;
// a time alone on its line, maybe in brackets: "0:05", "[01:02]", "(1:02:03)"
const STAMP_LINE = new RegExp(String.raw`^[\[(]?(${TIME})[\])]?$`);
// a time then the words: "0:05 hello", "[0:05] hello", "0:05 - hello"
const STAMP_TEXT = new RegExp(String.raw`^[\[(]?(${TIME})[\])]?\s*(?:[-–—:|]\s*)?(\S.*)$`);
// the screen-reader label YouTube copies along with each time:
// "5 seconds", "1 minute, 5 seconds", "2 giây", "1 phút, 5 giây"
const SPOKEN_DURATION =
  /^(?:\d+\s+(?:hours?|minutes?|seconds?|giờ|phút|giây)(?:\s*,\s*|\s+|$))+$/i;
// chapter headings YouTube puts between the lines: "Chapter 2: Benefits of new habits"
const CHAPTER = /^(?:chapter|chương|phần)\s+\d+\s*[:.\-–—]/i;
const ARROW = /(\d[\d:.,]*)\s*-->\s*(\d[\d:.,]*)/;

export function parseTimestamp(value: string): number | null {
  const parts = value.trim().replace(',', '.').split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    if (!/^\d+(?:\.\d+)?$/.test(part)) return null;
    seconds = seconds * 60 + parseFloat(part);
  }
  return Number.isFinite(seconds) ? seconds : null;
}

export function parseTranscript(raw: string): ParsedTranscript | null {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return null;
  if (/^\s*WEBVTT/.test(text)) return wrap('vtt', parseCues(text));
  if (ARROW.test(text)) return wrap('srt', parseCues(text));
  return wrap('youtube', parseYouTubeCopy(text));
}

function wrap(format: TranscriptFormat, captions: Caption[]): ParsedTranscript | null {
  return captions.length ? { format, captions } : null;
}

// ---------- YouTube "Show transcript" copy ----------

function parseYouTubeCopy(text: string): Caption[] {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/ /g, ' ').trim())
    .filter(Boolean);

  // A line of speech can start with a time ("10:30 is fine"), so pick the layout
  // from the whole text: times on their own lines, or times leading each line.
  const alone = lines.filter((line) => STAMP_LINE.test(line)).length;
  const inline = lines.filter((line) => !STAMP_LINE.test(line) && STAMP_TEXT.test(line)).length;
  const timesAlone = alone >= inline;

  const raw: { start: number; parts: string[] }[] = [];
  for (const line of lines) {
    const stamp = line.match(STAMP_LINE);
    const lead = timesAlone ? null : line.match(STAMP_TEXT);
    const time = stamp ? parseTimestamp(stamp[1]) : lead ? parseTimestamp(lead[1]) : null;
    const last = raw[raw.length - 1];
    if (time !== null && (!last || time >= last.start)) {
      raw.push({ start: time, parts: lead && !stamp ? [lead[2]] : [] });
    } else if (last && !SPOKEN_DURATION.test(line) && !CHAPTER.test(line)) {
      last.parts.push(line);
    }
    // lines before the first time ("Transcript", "Search in video", the language
    // menu) are not part of the transcript
  }

  // Each line lasts until the next one starts. Measured before sound labels are
  // dropped, so a line before "[Music]" doesn't run on through the music.
  const captions: Caption[] = [];
  raw.forEach((entry, i) => {
    const next = raw[i + 1];
    const words = cleanCaption(entry.parts.join(' '));
    if (!words) return;
    const end = next ? next.start : entry.start + estimateSeconds(words);
    captions.push({ start: entry.start, end: Math.max(end, entry.start + 0.3), text: words });
  });
  return captions;
}

// About how long a line takes to say, for the last line (nothing follows it).
function estimateSeconds(text: string): number {
  return Math.max(1.5, text.split(/\s+/).length * 0.45 + 0.6);
}

// ---------- .srt / .vtt ----------

function parseCues(text: string): Caption[] {
  // Read line by line rather than by blank-line blocks: YouTube's cues can hold a
  // line with just a space, which a block split would take for a cue break.
  const cues: { start: number; end: number; lines: string[] }[] = [];
  let cue: (typeof cues)[number] | null = null;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const match = line.match(ARROW);
    if (match) {
      const start = parseTimestamp(match[1]);
      const end = parseTimestamp(match[2]);
      cue = start !== null && end !== null ? { start, end, lines: [] } : null;
      if (cue) cues.push(cue);
    } else if (line === '') {
      cue = null; // headers, NOTE blocks, cue numbers and ids sit outside cues
    } else if (cue && line.trim() && !(/^\d+$/.test(line.trim()) && ARROW.test(lines[i + 1] ?? ''))) {
      cue.lines.push(line);
    }
  });

  const captions: Caption[] = [];
  // the lines the previous cue showed, to drop the repeats of rolling captions
  let shown: string[] = [];
  for (const { start, end, lines: raw } of cues) {
    const cueLines = raw.map((line) => stripTags(line).trim()).filter(Boolean);
    const fresh = cueLines.filter((line) => !shown.includes(line));
    if (cueLines.length) shown = cueLines;
    const words = cleanCaption(fresh.join(' '));
    if (!words) continue;
    captions.push({ start, end: Math.max(end, start + 0.3), text: words });
  }

  captions.sort((a, b) => a.start - b.start);
  return captions;
}

function stripTags(line: string): string {
  return line
    .replace(/<[^>]*>/g, '') // <i>, <c.colorE5E5E5>, <00:00:01.500>
    .replace(/\{\\[^}]*\}/g, ''); // {\an8}
}

// ---------- cleaning ----------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    const known = ENTITIES[name.toLowerCase()];
    if (known) return known;
    if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return whole;
  });
}

// Drops what isn't speech: [Music], (applause), ♪ notes, ">>" speaker changes, and
// leading "- " / "NAME:" speaker markers.
export function cleanCaption(text: string): string {
  return decodeEntities(text)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[^)]*\b(?:music|applause|laugh\w*|cheer\w*|sigh\w*|inaudible|silence|noise)\b[^)]*)\)/gi, ' ')
    .replace(/[♪♫♬]/g, ' ')
    .replace(/>>+/g, ' ')
    .replace(/^\s*[-–—]\s+/, '')
    .replace(/^\s*[A-Z][A-Z .'-]{1,24}:\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
