import { beforeEach, describe, expect, it } from 'vitest';
import { gapMs, SegmentPlayer, type MediaLike, type PlayerSettings } from '@/shadowing/SegmentPlayer';
import type { Segment } from '@/shadowing/types';

// A fake video with its own clock: time moves only when the test advances it.
class FakeMedia implements MediaLike {
  t = 0;
  playing = false;
  rate = 1;
  seeks: number[] = [];
  // how many advance() calls a seek takes to show up (YouTube reports late)
  lag = 0;
  private pendingSeek: { to: number; left: number } | null = null;

  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seek(seconds: number) {
    this.seeks.push(seconds);
    if (this.lag) this.pendingSeek = { to: seconds, left: this.lag };
    else this.t = seconds;
  }
  time() {
    return this.t;
  }
  setRate(rate: number) {
    this.rate = rate;
  }
  advance(seconds: number) {
    if (this.pendingSeek && --this.pendingSeek.left <= 0) {
      this.t = this.pendingSeek.to;
      this.pendingSeek = null;
    }
    if (this.playing) this.t += seconds * this.rate;
  }
}

const segments: Segment[] = [
  { start: 1, end: 3, text: 'one' },
  { start: 3, end: 6, text: 'two' },
  { start: 6, end: 8, text: 'three' },
];

let now = 0;
let media: FakeMedia;
let done: number[];
let finished: number;

function make(settings: Partial<PlayerSettings> = {}, start = 0) {
  return new SegmentPlayer(
    media,
    segments,
    { mode: 'repeat', rate: 1, repeat: 1, gapFactor: 1, autoNext: true, ...settings },
    {
      now: () => now,
      onSegmentDone: (i) => done.push(i),
      onFinished: () => finished++,
    },
    start,
  );
}

// advance both clocks in small steps, ticking the player each step
function run(player: SegmentPlayer, seconds: number, step = 0.05) {
  for (let s = 0; s < seconds - 1e-9; s += step) {
    now += step * 1000;
    media.advance(step);
    player.tick();
  }
}

beforeEach(() => {
  now = 0;
  media = new FakeMedia();
  done = [];
  finished = 0;
});

describe('listen & repeat', () => {
  it('plays a sentence, stops for the gap, then moves on', () => {
    const player = make();
    expect(player.snapshot().phase).toBe('idle');
    player.toggle();
    expect(player.snapshot()).toMatchObject({ phase: 'playing', index: 0 });
    expect(media.seeks).toEqual([0.9]);

    run(player, 2.5);
    expect(player.snapshot().phase).toBe('gap');
    expect(media.playing).toBe(false);
    expect(done).toEqual([0]);
    // stopped just after the end, not before
    expect(media.t).toBeGreaterThanOrEqual(3.2);
    expect(media.t).toBeLessThan(3.35);

    const gap = gapMs(segments[0], 1, 1) / 1000;
    run(player, gap / 2);
    expect(player.snapshot().gapProgress).toBeGreaterThan(0.4);
    expect(player.snapshot().gapProgress).toBeLessThan(0.6);
    run(player, gap / 2 + 0.1);
    expect(player.snapshot()).toMatchObject({ phase: 'playing', index: 1 });
  });

  it('plays each sentence the chosen number of times', () => {
    const player = make({ repeat: 2 });
    player.toggle();
    run(player, 2.5);
    expect(player.snapshot()).toMatchObject({ phase: 'gap', index: 0, repeatsDone: 1 });
    run(player, gapMs(segments[0], 1, 1) / 1000 + 0.1);
    expect(player.snapshot()).toMatchObject({ phase: 'playing', index: 0, repeatsDone: 1 });
    run(player, 2.5);
    expect(player.snapshot()).toMatchObject({ phase: 'gap', index: 0, repeatsDone: 2 });
    run(player, gapMs(segments[0], 1, 1) / 1000 + 0.1);
    expect(player.snapshot()).toMatchObject({ phase: 'playing', index: 1, repeatsDone: 0 });
    expect(done).toEqual([0, 0]);
  });

  it('waits after the gap when auto-next is off, and ▶ goes on', () => {
    const player = make({ autoNext: false });
    player.toggle();
    run(player, 2.5);
    run(player, 10);
    expect(player.snapshot()).toMatchObject({ phase: 'waiting', index: 0 });
    player.toggle();
    expect(player.snapshot()).toMatchObject({ phase: 'playing', index: 1 });
  });

  it('pauses and resumes mid-sentence', () => {
    const player = make();
    player.toggle();
    run(player, 1);
    player.toggle();
    expect(player.snapshot().phase).toBe('paused');
    const t = media.t;
    run(player, 3);
    expect(media.t).toBe(t);
    player.toggle();
    expect(player.snapshot().phase).toBe('playing');
    run(player, 1.5);
    expect(player.snapshot().phase).toBe('gap');
  });

  it('▶ during the gap holds it; ▶ again goes on', () => {
    const player = make();
    player.toggle();
    run(player, 2.5);
    player.toggle();
    expect(player.snapshot().phase).toBe('waiting');
    run(player, 20);
    expect(player.snapshot().phase).toBe('waiting');
    player.toggle();
    expect(player.snapshot()).toMatchObject({ phase: 'playing', index: 1 });
  });

  it('replay plays the same sentence again from its start', () => {
    const player = make();
    player.toggle();
    run(player, 2.5);
    player.replay();
    expect(player.snapshot()).toMatchObject({ phase: 'playing', index: 0 });
    expect(media.seeks[media.seeks.length - 1]).toBe(0.9);
  });

  it('ignores the stale time a video reports right after a seek', () => {
    const player = make();
    player.toggle();
    run(player, 2.5); // now at ~3.25, in the gap
    media.lag = 4; // the next seek shows up 4 ticks late
    player.replay();
    run(player, 0.1);
    // still reporting 3.25 (past the end): must not count as finished
    expect(player.snapshot().phase).toBe('playing');
    run(player, 2.5);
    expect(player.snapshot().phase).toBe('gap');
    expect(done).toEqual([0, 0]);
  });

  it('seeks again when the video never gets there', () => {
    const player = make();
    player.toggle();
    run(player, 2.5);
    media.lag = 1000;
    player.replay();
    const seeks = media.seeks.length;
    run(player, 3);
    expect(media.seeks.length).toBe(seeks + 1);
  });

  it('next/prev move between sentences; next on the last one finishes', () => {
    const player = make({}, 1);
    player.next();
    expect(player.snapshot().index).toBe(2);
    player.prev();
    player.prev();
    player.prev();
    expect(player.snapshot().index).toBe(0);
    player.playSegment(2);
    player.next();
    expect(player.snapshot().phase).toBe('ended');
    expect(finished).toBe(1);
    player.toggle();
    expect(player.snapshot()).toMatchObject({ phase: 'playing', index: 0 });
  });

  it('finishes after the last sentence', () => {
    const player = make({}, 2);
    player.toggle();
    run(player, 2.5);
    run(player, 10);
    expect(player.snapshot().phase).toBe('ended');
    expect(finished).toBe(1);
    expect(done).toEqual([2]);
  });

  it('a longer gap at a slower speed', () => {
    expect(gapMs(segments[0], 0.5, 1)).toBeGreaterThan(gapMs(segments[0], 1, 1));
    expect(gapMs(segments[0], 1, 1.5)).toBeGreaterThan(gapMs(segments[0], 1, 1));
    expect(gapMs({ start: 0, end: 0.1, text: '' }, 1, 1)).toBe(1500);
    expect(gapMs({ start: 0, end: 100, text: '' }, 1, 1)).toBe(30000);
  });
});

