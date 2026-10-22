import { expect, test, type Browser } from '@playwright/test';

// Reading a transcript from screenshots: the pictures are drawn here, in the style
// of YouTube's dark transcript panel (made-up text), and fed to the real reader.

interface Entry {
  t: string;
  text: string;
}

const PAGE_ONE: Entry[] = [
  { t: '0:05', text: 'Every morning the gardener walks down to the old greenhouse, long before anyone else is awake.' },
  { t: '0:12', text: 'She waters the tomatoes first, then the peppers.' },
  { t: '0:19', text: "I think it's the quietest part of her whole day." },
  { t: '0:27', text: 'Chapter' },
  { t: '0:33', text: 'The radio on the shelf plays soft music while the sun comes up over the hills.' },
  { t: '0:41', text: 'Nobody has ever asked her to keep this routine.' },
];

const PAGE_TWO: Entry[] = [
  { t: '0:33', text: 'The radio on the shelf plays soft music while the sun comes up over the hills.' },
  { t: '0:41', text: 'Nobody has ever asked her to keep this routine.' },
  { t: '0:48', text: 'And yet she says the plants can tell when a day is going to be hot.' },
  { t: '0:56', text: "That's why she always opens the windows before breakfast." },
];

const PAGE_THREE: Entry[] = [
  { t: '0:48', text: 'And yet she says the plants can tell when a day is going to be hot.' },
  { t: '0:56', text: "That's why she always opens the windows before breakfast." },
  { t: '1:03', text: 'Then she checks the seedlings one by one.' },
  { t: '1:10', text: 'By seven oclock the first visitors arrive.' },
];

// a page far away in the video, to see the missing stretch noticed
const PAGE_FAR: Entry[] = [
  { t: '3:10', text: 'By noon the greenhouse is full of the smell of warm leaves.' },
  { t: '3:18', text: 'Visitors usually stay longer than they planned.' },
];

function panelHtml(entries: Entry[], chapter?: string): string {
  const rows = entries
    .map((e) =>
      e.text === 'Chapter'
        ? `<h2>${chapter ?? 'Chapter 2: A very long title about gardens'}</h2>`
        : `<p><span class="pill">${e.t}</span> ${e.text}</p>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; width: 1080px; height: 2200px; background: #0f0f0f; color: #f1f1f1; font-family: Roboto, Arial, sans-serif; position: relative; overflow: hidden; }
    .status { height: 90px; font-size: 40px; padding: 24px 40px; box-sizing: border-box; color: #ddd; }
    .video { height: 520px; background: #223; display: grid; place-items: center; font-size: 60px; color: #fcc; }
    .title { font-size: 64px; font-weight: 700; padding: 40px 40px 10px; }
    .search { margin: 20px 40px; padding: 30px; background: #272727; border-radius: 60px; font-size: 56px; color: #aaa; }
    .list { padding: 0 40px; font-size: 62px; font-weight: 700; line-height: 1.3; color: #cfcfcf; }
    .list p { margin: 0 0 44px; }
    .pill { display: inline-block; background: #272727; border-radius: 40px; padding: 4px 26px; font-size: 46px; font-weight: 500; color: #aaa; margin-right: 12px; }
    h2 { font-size: 66px; margin: 20px 0 44px; color: #fff; }
    .sync { position: absolute; left: 330px; top: 1760px; background: #fff; color: #111; padding: 28px 60px; border-radius: 60px; font-size: 52px; font-family: Arial, sans-serif; }
    .nav { position: absolute; bottom: 0; height: 110px; width: 100%; background: #000; }
  </style>
  <div class="status">11:09 &nbsp; 62 &nbsp; 5G &nbsp; 44%</div>
  <div class="video">Video here</div>
  <div class="title">&lt; Transcript</div>
  <div class="search">Search transcript</div>
  <div class="list">${rows}</div>
  <div class="sync">Sync to video</div>
  <div class="nav"></div>`;
}

async function screenshot(browser: Browser, entries: Entry[]): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: 1080, height: 2200 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  const page = await context.newPage();
  await page.setContent(panelHtml(entries));
  const png = await page.screenshot();
  await context.close();
  return png;
}

