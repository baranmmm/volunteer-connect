// The public events map (signed out): always visible on /events (desktop split view, phone strip + full screen) and on
// the landing page; markers and cards, the timeline (keyboard), the Online panel and the "Past events" toggle.
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { test, expect, runId, type TestUser } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { EVENT_TITLE_PREFIX, deleteEvents, eventPayload } from "../../api/events";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { EventsMapPage, monthOffset } from "../../pages/EventsMapPage";
import { EventFormDialog } from "../../pages/components/EventFormDialog";

const DAY = 86_400_000;
const londonDay = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * DAY));

/** A public past record (like the importer writes) in the owner's branch, `daysAgo` days back. */
async function createPastRecord(owner: TestUser, regionId: string, daysAgo: number): Promise<string> {
  const title = `${EVENT_TITLE_PREFIX}${runId}-${randomUUID().slice(0, 6)} map past`;
  const { data, error } = await adminClient()
    .from("events")
    .insert({
      ...eventPayload({ title, branchId: owner.branchId!, status: "published", startInMinutes: -daysAgo * 24 * 60, audience: "public" }),
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

test.describe("Public events map", () => {
  test("desktop /events: marker card reaches Register, the timeline moves by keyboard, online events sit in the Online panel", { tag: "@smoke" }, async ({ page, isMobile, freshUser, freshEvent }) => {
    test.skip(isMobile, "the phone layout has its own test");
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const inPerson = await freshEvent(manager, { label: "map in person", status: "published", startInMinutes: 4 * 24 * 60, audience: "public" });
    const online = await freshEvent(manager, { label: "map online", status: "published", startInMinutes: 4 * 24 * 60, audience: "public", onlineUrl: "https://meet.example.org/e2e-map-room" });
    const map = new EventsMapPage(page);
    await map.blockTiles();
    await page.goto("/events");
    await expect(page.getByTestId("public-events-page")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("events-map-layout")).toHaveAttribute("data-layout", "desktop");
    await map.waitInteractive();
    // In person: a marker (at the branch location); online: only in the Online panel.
    await expect(map.markerOf(inPerson.id)).toBeVisible();
    await expect(map.markerOf(inPerson.id)).toHaveAttribute("aria-label", /.+/);
    await expect(map.markerOf(online.id)).toHaveCount(0);
    await expect(map.onlineItem(online.id)).toBeVisible();
    await expect(page.locator(`[data-testid="public-event-card"][data-event-id="${online.id}"]`)).toBeVisible();

    // Timeline by keyboard: the event's month shows it; the last month does not (map and list alike).
    const when = new Date(Date.now() + 4 * 24 * 60 * 60_000).toISOString();
    await map.selectMonth(monthOffset(when));
    await expect(map.slider()).toHaveAttribute("aria-valuetext", /\d{4}/);
    await expect(map.markerOf(inPerson.id)).toBeVisible();
    await page.keyboard.press("End");
    await expect(map.markerOf(inPerson.id)).toHaveCount(0);
    await expect(page.locator(`[data-testid="public-event-card"][data-event-id="${inPerson.id}"]`)).toHaveCount(0);
    await expect(map.onlineItem(online.id)).toHaveCount(0);
    await page.getByTestId("events-map-timeline-span-all").click();
    await expect(map.markerOf(inPerson.id)).toBeVisible();

    // Marker → card (focus moves in), the list item is highlighted; Escape closes and returns focus to the marker.
    await map.markerOf(inPerson.id).click();
    await expect(map.cardItem(inPerson.id)).toBeVisible();
    await expect(map.card()).toBeFocused();
    await expect(page.locator(`[data-testid="public-event-card"][data-highlighted="true"]`)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(map.card()).toHaveCount(0);
    await expect(map.markerOf(inPerson.id)).toBeFocused();
    await page.keyboard.press("Enter");
    await map.cardItem(inPerson.id).getByTestId("events-map-card-register").click();
    await expect(page).toHaveURL(new RegExp(`/events/${inPerson.id}$`));
    await expect(page.getByTestId("public-event-detail")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  });

  test("Past events: the timeline goes back and past records appear as past markers linking to the event", async ({ page, isMobile, freshUser, seed }) => {
    test.skip(isMobile, "the toggle is the same on phones (inside the timeline)");
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const pastId = await createPastRecord(manager, seed.regionId, 40);
    try {
      const map = new EventsMapPage(page);
      await map.blockTiles();
      await page.goto("/events");
      await map.waitInteractive();
      await expect(map.markerOf(pastId)).toHaveCount(0);
      const before = Number(await map.slider().getAttribute("aria-valuenow"));
      await page.getByTestId("events-map-past-toggle").click();
      await expect(page.getByTestId("events-map-legend-past")).toBeVisible();
      // The same month stays selected: the timeline gained the 12 months before it.
      await expect(map.slider()).toHaveAttribute("aria-valuenow", String(before + 12));
      await expect(map.markerOf(pastId)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      await expect(page.locator(`[data-testid="public-event-card"][data-event-id="${pastId}"]`)).toBeVisible();
      await map.markerOf(pastId).click();
      const item = map.cardItem(pastId);
      await expect(item).toHaveAttribute("data-past", "true");
      // No gallery photos: the card links to the public event page.
      await expect(item.getByTestId("events-map-card-past-link")).toHaveAttribute("href", `/events/${pastId}`);
      await expect(item.getByTestId("events-map-card-register")).toHaveCount(0);
      await page.getByTestId("events-map-past-toggle").click();
      await expect(map.markerOf(pastId)).toHaveCount(0);
    } finally {
      await deleteEvents([pastId]);
    }
  });

  test("phone: the map strip opens the full-screen map; Escape closes the card, then the map", async ({ page, isMobile, freshUser, freshEvent }) => {
    test.skip(!isMobile, "phones only");
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "map phone", status: "published", startInMinutes: 4 * 24 * 60, audience: "public" });
    const map = new EventsMapPage(page);
    await map.blockTiles();
    await page.goto("/events");
    await expect(page.getByTestId("events-map-layout")).toHaveAttribute("data-layout", "mobile", { timeout: APP_LOAD_TIMEOUT });
    // No Leaflet until the strip is opened.
    await expect(page.getByTestId("events-map-leaflet")).toHaveCount(0);
    await expect(page.locator(`[data-testid="public-event-card"][data-event-id="${event.id}"]`)).toBeVisible();
    const strip = page.getByTestId("events-map-strip");
    await strip.click();
    await expect(page.getByTestId("events-map-fullscreen")).toBeVisible();
    await map.waitInteractive();
    await map.markerOf(event.id).click();
    await expect(map.cardItem(event.id)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(map.card()).toHaveCount(0);
    await expect(page.getByTestId("events-map-fullscreen")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("events-map-fullscreen")).toHaveCount(0);
    await expect(strip).toBeFocused();
  });

  test("landing page: the section shows the map once scrolled to, with the event's marker and Register", async ({ page, freshUser, freshEvent }) => {
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "map landing", status: "published", startInMinutes: 5 * 24 * 60, audience: "public" });
    const map = new EventsMapPage(page);
    await map.blockTiles();
    await page.goto("/");
    // The section (and its code) loads only when it nears the screen.
    const slot = page.getByTestId("landing-map-slot");
    await expect(slot).toBeAttached({ timeout: APP_LOAD_TIMEOUT });
    await slot.scrollIntoViewIfNeeded();
    const section = page.getByTestId("landing-map");
    await expect(section).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await section.scrollIntoViewIfNeeded();
    await map.waitInteractive();
    await expect(map.markerOf(event.id)).toBeVisible();
    await map.markerOf(event.id).click();
    await expect(map.cardItem(event.id).getByTestId("events-map-card-register")).toHaveAttribute("href", `/events/${event.id}`);
    // The accessible list holds the same event.
    await expect(section.locator(`[data-testid="landing-map-list-item"][data-event-id="${event.id}"]`)).toBeAttached();
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

  test("no axe violations in the map, timeline, legend and Online panel (/events and the landing section)", async ({ page, isMobile, freshUser, freshEvent }) => {
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    await freshEvent(manager, { label: "map axe", status: "published", startInMinutes: 4 * 24 * 60, audience: "public" });
    const map = new EventsMapPage(page);
    await map.blockTiles();
    const axe = (include: string) =>
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).include(include).analyze();
    await page.goto("/events");
    await expect(page.getByTestId("events-map-timeline")).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    if (!isMobile) await map.waitInteractive();
    expect((await axe('[data-testid="events-map-layout"]')).violations).toEqual([]);
    await page.goto("/");
    const slot = page.getByTestId("landing-map-slot");
    await expect(slot).toBeAttached({ timeout: APP_LOAD_TIMEOUT });
    await slot.scrollIntoViewIfNeeded();
    await map.waitInteractive();
    await page.getByTestId("events-map-past-toggle").click();
    await expect(page.getByTestId("events-map-legend-past")).toBeVisible();
    expect((await axe('[data-testid="landing-map"]')).violations).toEqual([]);
  });
});
