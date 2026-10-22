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

// where a lesson's sentences came from; 'none' = no transcript, the video is cut by
// time or by the player marking where each sentence ends
export type LessonSource = TranscriptFormat | 'none';

export interface ShadowLesson {
  id: string;
  videoId: string;
  title: string;
  level: LessonLevel;
  // empty for a lesson without transcript until its video has loaded once
  segments: Segment[];
  source: LessonSource;
  createdAt: number;
  updatedAt: number;
  // set when the lesson was made from a suggested video
  suggestionId?: string;
  // lesson without transcript: the video is marked into sentences up to this time (the
  // sentences end there); what comes after is cut by time. Unset until marking starts.
  liveAnchor?: number;
}

export type ShadowMode = 'repeat' | 'shadow';
export type TextMode = 'show' | 'hint' | 'hide';
