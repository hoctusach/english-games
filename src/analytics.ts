// Anonymous usage stats through Umami Cloud (free plan, no cookies, no server of
// our own). Nothing personal is sent: no player name, no word lists — only
// counts like "a round ended after 12 words at speed 0.5×". Umami itself adds
// device type, browser, OS and country to each visit.
//
// To turn it on: create a website at https://cloud.umami.is, then paste its
// Website ID below. While it is empty, nothing is loaded or sent.
const UMAMI_WEBSITE_ID = 'c51f7d4d-f8a4-49cc-8617-3cc0f1c3d5b3';
const UMAMI_SCRIPT = 'https://cloud.umami.is/script.js';
// only the real site counts, not local testing
const UMAMI_DOMAINS = 'hoctusach.github.io';

type EventData = Record<string, string | number | boolean>;

interface Umami {
  track: (name: string, data?: EventData) => void;
}

const queue: [string, EventData | undefined][] = [];

function umami(): Umami | undefined {
  return (window as unknown as { umami?: Umami }).umami;
}

// The Google Play app (a Trusted Web Activity) opens with an android-app:// referrer
// and sends no stats at all: it is offered to children as well.
function insideAndroidApp(): boolean {
  try {
    if (document.referrer.startsWith('android-app://')) sessionStorage.setItem('shootwords.twa', '1');
    return sessionStorage.getItem('shootwords.twa') === '1';
  } catch {
    return false;
  }
}

export function initAnalytics(): void {
  if (!UMAMI_WEBSITE_ID || !import.meta.env.PROD || insideAndroidApp()) return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = UMAMI_SCRIPT;
  script.dataset.websiteId = UMAMI_WEBSITE_ID;
  script.dataset.domains = UMAMI_DOMAINS;
  script.addEventListener('load', () => {
    const api = umami();
    if (!api) return;
    for (const [name, data] of queue.splice(0)) api.track(name, data);
  });
  document.head.appendChild(script);
}

export function track(name: string, data?: EventData): void {
  if (!UMAMI_WEBSITE_ID || !import.meta.env.PROD) return;
  try {
    const api = umami();
    if (api) api.track(name, data);
    else if (queue.length < 50) queue.push([name, data]);
  } catch {
    // stats must never break the game
  }
}
