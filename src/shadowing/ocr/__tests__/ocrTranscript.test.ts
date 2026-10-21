import { describe, expect, it } from 'vitest';
import {
  entriesFromLines,
  findGaps,
  formatTime,
  mergeEntries,
  parseTimeToken,
  toTranscriptText,
  transcriptFromScreenshots,
  type OcrLine,
} from '@/shadowing/ocr/ocrTranscript';

// a line from "words", each optionally "word@confidence"
function line(y: number, text: string): OcrLine {
  return {
    y,
    words: text.split(' ').map((w) => {
      const [t, c] = w.split('@');
      return { text: t, confidence: c ? Number(c) : 90 };
    }),
  };
}

const H = 2000;

describe('parseTimeToken', () => {
  it('reads times, also as OCR misreads them', () => {
    expect(parseTimeToken('0:16')).toBe(16);
    expect(parseTimeToken('10:42')).toBe(642);
    expect(parseTimeToken('1:02:03')).toBe(3723);
    expect(parseTimeToken('O:16')).toBe(16);
    expect(parseTimeToken('l:05')).toBe(65);
    expect(parseTimeToken('1l:30')).toBe(690);
    expect(parseTimeToken('3:75')).toBeNull();
    expect(parseTimeToken('hello')).toBeNull();
    expect(parseTimeToken('1:2')).toBeNull();
    expect(parseTimeToken('12')).toBeNull();
  });

  it('formats times', () => {
    expect(formatTime(7)).toBe('0:07');
    expect(formatTime(642)).toBe('10:42');
    expect(formatTime(3723)).toBe('1:02:03');
  });
});

describe('entriesFromLines', () => {
  const screenshot = [
    line(50, '11:09 62 5G 44%'), // status bar: a clock that is not a transcript time
    line(300, 'Some caption burned into the video'),
    line(810, '< Transcript i X'),
    line(999, 'Search transcript'),
    line(1169, 'Chapter 1: Getting started'),
    line(1301, '0:00 Transcriber: Someone'),
    line(1503, '0:07 The cat sat on the'),
    line(1583, 'warm windowsill all day,'),
    line(1661, '0:12 and the dog slept below.'),
    line(1787, 'Chapter 2: A very long chapter'),
    line(1830, 'title that wraps'),
    line(1900, '0:19 Then it rained.'),
    line(1940, '= O <'), // navigation bar
  ];

  it('keeps only the transcript, with each entry joined across its lines', () => {
    const entries = entriesFromLines(screenshot, H);
    expect(entries.map((e) => [e.start, e.text])).toEqual([
      [0, 'Transcriber: Someone'],
      [7, 'The cat sat on the warm windowsill all day,'],
      [12, 'and the dog slept below.'],
      [19, 'Then it rained.'],
    ]);
  });

  it('works without knowing the height, and without a header', () => {
    const entries = entriesFromLines([line(10, '0:05 First line'), line(50, 'continued here'), line(90, '0:09 Second')]);
    expect(entries.map((e) => [e.start, e.text])).toEqual([
      [5, 'First line continued here'],
      [9, 'Second'],
    ]);
  });

  it('drops the floating "Sync to video" button, noise and cut-off lines', () => {
    const entries = entriesFromLines(
      [
        line(800, 'Transcript'),
        line(1000, '0:30 You can Sync to video give that'),
        line(1100, 'gift to your@90 ///@10 audience.'),
        line(1200, '0:35 Sync to video'),
        line(1300, 'Next words here'),
      ],
      H,
    );
    expect(entries.map((e) => [e.start, e.text])).toEqual([
      [30, 'You can give that gift to your audience.'],
      [35, 'Next words here'],
    ]);
  });

  it('fixes a capital I read as l or |', () => {
    const entries = entriesFromLines([line(900, 'Transcript'), line(1000, '0:40 l think l\'m sure |\'ll go and l\'ve seen it')], H);
    expect(entries[0].text).toBe("I think I'm sure I'll go and I've seen it");
  });

  it('puts a misread time right when one digit explains it, else leaves the entry out', () => {
    const entries = entriesFromLines(
      [
        line(900, 'Transcript'),
        line(1000, '0:40 one'),
        line(1100, '0:10 two'), // goes back, no single digit fixes it: left out
        line(1200, '0:50 three'),
        line(1300, '9:59 four'), // a 9 for a 0: 0:59
        line(1400, '0:55 five'), // goes back again
        line(1500, '1:05 six'),
      ],
      H,
    );
    expect(entries.map((e) => [e.start, e.text])).toEqual([
      [40, 'one'],
      [50, 'three'],
      [59, 'four'],
      [65, 'six'],
    ]);
  });

  it('reads times whose colon was lost, and digits read as letters', () => {
    const entries = entriesFromLines(
      [
        line(900, 'Transcript'),
        line(1000, '0:40 one'),
        line(1100, '049 two'),
        line(1200, '1.05 three'),
        line(1300, 'l:16 four'),
        line(1400, '1:2O five'),
        line(1500, '500 companies grew'), // a number in the text, not a time
      ],
      H,
    );
    expect(entries.map((e) => [e.start, e.text])).toEqual([
      [40, 'one'],
      [49, 'two'],
      [65, 'three'],
      [76, 'four'],
      [80, 'five 500 companies grew'],
    ]);
  });
});

describe('merging screenshots', () => {
  it('keeps the clearest reading of an entry seen twice, in time order', () => {
    const first = entriesFromLines([line(900, 'Transcript'), line(1000, '0:07 Alpha beta'), line(1100, '0:12 Gamma delta epsi@20')], H);
    const second = entriesFromLines(
      [line(900, 'Transcript'), line(1000, '0:12 Gamma delta epsilon zeta'), line(1100, '0:20 Eta theta')],
      H,
    );
    const merged = mergeEntries([second, first]);
    expect(merged.map((e) => [e.start, e.text])).toEqual([
      [7, 'Alpha beta'],
      [12, 'Gamma delta epsilon zeta'],
      [20, 'Eta theta'],
    ]);
  });

  it('builds transcript text and warns about a missing stretch', () => {
    const a = [line(900, 'Transcript'), line(1000, '0:07 Alpha beta'), line(1100, '0:12 Gamma')];
    const b = [line(900, 'Transcript'), line(1000, '1:10 Later words'), line(1100, '1:15 End')];
    const result = transcriptFromScreenshots([
      { lines: a, height: H },
      { lines: b, height: H },
    ]);
    expect(result.text).toBe('0:07\nAlpha beta\n0:12\nGamma\n1:10\nLater words\n1:15\nEnd');
    expect(result.gaps).toEqual([{ from: 12, to: 70 }]);
    expect(findGaps(result.entries, 100)).toEqual([]);
    expect(toTranscriptText([])).toBe('');
  });
});
