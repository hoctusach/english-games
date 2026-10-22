import { describe, expect, it } from 'vitest';
import { SUGGESTIONS } from '@/shadowing/suggestions';
import { parseTranscript } from '@/shadowing/transcriptParse';
import { buildSegments } from '@/shadowing/segment';

// Suggestions can carry a transcript, but only one we may redistribute. None of the
// current videos does (TED and TEDx transcripts are licensed): people paste their own.
describe('built-in transcripts', () => {
  const withText = SUGGESTIONS.filter((s) => s.transcript);

  it.each(withText.map((s) => [s.id, s.transcript!]))('%s cuts into practisable sentences', (_id, transcript) => {
    const parsed = parseTranscript(transcript);
    expect(parsed?.format).toBe('youtube');
    const segments = buildSegments(parsed!.captions);
    expect(segments.length).toBeGreaterThan(10);
    for (const seg of segments) {
      expect(seg.end).toBeGreaterThan(seg.start);
      expect(seg.end - seg.start).toBeLessThanOrEqual(14);
    }
  });

  it('TED talks carry no copied transcript', () => {
    expect(SUGGESTIONS.filter((s) => /TED/.test(s.channel) && s.transcript)).toEqual([]);
  });
});
