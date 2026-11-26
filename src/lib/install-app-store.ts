// The one place that listens for the browser's install events. `startInstallCapture()` runs when the member shell's
// chunk loads (src/components/app/MemberShell.tsx), before the dashboard mounts, so a `beforeinstallprompt` that fires
// early is kept; components read the state through `useInstallApp()`. Signed-in code only.
import { useSyncExternalStore } from "react";
import {
  bannerVisible,
  classifyPlatform,
  installMode,
  isStandalone,
  menuItemVisible,
  readInstallMemory,
  writeInstallMemory,
  INSTALL_DISMISSED_KEY,
  INSTALLED_KEY,
  type InstallMemory,
  type InstallMode,
  type Platform,
} from "@/lib/install-app";

/** Chrome / Edge's install prompt event (not in the DOM typings). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

type State = {
  platform: Platform;
  standalone: boolean;
  deferred: BeforeInstallPromptEvent | null;
  memory: InstallMemory;
};

const NONE: Platform = {
  ios: false,
  iosSafari: false,
  android: false,
  firefoxAndroid: false,
  macSafari: false,
};
let state: State = {
  platform: NONE,
  standalone: false,
  deferred: null,
  memory: { dismissed: false, installed: false },
};
let started = false;
const listeners = new Set<() => void>();

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function remember(key: typeof INSTALL_DISMISSED_KEY | typeof INSTALLED_KEY) {
  writeInstallMemory(storage(), key);
  const memory =
    key === INSTALLED_KEY
      ? { ...state.memory, installed: true }
      : { ...state.memory, dismissed: true };
  set({ memory });
}

/** Starts listening once per page (browser only). */
export function startInstallCapture() {
  if (started || typeof window === "undefined") return;
  started = true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const standalone = isStandalone(window.matchMedia?.bind(window), nav.standalone);
  state = {
    platform: classifyPlatform(nav.userAgent, nav.maxTouchPoints ?? 0),
    standalone,
    deferred: null,
    memory: readInstallMemory(storage()),
  };
  // Running installed: remembered, so the banner stays away in the browser too (also after an uninstall).
  if (standalone && !state.memory.installed) remember(INSTALLED_KEY);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    set({ deferred: event as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => {
    set({ deferred: null });
    remember(INSTALLED_KEY);
  });
}

export type InstallApp = {
  mode: InstallMode | null;
  showBanner: boolean;
  showMenuItem: boolean;
  dismissBanner: () => void;
  /** Shows the browser's install prompt (mode `prompt`); false when there is none. */
  prompt: () => Promise<boolean>;
};

async function promptInstall() {
  const event = state.deferred;
  if (!event) return false;
  // A prompt event can be used once; the menu item comes back when the browser fires a new one.
  set({ deferred: null });
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "accepted") remember(INSTALLED_KEY);
  } catch {
    /* the browser refused the prompt (e.g. already shown) */
  }
  return true;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;

export function useInstallApp(): InstallApp {
  startInstallCapture();
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const mode = installMode(s.platform, s.standalone, !!s.deferred);
  return {
    mode,
    showBanner: bannerVisible(mode, s.memory),
    showMenuItem: menuItemVisible(mode),
    dismissBanner: () => remember(INSTALL_DISMISSED_KEY),
    prompt: promptInstall,
  };
}
