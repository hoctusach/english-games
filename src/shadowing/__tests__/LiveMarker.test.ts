import { beforeEach, describe, expect, it } from 'vitest';
import { gapMs, type MediaLike } from '@/shadowing/SegmentPlayer';
import { LiveMarker, MIN_SENTENCE_SECONDS, REACTION_SECONDS } from '@/shadowing/LiveMarker';
import type { Segment } from '@/shadowing/types';

// A fake video with its own clock: it moves only when the test advances it.
class FakeMedia implements MediaLike {
  t = 0;
  playing = false;
  rate = 1;
  seeks: number[] = [];
  holds: boolean[] = [];
  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seek(seconds: number) {
    this.seeks.push(seconds);
    this.t = seconds;
  }
  time() {
    return this.t;
  }
  setRate(rate: number) {
    this.rate = rate;
  }
  hold(on: boolean) {
    this.holds.push(on);
    if (on) this.playing = true;
  }
  advance(seconds: number) {
    if (this.playing) this.t += seconds * this.rate;
  }
}

let now = 0;
let media: FakeMedia;
let cuts: [Segment, number][];
let uncuts: [number, number][];
let practised: number[];
let finished: number;

function make(options: { start?: number; duration?: number; base?: number; softHold?: boolean; rate?: number } = {}) {
  return new LiveMarker(
    media,
    { rate: options.rate ?? 1, gapFactor: 0.75, softHold: options.softHold ?? false },
    {
      now: () => now,
      onCut: (segment, index) => cuts.push([segment, index]),
      onUncut: (index, anchor) => uncuts.push([index, anchor]),
      onPractised: (index) => practised.push(index),
      onFinished: () => finished++,
    },
    options.start ?? 0,
    options.duration ?? 60,
    options.base ?? 0,
  );
}

function run(marker: LiveMarker, seconds: number, step = 0.05) {
  for (let s = 0; s < seconds - 1e-9; s += step) {
    now += step * 1000;
    media.advance(step);
    marker.tick();
  }
}

beforeEach(() => {
  now = 0;
  media = new FakeMedia();
  cuts = [];
  uncuts = [];
  practised = [];
  finished = 0;
});

