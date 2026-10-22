import type { App } from '@/App';
import type { ScreenHandle } from '@/ui/ScreenManager';
import type { Segment, ShadowLesson, ShadowMode, TextMode } from '@/shadowing/types';
import {
  CHUNK_SECONDS,
  GAP_FACTORS,
  getLesson,
  loadLessonProgress,
  loadPrefs,
  RATES,
  remapReps,
  REPEATS,
  saveLessonProgress,
  savePrefs,
  setLastLessonId,
  StorageFullError,
  updateLesson,
  type ShadowPrefs,
} from '@/shadowing/lessonStore';
import { SegmentPlayer, type PlayerSnapshot } from '@/shadowing/SegmentPlayer';
import { LiveMarker, type LiveSnapshot } from '@/shadowing/LiveMarker';
import { loadYouTubeApi, YouTubeMedia, type PlayerErrorKind } from '@/shadowing/youtubePlayer';
import { chunkByTime, formatClock, mergeWithNext, removeSegment, splitSegment } from '@/shadowing/segment';
import { maskWord, timedWords, type TimedWord } from '@/shadowing/textMask';
import { watchUrl } from '@/shadowing/youtubeUrl';
import { st } from '@/shadowing/strings';
import { icons } from '@/shadowing/ui/icons';
import { escapeHtml } from '@/utils/dom';
import { track } from '@/analytics';

const TICK_MS = 50;
const SAVE_EVERY_MS = 10000;
const TEXT_MODES: TextMode[] = ['show', 'hint', 'hide'];
// the player scrolled the sentence list: leave it alone for a moment
const LIST_SCROLL_QUIET_MS = 2500;

