import { ScreenManager, type ScreenRenderer } from '@/ui/ScreenManager';
import { renderMenuScreen } from '@/ui/screens/MenuScreen';
import { renderImportScreen } from '@/ui/screens/ImportScreen';
import { renderGameScreen } from '@/ui/screens/GameScreen';
import { renderResultsScreen } from '@/ui/screens/ResultsScreen';
import type { GameMode } from '@/game/GameMode';
import type { WordSet } from '@/types/wordset';
import {
  getLastPlayedSetId,
  loadWordSets,
  setLastPlayedSetId,
  setLastSelectedSetId,
} from '@/data/wordSetStore';
import { FIRST_PLAY_SET_ID } from '@/data/seedSets';
import { LAST_GAME_KEY } from '@/utils/storageKeys';
import { t } from '@/i18n';

type ShadowScreens = typeof import('@/shadowing/ui/screens');
type Game = 'words' | 'shadow';

function getLastGame(): Game {
  try {
    return localStorage.getItem(LAST_GAME_KEY) === 'shadow' ? 'shadow' : 'words';
  } catch {
    return 'words';
  }
}

function setLastGame(game: Game): void {
  try {
    localStorage.setItem(LAST_GAME_KEY, game);
  } catch {
    // only a convenience
  }
}

export interface ShowGameOptions {
  // open the round paused behind a "start" button (the app just opened)
  waitForStart?: boolean;
  // practice (default) or a challenge set up with its miss limit and speed
  mode?: GameMode;
  // who is playing (a challenge asks; practice uses the Home player name)
  player?: string;
}

export class App {
  private screens: ScreenManager;
  // Shadowing is its own chunk, loaded the first time it is opened.
  private shadowScreens: Promise<ShadowScreens> | null = null;
  // bumped on every navigation, so a slow chunk load can't replace a newer screen
  private navigation = 0;

  constructor(root: HTMLElement) {
    this.screens = new ScreenManager(root);
  }

  // Opening the app goes straight into a round: the set played last, or Ways of
  // Walking on a first visit. `?home=1` in the URL opens Home instead.
  // Whoever was last in Shadowing opens its lesson list instead.
  start(): void {
    const home = new URLSearchParams(location.search).has('home');
    if (!home && getLastGame() === 'shadow') {
      this.showShadowHome();
    } else {
      const set = home ? undefined : this.setToOpen();
      if (set) this.showGame(set, { waitForStart: true });
      else this.showMenu();
    }
    // fetch the Shadowing chunk while idle, so opening it is instant (and works
    // offline once cached)
    window.setTimeout(() => void this.loadShadow().catch(() => undefined), 4000);
  }

  private setToOpen(): WordSet | undefined {
    const sets = loadWordSets().filter((s) => s.words.length > 0);
    const lastPlayed = getLastPlayedSetId();
    return (
      sets.find((s) => s.id === lastPlayed) ?? sets.find((s) => s.id === FIRST_PLAY_SET_ID) ?? sets[0]
    );
  }

  showMenu = (): void => {
    this.navigation++;
    this.screens.show((root) => renderMenuScreen(root, this));
  };

  showImport = (): void => {
    this.navigation++;
    this.screens.show((root) => renderImportScreen(root, this));
  };

  showGame = (wordSet: WordSet, options: ShowGameOptions = {}): void => {
    this.navigation++;
    setLastGame('words');
    setLastPlayedSetId(wordSet.id);
    setLastSelectedSetId(wordSet.id);
    this.screens.show((root) => renderGameScreen(root, this, wordSet, options));
  };

  showResults = (wordSet: WordSet, sessionId: string): void => {
    this.navigation++;
    this.screens.show((root) => renderResultsScreen(root, this, wordSet, sessionId));
  };

  showShadowHome = (): void => {
    this.showShadow((m, root) => m.renderShadowHome(root, this));
  };

  showShadowNew = (suggestionId?: string): void => {
    this.showShadow((m, root) => m.renderShadowNew(root, this, suggestionId));
  };

  showShadowLesson = (lessonId: string): void => {
    this.showShadow((m, root) => m.renderShadowLesson(root, this, lessonId));
  };

  private loadShadow(): Promise<ShadowScreens> {
    if (!this.shadowScreens) {
      this.shadowScreens = import('@/shadowing/ui/screens').catch((err) => {
        this.shadowScreens = null;
        throw err;
      });
    }
    return this.shadowScreens;
  }

  private showShadow(render: (screens: ShadowScreens, root: HTMLElement) => ReturnType<ScreenRenderer>): void {
    const navigation = ++this.navigation;
    setLastGame('shadow');
    this.loadShadow().then(
      (screens) => {
        if (navigation === this.navigation) this.screens.show((root) => render(screens, root));
      },
      () => {
        if (navigation !== this.navigation) return;
        alert(t('shadowLoadError'));
        setLastGame('words');
        this.showMenu();
      },
    );
  }
}
