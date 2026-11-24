// The locale loader (src/lib/i18n.ts): the active locale's texts exist before anything renders, on every route, with
// no download that can fail or arrive late (the reverted #43 rendered raw keys like "navigation.dashboard" whenever its
// locale download failed or was skipped).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";

type I18nModule = typeof import("@/lib/i18n");

/** A fresh copy of the module (and of i18next), as on a new page load. */
async function freshLoad(pageLang?: "en" | "tr"): Promise<I18nModule> {
  vi.resetModules();
  if (pageLang) document.documentElement.setAttribute("data-lang", pageLang);
  else document.documentElement.removeAttribute("data-lang");
  return import("@/lib/i18n");
}

function Nav() {
  const { t } = useTranslation();
  return <span data-testid="label">{t("navigation.dashboard")}</span>;
}

describe("locale loader", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    localStorage.clear();
    // Any network use for texts would be a regression: make it fail loudly.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    document.documentElement.removeAttribute("data-lang");
  });

  it("registers both locales synchronously, before the first render", async () => {
    const { default: i18n } = await freshLoad("en");
    // No await between the import and these checks: nothing is pending.
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("tr", "translation")).toBe(true);
    expect(i18n.t("navigation.dashboard")).toBe(en.navigation.dashboard);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("starts in the language the server rendered (<html data-lang>) and renders it on the first render", async () => {
    localStorage.setItem("dsvh-language", "en"); // a different saved choice is applied only after hydration
    const { default: i18n, currentLang } = await freshLoad("tr");
    expect(currentLang()).toBe("tr");
    // The component imports react-i18next after the reset, so it uses the same fresh i18next instance.
    const { I18nextProvider } = await import("react-i18next");
    render(
      <I18nextProvider i18n={i18n}>
        <Nav />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("label")).toHaveTextContent(tr.navigation.dashboard);
    expect(document.documentElement.lang).toBe("tr");
  });

  it("switches language at once, without a download", async () => {
    const { default: i18n, setLanguage } = await freshLoad("en");
    setLanguage("tr");
    expect(i18n.language).toBe("tr");
    expect(i18n.t("navigation.dashboard")).toBe(tr.navigation.dashboard);
    expect(document.cookie).toContain("dsvh-language=tr");
    expect(localStorage.getItem("dsvh-language")).toBe("tr");
    setLanguage("en");
    expect(i18n.t("navigation.dashboard")).toBe(en.navigation.dashboard);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to English text, never the key, when a Turkish text is missing", async () => {
    const { default: i18n, setLanguage } = await freshLoad("tr");
    i18n.addResource("en", "translation", "zzOnlyEnglish.label", "English only");
    setLanguage("tr");
    expect(i18n.t("zzOnlyEnglish.label")).toBe("English only");
  });

  it("the head script stores a saved choice the server did not render in, and reloads at most once", async () => {
    const { LANGUAGE_COOKIE_SCRIPT } = await freshLoad("en");
    // jsdom cannot navigate: it reports the reload as "not implemented" on the console.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = () => new Function(LANGUAGE_COOKIE_SCRIPT)() as void;
    document.cookie = "dsvh-language=; max-age=0; path=/";
    sessionStorage.clear();

    // Same language as the server rendered: nothing to do.
    localStorage.setItem("dsvh-language", "en");
    run();
    expect(document.cookie).not.toContain("dsvh-language=en");
    expect(sessionStorage.getItem("dsvh-language-reload")).toBeNull();

    // A different saved choice: cookie for the server, and one reload (marked so it never loops).
    localStorage.setItem("dsvh-language", "tr");
    run();
    expect(document.cookie).toContain("dsvh-language=tr");
    expect(sessionStorage.getItem("dsvh-language-reload")).toBe("1");
    sessionStorage.clear();
    quiet.mockRestore();
  });

  it("an unknown page language or no window storage still gives translated English", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
    document.documentElement.setAttribute("data-lang", "de");
    const { default: i18n } = await freshLoad();
    expect(i18n.language).toBe("en");
    expect(i18n.t("navigation.dashboard")).toBe(en.navigation.dashboard);
    vi.restoreAllMocks();
  });
});
