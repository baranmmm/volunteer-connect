// Playwright "setup" project: warm the app's dev server up once before any test.
// The Vite dev server pre-bundles dependencies; the ones it only finds when the browser first loads the app (TanStack
// Start's runtime chunks, imported from its virtual client entry) make it re-optimise and force-reload every open page
// ("optimized dependencies changed. reloading"), which aborted in-flight requests and failed tests on a cold cache.
// The signed-out pages pull in one batch, the first signed-in page a second one, so this runs after the sign-in setup
// and loads both kinds of page; the reloads then happen here, before the tests start. Route dependencies are
// pre-scanned at startup (vite.config.ts optimizeDeps.entries). Not a retry: tests still fail on any real error.
import { test as setup, expect } from "@playwright/test";
import { storageFile } from "./env";

/** True once the page stayed on the same document (no reload) for `quietMs`. */
async function settled(page: import("@playwright/test").Page, quietMs: number, maxMs: number) {
  let last = Date.now();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) last = Date.now();
  });
  const start = Date.now();
  while (Date.now() - last < quietMs) {
    if (Date.now() - start > maxMs) return false;
    await page.waitForTimeout(250);
  }
  return true;
}

setup("warm up the dev server (dependency optimisation before the tests)", async ({ browser }) => {
  setup.setTimeout(240_000);
  // Signed out, then signed in as a volunteer (session from the sign-in setup).
  for (const [storageState, paths] of [
    [undefined, ["/", "/auth"]],
    [storageFile("volunteerMedway"), ["/dashboard", "/requests?tab=mine", "/tasks"]],
  ] as const) {
    const context = await browser.newContext(storageState ? { storageState } : {});
    const page = await context.newPage();
    for (const path of paths) {
      await page.goto(path, { waitUntil: "load", timeout: 120_000 });
      await page.waitForLoadState("networkidle", { timeout: 60_000 });
      expect(await settled(page, 5_000, 120_000), `the app kept reloading on ${path}`).toBe(true);
    }
    await context.close();
  }
});
