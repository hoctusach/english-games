import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const FAKE_YT = readFileSync(fileURLToPath(new URL('./fake-youtube.js', import.meta.url)), 'utf8');

const LESSON = {
  id: 'lesson-e2e',
  videoId: 'abcdefghijk',
  title: 'Test lesson',
  level: 'kids',
  source: 'youtube',
  createdAt: 1,
  updatedAt: 1,
  segments: [
    { start: 1, end: 3, text: 'Hello there, my friend.' },
    { start: 3, end: 5.5, text: 'How are you today?' },
    { start: 5.5, end: 8, text: 'I am fine, thank you.' },
    { start: 8, end: 10, text: 'See you later.' },
  ],
};

const TRANSCRIPT = `Transcript
0:00
0 seconds
Hello everyone and welcome
0:03
3 seconds
to our little show. Today we
0:06
6 seconds
are going to learn about animals.
0:09
9 seconds
[Music]
0:15
15 seconds
Cats are very cute.`;

interface Setup {
  lessons?: unknown[];
  prefs?: Record<string, unknown>;
  lastGame?: 'shadow' | 'words';
  blockApi?: boolean;
}

async function setup(page: Page, options: Setup = {}) {
  await page.route('**/iframe_api', (route) =>
    options.blockApi ? route.abort() : route.fulfill({ contentType: 'text/javascript', body: FAKE_YT }),
  );
  await page.route('https://i.ytimg.com/**', (route) => route.abort());
  await page.route('https://www.youtube.com/oembed**', (route) => route.abort());
  await page.route('https://cloud.umami.is/**', (route) => route.abort());
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.abort());
  await page.addInitScript((opts) => {
    if (localStorage.getItem('e2e.seeded')) return;
    localStorage.setItem('e2e.seeded', '1');
    localStorage.setItem('shootwords.lang.v1', 'vi');
    if (opts.lessons) localStorage.setItem('shootwords.shadowLessons.v1', JSON.stringify(opts.lessons));
    if (opts.prefs) localStorage.setItem('shootwords.shadowPrefs.v1', JSON.stringify(opts.prefs));
    if (opts.lastGame) localStorage.setItem('shootwords.lastGame.v1', opts.lastGame);
  }, options);
}

const FAST = { gapFactor: 0.75, rate: 1, repeat: 1, autoNext: true, mode: 'repeat', textMode: 'show' };

