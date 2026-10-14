import type { Segment, ShadowMode } from '@/shadowing/types';
import { segmentIndexAt } from '@/shadowing/segment';

// The practice loop, kept apart from YouTube so it can be tested with a fake video.
//
// "repeat" (listen & repeat): play one sentence, stop, wait while the player says
// it back (the gap), then repeat it or move on.
// "shadow": the video runs on and the player speaks along; the current sentence
// follows the video, optionally looping one sentence.
//
// The screen calls tick() every few dozen milliseconds; nothing here keeps time on
// its own, so a test can drive it step by step.

export interface MediaLike {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  time(): number;
  setRate(rate: number): void;
}

export type Phase = 'idle' | 'playing' | 'gap' | 'waiting' | 'paused' | 'ended';

export interface PlayerSettings {
  mode: ShadowMode;
  rate: number;
  // how many times each sentence is played in "repeat" mode
  repeat: number;
  // gap length as a share of the sentence's (slowed) length
  gapFactor: number;
  // in "repeat" mode, move to the next sentence on its own after the gap
  autoNext: boolean;
}

export interface PlayerSnapshot {
  phase: Phase;
  index: number;
  mode: ShadowMode;
  repeatsDone: number;
  loop: boolean;
  // 0…1 through the gap while phase is "gap"
  gapProgress: number;
}

export interface PlayerHooks {
  // phase, sentence, mode or loop changed
  onChange?: (snapshot: PlayerSnapshot) => void;
  // a sentence was heard through to its end
  onSegmentDone?: (index: number) => void;
  onFinished?: () => void;
  now?: () => number;
}

// start a little early and stop a little late: caption times are rough
export const LEAD_SECONDS = 0.1;
export const TAIL_SECONDS = 0.2;
const SEEK_SETTLE_MS = 2500;
const SEEK_RETRIES = 2;

export function gapMs(segment: Segment, rate: number, factor: number): number {
  const heard = (segment.end - segment.start) / Math.max(0.25, rate);
  return Math.round(Math.min(30, Math.max(1.5, heard * factor + 0.8)) * 1000);
}

export class SegmentPlayer {
  private phase: Phase = 'idle';
  private index = 0;
  private repeatsDone = 0;
  private loop = false;
  private gapStart = 0;
  private gapEnd = 0;
  // after a seek the video keeps reporting the old time for a moment
  private seekPending: { target: number; since: number; tries: number } | null = null;
  private readonly now: () => number;

  constructor(
    private media: MediaLike,
    private segments: Segment[],
    private settings: PlayerSettings,
    private hooks: PlayerHooks = {},
    startIndex = 0,
  ) {
    this.now = hooks.now ?? (() => performance.now());
    this.index = this.clamp(startIndex);
    media.setRate(settings.rate);
  }

  snapshot(): PlayerSnapshot {
    const span = this.gapEnd - this.gapStart;
    return {
      phase: this.phase,
      index: this.index,
      mode: this.settings.mode,
      repeatsDone: this.repeatsDone,
      loop: this.loop,
      gapProgress: this.phase === 'gap' && span > 0 ? Math.min(1, (this.now() - this.gapStart) / span) : 0,
    };
  }

  get current(): Segment {
    return this.segments[this.index];
  }

  get count(): number {
    return this.segments.length;
  }

  // ---------- controls ----------

  playSegment(index: number, fresh = true): void {
    this.index = this.clamp(index);
    if (fresh) this.repeatsDone = 0;
    this.seekTo(this.current.start - LEAD_SECONDS, 0);
    this.media.play();
    this.setPhase('playing');
  }

  // The big play/pause button.
  toggle(): void {
    switch (this.phase) {
      case 'playing':
        this.media.pause();
        this.setPhase('paused');
        break;
      case 'paused':
        this.media.play();
        this.setPhase('playing');
        break;
      case 'gap':
        this.setPhase('waiting');
        break;
      case 'waiting':
        this.proceed();
        break;
      case 'idle':
        this.playSegment(this.index);
        break;
      case 'ended':
        this.playSegment(0);
        break;
    }
  }

  replay(): void {
    this.playSegment(this.index, false);
  }

  next(): void {
    if (this.index < this.segments.length - 1) this.playSegment(this.index + 1);
    else this.finish();
  }

  prev(): void {
    this.playSegment(Math.max(0, this.index - 1));
  }

  // Skip the rest of the gap.
  skipGap(): void {
    if (this.phase === 'gap' || this.phase === 'waiting') this.proceed();
  }

  setMode(mode: ShadowMode): void {
    if (mode === this.settings.mode) return;
    this.settings.mode = mode;
    this.loop = false;
    if (this.phase === 'gap') this.phase = 'waiting';
    this.emit();
  }

