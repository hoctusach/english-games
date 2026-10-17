import { describe, expect, it } from 'vitest';
import { SUGGESTIONS } from '@/shadowing/suggestions';
import { LESSON_LEVELS } from '@/shadowing/types';

describe('suggested videos', () => {
  it('have unique ids, valid video ids, a topic and a note in both languages', () => {
    expect(new Set(SUGGESTIONS.map((s) => s.id)).size).toBe(SUGGESTIONS.length);
    for (const s of SUGGESTIONS) {
      expect(LESSON_LEVELS).toContain(s.level);
      if (s.videoId) expect(s.videoId).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(s.topic.vi && s.topic.en && s.note.vi && s.note.en && s.query).toBeTruthy();
    }
    expect(SUGGESTIONS.find((s) => s.videoId === 'eVFzbxmKNUw')?.level).toBe('advanced');
  });
});
