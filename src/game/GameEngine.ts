import type { WordSet } from '@/types/wordset';
import { speak, prepareSpeech } from '@/audio/pronounce';
import { playTick, playSuccess, playMiss } from '@/audio/sfx';
import { getBackgroundThemeId } from '@/data/settingsStore';
import { setWordSetSpeedFactor } from '@/data/wordSetStore';
import { getThemeById } from '@/ui/backgrounds';
import { PLATE_PADDING, type FallingWord } from './FallingWord';
import { Spawner } from './Spawner';
import { ChallengeSpawner } from './ChallengeSpawner';
import { PRACTICE, seededRandom, type GameMode } from './GameMode';
import { ProgressTracker } from './ProgressTracker';
import { termKey } from '@/data/progressStore';
import { CanvasRenderer } from './CanvasRenderer';
import { InputController } from './InputController';
import { createScoreState, applyKill, applyMiss, type ScoreState } from './Scoring';
import {
  spawnIntervalMs,
  fallSpeedPxPerSec,
  speedScoreMultiplier,
  stepSpeedFactor,
  snapSpeedFactor,
  maxWordsOnScreen,
} from './DifficultyCurve';
import { defaultSpeedForSet } from './difficultyScore';
import {
  type Projectile,
  type Particle,
  createProjectile,
  advanceProjectiles,
  createBurst,
  createConfetti,
  createImpactBurst,
  advanceParticles,
  turretPosition,
  turretScale,
  bottomMargin,
  TURRET_BARREL_LENGTH,
} from './effects';
import { normalizeForTyping } from './typing';

export interface GameEngineEvents {
  onScoreChange?: (state: ScoreState) => void;
  onWordKilled?: (word: FallingWord) => void;
  onPauseChange?: (paused: boolean) => void;
  onSpeedChange?: (factor: number) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onSuggestionBlocked?: () => void;
  onVietnameseInput?: () => void;
  // a word reached the danger line (the screen shakes for SHAKE_MS)
  onImpact?: () => void;
  // challenge only: the miss limit was reached
  onGameOver?: (state: ScoreState) => void;
}

const SIDE_MARGIN = 16;
const NON_ASCII = /[^\x00-\x7f]/;
export const SHAKE_MS = 380;
// small screens need a bigger jolt to read as a shake
const SHAKE_PX = 9;
const SHAKE_PX_SMALL_SCREEN = 12;
const SMALL_SCREEN_PX = 600;
const VIBRATE_PATTERN = [90, 40, 90];
// how far above the danger line a word starts to make the line glow harder
const DANGER_ZONE_PX = 120;
const EMPTY_SCREEN_SPAWN_MS = 700;
// smallest size a long phrase is shrunk to (12px text)
const MIN_WORD_SCALE = 0.6;

