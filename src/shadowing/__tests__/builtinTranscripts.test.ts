import { describe, expect, it } from 'vitest';
import { SUGGESTIONS } from '@/shadowing/suggestions';
import { parseTranscript } from '@/shadowing/transcriptParse';
import { buildSegments } from '@/shadowing/segment';

describe('built-in transcripts', () => {
  const withText = SUGGESTIONS.filter((s) => s.transcript);

  it('exist', () => {
    expect(withText.map((s) => s.id)).toContain('ted-cutts-30-days');
  });

  it.each(withText.map((s) => [s.id, s.transcript!]))('%s cuts into practisable sentences', (_id, transcript) => {
    const parsed = parseTranscript(transcript);
    expect(parsed?.format).toBe('youtube');
    const segments = buildSegments(parsed!.captions);
    expect(segments.length).toBeGreaterThan(10);
    for (const seg of segments) {
      expect(seg.end).toBeGreaterThan(seg.start);
      expect(seg.end - seg.start).toBeLessThanOrEqual(14);
      expect(seg.text).not.toMatch(/\[|Chapter/);
    }
    // in time order, without overlaps
    segments.slice(1).forEach((seg, i) => expect(seg.start).toBeGreaterThanOrEqual(segments[i].end - 0.01));
  });

  it('Matt Cutts: first and last sentences', () => {
    const s = SUGGESTIONS.find((x) => x.id === 'ted-cutts-30-days')!;
    const segments = buildSegments(parseTranscript(s.transcript!)!.captions);
    // a long first sentence is cut at its comma, not mid-phrase at the line end
    expect(segments[0].text).toBe('A few years ago, I felt like I was stuck in a rut,');
    expect(segments[1].text).toBe(
      'so I decided to follow in the footsteps of the great American philosopher, Morgan Spurlock, and try something new for 30 days.',
    );
    expect(segments[0].start).toBe(16);
    expect(segments[segments.length - 1].text).toBe('Thanks.');
  });
});
