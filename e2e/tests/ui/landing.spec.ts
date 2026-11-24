// The signed-out landing page (/): the next public event as the hero, upcoming cards with a branch filter, YouTube
// highlights that load nothing from YouTube/Google before a click, the past-events gallery with its lightbox,
// counters, reduced motion and axe. Signed-in members go straight to /dashboard.
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { EVENT_TITLE_PREFIX, TINY_PNG, deleteEvents, eventPayload } from "../../api/events";
import { APP_LOAD_TIMEOUT } from "../../pages/app";

/** Hosts that must stay untouched until a highlight is played (Google Fonts of the app shell are not trackers here). */
const TRACKERS = /(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|doubleclick\.net|google\.com)$/;

const londonDay = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86_400_000));

type PastEvent = { id: string; title: string; photos: string[] };
type Video = { id: string; youtubeId: string };

/** A past-event record (public, published) with two gallery photos, written with the service role (like the importer). */
async function createPastGalleryEvent(owner: TestUser, regionId: string, label: string): Promise<PastEvent> {
  const title = `${EVENT_TITLE_PREFIX}${runId}-${randomUUID().slice(0, 6)} ${label}`;
  const data = {
    ...eventPayload({ title, branchId: owner.branchId!, status: "published", startInMinutes: -3 * 24 * 60, audience: "public" }),
    created_by: owner.id,
    past_record: true,
    region_id: regionId,
    all_day: true,
    start_date: londonDay(-3),
    end_date: londonDay(-3),
    start_at: null,
    end_at: null,
  };
  const db = adminClient();
  const { data: row, error } = await db.from("events").insert(data).select("id").single();
  if (error || !row) throw new Error(`past event: ${error?.message}`);
  const id = (row as { id: string }).id;
  const photos: string[] = [];
  for (let i = 0; i < 2; i++) {
    const mediaId = randomUUID();
    const path = `${id}/${mediaId}.png`;
    const up = await db.storage.from("event-media").upload(path, TINY_PNG, { contentType: "image/png" });
    if (up.error) throw new Error(`upload ${path}: ${up.error.message}`);
    const media = await db
      .from("event_media")
      .insert({ id: mediaId, event_id: id, storage_path: path, kind: "image", position: i, in_gallery: true, width: 4, height: 3 })
      .select("id")
      .single();
    if (media.error) throw new Error(`event_media: ${media.error.message}`);
    photos.push(mediaId);
  }
  return { id, title, photos };
}

