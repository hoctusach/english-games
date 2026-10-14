import { getVoiceName } from '@/data/settingsStore';

// Words are read with the browser's own speech (speechSynthesis). Some Android setups
// have none that works: in-app browsers (Telegram, Zalo, Messenger…) often lack the
// API, and phones without a text-to-speech engine or English voice report no voices
// or fail silently. Then the game plays recorded pronunciations from a free online
// dictionary instead (needs a connection; phrases are read word by word).

const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
// how long a spoken word may take to start before we assume the engine is silent
const START_TIMEOUT_MS = 1200;
// after this, an empty voice list means there really are none
const VOICES_WAIT_MS = 2000;
const MAX_PHRASE_WORDS = 5;

let voicesSettled = false;
// null until the first utterance tells us whether speech actually plays
let speechWorks: boolean | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let currentAudio: HTMLAudioElement | null = null;
const audioUrls = new Map<string, Promise<string | null>>();

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return window.speechSynthesis;
}

(function watchVoices() {
  const s = synth();
  if (!s) {
    voicesSettled = true;
    return;
  }
  if (s.getVoices().length > 0) voicesSettled = true;
  s.addEventListener('voiceschanged', () => {
    voicesSettled = true;
  });
  window.setTimeout(() => {
    voicesSettled = true;
  }, VOICES_WAIT_MS);
})();

export function getEnglishVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  return s.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
}

export function onVoicesReady(callback: () => void): () => void {
  const s = synth();
  const timer = window.setTimeout(callback, VOICES_WAIT_MS + 50);
  if (!s) return () => window.clearTimeout(timer);
  s.addEventListener('voiceschanged', callback);
  return () => {
    window.clearTimeout(timer);
    s.removeEventListener('voiceschanged', callback);
  };
}

// True when words are read with dictionary recordings instead of the device voice.
export function usesOnlineVoice(): boolean {
  if (!synth()) return true;
  if (speechWorks === false) return true;
  return voicesSettled && getEnglishVoices().length === 0;
}

// Opened inside another app's browser (Telegram, Zalo, Facebook…), where speech is
// usually missing: opening the page in Chrome brings the device voices back.
export function isInAppBrowser(): boolean {
  return /; wv\)|\bwv\b|Telegram|Zalo|FBAN|FBAV|Instagram|Line\//i.test(navigator.userAgent);
}

function lookupAudio(word: string): Promise<string | null> {
  const key = word.trim().toLowerCase();
  let pending = audioUrls.get(key);
  if (!pending) {
    pending = fetch(DICTIONARY_API + encodeURIComponent(key))
      .then((res) => (res.ok ? res.json() : []))
      .then((entries: { phonetics?: { audio?: string }[] }[]) => {
        const urls = (Array.isArray(entries) ? entries : [])
          .flatMap((entry) => entry.phonetics ?? [])
          .map((p) => p.audio ?? '')
          .filter(Boolean);
        return urls.find((u) => u.includes('-us')) ?? urls.find((u) => u.includes('-uk')) ?? urls[0] ?? null;
      })
      .catch(() => null);
    audioUrls.set(key, pending);
  }
  return pending;
}

// Recording for the whole term if the dictionary has one, otherwise for each word.
async function onlineUrls(term: string): Promise<string[]> {
  const whole = await lookupAudio(term);
  if (whole) return [whole];
  const words = term
    .toLowerCase()
    .split(/[\s-]+/)
    .map((w) => w.replace(/[^a-z']/g, ''))
    .filter(Boolean)
    .slice(0, MAX_PHRASE_WORDS);
  if (words.length < 2) return [];
  const urls = await Promise.all(words.map(lookupAudio));
  return urls.filter((u): u is string => !!u);
}

async function playOnline(term: string): Promise<void> {
  const urls = await onlineUrls(term);
  if (currentAudio) currentAudio.pause();
  const playFrom = (index: number) => {
    if (index >= urls.length) return;
    const audio = new Audio(urls[index]);
    currentAudio = audio;
    audio.addEventListener('ended', () => playFrom(index + 1));
    audio.play().catch(() => {});
  };
  playFrom(0);
}

// Fetch a word's recording ahead of time (called when it spawns) so the kill plays it
// without a delay. Does nothing while the device voice works.
export function prepareSpeech(term: string): void {
  if (usesOnlineVoice()) void onlineUrls(term);
}

// `followUp` (an example sentence) is read right after the word with the same voice.
// The online recordings only have single words, so without a device voice only the
// word is read.
export function speak(word: string, voiceName = getVoiceName(), followUp?: string): void {
  const s = synth();
  if (!s || usesOnlineVoice()) {
    void playOnline(word);
    return;
  }
  s.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  const voice = voiceName ? s.getVoices().find((v) => v.name === voiceName) : undefined;
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  currentUtterance = utterance;
  let started = false;
  const fallBack = () => {
    // only for the word still being read: a newer word cancels the older one on purpose
    if (started || currentUtterance !== utterance) return;
    speechWorks = false;
    s.cancel();
    void playOnline(word);
  };
  utterance.addEventListener('start', () => {
    started = true;
    speechWorks = true;
  });
  utterance.addEventListener('error', (event) => {
    if (event.error !== 'interrupted' && event.error !== 'canceled') fallBack();
  });
  s.speak(utterance);
  if (followUp) {
    // queued: plays when the word ends; the next speak() cancels both
    const sentence = new SpeechSynthesisUtterance(followUp);
    sentence.lang = utterance.lang;
    if (voice) sentence.voice = voice;
    s.speak(sentence);
  }
  if (speechWorks !== true) window.setTimeout(fallBack, START_TIMEOUT_MS);
}
