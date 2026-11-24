import "@testing-library/jest-dom/vitest";
import i18n from "@/lib/i18n";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";

// The app downloads one locale at a time (src/lib/i18n.ts); tests have both, so language switches are synchronous.
i18n.addResourceBundle("en", "translation", en, true, true);
i18n.addResourceBundle("tr", "translation", tr, true, true);

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom has no ResizeObserver; Radix Switch measures itself with it.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
