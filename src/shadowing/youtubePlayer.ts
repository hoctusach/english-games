import type { MediaLike } from '@/shadowing/SegmentPlayer';

// The YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference),
// wrapped as the MediaLike the practice loop drives. No API key is needed; the
// video plays inside YouTube's own embedded player.

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  setPlaybackRate(rate: number): void;
  getVideoData?(): { title?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (el: HTMLElement, options: Record<string, unknown>) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_URL = 'https://www.youtube.com/iframe_api';
let apiPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(timeoutMs = 15000): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const fail = (reason: string) => {
      window.clearTimeout(timer);
      apiPromise = null;
      script.remove();
      reject(new Error(reason));
    };
    const timer = window.setTimeout(() => fail('timeout'), timeoutMs);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else fail('no player');
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => fail('network');
    document.head.appendChild(script);
  });
  return apiPromise;
}

// YouTube player error codes
export type PlayerErrorKind = 'notFound' | 'notEmbeddable' | 'other';

export function errorKind(code: number): PlayerErrorKind {
  if (code === 2 || code === 100) return 'notFound';
  if (code === 101 || code === 150 || code === 153) return 'notEmbeddable';
  return 'other';
}

export interface YouTubeEvents {
  onReady?: () => void;
  onError?: (kind: PlayerErrorKind, code: number) => void;
  // started or paused from the player's own controls, not by us
  onExternalPlay?: () => void;
  onExternalPause?: () => void;
  onEnded?: () => void;
}

const STATE_ENDED = 0;
const STATE_PLAYING = 1;
const STATE_PAUSED = 2;

export class YouTubeMedia implements MediaLike {
  private player: YTPlayer;
  private ready = false;
  private queued: (() => void)[] = [];
  private playing = false;
  private rate = 1;
  private lastRaw = -1;
  private lastRawAt = 0;
  private pendingSeek: { target: number; since: number } | null = null;
  private lastCommand: { type: 'play' | 'pause'; at: number } | null = null;
  private destroyed = false;

  constructor(api: YTNamespace, host: HTMLElement, videoId: string, private events: YouTubeEvents = {}) {
    const mount = document.createElement('div');
    host.appendChild(mount);
    this.player = new api.Player(mount, {
      videoId,
      host: 'https://www.youtube-nocookie.com',
      width: '100%',
      height: '100%',
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        cc_load_policy: 0,
        disablekb: 1,
        fs: 0,
        enablejsapi: 1,
        origin: location.origin,
      },
      events: {
        onReady: () => {
          if (this.destroyed) return;
          this.ready = true;
          this.player.setPlaybackRate(this.rate);
          this.queued.splice(0).forEach((run) => run());
          this.events.onReady?.();
        },
        onStateChange: (event: { data: number }) => this.onState(event.data),
        onError: (event: { data: number }) => this.events.onError?.(errorKind(event.data), event.data),
      },
    });
  }

  play(): void {
    this.lastCommand = { type: 'play', at: performance.now() };
    this.run(() => this.player.playVideo());
  }

  pause(): void {
    this.lastCommand = { type: 'pause', at: performance.now() };
    this.playing = false;
    this.run(() => this.player.pauseVideo());
  }

  seek(seconds: number): void {
    this.pendingSeek = { target: seconds, since: performance.now() };
    this.lastRaw = -1;
    this.run(() => this.player.seekTo(seconds, true));
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.run(() => this.player.setPlaybackRate(rate));
  }

  // The player only reports its time every so often, and keeps reporting the old
  // time for a moment after a seek. Smooth both over: hold the seek target until
  // the player catches up, and run the clock forward between reports.
  time(): number {
    if (!this.ready) return this.pendingSeek?.target ?? 0;
    const raw = Number(this.player.getCurrentTime()) || 0;
    const now = performance.now();
    if (this.pendingSeek) {
      if (Math.abs(raw - this.pendingSeek.target) < 1) this.pendingSeek = null;
      else if (now - this.pendingSeek.since < 1500) return this.pendingSeek.target;
      else this.pendingSeek = null;
    }
    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      this.lastRawAt = now;
    }
    if (!this.playing) return raw;
    return raw + Math.min(0.5, ((now - this.lastRawAt) / 1000) * this.rate);
  }

  title(): string {
    try {
      return this.player.getVideoData?.().title?.trim() ?? '';
    } catch {
      return '';
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.queued = [];
    try {
      this.player.destroy();
    } catch {
      // already gone
    }
  }

  private run(command: () => void): void {
    if (this.destroyed) return;
    if (this.ready) command();
    else this.queued.push(command);
  }

  private onState(state: number): void {
    if (this.destroyed) return;
    const since = this.lastCommand ? performance.now() - this.lastCommand.at : Infinity;
    if (state === STATE_PLAYING) {
      this.playing = true;
      this.lastRawAt = performance.now();
      const ours = this.lastCommand?.type === 'play' && since < 3000;
      if (!ours) {
        this.lastCommand = null;
        this.events.onExternalPlay?.();
      }
    } else {
      this.playing = false;
      if (state === STATE_PAUSED) {
        // a seek can pass through "paused" right after we press play
        const ours = since < (this.lastCommand?.type === 'pause' ? 3000 : 1000);
        if (!ours) {
          this.lastCommand = null;
          this.events.onExternalPause?.();
        }
      } else if (state === STATE_ENDED) {
        this.events.onEnded?.();
      }
    }
  }
}
