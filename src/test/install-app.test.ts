import { describe, expect, it } from "vitest";
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
} from "@/lib/install-app";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/124.0.2478.89 Mobile/15E148 Safari/605.1.15",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0",
  ipadOsSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  macSafari17:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  macSafari16:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  winEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.80",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0",
};

const mode = (ua: string, { touch = 0, standalone = false, prompt = false } = {}) =>
  installMode(classifyPlatform(ua, touch), standalone, prompt);

describe("install app: platform and browser", () => {
  it("iPhone Safari gets the Share / Add to Home Screen steps", () => {
    expect(classifyPlatform(UA.iphoneSafari, 5)).toMatchObject({ ios: true, iosSafari: true });
    expect(mode(UA.iphoneSafari, { touch: 5 })).toBe("ios-safari");
  });
  it("other iPhone browsers and in-app browsers are sent to Safari", () => {
    for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneEdge, UA.iphoneInstagram]) {
      expect(classifyPlatform(ua, 5)).toMatchObject({ ios: true, iosSafari: false });
      expect(mode(ua, { touch: 5 })).toBe("ios-other");
    }
  });
  it("iPadOS (a Mac user agent with a touch screen) counts as iOS, a Mac does not", () => {
    expect(mode(UA.ipadOsSafari, { touch: 5 })).toBe("ios-safari");
    expect(classifyPlatform(UA.macSafari17, 0).ios).toBe(false);
  });
  it("iOS never uses a prompt (it has none), even when an event is captured", () => {
    expect(mode(UA.iphoneSafari, { touch: 5, prompt: true })).toBe("ios-safari");
  });
  it("Chrome and Edge install through the captured prompt, and show nothing without one", () => {
    for (const ua of [UA.androidChrome, UA.winEdge, UA.macChrome]) {
      expect(mode(ua, { prompt: true })).toBe("prompt");
      expect(mode(ua)).toBeNull();
    }
  });
  it("Firefox on Android uses the browser menu; Firefox on a computer cannot install", () => {
    expect(classifyPlatform(UA.androidFirefox).firefoxAndroid).toBe(true);
    expect(mode(UA.androidFirefox)).toBe("android-menu");
    expect(mode(UA.winFirefox)).toBeNull();
  });
  it("Safari 17+ on a Mac adds to the Dock; older Safari and Chrome on a Mac do not", () => {
    expect(mode(UA.macSafari17)).toBe("mac-safari");
    expect(mode(UA.macSafari16)).toBeNull();
    expect(classifyPlatform(UA.macChrome).macSafari).toBe(false);
  });
  it("an empty user agent shows nothing", () => {
    expect(mode("")).toBeNull();
  });
});

describe("install app: installed (standalone) detection", () => {
  const media = (matching: string[]) => (q: string) => ({ matches: matching.includes(q) });
  it("matches standalone, minimal-ui and window-controls-overlay display modes", () => {
    expect(isStandalone(media(["(display-mode: standalone)"]), undefined)).toBe(true);
    expect(isStandalone(media(["(display-mode: minimal-ui)"]), undefined)).toBe(true);
    expect(isStandalone(media(["(display-mode: window-controls-overlay)"]), undefined)).toBe(true);
  });
  it("a browser tab (or a full-screen tab) is not installed", () => {
    expect(isStandalone(media(["(display-mode: browser)"]), false)).toBe(false);
    expect(isStandalone(media(["(display-mode: fullscreen)"]), false)).toBe(false);
    expect(isStandalone(undefined, undefined)).toBe(false);
  });
  it("iOS home-screen apps report navigator.standalone", () => {
    expect(isStandalone(media([]), true)).toBe(true);
  });
  it("a throwing matchMedia counts as not installed", () => {
    expect(
      isStandalone(() => {
        throw new Error("no");
      }, undefined),
    ).toBe(false);
  });
  it("installed: no install UI on any platform", () => {
    for (const ua of [
      UA.iphoneSafari,
      UA.iphoneChrome,
      UA.androidChrome,
      UA.androidFirefox,
      UA.macSafari17,
    ])
      expect(mode(ua, { touch: 5, standalone: true, prompt: true })).toBeNull();
  });
});

describe("install app: banner and menu item", () => {
  const fresh = { dismissed: false, installed: false };
  it("the banner shows with an install path and nothing remembered", () => {
    expect(bannerVisible("prompt", fresh)).toBe(true);
    expect(bannerVisible("ios-safari", fresh)).toBe(true);
    expect(bannerVisible(null, fresh)).toBe(false);
  });
  it("the banner stays away once dismissed or installed on this device; the menu item does not", () => {
    expect(bannerVisible("prompt", { dismissed: true, installed: false })).toBe(false);
    expect(bannerVisible("prompt", { dismissed: false, installed: true })).toBe(false);
    expect(menuItemVisible("prompt")).toBe(true);
    expect(menuItemVisible("ios-safari")).toBe(true);
    expect(menuItemVisible(null)).toBe(false);
  });
  it("after an uninstall Chrome offers the prompt again: the menu item returns, the banner does not", () => {
    const remembered = { dismissed: false, installed: true };
    const m = mode(UA.androidChrome, { prompt: true });
    expect(menuItemVisible(m)).toBe(true);
    expect(bannerVisible(m, remembered)).toBe(false);
  });

  it("memory round-trips through storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(readInstallMemory(storage)).toEqual(fresh);
    writeInstallMemory(storage, INSTALL_DISMISSED_KEY);
    expect(readInstallMemory(storage)).toEqual({ dismissed: true, installed: false });
    writeInstallMemory(storage, INSTALLED_KEY);
    expect(readInstallMemory(storage)).toEqual({ dismissed: true, installed: true });
  });
  it("works without storage (missing or throwing)", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readInstallMemory(throwing)).toEqual(fresh);
    expect(() => writeInstallMemory(throwing, INSTALLED_KEY)).not.toThrow();
    expect(readInstallMemory(null)).toEqual(fresh);
    expect(() => writeInstallMemory(undefined, INSTALL_DISMISSED_KEY)).not.toThrow();
  });
});