/** A channel highlight (event_id NULL) without a stored poster: the branded placeholder is shown. */
async function createHighlight(): Promise<Video> {
  const youtubeId = randomUUID().replace(/-/g, "").slice(0, 11);
  const { data, error } = await adminClient()
    .from("event_videos")
    .insert({ event_id: null, youtube_id: youtubeId, title: `E2E highlight ${runId}` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`event_videos: ${error?.message}`);
  return { id: (data as { id: string }).id, youtubeId };
}

async function openLanding(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("landing-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(page.getByTestId("landing-hero")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
}

test.describe("Landing page (signed out)", () => {
  test("hero, upcoming card of a new public event, Sign in and Join", { tag: "@smoke" }, async ({ page, freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "landing", status: "published", startInMinutes: 90, audience: "public", capacity: 30 });
    await openLanding(page);
    await expect(page.getByTestId("landing-hero-register")).toHaveAttribute("href", /^\/events\/[0-9a-f-]{36}$/);
    // The card may sit behind "Show more" when many events come first: filter to the event's branch.
    await page.getByTestId("landing-filter-branch").selectOption(manager.branchId!);
    const card = page.locator(`[data-testid="landing-upcoming-card"][data-event-id="${event.id}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByRole("link")).toHaveAttribute("href", `/events/${event.id}`);
    await expect(card).toContainText("30");
    await expect(page.getByTestId("landing-sign-in")).toHaveAttribute("href", "/auth");
    await expect(page.getByTestId("landing-join")).toHaveAttribute("href", "/auth?mode=signup");
    await page.getByTestId("landing-join").click();
    await expect(page).toHaveURL(/\/auth\?mode=signup$/);
  });

  test("the branch filter narrows the upcoming cards", async ({ page, freshUser, freshEvent, freshBranch }) => {
    const [a, b] = [await freshBranch("landing-a"), await freshBranch("landing-b")];
    const managerA = await freshUser({ role: "branch_manager", branch: a });
    const managerB = await freshUser({ role: "branch_manager", branch: b });
    const eventA = await freshEvent(managerA, { label: "landing A", status: "published", startInMinutes: 120, audience: "public" });
    const eventB = await freshEvent(managerB, { label: "landing B", status: "published", startInMinutes: 120, audience: "public" });
    await openLanding(page);
    const cardA = page.locator(`[data-testid="landing-upcoming-card"][data-event-id="${eventA.id}"]`);
    const cardB = page.locator(`[data-testid="landing-upcoming-card"][data-event-id="${eventB.id}"]`);
    const filter = page.getByTestId("landing-filter-branch");
    await filter.selectOption(a);
    await expect(cardA).toBeVisible();
    await expect(cardB).toHaveCount(0);
    await expect(page.getByTestId("landing-upcoming-card")).toHaveCount(1);
    await filter.selectOption(b);
    await expect(cardB).toBeVisible();
    await expect(cardA).toHaveCount(0);
  });

  test("a highlight loads nothing from YouTube or Google before play, then the youtube-nocookie player", async ({ page }) => {
    const video = await createHighlight();
    try {
      const external: string[] = [];
      page.on("request", (r) => {
        if (TRACKERS.test(new URL(r.url()).hostname)) external.push(r.url());
      });
      // Never reach the real player from tests.
      await page.route(/youtube-nocookie\.com/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
      await openLanding(page);
      const play = page.locator(`[data-testid="landing-highlight-play"][data-video-id="${video.youtubeId}"]`);
      await play.scrollIntoViewIfNeeded();
      await expect(play).toBeVisible();
      await expect(play).toHaveAccessibleName(/.+/);
      expect(external, "nothing from YouTube/Google before the click").toEqual([]);
      await play.click();
      const iframe = page.getByTestId("landing-highlight-iframe");
      await expect(iframe).toHaveAttribute("src", `https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&rel=0`);
      await expect(iframe).toHaveAttribute("title", /.+/);
    } finally {
      await adminClient().from("event_videos").delete().eq("id", video.id);
    }
  });

  test("gallery lightbox: open, arrows, Escape", async ({ page, freshUser, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const past = await createPastGalleryEvent(manager, seed.regionId, "landing gallery");
    try {
      await openLanding(page);
      const first = page.locator(`[data-testid="landing-gallery-photo"][data-photo-id="${past.photos[0]}"]`);
      await first.scrollIntoViewIfNeeded();
      await expect(first.getByRole("img")).toHaveAttribute("alt", new RegExp(`${past.title}.*1.*2`));
      await first.click();
      const lightbox = page.getByTestId("landing-lightbox");
      await expect(lightbox).toBeVisible();
      await expect(lightbox).toHaveAttribute("data-photo-id", past.photos[0]!);
      await page.keyboard.press("ArrowRight");
      await expect(lightbox).toHaveAttribute("data-photo-id", past.photos[1]!);
      await page.keyboard.press("ArrowLeft");
      await expect(lightbox).toHaveAttribute("data-photo-id", past.photos[0]!);
      await page.getByTestId("landing-lightbox-next").click();
      await expect(lightbox).toHaveAttribute("data-photo-id", past.photos[1]!);
      await page.keyboard.press("Escape");
      await expect(lightbox).toBeHidden();
      // Focus returns to the photo last shown.
      await expect(page.locator(`[data-testid="landing-gallery-photo"][data-photo-id="${past.photos[1]}"]`)).toBeFocused();
      await first.click();
      await page.getByTestId("landing-lightbox-close").click();
      await expect(lightbox).toBeHidden();
    } finally {
      await deleteEvents([past.id]);
    }
  });

  test("axe: no serious violations; no sideways scrolling", async ({ page, freshUser, freshEvent, seed }) => {
    const manager = await freshUser({ role: "branch_manager" });
    await freshEvent(manager, { label: "landing axe", status: "published", startInMinutes: 150, audience: "public" });
    const past = await createPastGalleryEvent(manager, seed.regionId, "landing axe gallery");
    const video = await createHighlight();
    try {
      await page.route(/youtube-nocookie\.com/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
      await openLanding(page);
      await expect(page.getByTestId("landing-gallery")).toBeAttached();
      // Reveal every section (they fade in when scrolled to) before scanning.
      for (const id of ["landing-upcoming", "landing-highlights", "landing-gallery", "landing-subscribe"]) {
        await page.getByTestId(id).first().scrollIntoViewIfNeeded();
      }
      await expect(page.getByTestId("subscribe-form")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      await page.waitForTimeout(800);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(sideways, "no sideways scrolling").toBeLessThanOrEqual(0);
      await page.getByTestId("landing-gallery-photo").first().click();
      await expect(page.getByTestId("landing-lightbox")).toBeVisible();
      const dialog = await new AxeBuilder({ page }).include('[data-testid="landing-lightbox"]').withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(dialog.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    } finally {
      await adminClient().from("event_videos").delete().eq("id", video.id);
      await deleteEvents([past.id]);
    }
  });

  test("reduced motion: sections are shown at once and counters show their final figure", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLanding(page);
    // Below the fold and never scrolled to, yet fully opaque.
    const upcoming = page.getByTestId("landing-upcoming");
    await expect(upcoming).toBeAttached();
    expect(await upcoming.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    const counter = page.locator('[data-testid="landing-counter"][data-counter="branches"]');
    const value = Number(await counter.getAttribute("data-value"));
    expect(value).toBeGreaterThan(0);
    await expect(counter.locator("span").first()).toHaveText(new Intl.NumberFormat("en-GB").format(value));
    expect(await upcoming.evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0s/);
    // Without the preference the sections fade in (an opacity transition) once scrolled to.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await upcoming.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain("opacity");
    await upcoming.scrollIntoViewIfNeeded();
    await expect(upcoming).toHaveAttribute("data-visible", "true");
    await expect.poll(() => upcoming.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });
});

test.describe("Landing page (signed in)", () => {
  test("a signed-in member goes to /dashboard without the landing showing", async ({ freshUser, pageAs }) => {
    const page = await pageAs(await freshUser());
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="landing-page"]')) (window as unknown as { __landing: boolean }).__landing = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: APP_LOAD_TIMEOUT });
    expect(await page.evaluate(() => (window as unknown as { __landing?: boolean }).__landing ?? false)).toBe(false);
  });
});
