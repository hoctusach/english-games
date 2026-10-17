import type { LessonLevel, LessonSource, Segment, ShadowLesson, ShadowMode, TextMode } from '@/shadowing/types';
import { LESSON_LEVELS } from '@/shadowing/types';
import {
  LAST_LESSON_KEY,
  SHADOW_LESSONS_KEY,
  SHADOW_PREFS_KEY,
  SHADOW_PROGRESS_PREFIX,
} from '@/utils/storageKeys';

// Shadowing lessons, their progress and the player's preferences, in localStorage
// next to the word sets (so backups pick them up too). A 10-minute transcript is
// about 15 KB.

export class StorageFullError extends Error {}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    throw new StorageFullError(String(err));
  }
}

function validSegment(seg: unknown): seg is Segment {
  const s = seg as Segment;
  return !!s && typeof s.text === 'string' && Number.isFinite(s.start) && Number.isFinite(s.end);
}

function validLesson(value: unknown): value is ShadowLesson {
  const l = value as ShadowLesson;
  return (
    !!l &&
    typeof l.id === 'string' &&
    typeof l.videoId === 'string' &&
    Array.isArray(l.segments) &&
    (l.segments.length > 0 || l.source === 'none') &&
    l.segments.every(validSegment)
  );
}

// ---------- lessons ----------