async function openLesson(page: Page, prefs: Record<string, unknown> = FAST) {
  await setup(page, { lessons: [LESSON], prefs, lastGame: 'shadow' });
  await page.goto('./');
  await page.locator('.sh-lesson-open').first().click();
  await expect(page.locator('.sh-video-overlay')).toBeHidden();
  await expect(page.locator('.sh-play')).toBeEnabled();
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('entry', () => {
  test('home shows both games and opens Shadowing', async ({ page }) => {
    await setup(page);
    await page.goto('./?home=1');
    await expect(page.locator('.game-tile')).toHaveCount(2);
    await page.locator('.game-tile-shadow').click();
    await expect(page.locator('.sh-home h1')).toHaveText('Shadowing');
    await expect(page.locator('.sh-suggest').first()).toBeVisible();
    await noHorizontalScroll(page);

    // level tabs
    await page.locator('.sh-tab[data-level="advanced"]').click();
    await expect(page.locator('.sh-suggest h3').first()).toContainText('Matt Cutts');
    await page.locator('.sh-tab[data-level="kids"]').click();
    await expect(page.locator('.sh-suggest h3').first()).toContainText('Peppa');

    // back to the word game
    await page.locator('.sh-back').click();
    await expect(page.locator('.game-switch')).toBeVisible();
  });

  test('reopens Shadowing when it was used last, and the word game otherwise', async ({ page }) => {
    await setup(page, { lastGame: 'shadow' });
    await page.goto('./');
    await expect(page.locator('.sh-home')).toBeVisible();
    await page.locator('.sh-back').click();
    await page.locator('.set-card .practice-btn').first().click();
    await expect(page.locator('.screen-game')).toBeVisible();
    await page.reload();
    await expect(page.locator('.screen-game')).toBeVisible();
  });
});

test.describe('new lesson', () => {
  test('from a link and a pasted YouTube transcript', async ({ page }) => {
    await setup(page, { lastGame: 'shadow' });
    await page.goto('./');
    await page.locator('.sh-new-card').click();

    const save = page.locator('.sh-save');
    await expect(save).toBeDisabled();
    await expect(page.locator('.sh-guide')).toHaveAttribute('open', '');

    await page.locator('#sh-url').fill('not a link');
    await expect(page.locator('.sh-url-status .sh-bad')).toBeVisible();
    await page.locator('#sh-url').fill('https://youtu.be/abcdefghijk?si=xyz');
    await expect(page.locator('.sh-url-ok')).toContainText('abcdefghijk');
    await expect(save).toBeDisabled();

    await page.locator('#sh-transcript').fill('no times here at all');
    await expect(page.locator('.sh-parse-status .sh-bad')).toBeVisible();
    await page.locator('#sh-transcript').fill(TRANSCRIPT);
    await expect(page.locator('.sh-parse-status .sh-good')).toContainText('3 câu');
    await expect(page.locator('.sh-preview-list li')).toHaveCount(3);
    await expect(page.locator('.sh-preview-list li').nth(1)).toContainText('Today we are going to learn about animals.');
    await expect(page.locator('.sh-preview-list li').nth(2)).toContainText('Cats are very cute.');
    await expect(page.locator('.sh-preview-list li').first()).toContainText('Hello everyone and welcome to our little show.');
    await expect(save).toBeEnabled();

    await page.locator('.sh-chip[data-level="advanced"]').click();
    await expect(page.locator('.sh-chip[data-level="advanced"]')).toHaveClass(/active/);
    await noHorizontalScroll(page);
    await save.click();

    await expect(page.locator('.sh-lesson-screen')).toBeVisible();
    await expect(page.locator('.sh-list .sh-row')).toHaveCount(3);
    // no name given: taken from the video once it loads
    await expect(page.locator('.sh-bar-title')).toHaveText('Fake video title');
    await page.locator('.sh-back').click();
    await expect(page.locator('.sh-lesson-title')).toHaveText('Fake video title');
    await expect(page.locator('.sh-level-advanced')).toBeVisible();
  });

  test('from a suggested video, with an .srt file', async ({ page }) => {
    await setup(page, { lastGame: 'shadow' });
    await page.goto('./');
    await page.locator('.sh-tab[data-level="kids"]').click();
    await page.locator('.sh-suggest .sh-make').first().click();
    await expect(page.locator('.sh-new-pick')).toContainText('Peppa Pig');
    await expect(page.locator('#sh-title')).toHaveValue('Peppa Pig — Muddy Puddles');
    await expect(page.locator('.sh-chip[data-level="kids"]')).toHaveClass(/active/);

    await page.locator('#sh-url').fill('https://www.youtube.com/watch?v=abcdefghijk');
    await page.locator('.sh-file').setInputFiles({
      name: 'peppa.srt',
      mimeType: 'application/x-subrip',
      buffer: Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nI am Peppa Pig.\n\n2\n00:00:03,000 --> 00:00:05,000\nThis is my little brother George.\n'),
    });
    await expect(page.locator('.sh-parse-status .sh-good')).toContainText('2 câu');
    await page.locator('.sh-save').click();
    await expect(page.locator('.sh-bar-title')).toHaveText('Peppa Pig — Muddy Puddles');
    await page.locator('.sh-back').click();
    await page.locator('.sh-tab[data-level="kids"]').click();
    await expect(page.locator('.sh-suggest').first().locator('.sh-have')).toBeVisible();
  });
});

test.describe('practice', () => {
  test('listen & repeat: plays a sentence, gives a turn, moves on', async ({ page }) => {
    await openLesson(page);
    await expect(page.locator('.sh-bar-count')).toHaveText('1/4');
    await expect(page.locator('.sh-text')).toHaveText('Hello there, my friend.');
    await page.locator('.sh-play').click();
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing');
    await expect(page.locator('.sh-status')).toHaveText('👂 Nghe kỹ…');

    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'gap', { timeout: 5000 });
    await expect(page.locator('.sh-status')).toContainText('Đến lượt bạn');
    // the video really stopped near the end of the sentence
    const stoppedAt = await page.evaluate(() => (window as any).__yt.now());
    expect(stoppedAt).toBeGreaterThan(3);
    expect(stoppedAt).toBeLessThan(3.8);
    await expect(page.locator('.sh-row[data-i="0"]')).toHaveClass(/done/);

    await expect(page.locator('.sh-bar-count')).toHaveText('2/4', { timeout: 6000 });
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing');
    await expect(page.locator('.sh-text')).toHaveText('How are you today?');
    await expect(page.locator('.sh-row[data-i="1"]')).toHaveClass(/current/);
  });

  test('pause, resume, replay, next and previous', async ({ page }) => {
    await openLesson(page);
    await page.locator('.sh-play').click();
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing');
    await page.locator('.sh-play').click();
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'paused');
    const t1 = await page.evaluate(() => (window as any).__yt.now());
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__yt.now())).toBeCloseTo(t1, 1);
    await page.locator('.sh-play').click();
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing');

    await page.locator('.sh-next').click();
    await expect(page.locator('.sh-bar-count')).toHaveText('2/4');
    await page.locator('.sh-next').click();
    await expect(page.locator('.sh-bar-count')).toHaveText('3/4');
    await page.locator('.sh-prev').click();
    await expect(page.locator('.sh-bar-count')).toHaveText('2/4');

    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'gap', { timeout: 6000 });
    await page.locator('.sh-replay').click();
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing');
    await expect(page.locator('.sh-bar-count')).toHaveText('2/4');
    // replay starts from the sentence's beginning even though the video reports late
    await page.waitForTimeout(150);
    const t = await page.evaluate(() => (window as any).__yt.now());
    expect(t).toBeGreaterThan(2.8);
    expect(t).toBeLessThan(3.6);
  });

  test('jump to a sentence from the transcript', async ({ page }) => {
    await openLesson(page);
    await page.locator('.sh-row[data-i="2"] .sh-row-main').click();
    await expect(page.locator('.sh-bar-count')).toHaveText('3/4');
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing');
    await expect(page.locator('.sh-text')).toHaveText('I am fine, thank you.');
  });

  test('auto-next off waits for ▶; each sentence twice', async ({ page }) => {
    await openLesson(page, { ...FAST, repeat: 2, autoNext: false });
    await page.locator('.sh-play').click();
    await expect(page.locator('.sh-rep')).toHaveText('Lần 1/2');
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'gap', { timeout: 5000 });
    // second time through, same sentence
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing', { timeout: 6000 });
    await expect(page.locator('.sh-rep')).toHaveText('Lần 2/2');
    await expect(page.locator('.sh-bar-count')).toHaveText('1/4');
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'waiting', { timeout: 12000 });
    await expect(page.locator('.sh-bar-count')).toHaveText('1/4');
    await page.locator('.sh-play').click();
    await expect(page.locator('.sh-bar-count')).toHaveText('2/4');
  });

  test('shadow mode runs on and can loop a sentence', async ({ page }) => {
    await openLesson(page, { ...FAST, mode: 'shadow' });
    await expect(page.locator('.sh-mode [data-mode="shadow"]')).toHaveClass(/active/);
    await expect(page.locator('.sh-replay small')).toHaveText('Lặp câu');
    await page.locator('.sh-play').click();
    await expect(page.locator('.sh-status')).toHaveText('🗣 Nói cùng lúc với video');
    await expect(page.locator('.sh-bar-count')).toHaveText('2/4', { timeout: 5000 });
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing');

    await page.locator('.sh-replay').click();
    await expect(page.locator('.sh-replay')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sh-status')).toHaveText('🔂 Đang lặp lại câu này');
    await page.waitForTimeout(3500);
    await expect(page.locator('.sh-bar-count')).toHaveText('2/4');
    const t = await page.evaluate(() => (window as any).__yt.now());
    expect(t).toBeGreaterThan(2.5);
    expect(t).toBeLessThan(6);

    // switch back to listen & repeat
    await page.locator('.sh-mode [data-mode="repeat"]').click();
    await expect(page.locator('.sh-replay small')).toHaveText('Nghe lại');
  });

  test('text modes and speed', async ({ page }) => {
    await openLesson(page);
    const textBtn = page.locator('.sh-textmode');
    await textBtn.click();
    await expect(page.locator('.sh-text')).toHaveText('H____ t____, m_ f_____.');
    await textBtn.click();
    await expect(page.locator('.sh-text')).toContainText('Chạm để xem câu');
    await page.locator('.sh-card').click();
    await expect(page.locator('.sh-text')).toHaveText('Hello there, my friend.');
    await textBtn.click();
    await expect(page.locator('.sh-text')).toHaveText('Hello there, my friend.');

    const speed = page.locator('.sh-speed');
    await expect(speed).toHaveText('1×');
    await speed.click();
    await expect(speed).toHaveText('🐇 1.25×');
    await speed.click();
    await expect(speed).toHaveText('🐢 0.5×');
    expect(await page.evaluate(() => (window as any).__yt.rate)).toBe(0.5);

    // remembered next time
    await page.reload();
    await page.locator('.sh-lesson-open').first().click();
    await expect(page.locator('.sh-speed')).toHaveText('🐢 0.5×');
  });

  test('keyboard shortcuts', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard is a desktop feature');
    await openLesson(page);
    await page.keyboard.press('Space');
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing');
    await page.keyboard.press('Space');
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'paused');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.sh-bar-count')).toHaveText('2/4');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.sh-bar-count')).toHaveText('1/4');
    await page.keyboard.press('t');
    await expect(page.locator('.sh-text')).toHaveText('H____ t____, m_ f_____.');
  });

  test('settings sheet', async ({ page }) => {
    await openLesson(page);
    await page.locator('.sh-settings-btn').click();
    await expect(page.locator('.sh-sheet')).toBeVisible();
    await page.locator('.sh-choice[data-name="repeat"] .sh-chip[data-value="3"]').click();
    await expect(page.locator('.sh-choice[data-name="repeat"] .sh-chip[data-value="3"]')).toHaveClass(/active/);
    await page.locator('.sh-auto').uncheck();
    await page.locator('.sh-sheet-close').click();
    await expect(page.locator('.sh-sheet')).toBeHidden();
    const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('shootwords.shadowPrefs.v1')!));
    expect(prefs).toMatchObject({ repeat: 3, autoNext: false });
  });

  test('finishing the lesson', async ({ page }) => {
    await openLesson(page);
    await page.locator('.sh-row[data-i="3"] .sh-row-main').click();
    await expect(page.locator('.sh-finish-card')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.sh-finish-card h2')).toHaveText('Giỏi lắm!');
    await page.locator('.sh-again').click();
    await expect(page.locator('.sh-finish')).toBeHidden();
    await expect(page.locator('.sh-bar-count')).toHaveText('1/4');
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing');
  });

  test('editing sentences is saved', async ({ page }) => {
    await openLesson(page);
    await page.locator('.sh-edit-toggle').click();
    await page.locator('.sh-row[data-i="0"] [data-act="merge"]').click();
    await expect(page.locator('.sh-row')).toHaveCount(3);
    await expect(page.locator('.sh-text')).toHaveText('Hello there, my friend. How are you today?');
    await page.locator('.sh-row[data-i="1"] [data-act="split"]').click();
    await expect(page.locator('.sh-row')).toHaveCount(4);
    await expect(page.locator('.sh-row[data-i="1"] .sh-row-text')).toHaveText('I am fine,');
    await expect(page.locator('.sh-row[data-i="2"] .sh-row-text')).toHaveText('thank you.');
    await page.locator('.sh-row[data-i="3"] [data-act="remove"]').click();
    await expect(page.locator('.sh-row')).toHaveCount(3);
    await page.locator('.sh-edit-toggle').click();
    await expect(page.locator('.sh-row-edit')).toHaveCount(0);

    await page.reload();
    await page.locator('.sh-lesson-open').first().click();
    await expect(page.locator('.sh-row')).toHaveCount(3);
    await expect(page.locator('.sh-bar-count')).toHaveText('1/3');
  });

  test('progress and "continue" survive a reload', async ({ page }) => {
    await openLesson(page);
    await page.locator('.sh-row[data-i="1"] .sh-row-main').click();
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'gap', { timeout: 6000 });
    await page.locator('.sh-back').click();
    await expect(page.locator('.sh-continue')).toContainText('1/4');
    await expect(page.locator('.sh-lesson-meta')).toContainText('1/4');
    // leaving the lesson stops the video
    expect(await page.evaluate(() => (window as any).__yt.destroyed)).toBe(true);
    await page.reload();
    await page.locator('.sh-continue').click();
    await expect(page.locator('.sh-bar-count')).toHaveText('2/4');
    await expect(page.locator('.sh-row[data-i="1"]')).toHaveClass(/done/);
  });

  test('going to the background pauses', async ({ page }) => {
    await openLesson(page);
    await page.locator('.sh-play').click();
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'playing');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'paused');
    expect(await page.evaluate(() => (window as any).__yt.playing)).toBe(false);
  });
});

