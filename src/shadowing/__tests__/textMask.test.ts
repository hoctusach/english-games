import { describe, expect, it } from 'vitest';
import { maskWord, timedWords } from '@/shadowing/textMask';

describe('maskWord', () => {
  it('keeps the first letter and punctuation', () => {
    expect(maskWord('Hello,')).toBe('H____,');
    expect(maskWord('"world!"')).toBe('"w____!"');
    expect(maskWord("don't")).toBe("d__'_");
    expect(maskWord('I')).toBe('I');
    expect(maskWord('café')).toBe('c___');
    expect(maskWord('—')).toBe('—');
  });
});

describe('timedWords', () => {
  it('spreads words over the sentence by letters', () => {
    const words = timedWords({ start: 10, end: 14, text: 'aaa b cc' });
    expect(words.map((w) => w.word)).toEqual(['aaa', 'b', 'cc']);
    expect(words[0].at).toBe(10);
    expect(words[1].at).toBeCloseTo(10 + (4 * 4) / 9);
    expect(words[2].at).toBeCloseTo(10 + (4 * 6) / 9);
  });
});
