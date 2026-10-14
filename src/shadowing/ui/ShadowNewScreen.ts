import type { App } from '@/App';
import type { ScreenHandle } from '@/ui/ScreenManager';
import type { LessonLevel, Segment } from '@/shadowing/types';
import { LESSON_LEVELS } from '@/shadowing/types';
import { createLesson, loadLessons, setLastLessonId, StorageFullError } from '@/shadowing/lessonStore';
import { parseTranscript, type ParsedTranscript } from '@/shadowing/transcriptParse';
import { buildSegments, formatClock } from '@/shadowing/segment';
import { parseVideoId, searchUrl, thumbnailUrl } from '@/shadowing/youtubeUrl';
import { getSuggestion } from '@/shadowing/suggestions';
import { levelLabel, st } from '@/shadowing/strings';
import { escapeHtml } from '@/utils/dom';
import { track } from '@/analytics';

const PREVIEW_COUNT = 4;

export function renderShadowNew(root: HTMLElement, app: App, suggestionId?: string): ScreenHandle {
  const suggestion = getSuggestion(suggestionId);
  const wrap = document.createElement('div');
  wrap.className = 'screen sh-new';
  wrap.innerHTML = `
    <div class="sh-new-head">
      <button class="btn btn-link sh-back" type="button">${st('backToLessons')}</button>
      <h1>${st('newTitle')}</h1>
    </div>
    ${
      suggestion
        ? `<div class="sh-new-pick">
             <span class="sh-suggest-emoji" aria-hidden="true">${suggestion.emoji}</span>
             <div><b>${escapeHtml(suggestion.title)}</b><small>${escapeHtml(suggestion.channel)}</small></div>
             <a class="btn btn-sm" href="${searchUrl(suggestion.query)}" target="_blank" rel="noopener">${st('findOnYouTube')}</a>
           </div>`
        : ''
    }
    <section class="sh-step">
      <label class="sh-step-label" for="sh-url">${st('step1')}</label>
      <div class="sh-url-row">
        <input id="sh-url" class="sh-input" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="${st('urlPlaceholder')}">
        <button class="btn btn-sm sh-paste" type="button" hidden>${st('pasteBtn')}</button>
      </div>
      <div class="sh-url-status" aria-live="polite"></div>
    </section>
    <section class="sh-step">
      <label class="sh-step-label" for="sh-transcript">${st('step2')}</label>
      <details class="sh-guide">
        <summary>${st('guideTitle')}</summary>
        <ol>
          <li>${st('guide1')}</li>
          <li>${st('guide2')}</li>
          <li>${st('guide3')}</li>
          <li>${st('guide4')}</li>
        </ol>
        <p class="sh-hint">${st('guideTip')}</p>
      </details>
      <textarea id="sh-transcript" class="sh-input sh-textarea" rows="7" spellcheck="false" placeholder="${escapeHtml(st('transcriptPlaceholder'))}"></textarea>
      <div class="sh-file-row">
        <button class="btn btn-sm sh-file-btn" type="button">${st('fileBtn')}</button>
        <input class="sh-file" type="file" accept=".srt,.vtt,.txt,text/vtt,application/x-subrip,text/plain" hidden>
      </div>
      <div class="sh-parse-status" aria-live="polite"></div>
      <div class="sh-preview"></div>
    </section>
    <section class="sh-step">
      <label class="sh-step-label" for="sh-title">${st('step3')}</label>
      <input id="sh-title" class="sh-input" type="text" maxlength="120" placeholder="${st('titlePlaceholder')}">
      <div class="sh-levels" role="radiogroup"></div>
    </section>
    <button class="btn btn-primary sh-save" type="button" disabled>${st('saveStart')}</button>
    <p class="sh-save-hint">${st('needBoth')}</p>
  `;
  root.appendChild(wrap);
  window.scrollTo(0, 0);

  const urlInput = wrap.querySelector<HTMLInputElement>('#sh-url')!;
  const urlStatus = wrap.querySelector<HTMLDivElement>('.sh-url-status')!;
  const pasteBtn = wrap.querySelector<HTMLButtonElement>('.sh-paste')!;
  const textarea = wrap.querySelector<HTMLTextAreaElement>('#sh-transcript')!;
  const fileInput = wrap.querySelector<HTMLInputElement>('.sh-file')!;
  const parseStatus = wrap.querySelector<HTMLDivElement>('.sh-parse-status')!;
  const preview = wrap.querySelector<HTMLDivElement>('.sh-preview')!;
  const titleInput = wrap.querySelector<HTMLInputElement>('#sh-title')!;
  const levels = wrap.querySelector<HTMLDivElement>('.sh-levels')!;
  const saveBtn = wrap.querySelector<HTMLButtonElement>('.sh-save')!;
  const saveHint = wrap.querySelector<HTMLParagraphElement>('.sh-save-hint')!;
  const guide = wrap.querySelector<HTMLDetailsElement>('.sh-guide')!;

  let videoId: string | null = null;
  let parsed: ParsedTranscript | null = null;
  let segments: Segment[] = [];
  let level: LessonLevel = suggestion?.level ?? 'mid';
  let titleTouched = false;
  let fetchedTitleFor = '';

  if (suggestion) titleInput.value = suggestion.title;
  // first lesson: show how to get a transcript straight away
  guide.open = loadLessons().length === 0;

  wrap.querySelector('.sh-back')!.addEventListener('click', () => app.showShadowHome());

  // ---- step 1: the link ----
  const onUrl = () => {
    videoId = parseVideoId(urlInput.value);
    if (!urlInput.value.trim()) {
      urlStatus.innerHTML = '';
    } else if (!videoId) {
      urlStatus.innerHTML = `<p class="sh-bad">${st('urlBad')}</p>`;
    } else {
      urlStatus.innerHTML = `
        <div class="sh-url-ok">
          <img src="${thumbnailUrl(videoId)}" alt="" width="96" height="54" onerror="this.style.visibility='hidden'">
          <span>✓ ${st('urlOk')} <code>${videoId}</code></span>
        </div>`;
      void fetchTitle(videoId);
    }
    update();
  };
  urlInput.addEventListener('input', onUrl);

  // Fill the name from YouTube when possible (oEmbed; quietly skipped if blocked).
  const fetchTitle = async (id: string) => {
    if (titleTouched || suggestion || fetchedTitleFor === id) return;
    fetchedTitleFor = id;
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 4000);
      const res = await fetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
        { signal: controller.signal },
      );
      window.clearTimeout(timer);
      if (!res.ok) return;
      const data = (await res.json()) as { title?: string };
      if (data.title && !titleTouched && videoId === id) titleInput.value = data.title;
    } catch {
      // the lesson screen fills it in from the player instead
    }
  };

  if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
    pasteBtn.hidden = false;
    pasteBtn.addEventListener('click', async () => {
      try {
        urlInput.value = (await navigator.clipboard.readText()).trim();
        onUrl();
      } catch {
        urlInput.focus();
      }
    });
  }

  // ---- step 2: the transcript ----
  let parseTimer = 0;
  const onTranscript = () => {
    window.clearTimeout(parseTimer);
    // parse right away for a paste, after a short pause while typing
    parseTimer = window.setTimeout(parseNow, textarea.value.length > 200 ? 0 : 250);
  };
  const parseNow = () => {
    const text = textarea.value;
    parsed = text.trim() ? parseTranscript(text) : null;
    segments = parsed ? buildSegments(parsed.captions) : [];
    drawParse(text.trim().length > 0);
    update();
  };
  textarea.addEventListener('input', onTranscript);

  const drawParse = (hasText: boolean) => {
    preview.innerHTML = '';
    if (!hasText) {
      parseStatus.innerHTML = '';
      return;
    }
    if (!parsed || !segments.length) {
      parseStatus.innerHTML = `<p class="sh-bad">${st('parsedNone')}</p>`;
      return;
    }
    const format =
      parsed.format === 'srt' ? st('parsedFormatSrt') : parsed.format === 'vtt' ? st('parsedFormatVtt') : st('parsedFormatYoutube');
    const last = segments[segments.length - 1];
    const punctuated = /[.?!]/.test(segments.map((s) => s.text).join(' '));
    parseStatus.innerHTML = `
      <p class="sh-good">${st('parsedOk', segments.length, formatClock(last.end))} · ${format}</p>
      ${punctuated ? '' : `<p class="sh-hint">${st('autoCaptionsNote')}</p>`}`;
    const rows = segments
      .slice(0, PREVIEW_COUNT)
      .map((s) => `<li><span class="sh-time">${formatClock(s.start)}</span><span>${escapeHtml(s.text)}</span></li>`)
      .join('');
    const more = segments.length > PREVIEW_COUNT ? `<p class="sh-more">${st('more', segments.length - PREVIEW_COUNT)}</p>` : '';
    preview.innerHTML = `<p class="sh-preview-title">${st('preview')}</p><ol class="sh-preview-list">${rows}</ol>${more}`;
  };

  wrap.querySelector('.sh-file-btn')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      textarea.value = await file.text();
    } catch {
      parseStatus.innerHTML = `<p class="sh-bad">${st('fileError')}</p>`;
      return;
    }
    if (!titleTouched && !suggestion && !titleInput.value) titleInput.value = file.name.replace(/\.[^.]+$/, '');
    parseNow();
  });

  // ---- step 3: name and level ----
  titleInput.addEventListener('input', () => {
    titleTouched = true;
  });
  for (const l of LESSON_LEVELS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sh-chip';
    btn.dataset.level = l;
    btn.setAttribute('role', 'radio');
    btn.textContent = levelLabel(l);
    btn.addEventListener('click', () => {
      level = l;
      drawLevels();
    });
    levels.appendChild(btn);
  }
  const drawLevels = () => {
    levels.querySelectorAll<HTMLButtonElement>('.sh-chip').forEach((btn) => {
      const on = btn.dataset.level === level;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });
  };
  drawLevels();

  // ---- save ----
  const update = () => {
    const ready = !!videoId && segments.length > 0;
    saveBtn.disabled = !ready;
    saveHint.hidden = ready;
  };

  saveBtn.addEventListener('click', () => {
    if (!videoId || !segments.length || !parsed) return;
    try {
      const lesson = createLesson({
        videoId,
        title: titleInput.value || suggestion?.title || videoId,
        level,
        segments,
        source: parsed.format,
        suggestionId: suggestion?.id,
      });
      setLastLessonId(lesson.id);
      track('shadow_lesson_create', { sentences: segments.length, format: parsed.format, level, suggested: !!suggestion });
      app.showShadowLesson(lesson.id);
    } catch (err) {
      alert(err instanceof StorageFullError ? st('storageFull') : String(err));
    }
  });

  return {
    destroy() {
      window.clearTimeout(parseTimer);
    },
  };
}