test.describe('problems', () => {
  test('a video that cannot be embedded', async ({ page }) => {
    await setup(page, { lessons: [{ ...LESSON, videoId: 'NoEmbed0000' }], lastGame: 'shadow' });
    await page.goto('./');
    await page.locator('.sh-lesson-open').click();
    await expect(page.locator('.sh-video-overlay')).toContainText('không cho phát');
    await expect(page.locator('.sh-video-overlay a')).toHaveAttribute('href', /youtube\.com\/watch\?v=NoEmbed0000/);
    await expect(page.locator('.sh-play')).toBeDisabled();
  });

  test('YouTube unreachable, then back', async ({ page }) => {
    await setup(page, { lessons: [LESSON], lastGame: 'shadow', blockApi: true });
    await page.goto('./');
    await page.locator('.sh-lesson-open').click();
    await expect(page.locator('.sh-video-overlay')).toContainText('Không tải được YouTube');
    await page.unroute('**/iframe_api');
    await page.route('**/iframe_api', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_YT }));
    await page.locator('.sh-retry').click();
    await expect(page.locator('.sh-video-overlay')).toBeHidden();
    await expect(page.locator('.sh-play')).toBeEnabled();
  });

  test('a missing lesson falls back to the list', async ({ page }) => {
    await setup(page, { lessons: [LESSON], lastGame: 'shadow' });
    await page.goto('./');
    await expect(page.locator('.sh-lesson-open')).toBeVisible();
    await page.evaluate(() => localStorage.setItem('shootwords.shadowLessons.v1', '[]'));
    await page.locator('.sh-lesson-open').click();
    await expect(page.locator('.sh-home')).toBeVisible();
  });
});