  setRate(rate: number): void {
    this.settings.rate = rate;
    this.media.setRate(rate);
  }

  setLoop(loop: boolean): void {
    if (loop === this.loop) return;
    this.loop = loop;
    this.emit();
  }

  updateSettings(settings: Partial<PlayerSettings>): void {
    const { mode, rate, ...rest } = settings;
    Object.assign(this.settings, rest);
    if (rate !== undefined) this.setRate(rate);
    if (mode !== undefined) this.setMode(mode);
  }

  // The sentence list was edited (merged, split, removed).
  setSegments(segments: Segment[], index = this.index): void {
    this.segments = segments;
    this.index = this.clamp(index);
    this.repeatsDone = 0;
    if (this.phase === 'playing') this.playSegment(this.index);
    else this.emit();
  }

  // The video was paused from outside (its own controls, the app going to the
  // background).
  externalPause(): void {
    if (this.phase === 'playing') this.setPhase('paused');
    else if (this.phase === 'gap') this.setPhase('waiting');
  }

  // The video was started from its own controls: follow it from where it is.
  externalPlay(): void {
    if (this.phase === 'playing') return;
    this.seekPending = null;
    const at = segmentIndexAt(this.segments, this.media.time());
    if (at !== this.index) this.repeatsDone = 0;
    this.index = at;
    this.setPhase('playing');
  }

  // The video itself reached its end.
  externalEnded(): void {
    if (this.phase === 'playing') {
      this.hooks.onSegmentDone?.(this.index);
      this.finish();
    }
  }

  // ---------- the clock ----------

  tick(): void {
    if (this.phase === 'gap' && this.now() >= this.gapEnd) {
      if (this.settings.autoNext || this.repeatsDone < this.settings.repeat) this.proceed();
      else this.setPhase('waiting');
      return;
    }
    if (this.phase !== 'playing') return;

    const t = this.media.time();
    const seg = this.current;
    if (this.seekPending && !this.seekSettled(t)) return;

    if (this.settings.mode === 'repeat') {
      if (t >= seg.end + TAIL_SECONDS) {
        this.media.pause();
        this.repeatsDone += 1;
        this.hooks.onSegmentDone?.(this.index);
        this.gapStart = this.now();
        this.gapEnd = this.gapStart + gapMs(seg, this.settings.rate, this.settings.gapFactor);
        this.setPhase('gap');
      }
      return;
    }

    // shadow mode
    const last = this.segments.length - 1;
    if (this.loop) {
      if (t >= seg.end + TAIL_SECONDS || t < seg.start - 1) {
        if (t >= seg.end) this.hooks.onSegmentDone?.(this.index);
        this.seekTo(seg.start - LEAD_SECONDS, 0);
      }
      return;
    }
    if (t >= this.segments[last].end + TAIL_SECONDS) {
      this.hooks.onSegmentDone?.(last);
      this.finish();
      return;
    }
    const at = segmentIndexAt(this.segments, t);
    if (at !== this.index) {
      if (at > this.index) for (let i = this.index; i < at; i++) this.hooks.onSegmentDone?.(i);
      this.index = at;
      this.emit();
    }
  }

  // ---------- internals ----------

  private proceed(): void {
    if (this.settings.mode === 'repeat' && this.repeatsDone < this.settings.repeat) {
      this.playSegment(this.index, false);
    } else if (this.index < this.segments.length - 1) {
      this.playSegment(this.index + 1);
    } else {
      this.finish();
    }
  }

  private finish(): void {
    this.media.pause();
    this.seekPending = null;
    this.setPhase('ended');
    this.hooks.onFinished?.();
  }

  private seekTo(seconds: number, tries: number): void {
    const target = Math.max(0, seconds);
    this.media.seek(target);
    this.seekPending = { target, since: this.now(), tries };
  }

  // True once the video reports a time near where we sent it. If it never does
  // (a slow network, an ad), seek again a couple of times, then trust it.
  private seekSettled(t: number): boolean {
    const pending = this.seekPending!;
    if (t >= pending.target - 0.6 && t <= pending.target + 1) {
      this.seekPending = null;
      return true;
    }
    if (this.now() - pending.since < SEEK_SETTLE_MS) return false;
    if (pending.tries < SEEK_RETRIES) {
      this.seekTo(pending.target, pending.tries + 1);
      this.media.play();
      return false;
    }
    this.seekPending = null;
    return true;
  }

  private clamp(index: number): number {
    return Math.max(0, Math.min(this.segments.length - 1, Math.floor(index) || 0));
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.emit();
  }

  private emit(): void {
    this.hooks.onChange?.(this.snapshot());
  }
}
