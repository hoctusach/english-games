import type { Segment } from '@/shadowing/types';
import { SegmentPlayer, type MediaLike, type PlayerSnapshot } from '@/shadowing/SegmentPlayer';

// Learning a video that has no transcript, one sentence at a time: the video plays on
// and the learner taps at the end of each sentence ("cut"). The tap marks where that
// sentence ends; the sentence is then played again and it is the learner's turn to
// say it back, after which the video goes on from there. The marks are the sentences
// of the lesson from then on. Like SegmentPlayer, it keeps no time of its own: the
// screen calls tick() every few dozen milliseconds.

export type LivePhase = 'idle' | 'listening' | 'paused' | 'practising' | 'ended';

export interface LiveSettings {
  rate: number;
  gapFactor: number;
  softHold: boolean;
}

export interface LiveSnapshot {
  phase: LivePhase;
  // where the sentence being listened to starts
  anchor: number;
  // sentences marked in this session
  cuts: number;
  // while practising: the replay / the learner's turn
  practice: PlayerSnapshot | null;
}

export interface LiveHooks {
  onChange?: (snapshot: LiveSnapshot) => void;
  // a sentence was marked; `index` counts from the first sentence of the lesson
  onCut?: (segment: Segment, index: number) => void;
  // the last mark was taken back
  onUncut?: (index: number, anchor: number) => void;
  // the sentence was heard again and the learner's turn has passed
  onPractised?: (index: number) => void;
  // the video reached its end
  onFinished?: () => void;
  now?: () => number;
}

// the time between hearing a sentence end and tapping, in seconds of real time
export const REACTION_SECONDS = 0.2;
// shortest sentence that can be marked: taps closer than this are slips
export const MIN_SENTENCE_SECONDS = 0.8;
const END_MARGIN_SECONDS = 0.3;

export class LiveMarker {
  private phase: LivePhase = 'idle';
  private anchor: number;
  private cuts: Segment[] = [];
  private inner: SegmentPlayer;
  private practice: PlayerSnapshot | null = null;

  constructor(
    private media: MediaLike,
    private settings: LiveSettings,
    private hooks: LiveHooks,
    startAt: number,
    private duration: number,
    // sentences the lesson already has before this one
    private baseIndex: number,
  ) {
    this.anchor = Math.max(0, startAt);
    this.inner = new SegmentPlayer(
      media,
      [{ start: 0, end: 1, text: '' }],
      { mode: 'repeat', rate: settings.rate, repeat: 1, gapFactor: settings.gapFactor, autoNext: true, softHold: settings.softHold },
      {
        now: hooks.now,
        onChange: (snapshot) => {
          this.practice = snapshot;
          if (this.phase === 'practising') this.emit();
        },
        onFinished: () => this.afterPractice(),
      },
    );
  }

  snapshot(): LiveSnapshot {
    const practice = this.phase === 'practising' ? this.inner.snapshot() : null;
    return { phase: this.phase, anchor: this.anchor, cuts: this.cuts.length, practice };
  }

  get marked(): Segment[] {
    return this.cuts;
  }

  // ---------- controls ----------

  start(): void {
    this.media.setRate(this.settings.rate);
    this.listenFrom(this.anchor);
  }

  // The learner taps: the sentence being heard ends about now.
  cut(): boolean {
    if (this.phase !== 'listening') return false;
    const end = this.media.time() - REACTION_SECONDS * this.settings.rate;
    if (end - this.anchor < MIN_SENTENCE_SECONDS) return false;
    const segment: Segment = { start: this.anchor, end, text: '' };
    this.cuts.push(segment);
    this.hooks.onCut?.(segment, this.baseIndex + this.cuts.length - 1);
    this.inner.setSegments([segment], 0);
    this.phase = 'practising';
    this.inner.playSegment(0);
    this.emit();
    return true;
  }

  // Takes back the last mark and listens to that sentence again from its start.
  undo(): boolean {
    const last = this.cuts.pop();
    if (!last) return false;
    this.inner.reset(0);
    this.hooks.onUncut?.(this.baseIndex + this.cuts.length, last.start);
    this.listenFrom(last.start);
    return true;
  }

  // ▶/⏸: pause or go on; while practising it skips to the next step like SegmentPlayer.
  toggle(): void {
    if (this.phase === 'listening') {
      this.media.pause();
      this.setPhase('paused');
    } else if (this.phase === 'paused') {
      this.media.play();
      this.setPhase('listening');
    } else if (this.phase === 'practising') {
      this.inner.toggle();
    }
  }

  // Skip the rest of the learner's turn.
  skipGap(): void {
    if (this.phase === 'practising') this.inner.skipGap();
  }

  setRate(rate: number): void {
    this.settings.rate = rate;
    this.inner.setRate(rate);
  }

  updateSettings(settings: Partial<LiveSettings>): void {
    Object.assign(this.settings, settings);
    this.inner.updateSettings({ gapFactor: this.settings.gapFactor, softHold: this.settings.softHold });
  }

  stop(): void {
    this.inner.reset(0);
    this.media.pause();
    this.setPhase('idle');
  }

  // The video was paused or started from outside (its own controls, the app going to
  // the background).
  externalPause(): void {
    if (this.phase === 'listening') this.setPhase('paused');
    else if (this.phase === 'practising') this.inner.externalPause();
  }

  externalPlay(): void {
    if (this.phase === 'paused') this.setPhase('listening');
  }

  externalEnded(): void {
    if (this.phase === 'listening') this.end();
  }

  // ---------- the clock ----------

  tick(): void {
    if (this.phase === 'practising') {
      this.inner.tick();
      return;
    }
    if (this.phase !== 'listening') return;
    if (this.duration > 0 && this.media.time() >= this.duration - END_MARGIN_SECONDS) this.end();
  }

  // ---------- internals ----------

  private listenFrom(seconds: number): void {
    this.anchor = Math.max(0, seconds);
    this.media.seek(this.anchor);
    this.media.play();
    this.setPhase('listening');
  }

  // The replay and the learner's turn are over: go on from where the sentence ended.
  private afterPractice(): void {
    if (this.phase !== 'practising') return;
    const index = this.baseIndex + this.cuts.length - 1;
    const last = this.cuts[this.cuts.length - 1];
    this.hooks.onPractised?.(index);
    if (this.duration > 0 && last.end >= this.duration - END_MARGIN_SECONDS) {
      this.end();
      return;
    }
    this.listenFrom(last.end);
  }

  private end(): void {
    this.media.pause();
    this.setPhase('ended');
    this.hooks.onFinished?.();
  }

  private setPhase(phase: LivePhase): void {
    this.phase = phase;
    this.emit();
  }

  private emit(): void {
    this.hooks.onChange?.(this.snapshot());
  }
}
