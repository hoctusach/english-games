// Pulls the 11-character video id out of anything a player might paste: a watch
// link, a youtu.be share link, a Shorts/embed/live link, the mobile or music site,
// or the bare id itself.
const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

export function parseVideoId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (ID.test(value)) return value;

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!HOSTS.test(url.hostname)) return null;

  if (/youtu\.be$/i.test(url.hostname)) {
    const id = url.pathname.split('/')[1] ?? '';
    return ID.test(id) ? id : null;
  }
  const v = url.searchParams.get('v');
  if (v && ID.test(v)) return v;
  const match = url.pathname.match(/^\/(?:shorts|embed|live|v|e)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/);
  return match ? match[1] : null;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

export function watchUrl(videoId: string, startSeconds = 0): string {
  const t = Math.floor(startSeconds);
  return `https://www.youtube.com/watch?v=${videoId}${t > 0 ? `&t=${t}s` : ''}`;
}

export function searchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