describe('shadow mode', () => {
  it('plays on, following the sentences, and finishes at the end', () => {
    const player = make({ mode: 'shadow' });
    player.toggle();
    run(player, 3);
    expect(player.snapshot()).toMatchObject({ phase: 'playing', index: 1 });
    expect(media.playing).toBe(true);
    run(player, 3);
    expect(player.snapshot().index).toBe(2);
    run(player, 3);
    expect(player.snapshot().phase).toBe('ended');
    expect(done).toEqual([0, 1, 2]);
    expect(finished).toBe(1);
  });

  it('loops one sentence', () => {
    const player = make({ mode: 'shadow' }, 1);
    player.toggle();
    player.setLoop(true);
    run(player, 8);
    expect(player.snapshot().index).toBe(1);
    expect(media.t).toBeGreaterThanOrEqual(2.9);
    expect(media.t).toBeLessThan(6.3);
    expect(done.length).toBeGreaterThanOrEqual(2);
    expect(done.every((i) => i === 1)).toBe(true);
  });

  it('switching to shadow mode during a gap waits for ▶', () => {
    const player = make();
    player.toggle();
    run(player, 2.5);
    player.setMode('shadow');
    expect(player.snapshot()).toMatchObject({ phase: 'waiting', mode: 'shadow' });
  });
});

describe('outside the app', () => {
  it('follows the video’s own pause and play', () => {
    const player = make({ mode: 'shadow' });
    player.toggle();
    run(player, 1);
    media.pause();
    player.externalPause();
    expect(player.snapshot().phase).toBe('paused');
    media.t = 6.5;
    media.play();
    player.externalPlay();
    expect(player.snapshot()).toMatchObject({ phase: 'playing', index: 2 });
  });

  it('turns a gap into waiting when the app goes to the background', () => {
    const player = make();
    player.toggle();
    run(player, 2.5);
    player.externalPause();
    expect(player.snapshot().phase).toBe('waiting');
  });

  it('keeps its place when sentences are edited', () => {
    const player = make({}, 2);
    player.setSegments(segments.slice(0, 2));
    expect(player.snapshot().index).toBe(1);
    expect(player.count).toBe(2);
  });

  it('sets the speed on the video', () => {
    const player = make({ rate: 0.75 });
    expect(media.rate).toBe(0.75);
    player.setRate(0.5);
    expect(media.rate).toBe(0.5);
  });
});
