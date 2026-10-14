// A line of a transcript as read from the pasted text or subtitle file. Pasted
// YouTube transcripts only carry start times; subtitle files carry both.
export interface Caption {
  start: number;
  end?: number;
  text: string;
}

// One sentence to practise: a stretch of the video, in seconds.
export interface Segment {
  start: number;
  end: number;
  text: string;
}

export type LessonLevel = 'kids' | 'mid' | 'advanced';

export const LESSON_LEVELS: LessonLevel[] = ['kids', 'mid', 'advanced'];

export type TranscriptFormat = 'youtube' | 'srt' | 'vtt';

export interface ShadowLesson {
  id: string;
  videoId: string;
  title: string;
  level: LessonLevel;
  segments: Segment[];
  source: TranscriptFormat;
  createdAt: number;
  updatedAt: number;
  // set when the lesson was made from a suggested video
  suggestionId?: string;
}

export type ShadowMode = 'repeat' | 'shadow';
export type TextMode = 'show' | 'hint' | 'hide';