describe('learn and mark', () => {
  it('plays on from the start until the learner marks the end of a sentence', () => {
    const marker = make();
    marker.start();
    expect(marker.snapshot()).toMatchObject({ phase: 'listening', anchor: 0, cuts: 0 });
    expect(media.playing).toBe(true);
    run(marker, 3);
    expect(marker.snapshot().phase).toBe('listening'); // nothing stops it by itself
    expect(media.t).toBeCloseTo(3, 1);

    expect(marker.cut()).toBe(true);
    expect(cuts).toHaveLength(1);
    const [segment, index] = cuts[0];
    expect(index).toBe(0);
    expect(segment.start).toBe(0);
    expect(segment.end).toBeCloseTo(3 - REACTION_SECONDS, 1);
    expect(marker.snapshot().phase).toBe('practising');
  });

  it('hears the sentence again, gives the learner a turn, then goes on from its end', () => {
    const marker = make();
    marker.start();
    run(marker, 3);
    marker.cut();
    const end = cuts[0][0].end;
    // replay: back to the sentence's start
    expect(media.seeks[media.seeks.length - 1]).toBeCloseTo(0 - 0.1 < 0 ? 0 : -0.1, 5);
    run(marker, end + 0.5);
    expect(marker.snapshot().practice?.phase).toBe('gap');
    expect(media.playing).toBe(false);
    expect(practised).toEqual([]);
    run(marker, gapMs(cuts[0][0], 1, 0.75) / 1000 + 0.2);
    expect(practised).toEqual([0]);
    expect(marker.snapshot()).toMatchObject({ phase: 'listening', anchor: end });
    expect(media.playing).toBe(true);
    expect(media.t).toBeGreaterThanOrEqual(end);

    // the next sentence starts where the last one ended
    run(marker, 2.5);
    marker.cut();
    expect(cuts[1][0].start).toBeCloseTo(end, 5);
    expect(cuts[1][1]).toBe(1);
    expect(marker.marked).toHaveLength(2);
  });

  it('numbers sentences after the ones the lesson already has, and starts from the given time', () => {
    const marker = make({ start: 20, base: 7 });
    marker.start();
    expect(media.seeks).toEqual([20]);
    run(marker, 3);
    marker.cut();
    expect(cuts[0][1]).toBe(7);
    expect(cuts[0][0].start).toBe(20);
  });

  it('ignores a tap too soon after the last one', () => {
    const marker = make();
    marker.start();
    run(marker, MIN_SENTENCE_SECONDS);
    expect(marker.cut()).toBe(false);
    expect(cuts).toEqual([]);
    expect(marker.snapshot().phase).toBe('listening');
    marker.undo(); // nothing to take back
    expect(uncuts).toEqual([]);
  });

  it('takes a mark back and listens to that sentence again', () => {
    const marker = make();
    marker.start();
    run(marker, 3);
    marker.cut();
    run(marker, 3 + 2.5); // through the replay and the gap, on into the next sentence
    run(marker, 3);
    marker.cut();
    expect(marker.marked).toHaveLength(2);
    const second = cuts[1][0];
    marker.undo();
    expect(uncuts).toEqual([[1, second.start]]);
    expect(marker.marked).toHaveLength(1);
    expect(marker.snapshot()).toMatchObject({ phase: 'listening', anchor: second.start });
    expect(media.t).toBeCloseTo(second.start, 5);
    expect(media.playing).toBe(true);
  });

  it('pauses and goes on; follows the video paused from outside', () => {
    const marker = make();
    marker.start();
    run(marker, 1);
    marker.toggle();
    expect(marker.snapshot().phase).toBe('paused');
    expect(media.playing).toBe(false);
    const t = media.t;
    run(marker, 2);
    expect(media.t).toBe(t);
    expect(marker.cut()).toBe(false); // not while paused
    marker.toggle();
    expect(marker.snapshot().phase).toBe('listening');
    expect(media.playing).toBe(true);
    media.pause();
    marker.externalPause();
    expect(marker.snapshot().phase).toBe('paused');
    media.play();
    marker.externalPlay();
    expect(marker.snapshot().phase).toBe('listening');
  });

  it('skips the learner’s turn', () => {
    const marker = make();
    marker.start();
    run(marker, 3);
    marker.cut();
    run(marker, 3.3);
    expect(marker.snapshot().practice?.phase).toBe('gap');
    marker.skipGap();
    expect(practised).toEqual([0]);
    expect(marker.snapshot().phase).toBe('listening');
  });

  it('finishes when the video ends, also after the last sentence was marked', () => {
    const marker = make({ duration: 5 });
    marker.start();
    run(marker, 6);
    expect(marker.snapshot().phase).toBe('ended');
    expect(finished).toBe(1);
    expect(media.playing).toBe(false);

    media = new FakeMedia();
    finished = 0;
    cuts = [];
    const second = make({ duration: 5 });
    second.start();
    run(second, 4.6);
    second.cut(); // the last sentence, marked just before the end
    run(second, 12);
    expect(practised).toEqual([0]);
    expect(second.snapshot().phase).toBe('ended');
    expect(finished).toBe(1);

    media = new FakeMedia();
    finished = 0;
    const third = make({ duration: 100 });
    third.start();
    third.externalEnded();
    expect(finished).toBe(1);
  });

  it('waits for the learner muted and slow, not paused, with soft hold; lets go before going on', () => {
    const marker = make({ softHold: true });
    marker.start();
    run(marker, 3);
    marker.cut();
    run(marker, 3.3);
    expect(marker.snapshot().practice?.phase).toBe('gap');
    expect(media.holds).toEqual([true]);
    expect(media.playing).toBe(true);
    run(marker, 4);
    expect(media.holds).toEqual([true, false]);
    expect(marker.snapshot().phase).toBe('listening');
  });

  it('cuts by video time at a slower speed', () => {
    const marker = make({ rate: 0.5 });
    marker.start();
    expect(media.rate).toBe(0.5);
    run(marker, 6); // 3 s of video
    marker.cut();
    expect(cuts[0][0].end).toBeCloseTo(3 - REACTION_SECONDS * 0.5, 1);
  });
});
