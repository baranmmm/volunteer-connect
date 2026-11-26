// The public events map on /events (signed out): one fixed dotted map of the United Kingdom that never zooms, pans or
// re-centres; scrolling through the sticky section steps through the events in date order (past first), the active
// event's branch dot pulses and its card opens the event page; the timeline (ticks, cursor, Today, keyboard, Play),
// branch dot previews, reduced motion (static map + list), phones (card below the map, swipe) and the server HTML.
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { EVENT_TITLE_PREFIX, deleteEvents, eventPayload } from "../../api/events";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { EventsMapPage } from "../../pages/EventsMapPage";
import { EventFormDialog } from "../../pages/components/EventFormDialog";

const DAY = 86_400_000;
const londonDay = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * DAY));

/** A public past record (like the importer writes) `daysAgo` days back: in the owner's branch, or region-wide. */
async function createPastRecord(owner: TestUser, regionId: string, daysAgo: number, opts: { regionWide?: boolean } = {}): Promise<string> {
  const title = `${EVENT_TITLE_PREFIX}${runId}-${randomUUID().slice(0, 6)} map past`;
  const { data, error } = await adminClient()
    .from("events")
    .insert({
      ...eventPayload({ title, branchId: owner.branchId!, status: "published", startInMinutes: -daysAgo * 24 * 60, audience: "public" }),
      ...(opts.regionWide ? { scope: "region", branch_id: null } : {}),
      created_by: owner.id,
      past_record: true,
      region_id: regionId,
      all_day: true,
      start_date: londonDay(-daysAgo),
      end_date: londonDay(-daysAgo),
      start_at: null,
      end_at: null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`past record: ${error?.message}`);
  return (data as { id: string }).id;
}

/** The app's map projection (src/lib/events-story.ts project()): map units of a point. */
const K = Math.cos((54.5 * Math.PI) / 180);
const project = (lat: number, lon: number) => [(lon + 9) * K * 100, (61 - lat) * 100] as const;
const CAPITALS: [string, number, number][] = [
  ["London", 51.5074, -0.1278],
  ["Cardiff", 51.4816, -3.1791],
  ["Edinburgh", 55.9533, -3.1883],
  ["Belfast", 54.5973, -5.9301],
];

/** The scroll position and the map's place on screen and frame (they must never change for an event). */
async function mapState(map: EventsMapPage) {
  return { frame: await map.canvas().getAttribute("data-frame"), box: await map.canvas().boundingBox() };
}

test.describe("Public events map", () => {
  test("desktop: a tick jumps to the event, its branch dot pulses on the fixed map and the card opens the event page", { tag: "@smoke" }, async ({ page, isMobile, freshUser, freshEvent, seed }) => {
    test.skip(isMobile, "the phone layout has its own test");
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "map in person", status: "published", startInMinutes: 4 * 24 * 60, audience: "public" });
    const other = await freshEvent(manager, { label: "map in person 2", status: "published", startInMinutes: 5 * 24 * 60, audience: "public" });
    const online = await freshEvent(manager, { label: "map online", status: "published", startInMinutes: 4 * 24 * 60, audience: "public", onlineUrl: "https://meet.example.org/e2e-map-room" });
    const map = new EventsMapPage(page);
    await page.goto("/events");
    await expect(page.getByTestId("public-events-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await map.waitReady();
    // No map library: no tiles, no zoom or pan controls.
    await expect(page.locator(".leaflet-container, .leaflet-control-zoom")).toHaveCount(0);
    await expect(map.branch(seed.branches.Medway)).toBeVisible();
    // Online events are not on the map (no tick); they are in the Online panel and the list.
    await expect(map.tick(online.id)).toHaveCount(0);
    await expect(page.locator(`[data-testid="events-map-online-item"][data-event-id="${online.id}"]`)).toBeVisible();

    // It opens on Today: the cursor on the next coming event (just after the Today marker), its card open.
    const flags = await map.ticks().evaluateAll((ticks) => ticks.map((t) => t.getAttribute("data-past")));
    const firstComing = flags.indexOf("false");
    await expect(map.story()).toHaveAttribute("data-start", String(firstComing));
    await expect(map.story()).toHaveAttribute("data-active", String(firstComing));
    await expect(map.card()).toHaveAttribute("data-past", "false");
    // The same when the section comes into view (its top reaches the sticky line under the site header).
    await map.story().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64));
    await expect(map.story()).toHaveAttribute("data-active", String(firstComing));
    await expect(map.card()).toHaveAttribute("data-past", "false");

    // No empty band: the dotted land fills the map box (a tight frame), and with every branch on the mainland there is
    // no inset box. Map, card and timeline fit in one viewport.
    const land = (await page.getByTestId("events-map-land").boundingBox())!;
    const canvasBox = (await map.canvas().boundingBox())!;
    expect(Math.abs(land.y - canvasBox.y)).toBeLessThanOrEqual(3);
    expect(Math.abs(land.y + land.height - (canvasBox.y + canvasBox.height))).toBeLessThanOrEqual(3);
    await expect(page.getByTestId("events-map-inset")).toHaveCount(0);
    const viewport = page.viewportSize()!;
    expect((await page.getByTestId("events-map-timeline").boundingBox())!.y + 40).toBeLessThanOrEqual(viewport.height);
    const cardBox = (await map.card().boundingBox())!;
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height + 1);

    // One fixed frame around mainland Great Britain and Northern Ireland: the four capitals are inside it.
    const [fx, fy, fw, fh] = (await map.canvas().getAttribute("data-frame"))!.split(" ").map(Number) as [number, number, number, number];
    for (const [name, lat, lon] of CAPITALS) {
      const [x, y] = project(lat, lon);
      expect(x > fx && x < fx + fw && y > fy && y < fy + fh, `${name} inside the map frame`).toBe(true);
    }

    await map.tick(event.id).scrollIntoViewIfNeeded();
    await map.tick(event.id).click();
    const index = await map.indexOf(event.id);
    await expect(map.story()).toHaveAttribute("data-active", String(index));
    await expect(map.card()).toHaveAttribute("data-event-id", event.id);
    await expect(map.card()).toHaveAttribute("data-past", "false");
    await expect(map.card().getByTestId("events-map-card-label")).toBeVisible();
    await expect(map.branch(seed.branches.Medway)).toHaveAttribute("data-active", "true");
    await expect(map.branch(seed.branches.Medway).getByTestId("events-map-pulse")).toHaveCount(1);
    await expect(page.getByTestId("events-map-timeline-cursor")).toBeVisible();
    await expect(page.getByTestId("events-map-timeline-today")).toBeVisible();

    // The map never moves for an event: same frame and the same place on screen (the panel is sticky).
    const before = await mapState(map);
    await map.tick(other.id).click();
    await expect(map.card()).toHaveAttribute("data-event-id", other.id);
    expect(await mapState(map)).toEqual(before);
    await map.ticks().first().click();
    await expect(map.story()).toHaveAttribute("data-active", "0");
    expect(await mapState(map)).toEqual(before);

    // The mouse wheel over the map scrolls the page (no zoom); the map stays where it is.
    const y = await page.evaluate(() => window.scrollY);
    const box = before.box!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y);
    expect(await mapState(map)).toEqual(before);

    await map.tick(event.id).click();
    await map.card().click();
    await expect(page).toHaveURL(new RegExp(`/events/${event.id}$`));
    await expect(page.getByTestId("public-event-detail")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  });

  test("desktop: keyboard, Play and branch previews", async ({ page, isMobile, freshUser, freshEvent, seed }) => {
    test.skip(isMobile, "keyboard and hover on desktop");
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    await freshEvent(manager, { label: "map keys 1", status: "published", startInMinutes: 3 * 24 * 60, audience: "public" });
    await freshEvent(manager, { label: "map keys 2", status: "published", startInMinutes: 5 * 24 * 60, audience: "public" });
    const map = new EventsMapPage(page);
    await page.goto("/events");
    await map.waitReady();
    const count = await map.ticks().count();
    expect(count).toBeGreaterThan(1);

    // Keyboard on the timeline: Home, arrows, End; the value names the event.
    await map.slider().focus();
    await page.keyboard.press("Home");
    await expect(map.story()).toHaveAttribute("data-active", "0");
    await page.keyboard.press("ArrowRight");
    await expect(map.story()).toHaveAttribute("data-active", "1");
    await expect(map.slider()).toHaveAttribute("aria-valuenow", "1");
    await expect(map.slider()).toHaveAttribute("aria-valuetext", /.+, .+/);
    await page.keyboard.press("End");
    await expect(map.story()).toHaveAttribute("data-active", String(count - 1));

    // Dragging the cursor to the bar's left end goes to the earliest event.
    await page.keyboard.press("End");
    const bar = (await map.slider().boundingBox())!;
    const cursor = (await page.getByTestId("events-map-timeline-cursor").boundingBox())!;
    await page.mouse.move(cursor.x + cursor.width / 2, cursor.y + cursor.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2, { steps: 5 });
    await page.mouse.move(bar.x + 1, bar.y + bar.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(map.story()).toHaveAttribute("data-active", "0");

    // Play from the start advances on its own (scrolling the page with it), Pause stops it.
    await page.keyboard.press("Home");
    await map.play().click();
    await expect(map.play()).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(2, 2);
    await expect.poll(async () => Number(await map.story().getAttribute("data-active")), { timeout: 10_000 }).toBeGreaterThan(0);
    await map.play().click();
    await expect(map.play()).toHaveAttribute("aria-pressed", "false");

    // The map is one tab stop: Down/Up move a visible focus between the branches (north to south) and the card shows
    // the focused branch's next event; Enter jumps to it.
    const dot = map.branch(seed.branches.Medway);
    const preview = await dot.getAttribute("data-event-id");
    expect(preview).toBeTruthy();
    await page.getByTestId("events-map-keys-target").focus();
    for (let i = 0; i < 80 && (await dot.getAttribute("data-focused")) !== "true"; i++) await page.keyboard.press("ArrowDown");
    await expect(dot).toHaveAttribute("data-focused", "true");
    await expect(map.card()).toHaveAttribute("data-event-id", preview!);
    await page.keyboard.press("Enter");
    const target = String(await map.indexOf(preview!));
    await expect(map.story()).toHaveAttribute("data-active", target);
    await expect(dot).not.toHaveAttribute("data-focused", "true");
    // With a pointer, clicking a dot jumps too.
    await map.slider().focus();
    await page.keyboard.press("Home");
    await dot.dispatchEvent("click");
    await expect(map.story()).toHaveAttribute("data-active", target);
  });

  test("past events come first (dark ticks before Today), region events light every branch of the region", async ({ page, isMobile, freshUser, freshEvent, seed, request }) => {
    test.skip(isMobile, "the order is the same on phones");
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const upcoming = await freshEvent(manager, { label: "map upcoming", status: "published", startInMinutes: 6 * 24 * 60, audience: "public" });
    const pastId = await createPastRecord(manager, seed.regionId, 40);
    const regionId = await createPastRecord(manager, seed.regionId, 60, { regionWide: true });
    try {
      // Past records are in the server-rendered HTML (no extra request after the page loads).
      expect(await (await request.get("/events")).text()).toContain(`data-event-id="${pastId}"`);
      const map = new EventsMapPage(page);
      await page.goto("/events");
      await map.waitReady();
      await expect(map.tick(pastId)).toHaveAttribute("data-past", "true");
      await expect(map.tick(upcoming.id)).toHaveAttribute("data-past", "false");
      // Every past tick comes before every coming one.
      const flags = await map.ticks().evaluateAll((ticks) => ticks.map((t) => t.getAttribute("data-past")));
      expect(flags.indexOf("false")).toBeGreaterThan(flags.lastIndexOf("true"));
      expect(await map.indexOf(regionId)).toBeLessThan(await map.indexOf(pastId));

      // It opens on Today; "Past events" (left of Today) jumps to the earliest past event without scrolling back.
      const start = Number(await map.story().getAttribute("data-start"));
      await expect(map.tick(upcoming.id)).toHaveAttribute("data-past", "false");
      expect(start).toBeGreaterThan(await map.indexOf(pastId));
      await expect(map.story()).toHaveAttribute("data-active", String(start));
      const past = page.getByTestId("events-map-timeline-past");
      const pastBox = (await past.boundingBox())!;
      const todayBox = (await page.getByTestId("events-map-timeline-today").boundingBox())!;
      expect(pastBox.x + pastBox.width).toBeLessThanOrEqual(todayBox.x);
      await past.click();
      await expect(map.story()).toHaveAttribute("data-active", "0");
      await expect(map.card()).toHaveAttribute("data-past", "true");
      // Scrolling moves forward from Today again (past events have no scroll slice).
      await page.mouse.wheel(0, 2000);
      await expect.poll(async () => Number(await map.story().getAttribute("data-active"))).toBeGreaterThanOrEqual(start);

      await map.tick(pastId).click();
      await expect(map.card()).toHaveAttribute("data-past", "true");
      await expect(map.card()).toHaveAttribute("href", `/events/${pastId}`);

      // The region-wide event: every located branch of the region lights up, Medway and Brighton among them.
      await map.tick(regionId).click();
      await expect(map.card()).toHaveAttribute("data-event-id", regionId);
      await expect(map.branch(seed.branches.Medway)).toHaveAttribute("data-active", "true");
      await expect(map.branch(seed.branches.Brighton)).toHaveAttribute("data-active", "true");
      expect(await map.activeBranches().count()).toBeGreaterThanOrEqual(2);
    } finally {
      await deleteEvents([pastId, regionId]);
    }
  });

  test("reduced motion: a static map with a plain chronological list, no timeline or Play", async ({ page, freshUser, freshEvent }) => {
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "map reduced", status: "published", startInMinutes: 4 * 24 * 60, audience: "public" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const map = new EventsMapPage(page);
    await page.goto("/events");
    await map.waitReady("static");
    await expect(page.getByTestId("events-map-timeline")).toBeHidden();
    await expect(map.play()).toBeHidden();
    await expect(map.card()).toBeVisible();
    // Not a tall scroll section any more.
    const height = await map.story().evaluate((e) => e.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const list = page.getByTestId("events-map-list");
    await expect(list).toHaveAttribute("open", "");
    await expect(list.locator(`[data-testid="events-map-list-item"][data-event-id="${event.id}"]`)).toBeVisible();
    // Chronological: past items (if any) first.
    const flags = await list.getByTestId("events-map-list-item").evaluateAll((items) => items.map((i) => i.getAttribute("data-past")));
    if (flags.includes("true") && flags.includes("false")) expect(flags.indexOf("false")).toBeGreaterThan(flags.lastIndexOf("true"));
  });

  test("phone: sticky map, the card below it, the timeline under the card; scroll and swipe advance", async ({ page, isMobile, freshUser, freshEvent }) => {
    test.skip(!isMobile, "phones only");
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const first = await freshEvent(manager, { label: "map phone 1", status: "published", startInMinutes: 4 * 24 * 60, audience: "public" });
    await freshEvent(manager, { label: "map phone 2", status: "published", startInMinutes: 5 * 24 * 60, audience: "public" });
    await freshEvent(manager, { label: "map phone 3", status: "published", startInMinutes: 6 * 24 * 60, audience: "public" });
    const map = new EventsMapPage(page);
    await page.goto("/events");
    await map.waitReady();
    // No full-screen map any more.
    await expect(page.locator(".leaflet-container")).toHaveCount(0);
    await map.selectByKeyboard(first.id);
    const card = map.card();
    await expect(card).toHaveAttribute("data-variant", "inline");
    await expect(card).toHaveAttribute("data-event-id", first.id);
    const canvas = (await map.canvas().boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    const bar = (await map.slider().boundingBox())!;
    expect(cardBox.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
    // All three fit in one viewport.
    expect(bar.y + bar.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(bar.y).toBeGreaterThanOrEqual(cardBox.y + cardBox.height - 1);

    // Scrolling the page moves to later events while the map stays put (sticky). From the first event, a third of a
    // screen always reaches the next slice and never the end of the section, however many events there are.
    await map.slider().focus();
    await page.keyboard.press("Home");
    await expect(map.story()).toHaveAttribute("data-active", "0");
    const start = 0;
    const before = await mapState(map);
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight / 3)));
    await expect.poll(async () => Number(await map.story().getAttribute("data-active"))).toBeGreaterThan(start);
    expect(await mapState(map)).toEqual(before);

    // A swipe to the left on the card moves one event on.
    const now = Number(await map.story().getAttribute("data-active"));
    const box = (await card.boundingBox())!;
    const y = box.y + box.height / 2;
    await card.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: box.x + box.width - 20, clientY: y }] });
    await card.dispatchEvent("touchend", { changedTouches: [{ identifier: 1, clientX: box.x + 20, clientY: y }] });
    await expect(map.story()).toHaveAttribute("data-active", String(now + 1));
  });

  test("event form: the optional map postcode is checked before saving (no geocoding request for a malformed one)", async ({ freshUser, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const page = await pageAs(manager);
    await page.goto("/calendar?view=list");
    await page.getByTestId("calendar-create-event-button").click({ timeout: APP_LOAD_TIMEOUT });
    const form = new EventFormDialog(page);
    await form.title().fill(`${EVENT_TITLE_PREFIX}${runId} map postcode`);
    await form.location().fill("E2E Hall");
    await form.setStart(`${londonDay(6)}T18:00`);
    await form.openSection("location");
    await page.getByTestId("event-form-postcode").fill("12345");
    await form.openSection("location");
    await form.publishButton().click();
    await expect(page.getByTestId("event-form-section-location")).toHaveAttribute("data-open", "true");
    await expect(page.locator("#event-form-postcode-error")).toBeVisible();
    await expect(page.getByTestId("event-form-postcode")).toBeFocused();
    // Online events have no map location: the section disappears.
    await page.getByTestId("event-form-location-type").click();
    await page.getByRole("option").nth(1).click();
    await expect(page.getByTestId("event-form-section-location")).toHaveCount(0);
  });

  test("no axe violations in the map story, timeline, card and list (/events)", async ({ page, freshUser, freshEvent }) => {
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    await freshEvent(manager, { label: "map axe", status: "published", startInMinutes: 4 * 24 * 60, audience: "public" });
    // Two events, so the timeline is there whatever else the database holds.
    await freshEvent(manager, { label: "map axe 2", status: "published", startInMinutes: 5 * 24 * 60, audience: "public" });
    const map = new EventsMapPage(page);
    const axe = () =>
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).include('[data-testid="events-map-layout"]').analyze();
    await page.goto("/events");
    await map.waitReady();
    await map.slider().focus();
    expect((await axe()).violations).toEqual([]);
    await page.getByTestId("events-map-list").locator("summary").click();
    expect((await axe()).violations).toEqual([]);
  });

  test("the map is in the server-rendered HTML of /events (no map library; the join page at / has none)", async ({ request, isMobile, freshUser, freshEvent }) => {
    test.skip(isMobile, "the HTML is the same for every device");
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "map ssr", status: "published", startInMinutes: 4 * 24 * 60, audience: "public" });
    await freshEvent(manager, { label: "map ssr 2", status: "published", startInMinutes: 5 * 24 * 60, audience: "public" });
    const html = await (await request.get("/events")).text();
    for (const id of ["events-map-land", "events-map-branch", "events-map-timeline-slider", "events-map-card", "events-map-list"])
      expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain(`data-testid="events-map-timeline-tick" data-index`);
    expect(html).toContain(`data-event-id="${event.id}"`);
    expect(html).not.toContain("leaflet");
    expect(html.match(/data-testid="events-map-land"/g) ?? [], "one map on the page").toHaveLength(1);
    const home = await (await request.get("/")).text();
    expect(home).not.toContain('data-testid="events-map-land"');
  });
});
