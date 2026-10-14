import type { Segment } from '@/shadowing/types';

// "Hint" text: each word keeps its first letter, the other letters become blanks,
// punctuation stays — "Hello, world!" → "H____, w____!". Enough to follow along
// without reading the sentence off the screen.
export function maskWord(word: string): string {
  let seenLetter = false;
  return Array.from(word)
    .map((ch) => {
      if (!/[A-Za-z0-9\u00C0-\u024F]/.test(ch)) return ch;
      if (!seenLetter) {
        seenLetter = true;
        return ch;
      }
      return '_';
    })
    .join('');
}

export interface TimedWord {
  word: string;
  // seconds into the video when this word is (about) reached
  at: number;
}

// Captions only time whole lines, so each word is placed by the share of letters
// before it — close enough to light the words up as they are spoken.
export function timedWords(segment: Segment): TimedWord[] {
  const words = segment.text.split(/\s+/).filter(Boolean);
  const total = words.reduce((sum, word) => sum + word.length + 1, 0) || 1;
  const span = Math.max(0, segment.end - segment.start);
  let offset = 0;
  return words.map((word) => {
    const at = segment.start + (span * offset) / total;
    offset += word.length + 1;
    return { word, at };
  });
}
