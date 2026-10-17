import type { App } from '@/App';
import type { ScreenHandle } from '@/ui/ScreenManager';
import type { LessonLevel, ShadowLesson } from '@/shadowing/types';
import { LESSON_LEVELS } from '@/shadowing/types';
import {
  createLesson,
  setLastLessonId,
  deleteLesson,
  getLastLessonId,
  loadLessonProgress,
  loadLessons,
  practisedCount,
  StorageFullError,
  updateLesson,
} from '@/shadowing/lessonStore';
import { SUGGESTIONS } from '@/shadowing/suggestions';
import { formatClock } from '@/shadowing/segment';
import { searchUrl, thumbnailUrl } from '@/shadowing/youtubeUrl';
import { levelLabel, st } from '@/shadowing/strings';
import { escapeHtml } from '@/utils/dom';
import { getLang } from '@/i18n';
import { track } from '@/analytics';
import { SHADOW_TAB_KEY as TAB_KEY } from '@/utils/storageKeys';

export function renderShadowHome(root: HTMLElement, app: App): ScreenHandle {
  const wrap = document.createElement('div');
  wrap.className = 'screen sh-home';
  root.appendChild(wrap);

  const draw = () => {
    wrap.innerHTML = '';
    wrap.appendChild(renderHeader(app));
    const lessons = loadLessons();
    const cont = renderContinue(app, lessons);
    if (cont) wrap.appendChild(cont);
    wrap.appendChild(renderLessons(app, lessons, draw));
    wrap.appendChild(renderSuggestions(app, lessons));
  };
  draw();
  window.scrollTo(0, 0);
  return {};
}

function renderHeader(app: App): HTMLElement {
  const header = document.createElement('header');
  header.className = 'sh-home-head';
  header.innerHTML = `
    <button class="btn btn-link sh-back" type="button">${st('homeBack')}</button>
    <div class="sh-home-title">
      <span class="sh-home-icon" aria-hidden="true">🎧</span>
      <h1>${st('homeTitle')}</h1>
    </div>
    <p>${st('homeSub')}</p>`;
  header.querySelector('.sh-back')!.addEventListener('click', () => app.showMenu());
  return header;
}

function lessonMeta(lesson: ShadowLesson): { done: number; total: number; length: string; progressText: string } {
  const progress = loadLessonProgress(lesson.id, lesson.segments.length);
  const last = lesson.segments[lesson.segments.length - 1];
  const done = practisedCount(progress);
  const total = lesson.segments.length;
  const progressText = !total
    ? st('notCutYet')
    : lesson.source === 'none'
      ? st('piecesDone', done, total)
      : st('sentencesDone', done, total);
  return { done, total, length: last ? formatClock(last.end) : '', progressText };
}

function renderContinue(app: App, lessons: ShadowLesson[]): HTMLElement | null {
  const lastId = getLastLessonId();
  const lesson = lessons.find((l) => l.id === lastId);
  if (!lesson) return null;
  const meta = lessonMeta(lesson);
  const btn = document.createElement('button');
  btn.className = 'cta sh-continue';
  btn.type = 'button';
  btn.innerHTML = `
    <span class="cta-icon">▶</span>
    <span class="cta-text">
      <span class="cta-title">${st('continueLesson')}</span>
      <span class="cta-sub">${escapeHtml(lesson.title)} · ${meta.progressText}</span>
    </span>`;
  btn.addEventListener('click', () => app.showShadowLesson(lesson.id));
  return btn;
}

function renderLessons(app: App, lessons: ShadowLesson[], refresh: () => void): HTMLElement {
  const section = document.createElement('section');
  section.className = 'sh-section';
  section.innerHTML = `
    <div class="section-head">
      <h2>${st('myLessons')}</h2>
      <span class="section-count">${lessons.length}</span>
    </div>`;

  const list = document.createElement('div');
  list.className = 'sh-lesson-list';
  section.appendChild(list);

  if (!lessons.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = st('noLessons');
    list.appendChild(empty);
  }
  for (const lesson of lessons) list.appendChild(renderLessonCard(app, lesson, refresh));

  const add = document.createElement('button');
  add.className = 'import-card sh-new-card';
  add.type = 'button';
  add.innerHTML = `
    <span class="import-plus" aria-hidden="true">
      <svg viewBox="0 0 20 20" width="18" height="18"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
    </span>
    <span class="import-text">${st('newLesson')}<small>${st('newLessonSub')}</small></span>`;
  add.addEventListener('click', () => app.showShadowNew());
  section.appendChild(add);
  return section;
}