export function loadLessons(): ShadowLesson[] {
  const raw = read<unknown[]>(SHADOW_LESSONS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(validLesson).map((l) => ({
    ...l,
    title: typeof l.title === 'string' && l.title.trim() ? l.title : l.videoId,
    level: LESSON_LEVELS.includes(l.level) ? l.level : 'mid',
  }));
}

function saveLessons(lessons: ShadowLesson[]): void {
  write(SHADOW_LESSONS_KEY, lessons);
}

export function getLesson(id: string): ShadowLesson | undefined {
  return loadLessons().find((l) => l.id === id);
}

export interface NewLesson {
  videoId: string;
  title: string;
  level: LessonLevel;
  segments: Segment[];
  source: LessonSource;
  suggestionId?: string;
}

function roundSegments(segments: Segment[]): Segment[] {
  const r = (n: number) => Math.round(n * 100) / 100;
  return segments.map((s) => ({ start: r(s.start), end: r(s.end), text: s.text }));
}

export function createLesson(input: NewLesson): ShadowLesson {
  const now = Date.now();
  const lesson: ShadowLesson = {
    id: crypto.randomUUID(),
    videoId: input.videoId,
    title: input.title.trim() || input.videoId,
    level: input.level,
    segments: roundSegments(input.segments),
    source: input.source,
    createdAt: now,
    updatedAt: now,
    ...(input.suggestionId ? { suggestionId: input.suggestionId } : {}),
  };
  saveLessons([lesson, ...loadLessons()]);
  return lesson;
}

export function updateLesson(
  id: string,
  changes: Partial<Pick<ShadowLesson, 'title' | 'level' | 'segments' | 'source'>>,
): ShadowLesson | undefined {
  const lessons = loadLessons();
  const lesson = lessons.find((l) => l.id === id);
  if (!lesson) return undefined;
  if (changes.title !== undefined && changes.title.trim()) lesson.title = changes.title.trim();
  if (changes.level !== undefined) lesson.level = changes.level;
  if (changes.segments !== undefined && changes.segments.length) lesson.segments = roundSegments(changes.segments);
  if (changes.source !== undefined) lesson.source = changes.source;
  lesson.updatedAt = Date.now();
  saveLessons(lessons);
  return lesson;
}

export function deleteLesson(id: string): void {
  saveLessons(loadLessons().filter((l) => l.id !== id));
  try {
    localStorage.removeItem(SHADOW_PROGRESS_PREFIX + id);
    if (localStorage.getItem(LAST_LESSON_KEY) === id) localStorage.removeItem(LAST_LESSON_KEY);
  } catch {
    // nothing to clean up
  }
}

export function getLastLessonId(): string | null {
  try {
    return localStorage.getItem(LAST_LESSON_KEY);
  } catch {
    return null;
  }
}

export function setLastLessonId(id: string): void {
  try {
    localStorage.setItem(LAST_LESSON_KEY, id);
  } catch {
    // not worth bothering the player over
  }
}

// ---------- progress ----------

export interface LessonProgress {
  // times each sentence was heard through, by index
  reps: number[];
  // the sentence to come back to
  last: number;
  // seconds spent practising
  seconds: number;
  // times the lesson was played to its end
  finished: number;
  updatedAt: number;
}

export function loadLessonProgress(id: string, count: number): LessonProgress {
  const raw = read<Partial<LessonProgress>>(SHADOW_PROGRESS_PREFIX + id);
  const reps = Array.from({ length: count }, (_, i) => {
    const n = raw?.reps?.[i];
    return typeof n === 'number' && n > 0 ? Math.floor(n) : 0;
  });
  const last = typeof raw?.last === 'number' ? Math.max(0, Math.min(count - 1, Math.floor(raw.last))) : 0;
  return {
    reps,
    last,
    seconds: typeof raw?.seconds === 'number' && raw.seconds > 0 ? raw.seconds : 0,
    finished: typeof raw?.finished === 'number' && raw.finished > 0 ? raw.finished : 0,
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

export function saveLessonProgress(id: string, progress: LessonProgress): void {
  try {
    write(SHADOW_PROGRESS_PREFIX + id, { ...progress, seconds: Math.round(progress.seconds), updatedAt: Date.now() });
  } catch {
    // progress is a nicety; never interrupt practice over it
  }
}

export function clearLessonProgress(id: string): void {
  try {
    localStorage.removeItem(SHADOW_PROGRESS_PREFIX + id);
  } catch {
    // nothing to clear
  }
}

export function practisedCount(progress: LessonProgress): number {
  return progress.reps.filter((n) => n > 0).length;
}

// Keeps per-sentence counts lined up after the sentence list is edited.
export function remapReps(reps: number[], edit: { type: 'merge' | 'split' | 'remove'; index: number }): number[] {
  const out = [...reps];
  const i = edit.index;
  if (edit.type === 'merge') out.splice(i, 2, Math.max(out[i] ?? 0, out[i + 1] ?? 0));
  else if (edit.type === 'split') out.splice(i, 1, out[i] ?? 0, out[i] ?? 0);
  else out.splice(i, 1);
  return out;
}

// ---------- preferences ----------

export interface ShadowPrefs {
  mode: ShadowMode;
  rate: number;
  repeat: number;
  gapFactor: number;
  autoNext: boolean;
  textMode: TextMode;
  // lessons without transcript: length of each piece, in seconds
  chunkSeconds: number;
}

export const CHUNK_SECONDS = [3, 4, 6];
export const RATES = [0.5, 0.75, 1, 1.25];
export const GAP_FACTORS = [0.75, 1, 1.5];
export const REPEATS = [1, 2, 3];

export const DEFAULT_PREFS: ShadowPrefs = {
  mode: 'repeat',
  rate: 1,
  repeat: 1,
  gapFactor: 1,
  autoNext: true,
  textMode: 'show',
  chunkSeconds: 4,
};

export function loadPrefs(): ShadowPrefs {
  const raw = read<Partial<ShadowPrefs>>(SHADOW_PREFS_KEY) ?? {};
  return {
    mode: raw.mode === 'shadow' ? 'shadow' : 'repeat',
    rate: RATES.includes(raw.rate as number) ? (raw.rate as number) : DEFAULT_PREFS.rate,
    repeat: REPEATS.includes(raw.repeat as number) ? (raw.repeat as number) : DEFAULT_PREFS.repeat,
    gapFactor: GAP_FACTORS.includes(raw.gapFactor as number) ? (raw.gapFactor as number) : DEFAULT_PREFS.gapFactor,
    autoNext: typeof raw.autoNext === 'boolean' ? raw.autoNext : DEFAULT_PREFS.autoNext,
    textMode: raw.textMode === 'hint' || raw.textMode === 'hide' ? raw.textMode : 'show',
    chunkSeconds: CHUNK_SECONDS.includes(raw.chunkSeconds as number) ? (raw.chunkSeconds as number) : DEFAULT_PREFS.chunkSeconds,
  };
}

export function savePrefs(prefs: ShadowPrefs): void {
  try {
    write(SHADOW_PREFS_KEY, prefs);
  } catch {
    // keep playing with the in-memory settings
  }
}
