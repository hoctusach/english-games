import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLesson,
  deleteLesson,
  getLastLessonId,
  getLesson,
  loadLessonProgress,
  loadLessons,
  loadPrefs,
  practisedCount,
  remapReps,
  saveLessonProgress,
  savePrefs,
  setLastLessonId,
  StorageFullError,
  updateLesson,
} from '@/shadowing/lessonStore';
import { SHADOW_LESSONS_KEY, SHADOW_PREFS_KEY, SHADOW_PROGRESS_PREFIX } from '@/utils/storageKeys';

class MemoryStorage {
  data = new Map<string, string>();
  full = false;
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.full) throw new Error('QuotaExceededError');
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
});

const segments = [
  { start: 0.123456, end: 2.5, text: 'Hello there.' },
  { start: 2.5, end: 4, text: 'How are you?' },
];

describe('lessons', () => {
  it('creates, reads, updates and deletes', () => {
    const lesson = createLesson({ videoId: 'dQw4w9WgXcQ', title: '  My video ', level: 'kids', segments, source: 'youtube' });
    expect(lesson.title).toBe('My video');
    expect(lesson.segments[0].start).toBe(0.12);
    expect(getLesson(lesson.id)?.videoId).toBe('dQw4w9WgXcQ');

    const second = createLesson({ videoId: 'aaaaaaaaaaa', title: '', level: 'advanced', segments, source: 'srt' });
    expect(second.title).toBe('aaaaaaaaaaa');
    expect(loadLessons().map((l) => l.id)).toEqual([second.id, lesson.id]); // newest first

    updateLesson(lesson.id, { title: 'Renamed', segments: [segments[0]] });
    expect(getLesson(lesson.id)?.title).toBe('Renamed');
    expect(getLesson(lesson.id)?.segments.length).toBe(1);
    updateLesson(lesson.id, { title: '   ', segments: [] });
    expect(getLesson(lesson.id)?.title).toBe('Renamed');
    expect(getLesson(lesson.id)?.segments.length).toBe(1);

    setLastLessonId(lesson.id);
    saveLessonProgress(lesson.id, { reps: [1], last: 0, seconds: 10, finished: 0, updatedAt: 0 });
    deleteLesson(lesson.id);
    expect(getLesson(lesson.id)).toBeUndefined();
    expect(storage.getItem(SHADOW_PROGRESS_PREFIX + lesson.id)).toBeNull();
    expect(getLastLessonId()).toBeNull();
  });

  it('survives broken or foreign data', () => {
    storage.setItem(SHADOW_LESSONS_KEY, '{not json');
    expect(loadLessons()).toEqual([]);
    storage.setItem(
      SHADOW_LESSONS_KEY,
      JSON.stringify([
        { id: 'ok', videoId: 'v', title: '', level: 'weird', segments: [{ start: 0, end: 1, text: 'a' }] },
        { id: 'no-segments', videoId: 'v', segments: [] },
        { id: 'bad-segment', videoId: 'v', segments: [{ start: 'x', end: 1, text: 'a' }] },
        null,
      ]),
    );
    const lessons = loadLessons();
    expect(lessons.map((l) => l.id)).toEqual(['ok']);
    expect(lessons[0].level).toBe('mid');
    expect(lessons[0].title).toBe('v');
  });

  it('reports a full storage', () => {
    storage.full = true;
    expect(() => createLesson({ videoId: 'v', title: 't', level: 'mid', segments, source: 'srt' })).toThrow(StorageFullError);
  });
});

describe('progress', () => {
  it('fits saved progress to the current sentence count', () => {
    saveLessonProgress('x', { reps: [2, 0, 1, 5], last: 3, seconds: 61.6, finished: 1, updatedAt: 0 });
    const p = loadLessonProgress('x', 2);
    expect(p.reps).toEqual([2, 0]);
    expect(p.last).toBe(1);
    expect(p.seconds).toBe(62);
    expect(practisedCount(p)).toBe(1);
    expect(loadLessonProgress('none', 3)).toMatchObject({ reps: [0, 0, 0], last: 0, seconds: 0, finished: 0 });
  });

  it('never throws when storage is full', () => {
    storage.full = true;
    expect(() => saveLessonProgress('x', { reps: [], last: 0, seconds: 0, finished: 0, updatedAt: 0 })).not.toThrow();
  });

  it('remaps counts after edits', () => {
    expect(remapReps([1, 2, 3], { type: 'merge', index: 0 })).toEqual([2, 3]);
    expect(remapReps([1, 2, 3], { type: 'split', index: 1 })).toEqual([1, 2, 2, 3]);
    expect(remapReps([1, 2, 3], { type: 'remove', index: 2 })).toEqual([1, 2]);
  });
});

describe('prefs', () => {
  it('falls back to defaults for unknown values', () => {
    storage.setItem(SHADOW_PREFS_KEY, JSON.stringify({ mode: 'shadow', rate: 3, repeat: 2, gapFactor: 'x', autoNext: false, textMode: 'hint' }));
    expect(loadPrefs()).toEqual({ mode: 'shadow', rate: 1, repeat: 2, gapFactor: 1, autoNext: false, textMode: 'hint' });
    savePrefs({ ...loadPrefs(), rate: 0.75 });
    expect(loadPrefs().rate).toBe(0.75);
  });
});