function renderLessonCard(app: App, lesson: ShadowLesson, refresh: () => void): HTMLElement {
  const meta = lessonMeta(lesson);
  const pct = meta.total ? Math.round((meta.done / meta.total) * 100) : 0;
  const card = document.createElement('article');
  card.className = 'sh-lesson';
  card.innerHTML = `
    <button class="sh-lesson-open" type="button">
      <span class="sh-thumb">
        <img src="${thumbnailUrl(lesson.videoId)}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">
        ${meta.length ? `<span class="sh-thumb-time">${meta.length}</span>` : ''}
      </span>
      <span class="sh-lesson-body">
        <span class="sh-lesson-title">${escapeHtml(lesson.title)}</span>
        <span class="sh-lesson-meta">
          <span class="sh-level sh-level-${lesson.level}">${levelLabel(lesson.level, true)}</span>
          ${lesson.source === 'none' ? `<span class="sh-notext">${st('noTextBadge')}</span>` : ''}
          <span>${meta.progressText}</span>
        </span>
        <span class="sh-lesson-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
      </span>
    </button>
    <div class="sh-lesson-actions">
      <button class="icon-btn sh-rename" type="button" title="${st('rename')}" aria-label="${st('rename')}">✎</button>
      <button class="icon-btn icon-btn-danger sh-delete" type="button" title="${st('delete')}" aria-label="${st('delete')}">🗑</button>
    </div>`;
  card.querySelector('.sh-lesson-open')!.addEventListener('click', () => app.showShadowLesson(lesson.id));
  card.querySelector('.sh-rename')!.addEventListener('click', () => {
    const name = prompt(st('newName'), lesson.title);
    if (!name || !name.trim()) return;
    try {
      updateLesson(lesson.id, { title: name });
    } catch (err) {
      if (err instanceof StorageFullError) alert(st('storageFull'));
    }
    refresh();
  });
  card.querySelector('.sh-delete')!.addEventListener('click', () => {
    if (!confirm(st('deleteConfirm', lesson.title))) return;
    try {
      deleteLesson(lesson.id);
    } catch {
      // deleting only frees space
    }
    refresh();
  });
  return card;
}

function readTab(): LessonLevel {
  try {
    const saved = localStorage.getItem(TAB_KEY) as LessonLevel | null;
    return saved && LESSON_LEVELS.includes(saved) ? saved : 'kids';
  } catch {
    return 'kids';
  }
}

function renderSuggestions(app: App, lessons: ShadowLesson[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'sh-section';
  section.innerHTML = `
    <div class="section-head"><h2>${st('suggested')}</h2></div>
    <p class="sh-hint">${st('suggestedHint')}</p>`;

  const tabs = document.createElement('div');
  tabs.className = 'sh-tabs';
  tabs.setAttribute('role', 'tablist');
  const list = document.createElement('div');
  list.className = 'sh-suggest-list';
  section.append(tabs, list);

  let tab = readTab();
  const drawList = () => {
    tabs.querySelectorAll<HTMLButtonElement>('.sh-tab').forEach((btn) => {
      const on = btn.dataset.level === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    list.innerHTML = '';
    const lang = getLang();
    for (const s of SUGGESTIONS.filter((x) => x.level === tab)) {
      const existing = lessons.find((l) => l.suggestionId === s.id);
      const card = document.createElement('article');
      card.className = 'sh-suggest';
      card.innerHTML = `
        ${
          s.videoId
            ? `<span class="sh-suggest-thumb" aria-hidden="true"><img src="${thumbnailUrl(s.videoId)}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'"><span>${s.emoji}</span></span>`
            : `<span class="sh-suggest-emoji" aria-hidden="true">${s.emoji}</span>`
        }
        <div class="sh-suggest-body">
          <h3>${escapeHtml(s.title)}</h3>
          <p class="sh-suggest-meta">${escapeHtml(s.channel)} · ${st('minutes', s.minutes)}</p>
          <p class="sh-suggest-note">${escapeHtml(s.note[lang])}</p>
          <div class="sh-suggest-actions">
            ${
              existing
                ? `<span class="sh-have">${st('haveLesson')}</span><button class="btn btn-primary btn-sm sh-open" type="button">${st('study')}</button>`
                : s.videoId
                  ? `<button class="btn btn-primary btn-sm sh-now" type="button">${st('learnNow')}</button>
                     <button class="btn btn-sm sh-make" type="button">${st('addTranscript')}</button>`
                  : `<a class="btn btn-sm" href="${searchUrl(s.query)}" target="_blank" rel="noopener">${st('findOnYouTube')}</a>
                     <button class="btn btn-primary btn-sm sh-make" type="button">${st('makeLesson')}</button>`
            }
          </div>
        </div>`;
      card.querySelector('.sh-open')?.addEventListener('click', () => app.showShadowLesson(existing!.id));
      card.querySelector('.sh-make')?.addEventListener('click', () => app.showShadowNew(s.id));
      // straight into practice, without transcript; one can be added later as a new lesson
      card.querySelector('.sh-now')?.addEventListener('click', () => {
        try {
          const lesson = createLesson({
            videoId: s.videoId!,
            title: s.title,
            level: s.level,
            segments: [],
            source: 'none',
            suggestionId: s.id,
          });
          setLastLessonId(lesson.id);
          track('shadow_lesson_create', { sentences: 0, format: 'none', level: s.level, suggested: true });
          app.showShadowLesson(lesson.id);
        } catch (err) {
          alert(err instanceof StorageFullError ? st('storageFull') : String(err));
        }
      });
      list.appendChild(card);
    }
  };

  for (const level of LESSON_LEVELS) {
    const btn = document.createElement('button');
    btn.className = 'sh-tab';
    btn.type = 'button';
    btn.dataset.level = level;
    btn.setAttribute('role', 'tab');
    btn.textContent = levelLabel(level);
    btn.addEventListener('click', () => {
      tab = level;
      try {
        localStorage.setItem(TAB_KEY, level);
      } catch {
        // only a convenience
      }
      drawList();
    });
    tabs.appendChild(btn);
  }
  drawList();
  return section;
}
