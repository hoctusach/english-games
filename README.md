# Word Shooter (Game Bắn Từ)

A small arcade-style typing game for practicing English vocabulary. Words drift down the
screen with their Vietnamese meaning shown as a hint — type the word to "shoot" it down
before it reaches the bottom. Correct words are read aloud.

Live: https://hoctusach.github.io/english-shoot-words/

On phones and tablets the game shows its own English keyboard instead of opening the
system one, so there are no suggestions, autocorrect or Vietnamese input method (Telex)
getting in the way, and no need to switch the phone's keyboard language. A physical
keyboard still works. Add `?osk=0` to the URL to use the system keyboard instead, or
`?osk=1` to force the game's keyboard on a computer.

## Import

Import a `.csv` or `.xlsx` file with two columns: word, then meaning. An optional third
column holds an example sentence, shown (in italics, with the word highlighted) under the
meaning after the word is shot; leave it blank to show none. No header row is needed —
every row is read as one word (a leading `Word,Meaning`-style header row is skipped
automatically if present). CSV fields may be quoted, so meanings and examples can contain
commas. A word listed more than once becomes one entry with all its meanings. Accented
letters and typographic punctuation in words (exposé, didn’t) can be typed with the
plain keyboard letters (expose, didn't). Each imported file is saved as a single word set that
you can rename afterwards from "Saved word sets".

## Practice and Challenge

Each word set has two modes:

- **Practice (Luyện tập)**: endless, no game over. Words are picked adaptively
  (1 new : 3 to review) and the speed can be changed while playing. ⏹ finishes the
  round and shows the results with the set's recent rounds.
- **Challenge (Thử thách)**: made for comparing players, e.g. a teacher letting each
  child play in turn. Before starting, enter the player's name, how many missed words
  end the game (default 10) and the speed, which is then locked. Every attempt on the
  set gets the same words in the same order (a fixed seeded shuffle), so scores are
  comparable; attempts with the same miss limit and speed are ranked on a leaderboard
  shown after each attempt and on the set's card.

Every round is recorded in `localStorage` (`shootwords.sessions.v1`) and updated after
each shot or miss, and lifetime totals are added per shot, so stopping or closing the
app mid-round never loses the score.

## Built-in sets

`src/data/seed/*.csv` files listed in `src/data/seedSets.ts` ship with the game (today:
"Movers A1", 740 words; "Ways of Walking (C1)", 26 words with examples; and
"advanced_words", 2477 idioms, phrasal verbs and word families, each with an example
sentence). Each list is its own small file,
loaded only on the visit that adds it. Each device gets them once on its next
visit, web or installed app; a player who deletes one doesn't get it back, and a set is
skipped if the player already imported the same words. To add another, drop its CSV in
`src/data/seed/` and add an entry with a new fixed `id`. When a later release adds example
sentences to a built-in set, raise its `examplesVersion`: devices that already have the set
get the examples filled in once (by term), keeping the player's progress and any example
they wrote.

After a word is shot, its example is shown with the word in bold, including phrases and
their other forms: *calm **her** down*, ***was under house arrest***, ***brought up***.

## Saved sets

Word sets are saved to the browser's `localStorage` on your device — no account, no
backend. Pick a saved set from "Saved word sets" to play it again instantly, or use the
"Continue: <set name>" shortcut on the home screen to jump back into the last one you
played.

## Install as an app, offline play and backups

The site is a Progressive Web App: phones can add it to the home screen and desktop
Chrome/Edge can install it as a window ("App & data" on Home shows how). After the first
visit it also opens and plays offline (`public/sw.js`).

"App & data" can download everything saved on the device (word sets, progress, stats,
settings) as one `.json` file and restore it later — on the same device after clearing
browser data, or on another device.

## Usage stats (optional, free)

`src/analytics.ts` can send anonymous counts to [Umami Cloud](https://cloud.umami.is)
(free plan, no cookies, no server of our own): app opens, installs, imports (word
count only), rounds started, finished or quit (speed, score, words shot, minutes).
No player names or word lists are sent. It is off until a Website ID is set:

1. Sign up at https://cloud.umami.is and add a website with domain
   `hoctusach.github.io`.
2. Copy its **Website ID** into `UMAMI_WEBSITE_ID` in `src/analytics.ts` and push.
3. Visitors, devices, countries and the events above then show in the Umami dashboard.

## Shadowing

The second game (🎧 on Home): practise speaking along with any YouTube video, one sentence
at a time. A lesson is a YouTube link plus its transcript with times, pasted from YouTube's
"Show transcript" panel or picked as a `.srt`/`.vtt` file (YouTube doesn't let a web page
fetch captions itself — see `docs/shadowing-plan.md`). The app cuts it into sentences and
plays them in the embedded YouTube player:

- **Listen & repeat (Nghe & nhắc lại)**: plays a sentence, stops, waits while you say it
  back (a green countdown ring), then plays it again or moves on.
- **Shadow (Nói đuổi)**: the video runs on and you speak along; one sentence can be looped.
- Speed 0.5×–1.25×, full text / first letters / hidden, a tappable transcript, merge or
  split badly cut sentences, keyboard shortcuts on computers.
- Suggested videos for kids (A2 Flyers), intermediate and advanced learners.

Lessons, progress and settings are saved in `localStorage` like the word sets (and are
part of backups). The code lives in `src/shadowing/` and loads only when Shadowing opens.

## Tests

```sh
npm run typecheck
npm test          # unit tests (vitest): transcript parsing, sentence cutting, the practice loop, storage
npm run test:e2e  # end-to-end (Playwright, Chromium) against the production build,
                  # with YouTube replaced by a fake player (e2e/fake-youtube.js)
```

Typecheck and unit tests also run before every deploy.

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
npm run preview  # preview the production build
```

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds the app and deploys
`dist/` to GitHub Pages via GitHub Actions.

**One-time setup**: in this repo's **Settings → Pages**, set **Build and deployment →
Source** to **GitHub Actions** (it defaults to "Deploy from a branch"). Without this, the
workflow builds successfully but the deploy step fails.