test.describe('layout', () => {
  test('screenshots for review', async ({ page }, info) => {
    await openLesson(page);
    await noHorizontalScroll(page);
    // the transcript stays visible below / beside the controls
    const list = await page.locator('.sh-side').boundingBox();
    const viewport = page.viewportSize()!;
    expect(list!.y + 80).toBeLessThan(viewport.height);
    await page.locator('.sh-play').click();
    await expect(page.locator('.sh-card')).toHaveAttribute('data-phase', 'gap', { timeout: 5000 });
    await page.screenshot({ path: `test-results/shots/${info.project.name}-lesson-gap.png` });
    await page.locator('.sh-back').click();
    await page.screenshot({ path: `test-results/shots/${info.project.name}-home.png`, fullPage: true });
    await page.locator('.sh-new-card').click();
    await page.locator('#sh-url').fill('https://youtu.be/abcdefghijk');
    await page.locator('#sh-transcript').fill(TRANSCRIPT);
    await page.screenshot({ path: `test-results/shots/${info.project.name}-new.png`, fullPage: true });
  });

  test('small phone keeps the transcript in view', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout');
    await page.setViewportSize({ width: 360, height: 640 });
    await openLesson(page);
    await noHorizontalScroll(page);
    const list = await page.locator('.sh-side').boundingBox();
    expect(list!.height).toBeGreaterThanOrEqual(100);
    expect(list!.y + list!.height).toBeLessThanOrEqual(641);
    await page.screenshot({ path: 'test-results/shots/small-phone-lesson.png' });
  });
});