export function renderShadowLesson(root: HTMLElement, app: App, lessonId: string): ScreenHandle {
  const found = getLesson(lessonId);
  if (!found) {
    app.showShadowHome();
    return {};
  }
  let lesson: ShadowLesson = found;
  setLastLessonId(lesson.id);
  const prefs: ShadowPrefs = loadPrefs();
  const progress = loadLessonProgress(lesson.id, lesson.segments.length);
  track('shadow_open', { sentences: lesson.segments.length, level: lesson.level });

  const wrap = document.createElement('div');
  wrap.className = 'sh-lesson-screen';
  wrap.innerHTML = `
    <header class="sh-bar">
      <button class="sh-bar-btn sh-back" type="button" aria-label="${st('backToLessons')}">${icons.back}</button>
      <h1 class="sh-bar-title"></h1>
      <span class="sh-bar-count"></span>
      <button class="sh-bar-btn sh-settings-btn" type="button" aria-label="${st('settings')}">${icons.settings}</button>
    </header>
    <div class="sh-layout">
      <div class="sh-stage">
        <div class="sh-video">
          <div class="sh-video-host"></div>
          <div class="sh-video-overlay"></div>
        </div>
        <div class="sh-card">
          <div class="sh-card-bar"><span></span></div>
          <div class="sh-card-top">
            <span class="sh-status" aria-live="polite"></span>
            <span class="sh-rep"></span>
          </div>
          <p class="sh-text"></p>
          <p class="sh-next-line"></p>
        </div>
        <div class="sh-controls">
          <div class="sh-mode" role="radiogroup">
            <button type="button" role="radio" data-mode="repeat">${st('modeRepeat')}</button>
            <button type="button" role="radio" data-mode="shadow">${st('modeShadow')}</button>
          </div>
          <button class="sh-speed" type="button" aria-label="${st('speed')}"></button>
        </div>
        <div class="sh-transport">
          <button class="sh-tbtn sh-prev" type="button">${icons.prev}<small>${st('btnPrev')}</small></button>
          <button class="sh-tbtn sh-replay" type="button"><span class="sh-ico"></span><small></small></button>
          <button class="sh-play" type="button">
            <svg class="sh-ring" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="35"/></svg>
            <span class="sh-play-ico"></span>
          </button>
          <button class="sh-tbtn sh-next" type="button">${icons.next}<small>${st('btnNext')}</small></button>
          <button class="sh-tbtn sh-textmode" type="button"><span class="sh-ico"></span><small></small></button>
        </div>
        <div class="sh-mark" hidden>
          <p class="sh-mark-help">${st('markHelp')}</p>
          <div class="sh-mark-row">
            <button class="btn sh-mark-undo" type="button">${st('markUndo')}</button>
            <button class="sh-mark-cut" type="button">✂<small>${st('markCut')}</small></button>
            <button class="btn btn-primary sh-mark-done" type="button">${st('markDone')}</button>
          </div>
          <div class="sh-mark-foot">
            <span class="sh-mark-count" aria-live="polite"></span>
            <button class="btn btn-link sh-mark-pause" type="button">${st('markPause')}</button>
          </div>
        </div>
      </div>
      <aside class="sh-side">
        <div class="sh-side-head">
          <h2>${st('transcript')} <span class="sh-side-count"></span></h2>
          <div class="sh-side-actions">
            <button class="btn btn-sm sh-mark-start" type="button" hidden>${st('markStart')}</button>
            <button class="btn btn-sm sh-edit-toggle" type="button">${st('editSentences')}</button>
          </div>
        </div>
        <ol class="sh-list"></ol>
      </aside>
    </div>
    <div class="sh-sheet" hidden>
      <div class="sh-sheet-card" role="dialog" aria-modal="true" aria-label="${st('settings')}"></div>
    </div>
    <div class="sh-finish" hidden></div>
  `;
  root.appendChild(wrap);
  window.scrollTo(0, 0);

  const $ = <T extends HTMLElement>(selector: string) => wrap.querySelector<T>(selector)!;
  const titleEl = $('.sh-bar-title');
  const countEl = $('.sh-bar-count');
  const videoHost = $('.sh-video-host');
  const overlay = $('.sh-video-overlay');
  const card = $('.sh-card');
  const cardBar = $<HTMLSpanElement>('.sh-card-bar span');
  const statusEl = $('.sh-status');
  const repEl = $('.sh-rep');
  const textEl = $('.sh-text');
  const nextLineEl = $('.sh-next-line');
  const modeEl = $('.sh-mode');
  const speedBtn = $<HTMLButtonElement>('.sh-speed');
  const prevBtn = $<HTMLButtonElement>('.sh-prev');
  const replayBtn = $<HTMLButtonElement>('.sh-replay');
  const playBtn = $<HTMLButtonElement>('.sh-play');
  const ring = $('.sh-ring circle') as unknown as SVGCircleElement;
  const nextBtn = $<HTMLButtonElement>('.sh-next');
  const textBtn = $<HTMLButtonElement>('.sh-textmode');
  const listEl = $('.sh-list');
  const sideCount = $('.sh-side-count');
  const editToggle = $<HTMLButtonElement>('.sh-edit-toggle');
  const markStartBtn = $<HTMLButtonElement>('.sh-mark-start');
  const markPanel = $('.sh-mark');
  const markCount = $('.sh-mark-count');
  const sheet = $('.sh-sheet');
  const sheetCard = $('.sh-sheet-card');
  const finishEl = $('.sh-finish');

  titleEl.textContent = lesson.title;

  let media: YouTubeMedia | null = null;
  let player: SegmentPlayer | null = null;
  let ready = false;
  let destroyed = false;
  let snap: PlayerSnapshot = {
    phase: 'idle',
    index: progress.last,
    mode: prefs.mode,
    repeatsDone: 0,
    loop: false,
    gapProgress: 0,
  };
  let editing = false;
  let revealed = -1;
  let words: TimedWord[] = [];
  let wordEls: HTMLSpanElement[] = [];
  let lit = -1;
  let shownIndex = -1;
  let lastListScroll = 0;
  let lastSave = performance.now();
  let lastTick = performance.now();
  let sessionSeconds = 0;
  let dirty = false;

  const segments = (): Segment[] => lesson.segments;
  // no transcript: pieces cut by time or by the player's own marks, no text to show
  const textless = lesson.source === 'none';
  // learning and marking sentences at once (see LiveMarker)
  let live: LiveMarker | null = null;
  let liveSnap: LiveSnapshot | null = null;
  // sentences the lesson had before this marking session
  let liveBase = 0;
  // marking was left in this visit: ▶ now practises the parts as they are
  let liveLeft = false;
  let durationTries = 0;

  markStartBtn.hidden = !textless;

  // ---------- the video ----------

  const showOverlay = (html: string) => {
    overlay.innerHTML = html;
    overlay.hidden = !html;
  };

  const loading = () =>
    showOverlay(`<div class="sh-overlay-box"><span class="sh-spinner" aria-hidden="true"></span><p>${st('loadingVideo')}</p></div>`);

  const failed = (message: string, retry: boolean) => {
    ready = false;
    drawControls();
    showOverlay(`
      <div class="sh-overlay-box">
        <p>${message}</p>
        <div class="sh-overlay-actions">
          ${retry ? `<button class="btn btn-primary btn-sm sh-retry" type="button">${st('retry')}</button>` : ''}
          <a class="btn btn-sm" href="${watchUrl(lesson.videoId, segments()[snap.index]?.start ?? 0)}" target="_blank" rel="noopener">${st('openYouTube')}</a>
        </div>
      </div>`);
    overlay.querySelector('.sh-retry')?.addEventListener('click', start);
  };

  const errorMessage = (kind: PlayerErrorKind) =>
    kind === 'notEmbeddable' ? st('notEmbeddable') : kind === 'notFound' ? st('notFound') : st('otherError');

  function start(): void {
    loading();
    media?.destroy();
    media = null;
    player = null;
    videoHost.innerHTML = '';
    loadYouTubeApi().then(
      (api) => {
        if (destroyed) return;
        media = new YouTubeMedia(api, videoHost, lesson.videoId, {
          onReady: () => {
            if (destroyed) return;
            setupPlayer();
            const title = media?.title();
            if (title && lesson.title === lesson.videoId) {
              try {
                lesson = updateLesson(lesson.id, { title }) ?? lesson;
              } catch {
                // keep the id as the name
              }
              titleEl.textContent = lesson.title;
            }
          },
          onError: (kind) => failed(errorMessage(kind), kind === 'other'),
          onExternalPlay: () => (live ? live.externalPlay() : player?.externalPlay()),
          onExternalPause: () => (live ? live.externalPause() : player?.externalPause()),
          onEnded: () => (live ? live.externalEnded() : player?.externalEnded()),
        }, { captions: textless });
      },
      () => {
        if (!destroyed) failed(st('apiError'), true);
      },
    );
  }

  // The practice loop starts once the video is ready. A lesson without transcript
  // is first cut into pieces, which needs the video's length.
  function setupPlayer(): void {
    if (destroyed || !media) return;
    if (!segments().length) {
      const duration = media.duration();
      if (!duration) {
        if (durationTries++ < 20) window.setTimeout(setupPlayer, 250);
        else failed(st('otherError'), true);
        return;
      }
      replaceSegments(chunkByTime(0, duration, prefs.chunkSeconds), 0);
    }
    player = new SegmentPlayer(
      media,
      segments(),
      {
        mode: prefs.mode,
        rate: prefs.rate,
        repeat: prefs.repeat,
        gapFactor: prefs.gapFactor,
        autoNext: prefs.autoNext,
        softHold: prefs.softPause,
      },
      { onChange, onSegmentDone, onFinished },
      snap.index,
    );
    ready = true;
    showOverlay('');
    drawSentence();
    drawStatus();
    drawControls();
  }

  // A new set of pieces (re-cut by time): progress starts over, except for the first
  // `keep` sentences (the ones marked by hand).
  function replaceSegments(next: Segment[], index: number, keep = 0): void {
    if (!next.length) return;
    try {
      lesson = updateLesson(lesson.id, { segments: next }) ?? lesson;
    } catch (err) {
      alert(err instanceof StorageFullError ? st('storageFull') : String(err));
      return;
    }
    progress.reps = next.map((_, i) => (i < keep ? progress.reps[i] ?? 0 : 0));
    progress.last = index;
    saveNow();
    if (player) {
      player.reset(index);
      player.setSegments(segments(), index);
    } else {
      snap = { ...snap, index, phase: 'idle' };
    }
    textEl.dataset.key = '';
    drawSentence();
    drawStatus();
    drawControls();
    drawList();
  }

  // ---------- player events ----------

  function onChange(next: PlayerSnapshot): void {
    if (live) {
      // the card belongs to the marking session meanwhile
      snap = next;
      return;
    }
    const moved = next.index !== snap.index;
    snap = next;
    if (moved) {
      revealed = -1;
      progress.last = next.index;
      dirty = true;
    }
    drawSentence();
    drawStatus();
    drawControls();
    drawListCurrent(moved);
    if (next.phase === 'playing') hideFinish();
  }

  function onSegmentDone(index: number): void {
    progress.reps[index] = (progress.reps[index] ?? 0) + 1;
    dirty = true;
    listEl.querySelector(`.sh-row[data-i="${index}"]`)?.classList.add('done');
  }

  function onFinished(): void {
    progress.finished += 1;
    progress.last = 0;
    saveNow();
    track('shadow_finish', { sentences: segments().length, minutes: Math.round(sessionSeconds / 60) });
    showFinish();
  }

  // ---------- drawing ----------

  function drawSentence(): void {
    const seg = segments()[snap.index];
    if (!seg) {
      textEl.dataset.key = '';
      textEl.innerHTML = `<span class="sh-piece-wait">${st('loadingVideo')}</span>`;
      nextLineEl.textContent = '';
      countEl.textContent = '';
      words = [];
      wordEls = [];
      return;
    }
    if (!seg.text) {
      const key = `piece|${snap.index}|${seg.start}|${seg.end}`;
      if (textEl.dataset.key !== key) {
        const indexChanged = shownIndex !== snap.index;
        shownIndex = snap.index;
        textEl.dataset.key = key;
        textEl.classList.remove('sh-text-hidden', 'sh-text-long');
        textEl.innerHTML = `
          <span class="sh-piece">🎧 ${st('pieceN', snap.index + 1)}</span>
          <span class="sh-piece-time">${formatClock(seg.start)} – ${formatClock(seg.end)}</span>`;
        words = [];
        wordEls = [];
        nextLineEl.textContent = '';
        if (indexChanged) {
          textEl.classList.remove('sh-enter');
          void textEl.offsetWidth;
          textEl.classList.add('sh-enter');
        }
      }
      countEl.textContent = st('sentenceOf', snap.index + 1, segments().length);
      return;
    }
    const key = `${snap.index}|${prefs.textMode}|${revealed === snap.index}|${seg.text}`;
    if (textEl.dataset.key === key) return;
    const indexChanged = shownIndex !== snap.index;
    shownIndex = snap.index;
    textEl.dataset.key = key;

    words = timedWords(seg);
    const hidden = prefs.textMode === 'hide' && revealed !== snap.index;
    const masked = prefs.textMode === 'hint' && revealed !== snap.index;
    textEl.classList.toggle('sh-text-hidden', hidden);
    textEl.classList.toggle('sh-text-long', seg.text.length > 140);
    if (hidden) {
      textEl.innerHTML = `<span class="sh-tap">${st('tapToShow')}</span>`;
      wordEls = [];
    } else {
      textEl.innerHTML = words
        .map((w) => `<span class="sh-w">${escapeHtml(masked ? maskWord(w.word) : w.word)}</span>`)
        .join(' ');
      wordEls = Array.from(textEl.querySelectorAll<HTMLSpanElement>('.sh-w'));
    }
    lit = -1;
    if (indexChanged) {
      textEl.classList.remove('sh-enter');
      void textEl.offsetWidth; // restart the animation
      textEl.classList.add('sh-enter');
    }

    const following = segments()[snap.index + 1];
    nextLineEl.textContent = prefs.textMode === 'show' && following ? following.text : '';
    countEl.textContent = st('sentenceOf', snap.index + 1, segments().length);
  }

  function statusText(): string {
    switch (snap.phase) {
      case 'idle':
        return textless && lesson.liveAnchor === undefined ? st('statusIdleLive') : st('statusIdle');
      case 'paused':
        return st('statusPaused');
      case 'gap':
        return st('statusYourTurn');
      case 'waiting':
        return st('statusWaiting');
      case 'ended':
        return st('statusEnded');
      default:
        if (snap.mode === 'shadow') return snap.loop ? st('statusLoop') : st('statusShadow');
        return st('statusListen');
    }
  }

  function drawStatus(): void {
    statusEl.textContent = statusText();
    card.dataset.phase = snap.phase;
    repEl.textContent =
      snap.mode === 'repeat' && prefs.repeat > 1 && snap.phase !== 'idle' && snap.phase !== 'ended'
        ? st('repeatOf', Math.min(prefs.repeat, snap.repeatsDone + (snap.phase === 'playing' ? 1 : 0)) || 1, prefs.repeat)
        : '';
  }

  function drawControls(): void {
    const playing = snap.phase === 'playing' || snap.phase === 'gap';
    playBtn.querySelector('.sh-play-ico')!.innerHTML =
      snap.phase === 'ended' ? icons.restart : playing ? icons.pause : icons.play;
    playBtn.setAttribute('aria-label', playing ? st('btnPause') : st('btnPlay'));
    playBtn.classList.toggle('is-gap', snap.phase === 'gap');
    for (const btn of [playBtn, prevBtn, nextBtn, replayBtn]) btn.disabled = !ready;
    wrap.classList.toggle('sh-not-ready', !ready);

    modeEl.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
      const on = btn.dataset.mode === prefs.mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });

    const shadow = prefs.mode === 'shadow';
    replayBtn.querySelector('.sh-ico')!.innerHTML = shadow ? icons.loop : icons.replay;
    replayBtn.querySelector('small')!.textContent = shadow ? st('btnLoop') : st('btnReplay');
    replayBtn.classList.toggle('active', shadow && snap.loop);
    replayBtn.setAttribute('aria-pressed', String(shadow && snap.loop));

    const rate = prefs.rate;
    speedBtn.textContent = `${rate < 1 ? '🐢 ' : rate > 1 ? '🐇 ' : ''}${rate}×`;

    // without transcript there's no text to hide: the button marks sentences instead
    const textIcon = textless
      ? '<span class="sh-ico-text">✂</span>'
      : prefs.textMode === 'show'
        ? icons.textShow
        : prefs.textMode === 'hint'
          ? icons.textHint
          : icons.textHide;
    textBtn.querySelector('.sh-ico')!.innerHTML = textIcon;
    textBtn.querySelector('small')!.textContent = textless
      ? st('markShort')
      : prefs.textMode === 'show'
        ? st('textShow')
        : prefs.textMode === 'hint'
          ? st('textHint')
          : st('textHide');
    textBtn.disabled = textless && !ready;
  }

  function drawList(): void {
    sideCount.textContent = String(segments().length);
    $('.sh-side-head h2').firstChild!.textContent = `${textless ? st('pieces') : st('transcript')} `;
    listEl.classList.toggle('editing', editing);
    editToggle.textContent = editing ? st('doneEditing') : st('editSentences');
    const last = segments().length - 1;
    listEl.innerHTML = segments()
      .map(
        (seg, i) => `
        <li class="sh-row${progress.reps[i] ? ' done' : ''}${i === snap.index ? ' current' : ''}" data-i="${i}">
          <button class="sh-row-main" type="button" data-act="go">
            <span class="sh-time">${formatClock(seg.start)}</span>
            <span class="sh-row-text${seg.text ? '' : ' sh-row-piece'}">${seg.text ? escapeHtml(seg.text) : `🎧 ${st('pieceN', i + 1)}`}</span>
            <span class="sh-row-done" aria-hidden="true">✓</span>
          </button>
          ${
            editing
              ? `<div class="sh-row-edit">
                  ${i < last ? `<button class="btn btn-sm" type="button" data-act="merge">⤵ ${st('mergeNext')}</button>` : ''}
                  ${seg.text.includes(' ') || (!seg.text && seg.end - seg.start >= 1.6) ? `<button class="btn btn-sm" type="button" data-act="split">✂ ${st('split')}</button>` : ''}
                  ${last > 0 ? `<button class="btn btn-sm btn-danger-soft" type="button" data-act="remove">🗑 ${st('remove')}</button>` : ''}
                </div>`
              : ''
          }
        </li>`,
      )
      .join('');
    drawListCurrent(true);
  }

  function drawListCurrent(scroll: boolean): void {
    listEl.querySelector('.sh-row.current')?.classList.remove('current');
    const row = listEl.querySelector<HTMLElement>(`.sh-row[data-i="${snap.index}"]`);
    if (!row) return;
    row.classList.add('current');
    if (!scroll || editing || performance.now() - lastListScroll < LIST_SCROLL_QUIET_MS) return;
    // scroll the list itself, never the page
    const target = row.offsetTop - listEl.clientHeight / 3;
    if (listEl.scrollHeight > listEl.clientHeight) {
      listEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }

  // ---------- animation ----------

  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const seg = segments()[snap.index];
    if (!seg) return;
    const t = media && ready ? media.time() : seg.start;
    const playing = snap.phase === 'playing';

    // progress through the sentence
    let share = 0;
    if (playing) share = (t - seg.start) / Math.max(0.1, seg.end - seg.start);
    else if (snap.phase === 'gap' || snap.phase === 'waiting') share = 1;
    else if (snap.phase === 'paused') share = parseFloat(cardBar.dataset.share ?? '0');
    share = Math.max(0, Math.min(1, share));
    if (cardBar.dataset.share !== share.toFixed(3)) {
      cardBar.dataset.share = share.toFixed(3);
      cardBar.style.transform = `scaleX(${share})`;
    }

    // light the words up as they are reached
    const target = playing ? words.filter((w) => w.at <= t + 0.05).length : snap.phase === 'paused' ? lit : wordEls.length;
    if (target !== lit) {
      wordEls.forEach((el, i) => el.classList.toggle('ahead', i >= target));
      lit = target;
    }

    // the countdown ring while it is the player's turn
    const ringShare = snap.phase === 'gap' && player ? player.snapshot().gapProgress : 0;
    ring.style.strokeDashoffset = String(220 * (1 - ringShare));
  };
  raf = requestAnimationFrame(frame);

  // ---------- the clock ----------

  const interval = window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(1, (now - lastTick) / 1000);
    lastTick = now;
    if (live) {
      live.tick();
      if (liveSnap && (liveSnap.phase === 'listening' || liveSnap.phase === 'practising')) {
        progress.seconds += dt;
        sessionSeconds += dt;
      }
      drawMarkCount();
      return;
    }
    if (!player) return;
    player.tick();
    if (snap.phase === 'playing' || snap.phase === 'gap') {
      progress.seconds += dt;
      sessionSeconds += dt;
    }
    if (dirty && now - lastSave > SAVE_EVERY_MS) saveNow();
  }, TICK_MS);

  function saveNow(): void {
    lastSave = performance.now();
    dirty = false;
    saveLessonProgress(lesson.id, progress);
  }

  // ---------- controls ----------

  function togglePlay(): void {
    if (!player || !ready) return;
    if (live) live.toggle();
    // a lesson without transcript starts by learning and marking at once
    else if (textless && lesson.liveAnchor === undefined && !liveLeft && snap.phase === 'idle') startLive();
    else player.toggle();
  }

  const act = (fn: (p: SegmentPlayer) => void) => () => {
    if (player && ready) fn(player);
  };

  playBtn.addEventListener('click', () => togglePlay());
  prevBtn.addEventListener('click', act((p) => p.prev()));
  nextBtn.addEventListener('click', act((p) => p.next()));
  replayBtn.addEventListener(
    'click',
    act((p) => {
      if (prefs.mode === 'shadow') {
        p.setLoop(!snap.loop);
        if (snap.phase !== 'playing') p.replay();
      } else {
        p.replay();
      }
    }),
  );

  modeEl.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (!btn) return;
    const mode = btn.dataset.mode as ShadowMode;
    if (mode === prefs.mode) return;
    setPref('mode', mode);
    player?.setMode(mode);
    drawStatus();
    drawControls();
  });

  speedBtn.addEventListener('click', () => {
    const rate = RATES[(RATES.indexOf(prefs.rate) + 1) % RATES.length];
    setPref('rate', rate);
    player?.setRate(rate);
    drawControls();
  });

  const cycleText = () => {
    if (textless) return;
    setPref('textMode', TEXT_MODES[(TEXT_MODES.indexOf(prefs.textMode) + 1) % TEXT_MODES.length]);
    revealed = -1;
    drawSentence();
    drawControls();
  };
  textBtn.addEventListener('click', () => (textless ? startLive() : cycleText()));

  card.addEventListener('click', () => {
    if (textless || prefs.textMode === 'show') return;
    revealed = revealed === snap.index ? -1 : snap.index;
    drawSentence();
  });

  listEl.addEventListener('scroll', () => {
    lastListScroll = performance.now();
  }, { passive: true });
  listEl.addEventListener('pointerdown', () => {
    lastListScroll = performance.now();
  });
  listEl.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    const row = btn?.closest<HTMLElement>('.sh-row');
    if (!btn || !row) return;
    const i = Number(row.dataset.i);
    const action = btn.dataset.act;
    if (action === 'go') {
      if (!editing && player && ready) {
        lastListScroll = 0;
        player.playSegment(i);
      }
      return;
    }
    if (action === 'merge') edit(mergeWithNext(segments(), i), { type: 'merge', index: i });
    else if (action === 'split') edit(splitSegment(segments(), i), { type: 'split', index: i });
    else if (action === 'remove') edit(removeSegment(segments(), i), { type: 'remove', index: i });
  });

  editToggle.addEventListener('click', () => {
    editing = !editing;
    drawList();
  });

  function edit(next: Segment[], change: { type: 'merge' | 'split' | 'remove'; index: number }): void {
    if (next === segments()) return;
    let updated: ShadowLesson | undefined;
    try {
      updated = updateLesson(lesson.id, { segments: next });
    } catch (err) {
      alert(err instanceof StorageFullError ? st('storageFull') : String(err));
      return;
    }
    if (!updated) return;
    lesson = updated;
    progress.reps = remapReps(progress.reps, change);
    let index = snap.index;
    if (index > change.index) index += change.type === 'split' ? 1 : -1;
    index = Math.max(0, Math.min(segments().length - 1, index));
    progress.last = index;
    saveNow();
    if (player) player.setSegments(segments(), index);
    else snap = { ...snap, index };
    textEl.dataset.key = '';
    drawSentence();
    drawList();
  }

  wrap.querySelector('.sh-back')!.addEventListener('click', () => app.showShadowHome());

  function setPref<K extends keyof ShadowPrefs>(key: K, value: ShadowPrefs[K]): void {
    prefs[key] = value;
    savePrefs(prefs);
  }

  // ---------- settings sheet ----------

  const openSheet = () => {
    const choice = (name: string, values: number[], current: number, label: (v: number) => string) =>
      `<div class="sh-choice" data-name="${name}">${values
        .map((v) => `<button type="button" class="sh-chip${v === current ? ' active' : ''}" data-value="${v}">${label(v)}</button>`)
        .join('')}</div>`;
    sheetCard.innerHTML = `
      <div class="sh-sheet-head"><h2>${st('settings')}</h2><button class="sh-bar-btn sh-sheet-close" type="button" aria-label="${st('close')}">✕</button></div>
      <p class="sh-sheet-mode">${prefs.mode === 'shadow' ? st('modeShadowHint') : st('modeRepeatHint')}</p>
      <div class="sh-field"><span>${st('repeatEach')}</span>${choice('repeat', REPEATS, prefs.repeat, (v) => st('repeatTimes', v))}</div>
      <div class="sh-field"><span>${st('gapLength')}</span>${choice('gapFactor', GAP_FACTORS, prefs.gapFactor, (v) =>
        v < 1 ? st('gapShort') : v > 1 ? st('gapLong') : st('gapMedium'),
      )}</div>
      <label class="sh-switch"><input type="checkbox" class="sh-auto"${prefs.autoNext ? ' checked' : ''}><span>${st('autoNext')}</span></label>
      <label class="sh-switch"><input type="checkbox" class="sh-soft"${prefs.softPause ? ' checked' : ''}><span>${st('softPause')}</span></label>
      <p class="sh-hint">${st('softPauseHint')}</p>
      ${
        textless
          ? `<div class="sh-field"><span>${st('chunkLength')}</span>${choice('chunkSeconds', CHUNK_SECONDS, prefs.chunkSeconds, (v) => st('seconds', v))}</div>
             <p class="sh-hint">${st('chunkHint')}</p>
             <button class="btn sh-sheet-mark" type="button">${st('markStart')}</button>`
          : ''
      }
      <p class="sh-hint sh-shortcuts">${st('shortcuts')}</p>
      <div class="sh-sheet-links">
        <a class="btn btn-sm" href="${watchUrl(lesson.videoId, segments()[snap.index]?.start ?? 0)}" target="_blank" rel="noopener">${st('openYouTube')}</a>
      </div>`;
    sheet.hidden = false;
    sheetCard.querySelector<HTMLButtonElement>('.sh-sheet-close')!.focus();
  };
  const closeSheet = () => {
    sheet.hidden = true;
  };
  $('.sh-settings-btn').addEventListener('click', openSheet);
  sheet.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target === sheet || target.closest('.sh-sheet-close')) return closeSheet();
    if (target.closest('.sh-sheet-mark')) {
      closeSheet();
      startLive();
      return;
    }
    const chip = target.closest<HTMLButtonElement>('.sh-choice .sh-chip');
    if (chip && chip.closest<HTMLElement>('.sh-choice')!.dataset.name === 'chunkSeconds') {
      const value = Number(chip.dataset.value);
      chip.parentElement!.querySelectorAll('.sh-chip').forEach((c) => c.classList.toggle('active', c === chip));
      if (value === prefs.chunkSeconds || !media) return;
      setPref('chunkSeconds', value);
      if (live) return;
      const duration = media.duration() || segments()[segments().length - 1]?.end || 0;
      // only what is not marked yet is cut again
      const anchor = lesson.liveAnchor ?? 0;
      const kept = segments().filter((seg) => seg.end <= anchor + 0.01);
      replaceSegments([...kept, ...chunkByTime(anchor, duration, value)], snap.index < kept.length ? snap.index : kept.length, kept.length);
      return;
    }
    if (chip) {
      const name = chip.closest<HTMLElement>('.sh-choice')!.dataset.name as 'repeat' | 'gapFactor';
      const value = Number(chip.dataset.value);
      setPref(name, value);
      player?.updateSettings({ [name]: value });
      chip.parentElement!.querySelectorAll('.sh-chip').forEach((c) => c.classList.toggle('active', c === chip));
      drawStatus();
    }
  });
  sheet.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.classList.contains('sh-soft')) {
      setPref('softPause', input.checked);
      player?.updateSettings({ softHold: input.checked });
      live?.updateSettings({ softHold: input.checked });
      return;
    }
    if (!input.classList.contains('sh-auto')) return;
    setPref('autoNext', input.checked);
    player?.updateSettings({ autoNext: input.checked });
  });

  // ---------- learning and marking at once (no transcript) ----------

  const videoLength = (): number => media?.duration() || segments()[segments().length - 1]?.end || 0;

  function startLive(): void {
    if (!player || !media || !ready || live) return;
    player.reset(snap.index);
    const anchor = lesson.liveAnchor ?? 0;
    liveBase = segments().filter((seg) => seg.end <= anchor + 0.01).length;
    live = new LiveMarker(
      media,
      { rate: prefs.rate, gapFactor: prefs.gapFactor, softHold: prefs.softPause },
      { onChange: onLiveChange, onCut: onLiveCut, onUncut: onLiveUncut, onPractised: onLivePractised, onFinished: () => finishLive(true) },
      anchor,
      videoLength(),
      liveBase,
    );
    liveSnap = live.snapshot();
    wrap.classList.add('sh-marking');
    markPanel.hidden = false;
    hideFinish();
    live.start();
    drawMarkCount();
    $<HTMLButtonElement>('.sh-mark-cut').focus();
  }

  function onLiveChange(next: LiveSnapshot): void {
    liveSnap = next;
    const phase = next.phase;
    const gap = next.practice?.phase === 'gap';
    statusEl.textContent =
      phase === 'practising' ? (gap ? st('statusYourTurn') : st('liveReplay')) : phase === 'paused' ? st('statusPaused') : phase === 'ended' ? st('statusEnded') : st('liveListen');
    card.dataset.phase = phase === 'practising' ? (gap ? 'gap' : 'playing') : phase === 'paused' ? 'paused' : 'playing';
    $<HTMLButtonElement>('.sh-mark-cut').disabled = phase !== 'listening';
    $('.sh-mark-pause').textContent = phase === 'paused' ? st('markResume') : st('markPause');
    drawMarkCount();
  }

  // Saves the lesson as: the sentences marked so far, then the rest of the video in parts.
  function saveLive(next: Segment[], index: number, anchor: number): boolean {
    try {
      lesson = updateLesson(lesson.id, { segments: next, liveAnchor: anchor }) ?? lesson;
    } catch (err) {
      alert(err instanceof StorageFullError ? st('storageFull') : String(err));
      return false;
    }
    progress.reps = segments().map((_, i) => (i <= index ? progress.reps[i] ?? 0 : 0));
    progress.last = index;
    saveNow();
    snap = { ...snap, index };
    textEl.dataset.key = '';
    drawSentence();
    drawList();
    return true;
  }

  function onLiveCut(cut: Segment, index: number): void {
    const next = [...segments().slice(0, index), cut, ...chunkByTime(cut.end, videoLength(), prefs.chunkSeconds)];
    saveLive(next, index, cut.end);
    const button = $('.sh-mark-cut');
    button.classList.remove('sh-pop');
    void button.offsetWidth;
    button.classList.add('sh-pop');
  }

  function onLiveUncut(index: number, anchor: number): void {
    const next = [...segments().slice(0, index), ...chunkByTime(anchor, videoLength(), prefs.chunkSeconds)];
    saveLive(next, Math.max(0, index - 1), anchor);
  }

  function onLivePractised(index: number): void {
    progress.reps[index] = (progress.reps[index] ?? 0) + 1;
    dirty = true;
    listEl.querySelector(`.sh-row[data-i="${index}"]`)?.classList.add('done');
  }

  function finishLive(ended: boolean): void {
    if (!live) return;
    live.stop();
    live = null;
    liveSnap = null;
    liveLeft = true;
    wrap.classList.remove('sh-marking');
    markPanel.hidden = true;
    const index = Math.max(0, Math.min(snap.index, segments().length - 1));
    snap = { ...snap, index, phase: 'idle' };
    player?.setSegments(segments(), index);
    player?.reset(index);
    textEl.dataset.key = '';
    drawSentence();
    drawStatus();
    drawControls();
    drawList();
    saveNow();
    track('shadow_marked', { sentences: segments().filter((seg) => seg.end <= (lesson.liveAnchor ?? 0) + 0.01).length });
    if (ended) showFinish();
  }

  function drawMarkCount(): void {
    const marked = liveSnap ? liveBase + liveSnap.cuts : liveBase;
    markCount.textContent = st('markCount', marked, formatClock(media?.time() ?? 0));
  }

  markStartBtn.addEventListener('click', startLive);
  $('.sh-mark-cut').addEventListener('click', () => live?.cut());
  $('.sh-mark-undo').addEventListener('click', () => live?.undo());
  $('.sh-mark-pause').addEventListener('click', () => live?.toggle());
  $('.sh-mark-done').addEventListener('click', () => finishLive(false));

  // ---------- finishing ----------

  function showFinish(): void {
    const minutes = Math.max(1, Math.round(progress.seconds / 60));
    const confetti = Array.from({ length: 18 }, (_, i) => {
      const left = Math.round((i / 18) * 100 + Math.random() * 5);
      const delay = (Math.random() * 0.6).toFixed(2);
      const emoji = ['🎉', '⭐', '✨', '🎊'][i % 4];
      return `<span style="left:${left}%;animation-delay:${delay}s">${emoji}</span>`;
    }).join('');
    finishEl.innerHTML = `
      <div class="sh-confetti" aria-hidden="true">${confetti}</div>
      <div class="sh-finish-card" role="dialog" aria-modal="true">
        <div class="sh-finish-icon" aria-hidden="true">🏆</div>
        <h2>${st('finishTitle')}</h2>
        <p>${st('finishSub', segments().length, minutes)}</p>
        <div class="sh-finish-actions">
          <button class="btn btn-primary sh-again" type="button">${st('againFromStart')}</button>
          <button class="btn sh-other" type="button">${st('otherLesson')}</button>
        </div>
      </div>`;
    finishEl.hidden = false;
    finishEl.querySelector('.sh-again')!.addEventListener('click', () => {
      hideFinish();
      if (player && ready) player.playSegment(0);
    });
    finishEl.querySelector('.sh-other')!.addEventListener('click', () => app.showShadowHome());
    finishEl.querySelector<HTMLButtonElement>('.sh-again')!.focus();
  }

  function hideFinish(): void {
    if (!finishEl.hidden) {
      finishEl.hidden = true;
      finishEl.innerHTML = '';
    }
  }

  // ---------- keyboard and app lifecycle ----------

  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (live) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
        live.cut();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        live.undo();
      } else if (event.key === 'p' || event.key === 'P') {
        live.toggle();
      } else if (event.key === 'Escape') {
        finishLive(false);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (!sheet.hidden) closeSheet();
      return;
    }
    if (!sheet.hidden || !finishEl.hidden) return;
    const run = (fn: () => void) => {
      event.preventDefault();
      // don't let a focused button also react to the same key
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      fn();
    };
    switch (event.key) {
      case ' ':
      case 'k':
        return run(togglePlay);
      case 'ArrowLeft':
        return run(act((p) => p.prev()));
      case 'ArrowRight':
        return run(act((p) => p.next()));
      case 'r':
      case 'R':
      case 'ArrowDown':
        return run(() => replayBtn.click());
      case 't':
      case 'T':
        return run(cycleText);
    }
  };
  document.addEventListener('keydown', onKey);

  // the video stops when the app goes to the background; so does the loop
  const onVisibility = () => {
    if (document.visibilityState !== 'hidden' || !player) return;
    if (live) {
      if (liveSnap?.phase === 'listening') live.toggle();
      saveNow();
      return;
    }
    if (snap.phase === 'playing') player.toggle();
    else if (snap.phase === 'gap') player.externalPause();
    saveNow();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onPageHide = () => saveNow();
  window.addEventListener('pagehide', onPageHide);

  // ---------- go ----------

  drawSentence();
  drawStatus();
  drawControls();
  drawList();
  start();

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.clearInterval(interval);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      saveNow();
      if (sessionSeconds > 5) track('shadow_session', { minutes: Math.round(sessionSeconds / 60), sentences: segments().length });
      live = null;
      media?.destroy();
      media = null;
      player = null;
    },
  };
}
