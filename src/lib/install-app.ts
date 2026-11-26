// "Install the app" (add the hub to the home screen): which install path this browser offers, whether the app already
// runs installed, and when the dashboard banner shows. Pure functions only (unit tested in src/test/install-app.test.ts);
// the browser state lives in src/lib/install-app-store.ts. Signed-in code only: no public route imports it.

/**
 * How the "Install app" entry installs, or null when it is hidden:
 * - `prompt`: Chrome / Edge / Samsung Internet captured `beforeinstallprompt`; the button calls its prompt().
 * - `ios-safari`: Safari on iPhone / iPad: instructions (Share, then Add to Home Screen).
 * - `ios-other`: another browser on iPhone / iPad (Chrome, Firefox, Edge, in-app browsers): open the page in Safari first.
 * - `android-menu`: Firefox on Android (no `beforeinstallprompt`): the browser menu's Install / Add to Home screen.
 * - `mac-safari`: Safari 17+ on a Mac: File, then Add to Dock.
 */
export type InstallMode = "prompt" | "ios-safari" | "ios-other" | "android-menu" | "mac-safari";

/** The instruction sheets (every mode but `prompt`). */
export type InstallSheetVariant = Exclude<InstallMode, "prompt">;

export type Platform = {
  ios: boolean;
  /** Safari itself (not another browser or an in-app web view) on iPhone / iPad. */
  iosSafari: boolean;
  android: boolean;
  firefoxAndroid: boolean;
  /** Safari 17 or later on macOS (File, then Add to Dock). */
  macSafari: boolean;
};

/** Tokens of iOS browsers and in-app web views that are not Safari (they cannot add to the home screen themselves). */
const IOS_OTHER =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\/|FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp|Snapchat|TikTok|MicroMessenger/i;
/** Chromium-based and other browsers that send "Safari" in their user agent on a Mac. */
const NOT_SAFARI = /Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i;

/**
 * Classifies the device from its user agent. iPadOS 13+ reports a Mac user agent; it is told apart by its touch screen
 * (`maxTouchPoints` above 1, which no Mac has).
 */
export function classifyPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  const ua = userAgent || "";
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const iosSafari = ios && /Safari\//i.test(ua) && /Version\//i.test(ua) && !IOS_OTHER.test(ua);
  const android = !ios && /Android/i.test(ua);
  const firefoxAndroid = android && /Firefox\//i.test(ua);
  const safariVersion = /Version\/(\d+)/i.exec(ua);
  const macSafari =
    !ios &&
    /Macintosh/i.test(ua) &&
    /Safari\//i.test(ua) &&
    !NOT_SAFARI.test(ua) &&
    !!safariVersion &&
    Number(safariVersion[1]) >= 17;
  return { ios, iosSafari, android, firefoxAndroid, macSafari };
}

/** Display modes in which the hub runs as an installed app (the manifest asks for standalone). */
export const INSTALLED_DISPLAY_MODES = [
  "standalone",
  "minimal-ui",
  "window-controls-overlay",
] as const;

/**
 * Whether the page runs as an installed app: a matching `display-mode` media query, or iOS's `navigator.standalone`
 * (a home-screen web app). `fullscreen` is left out on purpose: a browser tab in full screen (F11) matches it too.
 */
export function isStandalone(
  matchMedia: ((query: string) => { matches: boolean }) | undefined,
  navigatorStandalone: boolean | undefined,
): boolean {
  if (navigatorStandalone === true) return true;
  if (!matchMedia) return false;
  return INSTALLED_DISPLAY_MODES.some((mode) => {
    try {
      return matchMedia(`(display-mode: ${mode})`).matches;
    } catch {
      return false;
    }
  });
}

/**
 * The install path for this device, or null (no install UI). Installed: nothing. iPhone / iPad first (they never fire
 * `beforeinstallprompt`), then a captured prompt, then the browser-menu paths. Chrome / Edge without a captured prompt
 * (already installed, or not installable yet) and browsers that cannot install (Firefox on a computer) show nothing.
 */
export function installMode(
  platform: Platform,
  standalone: boolean,
  hasPrompt: boolean,
): InstallMode | null {
  if (standalone) return null;
  if (platform.ios) return platform.iosSafari ? "ios-safari" : "ios-other";
  if (hasPrompt) return "prompt";
  if (platform.firefoxAndroid) return "android-menu";
  if (platform.macSafari) return "mac-safari";
  return null;
}

/** What this device remembers (localStorage): the banner was dismissed, or the app was installed here. */
export type InstallMemory = { dismissed: boolean; installed: boolean };

/** The dashboard banner: only with an install path, and never again once dismissed or installed on this device. */
export const bannerVisible = (mode: InstallMode | null, memory: InstallMemory) =>
  mode !== null && !memory.dismissed && !memory.installed;

/** The permanent menu item: whenever there is an install path (it comes back when Chrome offers the prompt again). */
export const menuItemVisible = (mode: InstallMode | null) => mode !== null;

export const INSTALL_DISMISSED_KEY = "install-app-banner-dismissed";
export const INSTALLED_KEY = "install-app-installed";

/** Storage that may be missing or throw (private mode, blocked site data). */
type MaybeStorage = Pick<Storage, "getItem" | "setItem"> | null | undefined;

export function readInstallMemory(storage: MaybeStorage): InstallMemory {
  const read = (key: string) => {
    try {
      return storage?.getItem(key) === "1";
    } catch {
      return false;
    }
  };
  return { dismissed: read(INSTALL_DISMISSED_KEY), installed: read(INSTALLED_KEY) };
}

export function writeInstallMemory(
  storage: MaybeStorage,
  key: typeof INSTALL_DISMISSED_KEY | typeof INSTALLED_KEY,
) {
  try {
    storage?.setItem(key, "1");
  } catch {
    /* storage unavailable: remembered for this page only */
  }
}