async function openNewLesson(page: import('@playwright/test').Page) {
  await page.route('https://i.ytimg.com/**', (route) => route.abort());
  await page.route('https://cloud.umami.is/**', (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('shootwords.lang.v1', 'vi');
    localStorage.setItem('shootwords.lastGame.v1', 'shadow');
  });
  await page.goto('./');
  await page.locator('.sh-new-card').click();
}

test.describe('transcript from screenshots', () => {
  test.setTimeout(120000);

  test('reads overlapping screenshots into one transcript', async ({ page, browser }) => {
    // the "Sync to video" button covers the last line of the first two screenshots: those
    // lines are read clearly from the next screenshot
    const shots = [await screenshot(browser, PAGE_ONE), await screenshot(browser, PAGE_TWO), await screenshot(browser, PAGE_THREE)];
    await openNewLesson(page);
    await page.locator('.sh-ocr-input').setInputFiles(
      shots.map((buffer, i) => ({ name: `s${i}.png`, mimeType: 'image/png', buffer })),
    );
    await expect(page.locator('.sh-ocr-status .sh-good')).toContainText('Đã đọc 3 ảnh', { timeout: 100000 });

    const text = await page.locator('#sh-transcript').inputValue();
    const lines = text.split('\n');
    // times and text alternate, in order, with the overlap and the chapter heading dealt with
    expect(lines.filter((_, i) => i % 2 === 0)).toEqual(['0:05', '0:12', '0:19', '0:33', '0:41', '0:48', '0:56', '1:03', '1:10']);
    expect(lines[1]).toContain('gardener walks down to the old greenhouse');
    expect(lines[5]).toBe("I think it's the quietest part of her whole day."); // not "l think"
    expect(text).not.toMatch(/Chapter|Sync to video|Search|11:09/);
    expect(lines[7]).toContain('radio on the shelf');
    expect(lines[9]).toContain('Nobody has ever asked her to keep this routine');
    expect(lines[13]).toBe("That's why she always opens the windows before breakfast.");

    // and it goes on into the lesson like a pasted transcript
    await expect(page.locator('.sh-parse-status .sh-good')).toBeVisible();
    await expect(page.locator('.sh-ocr-status .sh-bad')).toHaveCount(0);
    await page.locator('#sh-url').fill('https://youtu.be/abcdefghijk');
    await expect(page.locator('.sh-save')).toBeEnabled();
  });

  test('notices a missing stretch between screenshots', async ({ page, browser }) => {
    const [one, far] = [await screenshot(browser, PAGE_ONE), await screenshot(browser, PAGE_FAR)];
    await openNewLesson(page);
    await page.locator('.sh-ocr-input').setInputFiles([
      { name: 'a.png', mimeType: 'image/png', buffer: one },
      { name: 'c.png', mimeType: 'image/png', buffer: far },
    ]);
    await expect(page.locator('.sh-ocr-status .sh-good')).toBeVisible({ timeout: 100000 });
    await expect(page.locator('.sh-ocr-status .sh-bad')).toContainText(/0:(33|41) → 3:10/);
  });

  test('a picture without a transcript says so', async ({ page, browser }) => {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    const blank = await context.newPage();
    await blank.setContent('<body style="background:#fff;color:#000;font:48px Arial">Just a holiday photo caption</body>');
    const png = await blank.screenshot();
    await context.close();
    await openNewLesson(page);
    await page.locator('.sh-ocr-input').setInputFiles([{ name: 'x.png', mimeType: 'image/png', buffer: png }]);
    await expect(page.locator('.sh-ocr-status .sh-bad')).toContainText('Không thấy dòng transcript', { timeout: 100000 });
    await expect(page.locator('#sh-transcript')).toHaveValue('');
  });
});