export class GameEngine {
  private ctx: CanvasRenderingContext2D;
  private renderer: CanvasRenderer;
  private spawner: Spawner | ChallengeSpawner;
  // spawn positions: seeded in a challenge so every attempt looks the same
  private random: () => number;
  private progress: ProgressTracker;
  private input: InputController;
  private wordSetId: string;
  private speedFactor: number;
  private activeWords: FallingWord[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private scoreState: ScoreState = createScoreState();
  private rafId: number | null = null;
  private lastFrameTime = 0;
  private lastSpawnTime = 0;
  private validValue = '';
  // a wrong key was pressed and no correct one since: the renderer marks the next letter
  private wrongHint = false;
  private shakeUntil = 0;
  // exposed for tests: the offset applied to the scene this frame
  shakeOffset = { x: 0, y: 0 };
  private running = false;
  private paused = false;

  constructor(
    private canvas: HTMLCanvasElement,
    container: HTMLElement,
    wordSet: WordSet,
    private events: GameEngineEvents,
    private mode: GameMode = PRACTICE,
    virtualKeyboard = false,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.renderer = new CanvasRenderer(canvas, this.ctx, getThemeById(getBackgroundThemeId()));
    this.renderer.afterResize = () => {
      if (this.running && this.paused) this.draw(performance.now());
    };
    // ?debug in the URL: let automated checks read where the words are
    if (new URLSearchParams(location.search).has('debug')) {
      (window as unknown as { __shootWords: () => unknown }).__shootWords = () =>
        this.activeWords.map((w) => ({ term: w.term, x: w.x, y: w.y, scale: w.scale, width: w.width, canvasWidth: this.renderer.widthCss }));
      (window as unknown as { __shootState: () => unknown }).__shootState = () => ({
        projectiles: this.projectiles.length,
        typed: this.validValue,
      });
    }
    this.wordSetId = wordSet.id;
    this.progress = new ProgressTracker(wordSet.id);
    if (mode.kind === 'challenge') {
      this.speedFactor = snapSpeedFactor(mode.speed);
      this.spawner = new ChallengeSpawner(wordSet.words, mode.seed);
      this.random = seededRandom(mode.seed ^ 0x9e3779b9);
      this.scoreState = createScoreState(mode.missLimit);
    } else {
      this.speedFactor = snapSpeedFactor(wordSet.speedFactor ?? defaultSpeedForSet(wordSet.words));
      this.spawner = new Spawner(wordSet.words, this.progress);
      this.random = Math.random;
    }
    this.input = new InputController(
      container,
      (value) => this.handleInput(value),
      (focused) => this.events.onInputFocusChange?.(focused),
      () => {
        this.flashInvalid();
        this.events.onSuggestionBlocked?.();
      },
      virtualKeyboard,
    );
  }

  // `paused`: set the round up and show it still, waiting for a tap to begin (used
  // when the app opens straight into a round: a phone keyboard only opens on a tap).
  start({ paused = false }: { paused?: boolean } = {}): void {
    this.running = true;
    this.paused = false;
    this.lastFrameTime = performance.now();
    this.lastSpawnTime = this.lastFrameTime;
    this.events.onScoreChange?.(this.scoreState);
    this.events.onSpeedChange?.(this.speedFactor);
    this.input.focus();
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('keydown', this.handleKeydown);
    if (paused) {
      this.draw(this.lastFrameTime);
      this.paused = true;
      this.input.enabled = false;
      this.events.onPauseChange?.(true);
      return;
    }
    this.rafId = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.running = false;
    this.input.enabled = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('keydown', this.handleKeydown);
    this.input.destroy();
    this.renderer.destroy();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get speed(): number {
    return this.speedFactor;
  }

  adjustSpeed(direction: 1 | -1): void {
    // a challenge runs at the speed it was set up with, the same for everyone
    if (this.mode.kind === 'challenge') return;
    const next = stepSpeedFactor(this.speedFactor, direction);
    if (next === this.speedFactor) return;
    this.speedFactor = next;
    setWordSetSpeedFactor(this.wordSetId, next);
    this.events.onSpeedChange?.(next);
    this.input.focus();
  }

  togglePause(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  focusInput(): void {
    this.input.focus();
  }

  // keys from the on-screen keyboard
  typeKey(ch: string): void {
    this.input.type(ch);
  }

  backspaceKey(): void {
    this.input.backspace();
  }

  private handleVisibility = (): void => {
    if (document.hidden) this.pause();
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.togglePause();
  };

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.input.enabled = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.events.onPauseChange?.(true);
  }

  private resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.input.enabled = true;
    this.lastFrameTime = performance.now();
    this.input.focus();
    this.rafId = requestAnimationFrame(this.loop);
    this.events.onPauseChange?.(false);
  }

  private loop = (time: number): void => {
    if (!this.running || this.paused) return;
    const dt = time - this.lastFrameTime;
    this.lastFrameTime = time;
    this.update(time, dt);
    if (!this.running) return;
    this.draw(time);
    this.rafId = requestAnimationFrame(this.loop);
  };

  private draw(time: number): void {
    const shakeLeft = Math.max(0, this.shakeUntil - time) / SHAKE_MS;
    const shakePx = this.renderer.widthCss < SMALL_SCREEN_PX ? SHAKE_PX_SMALL_SCREEN : SHAKE_PX;
    const amplitude = shakePx * shakeLeft * shakeLeft;
    this.shakeOffset = shakeLeft
      ? { x: (Math.random() * 2 - 1) * amplitude, y: (Math.random() * 2 - 1) * amplitude }
      : { x: 0, y: 0 };
    this.renderer.render({
      words: this.activeWords,
      typedValue: this.validValue,
      wrongHint: this.wrongHint,
      targetId: this.targetWord()?.id ?? null,
      dangerLevel: this.dangerLevel(),
      shake: this.shakeOffset,
      impactFlash: shakeLeft,
      elapsedMs: time,
      projectiles: this.projectiles,
      particles: this.particles,
      aim: this.aimTarget(),
    });
  }

  private update(time: number, dt: number): void {
    const interval = spawnIntervalMs(this.scoreState.level, this.speedFactor);
    const sinceSpawn = time - this.lastSpawnTime;
    const hasRoom = this.activeWords.length < maxWordsOnScreen(this.speedFactor);
    // don't leave a slow player staring at an empty screen until the next timed spawn
    const screenEmpty = this.activeWords.length === 0 && sinceSpawn >= EMPTY_SCREEN_SPAWN_MS;
    if (hasRoom && (sinceSpawn >= interval || screenEmpty)) {
      this.trySpawn();
      this.lastSpawnTime = time;
    }

    const fallSpeed = fallSpeedPxPerSec(this.scoreState.level, this.speedFactor);
    const heightCss = this.renderer.heightCss;
    const widthCss = this.renderer.widthCss;
    for (const word of this.activeWords) {
      word.y += fallSpeed * (dt / 1000);
      // keep it inside if the play area got narrower mid-fall (rotation, resize)
      const maxX = widthCss - SIDE_MARGIN - word.width + PLATE_PADDING * word.scale;
      if (word.x > maxX) word.x = Math.max(SIDE_MARGIN + PLATE_PADDING * word.scale, maxX);
    }

    this.projectiles = advanceProjectiles(this.projectiles, dt);
    this.particles = advanceParticles(this.particles, dt);

    const missed = this.activeWords.filter((w) => w.y >= heightCss - bottomMargin(heightCss));
    if (missed.length > 0) {
      const missedIds = new Set(missed.map((w) => w.id));
      this.activeWords = this.activeWords.filter((w) => !missedIds.has(w.id));
      for (const word of missed) {
        this.progress.recordMiss(word.term);
        this.scoreState = applyMiss(this.scoreState);
        const center = word.x - PLATE_PADDING * word.scale + word.width / 2;
        this.particles.push(...createImpactBurst(center, heightCss - bottomMargin(heightCss)));
      }
      this.impact(time);
      this.events.onScoreChange?.(this.scoreState);
      if (this.scoreState.lives <= 0) {
        this.gameOver();
        return;
      }
    }

    // the word being typed can fall off screen — don't leave a dead prefix blocking input
    if (this.validValue && !this.matchingWords(this.validValue).length) {
      this.resetInput();
    }
  }

  private matchingWords(value: string): FallingWord[] {
    return this.activeWords.filter((w) => normalizeForTyping(w.term).startsWith(value));
  }

  // A word reached the danger line: jolt the screen, flash red, thud, buzz the phone.
  private impact(time: number): void {
    this.shakeUntil = time + SHAKE_MS;
    playMiss();
    this.events.onImpact?.();
    try {
      // Android only: iPhone browsers don't let web pages vibrate
      navigator.vibrate?.(VIBRATE_PATTERN);
    } catch {
      // vibration blocked or unsupported
    }
  }

  private dangerLevel(): number {
    if (this.activeWords.length === 0) return 0;
    const height = this.renderer.heightCss;
    const lowest = Math.max(...this.activeWords.map((w) => w.y));
    const gap = height - bottomMargin(height) - lowest;
    return Math.min(1, Math.max(0, 1 - gap / DANGER_ZONE_PX));
  }

  // the word being typed — the lowest one matching what's typed so far
  private targetWord(): FallingWord | null {
    if (!this.validValue) return null;
    const candidates = this.matchingWords(this.validValue);
    if (candidates.length === 0) return null;
    return candidates.reduce((lowest, w) => (w.y > lowest.y ? w : lowest));
  }

  private aimTarget(): { x: number; y: number } | null {
    const candidates = this.validValue ? this.matchingWords(this.validValue) : this.activeWords;
    if (candidates.length === 0) return null;
    return candidates.reduce((lowest, w) => (w.y > lowest.y ? w : lowest));
  }

  private resetInput(): void {
    this.validValue = '';
    this.wrongHint = false;
    this.input.clear();
  }

  private trySpawn(): void {
    const activeTerms = new Set(this.activeWords.map((w) => termKey(w.term)));
    const word = this.spawner.next(activeTerms);
    if (!word) return;
    // Fit the whole word on screen: shrink a phrase wider than the play area, then
    // place it anywhere its plate stays inside the side margins.
    const widthCss = this.renderer.widthCss;
    const fullWidth = this.renderer.measureWordWidth(word.term) + PLATE_PADDING * 2;
    const usable = Math.max(1, widthCss - SIDE_MARGIN * 2);
    const scale = fullWidth > usable ? Math.max(MIN_WORD_SCALE, usable / fullWidth) : 1;
    const width = fullWidth * scale;
    const minX = SIDE_MARGIN + PLATE_PADDING * scale;
    const maxX = Math.max(minX, widthCss - SIDE_MARGIN - width + PLATE_PADDING * scale);
    this.activeWords.push({
      id: crypto.randomUUID(),
      term: word.term,
      meaning: word.meaning,
      example: word.example,
      x: minX + this.random() * (maxX - minX),
      y: -20,
      scale,
      width,
    });
    prepareSpeech(word.term);
  }

  private handleInput(rawValue: string): void {
    // only leading spaces are dropped: the space inside a phrase ("you␣didn't") is a
    // typed key like any letter, and fires a shot
    const raw = rawValue.replace(/^\s+/, '');
    const value = normalizeForTyping(raw);

    if (!value) {
      this.validValue = '';
      return;
    }

    const exactMatch = this.activeWords.find((w) => normalizeForTyping(w.term) === value);
    if (exactMatch) {
      this.killWord(exactMatch);
      return;
    }

    const candidates = this.matchingWords(value);
    if (candidates.length > 0) {
      const isProgress = value.length > this.validValue.length;
      this.validValue = value;
      if (isProgress) {
        this.wrongHint = false;
        playTick();
        this.fireAt(candidates.reduce((lowest, w) => (w.y > lowest.y ? w : lowest)));
      } else if (NON_ASCII.test(raw)) {
        // Vietnamese typing turned "was" into "wá": still on track, but the key did
        // nothing visible, so say why
        this.wrongHint = true;
        this.flashInvalid();
        this.events.onVietnameseInput?.();
      }
      return;
    }

    // Vietnamese typing (Telex) left on turns w-a-s into "wá". Wiping that back to "wa"
    // resets the input method, so every retry gives "wá" again. Leave it in the field:
    // pressing the same key again makes the input method undo it ("wá" + s = "was").
    if (NON_ASCII.test(raw) && value.length <= this.validValue.length + 1) {
      this.wrongHint = true;
      this.flashInvalid();
      this.events.onVietnameseInput?.();
      return;
    }

    // wrong letter: reject it instead of letting it stick and block every later word
    this.input.setValue(this.validValue);
    this.wrongHint = true;
    this.flashInvalid();
  }

  private flashInvalid(): void {
    this.canvas.classList.add('flash-invalid');
    window.setTimeout(() => this.canvas.classList.remove('flash-invalid'), 200);
  }

  private fireAt(word: FallingWord): void {
    const height = this.renderer.heightCss;
    const turret = turretPosition(this.renderer.widthCss, height);
    const angle = Math.atan2(word.y - turret.y, word.x - turret.x);
    const barrel = TURRET_BARREL_LENGTH * turretScale(height);
    this.projectiles.push(
      createProjectile(
        turret.x + Math.cos(angle) * barrel,
        turret.y + Math.sin(angle) * barrel,
        word.x,
        word.y,
      ),
    );
  }

  private killWord(word: FallingWord): void {
    this.fireAt(word);
    this.particles.push(...createBurst(word.x, word.y));
    this.particles.push(...createConfetti(word.x - PLATE_PADDING * word.scale + word.width / 2, word.y - 8));
    this.activeWords = this.activeWords.filter((w) => w.id !== word.id);
    this.progress.recordCorrect(word.term);
    this.resetInput();
    // the example sentence, if any, is read right after the word
    speak(word.term, undefined, word.example?.trim() || undefined);
    playSuccess();
    this.scoreState = applyKill(this.scoreState, word.term, speedScoreMultiplier(this.speedFactor));
    this.events.onScoreChange?.(this.scoreState);
    this.events.onWordKilled?.(word);
  }

  get state(): ScoreState {
    return this.scoreState;
  }

  private gameOver(): void {
    this.destroy();
    this.events.onGameOver?.(this.scoreState);
  }
}
