import { describe, expect, it } from 'vitest';
import {
  buildSegments,
  chunkByTime,
  formatClock,
  mergeWithNext,
  removeSegment,
  segmentIndexAt,
  segmentsFromMarks,
  splitSegment,
} from '@/shadowing/segment';
import type { Caption } from '@/shadowing/types';

const texts = (captions: Caption[]) => buildSegments(captions).map((s) => s.text);

describe('buildSegments — punctuated', () => {
  it('joins wrapped lines into sentences and splits a line holding two sentences', () => {
    const captions: Caption[] = [
      { start: 0, end: 2, text: 'Hello everyone and' },
      { start: 2, end: 4, text: 'welcome to the show. Today' },
      { start: 4, end: 6, text: 'we talk about food.' },
    ];
    const segments = buildSegments(captions);
    expect(segments.map((s) => s.text)).toEqual([
      'Hello everyone and welcome to the show.',
      'Today we talk about food.',
    ]);
    expect(segments[0].start).toBe(0);
    expect(segments[1].end).toBe(6);
    // the cut falls inside the second line, by letter share
    expect(segments[0].end).toBeGreaterThan(3);
    expect(segments[0].end).toBeLessThan(4);
    expect(segments[1].start).toBe(segments[0].end);
  });

  it('does not cut after abbreviations', () => {
    expect(texts([{ start: 0, end: 4, text: 'Mr. Smith met Dr. Jones at 5 p.m. today. Then he left.' }])).toEqual([
      'Mr. Smith met Dr. Jones at 5 p.m. today.',
      'Then he left.',
    ]);
  });

  it('cuts at closing quotes and question marks', () => {
    expect(texts([{ start: 0, end: 5, text: 'She said "Stop!" Why? Because I asked.' }])).toEqual([
      'She said "Stop!"',
      'Why? Because I asked.',
    ]);
  });

  it('cuts a very long sentence at a comma', () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}${i === 24 ? ',' : ''}`).join(' ') + '.';
    const segments = buildSegments([{ start: 0, end: 15, text: long }]);
    expect(segments.length).toBe(2);
    expect(segments[0].text.endsWith('w24,')).toBe(true);
  });

  it('always cuts at a long pause', () => {
    expect(
      texts([
        { start: 0, end: 2, text: 'This goes on' },
        { start: 5, end: 7, text: 'and on. Done.' },
      ]),
    ).toEqual(['This goes on', 'and on. Done.']);
  });
});

describe('buildSegments — auto captions (no punctuation)', () => {
  it('chunks at line ends every few seconds', () => {
    const captions: Caption[] = [];
    for (let i = 0; i < 10; i++) captions.push({ start: i * 2, end: i * 2 + 2, text: `line ${i} words here` });
    const segments = buildSegments(captions);
    expect(segments.length).toBe(5);
    expect(segments[0].text).toBe('line 0 words here line 1 words here');
    for (const seg of segments) {
      expect(seg.end - seg.start).toBeGreaterThanOrEqual(3.5);
      expect(seg.end - seg.start).toBeLessThanOrEqual(14);
    }
  });

  it('keeps order and every word', () => {
    const captions: Caption[] = [
      { start: 3, end: 5, text: 'c d' },
      { start: 0, end: 3, text: 'a b' },
      { start: 5, end: 6, text: '  ' },
    ];
    expect(buildSegments(captions).map((s) => s.text).join(' ')).toBe('a b c d');
  });

  it('returns nothing for nothing', () => {
    expect(buildSegments([])).toEqual([]);
  });
});

describe('editing', () => {
  const segs = [
    { start: 0, end: 2, text: 'One two.' },
    { start: 2, end: 4, text: 'Three four, five six.' },
    { start: 4, end: 6, text: 'Seven.' },
  ];

  it('merges with the next sentence', () => {
    expect(mergeWithNext(segs, 0)).toEqual([
      { start: 0, end: 4, text: 'One two. Three four, five six.' },
      segs[2],
    ]);
    expect(mergeWithNext(segs, 2)).toBe(segs);
  });

  it('splits near the middle, preferring punctuation', () => {
    const out = splitSegment(segs, 1);
    expect(out.length).toBe(4);
    expect(out[1].text).toBe('Three four,');
    expect(out[2].text).toBe('five six.');
    expect(out[1].end).toBe(out[2].start);
    expect(out[1].start).toBe(2);
    expect(out[2].end).toBe(4);
    expect(splitSegment(segs, 2)).toBe(segs); // one word
  });

  it('removes a sentence but never the last one', () => {
    expect(removeSegment(segs, 1).map((s) => s.text)).toEqual(['One two.', 'Seven.']);
    expect(removeSegment([segs[0]], 0)).toEqual([segs[0]]);
  });
});

describe('helpers', () => {
  it('finds the sentence at a time', () => {
    const segs = [
      { start: 1, end: 3, text: 'a' },
      { start: 3, end: 5, text: 'b' },
      { start: 8, end: 9, text: 'c' },
    ];
    expect(segmentIndexAt(segs, 0)).toBe(0);
    expect(segmentIndexAt(segs, 2.9)).toBe(0);
    expect(segmentIndexAt(segs, 3)).toBe(1);
    expect(segmentIndexAt(segs, 7)).toBe(1);
    expect(segmentIndexAt(segs, 100)).toBe(2);
  });

  it('formats clock times', () => {
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(3723)).toBe('1:02:03');
  });
});

describe('lessons without transcript', () => {
  it('cuts by time, joining a short leftover to the last piece', () => {
    expect(chunkByTime(0, 9, 4)).toEqual([
      { start: 0, end: 4, text: '' },
      { start: 4, end: 9, text: '' },
    ]);
    expect(chunkByTime(0, 10, 4).map((s) => s.end)).toEqual([4, 8, 10]);
    expect(chunkByTime(0, 12, 4).length).toBe(3);
    expect(chunkByTime(0, 13, 4).map((s) => s.end)).toEqual([4, 8, 13]);
    expect(chunkByTime(0, 15, 4).map((s) => s.end)).toEqual([4, 8, 12, 15]);
    expect(chunkByTime(0, 0, 4)).toEqual([]);
    expect(chunkByTime(0, 3, 4)).toEqual([{ start: 0, end: 3, text: '' }]);
  });

  it('builds sentences from marks, cutting the rest by time', () => {
    const segs = segmentsFromMarks([2.5, 6, 6.3, 1e9, -1], 19, 4);
    // 6.3 is too close to 6 to be a sentence of its own; out-of-range marks are ignored
    expect(segs.slice(0, 2)).toEqual([
      { start: 0, end: 2.5, text: '' },
      { start: 2.5, end: 6, text: '' },
    ]);
    expect(segs.slice(2).map((s) => [s.start, s.end])).toEqual([
      [6, 10],
      [10, 14],
      [14, 19],
    ]);
    expect(segmentsFromMarks([], 9, 4).map((s) => s.end)).toEqual([4, 9]);
  });

  it('splits and merges pieces without words', () => {
    const segs = [
      { start: 0, end: 4, text: '' },
      { start: 4, end: 8, text: '' },
    ];
    expect(splitSegment(segs, 0).slice(0, 2)).toEqual([
      { start: 0, end: 2, text: '' },
      { start: 2, end: 4, text: '' },
    ]);
    expect(splitSegment([{ start: 0, end: 1, text: '' }], 0).length).toBe(1);
    expect(mergeWithNext(segs, 0)).toEqual([{ start: 0, end: 8, text: '' }]);
  });
});
