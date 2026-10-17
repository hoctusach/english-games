import type { LessonLevel } from '@/shadowing/types';

// Videos picked for shadowing, by level. Those with a `videoId` (found through web
// search; official channel uploads where there is one) can be practised at once
// without a transcript; the others are found with a YouTube search. A transcript
// can be added to any of them when making the lesson.
export interface VideoSuggestion {
  id: string;
  level: LessonLevel;
  emoji: string;
  title: string;
  channel: string;
  minutes: number;
  videoId?: string;
  query: string;
  note: { vi: string; en: string };
}

export const SUGGESTIONS: VideoSuggestion[] = [
  // ---- kids · A2 Flyers ----
  {
    id: 'lek-greedy-hippo',
    level: 'kids',
    emoji: '🦛',
    title: 'The greedy hippo',
    channel: 'British Council · LearnEnglish Kids',
    minutes: 3,
    videoId: 'dbLecFXK00I',
    query: 'LearnEnglish Kids The greedy hippo',
    note: {
      vi: 'Truyện ngắn, giọng Anh chuẩn, câu đơn giản — hợp để bé bắt đầu.',
      en: 'A short story with clear British voices and simple sentences — a good first lesson.',
    },
  },
  {
    id: 'lek-jack-beanstalk',
    level: 'kids',
    emoji: '🌱',
    title: 'Jack and the beanstalk',
    channel: 'British Council · LearnEnglish Kids',
    minutes: 5,
    videoId: 'rKB1_wBueFM',
    query: 'LearnEnglish Kids Jack and the beanstalk',
    note: {
      vi: 'Truyện cổ tích quen thuộc, kể thì quá khứ — luyện đuôi -ed.',
      en: 'A familiar fairy tale in the past tense — practise -ed endings.',
    },
  },
  {
    id: 'lek-goldilocks',
    level: 'kids',
    emoji: '🐻',
    title: 'Goldilocks and the three bears',
    channel: 'British Council · LearnEnglish Kids',
    minutes: 4,
    videoId: 'Oaw-d3r_gIc',
    query: 'LearnEnglish Kids Goldilocks and the three bears',
    note: {
      vi: 'Nhiều câu lặp lại (too hot, too cold…) — rất dễ nói theo.',
      en: 'Lots of repeated lines (too hot, too cold…) — easy to say along.',
    },
  },
  {
    id: 'lek-princess-dragon',
    level: 'kids',
    emoji: '🐉',
    title: 'Princess and the dragon',
    channel: 'British Council · LearnEnglish Kids',
    minutes: 5,
    videoId: 'oepRTA4s4XM',
    query: 'LearnEnglish Kids Princess and the dragon',
    note: {
      vi: 'Truyện hiện đại, nhiều hội thoại — luyện ngữ điệu câu hỏi.',
      en: 'A modern tale with lots of dialogue — practise question intonation.',
    },
  },
  {
    id: 'lek-red-riding-hood',
    level: 'kids',
    emoji: '🧺',
    title: 'Little Red Riding Hood',
    channel: 'British Council · LearnEnglish Kids',
    minutes: 5,
    videoId: 'GbzMC6qAzVU',
    query: 'LearnEnglish Kids Little Red Riding Hood',
    note: {
      vi: 'Hội thoại nổi tiếng "What big eyes you have!" — vui để nhại giọng.',
      en: 'The famous "What big eyes you have!" dialogue — fun to act out.',
    },
  },
  {
    id: 'cambridge-flyers-speaking',
    level: 'kids',
    emoji: '🎓',
    title: 'A2 Flyers Speaking test — Michaela',
    channel: 'Cambridge English',
    minutes: 9,
    videoId: '5VM1C4dAFs4',
    query: 'Cambridge English A2 Flyers Speaking test Michaela',
    note: {
      vi: 'Bài thi nói Flyers mẫu chính thức — nhại theo cả giám khảo lẫn thí sinh.',
      en: 'The official Flyers speaking sample — shadow both the examiner and the candidate.',
    },
  },
  {
    id: 'peppa-muddy-puddles',
    level: 'kids',
    emoji: '🐷',
    title: 'Peppa Pig — Muddy Puddles',
    channel: 'Peppa Pig',
    minutes: 5,
    query: 'Peppa Pig Muddy Puddles full episode official',
    note: {
      vi: 'Giọng Anh chuẩn, câu ngắn, chậm. Chọn bản của kênh chính thức.',
      en: 'Clear British voices, short slow sentences. Pick the official channel’s upload.',
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
    videoId: 'UNP03fDSj1U',
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
    videoId: 'arj7oStGLkU',
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
    videoId: 'qp0HIF3SfI4',
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
    videoId: 'UF8uR6Z6KLc',
    query: 'Steve Jobs 2005 Stanford Commencement Address',
    note: {
      vi: 'Bài phát biểu nổi tiếng, nói chậm và rõ — rất hợp để nhại theo.',
      en: 'A famous speech, slow and clear — great for shadowing.',
    },
  },
];

export function getSuggestion(id: string | undefined): VideoSuggestion | undefined {
  return id ? SUGGESTIONS.find((s) => s.id === id) : undefined;
}
