// Regression for the reverted #43: pages showed raw translation keys ("navigation.dashboard", "common.hubName") and
// dead buttons. Every page must render translated text on its first paint after a hard load (page.goto), signed in
// and signed out, in English and Turkish, also inside a cross-site iframe (like the Lovable preview), and respond to a
// click.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures/roles";
import { Sidebar } from "../../pages/components/Sidebar";
import { RegionsPage } from "../../pages/RegionsPage";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { baseUrl, REPO_ROOT } from "../../setup/env";

type Lang = "en" | "tr";
type Messages = Record<string, unknown>;
const LOCALES: Record<Lang, Messages> = {
  en: JSON.parse(readFileSync(path.join(REPO_ROOT, "src/locales/en.json"), "utf8")) as Messages,
  tr: JSON.parse(readFileSync(path.join(REPO_ROOT, "src/locales/tr.json"), "utf8")) as Messages,
};

/** The translated text of a key ("navigation.dashboard"), read from the app's own locale files. */
function text(lang: Lang, key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node as Messages | undefined)?.[part], LOCALES[lang]);
  if (typeof value !== "string") throw new Error(`No ${lang} text for ${key}`);
  return value;
}

/** A whole word that is a key of a top-level namespace of the locale files ("navigation.dashboard", "regions.title"). */
const RAW_KEY = `^(?:${Object.keys(LOCALES.en).join("|")})\\.[a-zA-Z_][\\w.]*$`;

/** No visible word is a raw key (re-checked until the page settles; a failure lists the raw keys it found). */
async function expectNoRawKeys(page: Page | ReturnType<Page["frameLocator"]>) {
  const body = page.locator("body");
  await expect
    .poll(
      () =>
        body.evaluate((el, pattern) => {
          const re = new RegExp(pattern);
          return (el as HTMLElement).innerText.split(/\s+/).filter((word) => re.test(word));
        }, RAW_KEY),
      { timeout: 5_000, message: "raw translation keys on the page" },
    )
    .toEqual([]);
}

async function setLanguage(page: Page, lang: Lang) {
  // The cookie makes the server render this language; localStorage is the browser's own saved choice.
  await page.context().addCookies([{ name: "dsvh-language", value: lang, url: baseUrl() }]);
  await page.addInitScript((l) => window.localStorage.setItem("dsvh-language", l), lang);
}

test.describe("Translations on every first load", () => {
  for (const lang of ["en", "tr"] as const) {
    test(`signed-in pages (${lang}): /dashboard and /regions show translated labels and respond to clicks`, { tag: lang === "en" ? "@smoke" : undefined }, async ({ freshUser, pageAs, isMobile }) => {
      const nc = await freshUser({ role: "national_coordinator", language: lang });
      const page = await pageAs(nc, { language: lang });
      const sidebar = new Sidebar(page, !!isMobile);

      // Hard load of a deep link with a stored session.
      await page.goto("/dashboard");
      await expect(sidebar.link("dashboard")).toHaveText(text(lang, "navigation.dashboard"), { timeout: APP_LOAD_TIMEOUT });
      await expect(page.locator("html")).toHaveAttribute("lang", lang === "tr" ? "tr" : "en-GB");
      await expectNoRawKeys(page);
      // A click works (the page is interactive, not a dead server-rendered or crashed shell).
      await sidebar.go("calendar");
      await expectNoRawKeys(page);

      const regions = new RegionsPage(page);
      await regions.goto();
      await expect(page.getByTestId("regions-view-switch-map")).toHaveText(text(lang, "regions.views.map"));
      await expectNoRawKeys(page);
      await regions.showList();
      await expect(page.getByTestId("regions-view-switch-list")).toHaveAttribute("aria-pressed", "true");
      await expectNoRawKeys(page);
    });

    test(`public pages (${lang}): / and /events are server-rendered translated and respond to clicks`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await setLanguage(page, lang);

      await page.goto("/");
      await expect(page.getByTestId("public-topbar-sign-in")).toHaveText(text(lang, "landing.nav.signIn"), { timeout: APP_LOAD_TIMEOUT });
      await expectNoRawKeys(page);

      await page.goto("/events");
      await expect(page.getByTestId("public-topbar-events")).toHaveText(text(lang, "landing.nav.events"), { timeout: APP_LOAD_TIMEOUT });
      await expectNoRawKeys(page);
      await page.getByTestId("public-events-view-month").click();
      await expect(page.getByTestId("public-events-view-month")).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL(/view=month/);
      await expectNoRawKeys(page);
      // The server-rendered text matched the client's: no hydration error.
      expect(errors.filter((m) => /hydrat|#418|#423|#425/i.test(m))).toEqual([]);
    });
  }

  test("a saved Turkish choice without the language cookie: the server-rendered page loads in Turkish, no hydration error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Only the browser's saved choice (as saved before the cookie existed); the request asks for English.
    await page.addInitScript(() => window.localStorage.setItem("dsvh-language", "tr"));
    await page.goto("/events");
    await expect(page.getByTestId("public-topbar-events")).toHaveText(text("tr", "landing.nav.events"), { timeout: APP_LOAD_TIMEOUT });
    await expect(page.locator("html")).toHaveAttribute("data-lang", "tr");
    await expectNoRawKeys(page);
    await page.getByTestId("public-events-view-month").click();
    await expect(page.getByTestId("public-events-view-month")).toHaveAttribute("aria-pressed", "true");
    expect(errors.filter((m) => /hydrat|#418|#423|#425/i.test(m))).toEqual([]);
  });

  test("inside a cross-site iframe (like the Lovable preview): translated and interactive", async ({ page }) => {
    // A parent page on another site embeds the app, as lovable.dev embeds the preview. It is served by a real server on
    // 127.0.0.1 (another site than localhost, in the loopback address space): the browser blocks a page answered by a
    // route (an unknown address) from framing a local app.
    const html = `<!doctype html><title>parent</title><iframe data-testid="app-frame" src="${baseUrl()}/sign-in" style="width:100%;height:900px;border:0"></iframe>`;
    const server = createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(html));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      const app = page.frameLocator('[data-testid="app-frame"]');
      await expect(app.locator("html[data-hydrated]")).toBeAttached({ timeout: APP_LOAD_TIMEOUT });
      await expect(app.getByTestId("auth-language-toggle-tr")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      await expectNoRawKeys(app);

      // A click works inside the frame: the language switch re-renders the page in Turkish.
      await app.getByTestId("auth-language-toggle-tr").click();
      await expect(app.getByTestId("auth-language-toggle-tr")).toHaveAttribute("aria-pressed", "true");
      await expect(app.locator("html")).toHaveAttribute("lang", "tr");
      await expectNoRawKeys(app);
    } finally {
      server.close();
    }
  });
});
