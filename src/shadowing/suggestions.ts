import type { LessonLevel } from '@/shadowing/types';

// Videos picked for shadowing, by level. YouTube ids and uploads change, so each
// pick is found with a YouTube search; the player then pastes the link and the
// transcript once to turn it into a lesson.
export interface VideoSuggestion {
  id: string;
  level: LessonLevel;
  emoji: string;
  title: string;
  channel: string;
  minutes: number;
  query: string;
  note: { vi: string; en: string };
}

export const SUGGESTIONS: VideoSuggestion[] = [
  // ---- kids · A2 Flyers ----
  {
    id: 'peppa-muddy-puddles',
    level: 'kids',
    emoji: '🐷',
    title: 'Peppa Pig — Muddy Puddles',
    channel: 'Peppa Pig – Official Channel',
    minutes: 5,
    query: 'Peppa Pig Muddy Puddles full episode official',
    note: {
      vi: 'Giọng Anh chuẩn, câu ngắn, chậm — hợp để bé bắt đầu.',
      en: 'Clear British voices, short slow sentences — a good first lesson.',
    },
  },
  {
    id: 'lek-lion-and-mouse',
    level: 'kids',
    emoji: '🦁',
    title: 'The Lion and the Mouse',
    channel: 'British Council · LearnEnglish Kids',
    minutes: 4,
    query: 'LearnEnglish Kids The Lion and the Mouse short story',
    note: {
      vi: 'Truyện ngụ ngôn có phụ đề chuẩn, từ vựng trình độ Flyers.',
      en: 'A fable with proper subtitles and Flyers-level words.',
    },
  },
  {
    id: 'lek-ugly-duckling',
    level: 'kids',
    emoji: '🦢',
    title: 'The Ugly Duckling',
    channel: 'British Council · LearnEnglish Kids',
    minutes: 5,
    query: 'LearnEnglish Kids The Ugly Duckling short story',
    note: {
      vi: 'Kể chuyện thì quá khứ — luyện -ed và nhịp câu kể.',
      en: 'Told in the past tense — practise -ed endings and story rhythm.',
    },
  },
  {
    id: 'cambridge-flyers-speaking',
    level: 'kids',
    emoji: '🎓',
    title: 'A2 Flyers Speaking test',
    channel: 'Cambridge English',
    minutes: 9,
    query: 'Cambridge English A2 Flyers speaking test',
    note: {
      vi: 'Bài thi nói Flyers mẫu — nhại theo cả giám khảo lẫn thí sinh.',
      en: 'A sample Flyers speaking test — shadow both the examiner and the candidate.',
    },
  },
  // ---- intermediate ----
  {
    id: 'bbc-6-minute-english',
    level: 'mid',
    emoji: '☕',
    title: '6 Minute English',
    channel: 'BBC Learning English',
    minutes: 6,
    query: 'BBC Learning English 6 Minute English',
    note: {
      vi: 'Hai người dẫn nói chuyện tự nhiên, có phụ đề chuẩn. Chọn tập bất kỳ.',
      en: 'Two hosts chatting naturally, with proper subtitles. Pick any episode.',
    },
  },
  {
    id: 'voa-lets-learn-english',
    level: 'mid',
    emoji: '🇺🇸',
    title: "Let's Learn English — Lesson 1",
    channel: 'VOA Learning English',
    minutes: 10,
    query: "VOA Learning English Let's Learn English Lesson 1",
    note: {
      vi: 'Giọng Mỹ, tình huống đời thường, nói chậm rõ.',
      en: 'American English, everyday situations, slow and clear.',
    },
  },
  // ---- advanced ----
  {
    id: 'ted-cutts-30-days',
    level: 'advanced',
    emoji: '📅',
    title: 'Try something new for 30 days — Matt Cutts',
    channel: 'TED',
    minutes: 4,
    query: 'TED Matt Cutts Try something new for 30 days',
    note: {
      vi: 'Ngắn, dễ nghe, phụ đề TED chuẩn — bài TED đầu tiên lý tưởng.',
      en: 'Short and easy to follow, with TED subtitles — an ideal first talk.',
    },
  },
  {
    id: 'ted-urban-procrastinator',
    level: 'advanced',
    emoji: '🐒',
    title: 'Inside the mind of a master procrastinator — Tim Urban',
    channel: 'TED',
    minutes: 14,
    query: 'TED Tim Urban Inside the mind of a master procrastinator',
    note: {
      vi: 'Hài hước, nói nhanh, nhiều ngữ điệu — luyện nối âm và nhấn nhá.',
      en: 'Funny and fast, full of intonation — practise linking and stress.',
    },
  },
  {
    id: 'ted-sinek-golden-circle',
    level: 'advanced',
    emoji: '⭕',
    title: 'How great leaders inspire action — Simon Sinek',
    channel: 'TED',
    minutes: 18,
    query: 'TED Simon Sinek How great leaders inspire action',
    note: {
      vi: 'Bài nói thuyết phục kinh điển — luyện nhịp và ngắt nghỉ.',
      en: 'A classic persuasive talk — practise rhythm and pausing.',
    },
  },
  {
    id: 'jobs-stanford-2005',
    level: 'advanced',
    emoji: '🍎',
    title: "Steve Jobs' 2005 Stanford Commencement Address",
    channel: 'Stanford',
    minutes: 15,
    query: "Steve Jobs 2005 Stanford Commencement Address",
    note: {
      vi: 'Bài phát biểu nổi tiếng, nói chậm và rõ — rất hợp để nhại theo.',
      en: 'A famous speech, slow and clear — great for shadowing.',
    },
  },
];

export function getSuggestion(id: string | undefined): VideoSuggestion | undefined {
  return id ? SUGGESTIONS.find((s) => s.id === id) : undefined;
}
