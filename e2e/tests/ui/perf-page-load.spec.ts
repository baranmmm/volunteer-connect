// Page-load profile (manual, local stack only): E2E_PERF=1 with production-like volume (npm run local:seed-perf) and a
// production build (E2E_APP_BUILD=prod). For each page it records, from the browser's resource timings, every server
// function call (start → end), when the main data was in (the last server function on the first load) and when the
// first and last signed photos arrived. Combine with PERF_LOG=1 for the server's per-call DB/Storage/sign counts.
// Writes test-results/perf-page-load.json and prints one table. Skipped in every normal run.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, storageFor } from "../../fixtures/roles";

const ENABLED = process.env["E2E_PERF"] === "1";

type Row = {
  role: string;
  page: string;
  serverFns: { id: string; start: number; end: number }[];
  dataReady: number;
  firstImage: number | null;
  lastImage: number | null;
  images: number;
};
const rows: Row[] = [];

async function profile(page: Page, role: string, path: string) {
  await page.goto(path);
  // Let lazy loads (chapters, photo strips) settle; bounded so a slow page still reports.
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  const t = await page.evaluate(() =>
    (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map((e) => ({
      name: e.name,
      type: e.initiatorType,
      start: Math.round(e.startTime),
      end: Math.round(e.responseEnd),
    })),
  );
  const fns = t
    .filter((e) => e.name.includes("/_serverFn/"))
    .map((e) => ({ id: (e.name.split("/_serverFn/")[1] ?? "").slice(0, 12), start: e.start, end: e.end }));
  const images = t.filter((e) => e.name.includes("/storage/v1/object/sign/") && e.type !== "fetch");
  rows.push({
    role,
    page: path,
    serverFns: fns,
    dataReady: Math.max(0, ...fns.map((f) => f.end)),
    firstImage: images.length ? Math.min(...images.map((i) => i.end)) : null,
    lastImage: images.length ? Math.max(...images.map((i) => i.end)) : null,
    images: images.length,
  });
}

const MEMBER_PAGES = ["/dashboard", "/media", "/calendar?view=month", "/calendar?view=list", "/tasks", "/meetings"];

test.describe("page-load profile", () => {
  test.skip(!ENABLED, "manual profile: E2E_PERF=1");
  test.setTimeout(10 * 60_000);

  for (const role of ["managerMedway", "volunteerMedway"] as const) {
    test.describe(role, () => {
      test.use({ storageState: storageFor(role) });
      test(`${role} pages`, async ({ page }) => {
        for (const path of MEMBER_PAGES) await profile(page, role, path);
      });
    });
  }

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test("public pages", async ({ page }) => {
      for (const path of ["/", "/events"]) await profile(page, "anon", path);
    });
  });

  test.afterAll(() => {
    if (!rows.length) return;
    const dir = join(process.cwd(), "test-results");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `perf-page-load-${test.info().project.name}.json`);
    writeFileSync(file, JSON.stringify(rows, null, 2));
    for (const r of rows) {
      const slowest = [...r.serverFns].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      console.log(
        `[perf-page] ${r.role.padEnd(16)} ${r.page.padEnd(22)} data=${r.dataReady}ms ` +
          `firstImg=${r.firstImage ?? "-"}ms lastImg=${r.lastImage ?? "-"}ms imgs=${r.images} fns=${r.serverFns.length} ` +
          `slowest=${slowest ? `${slowest.id}:${slowest.end - slowest.start}ms` : "-"}`,
      );
    }
  });
});
