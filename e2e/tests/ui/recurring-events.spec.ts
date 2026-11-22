// A2r recurring events through the UI. Fresh managers/volunteers; every series (including split parts) is
// removed after each test (trackSeries / freshSeries).
import { test, expect } from "../../fixtures/roles";
import { EVENT_TITLE_PREFIX, mediaHolderOf, occurrencesOf } from "../../api/events";
import { EventPage } from "../../pages/EventPage";
import { EventFormDialog } from "../../pages/components/EventFormDialog";
import { RecycleBinPage } from "../../pages/RecycleBinPage";
import { CalendarPage } from "../../pages/CalendarPage";

const WEEKLY_8 = "FREQ=WEEKLY;BYDAY=TU;COUNT=8";
/** A Tuesday `weeks` weeks from this week (London date), "YYYY-MM-DD". */
function tuesday(weeks: number): string {
  const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date())}T12:00:00Z`);
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86_400_000);
  return new Date(monday.getTime() + (weeks * 7 + 1) * 86_400_000).toISOString().slice(0, 10);
}

test.describe("Recurring events", () => {
  test("a branch manager creates 'every Tuesday 18:00, 8 weeks' in the form: 8 events at 18:00 London", async ({ freshUser, pageAs, trackSeries }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const page = await pageAs(manager);
    await page.goto("/calendar?view=list");
    await page.getByTestId("calendar-create-event-button").click();
    const form = new EventFormDialog(page);
    await expect(form.root).toBeVisible();
    await form.title().fill(`${EVENT_TITLE_PREFIX}ui-${Date.now()} Tuesday dialogue`);
    await form.location().fill("E2E Community Hall");
    await form.setStart(`${tuesday(1)}T18:00`);
    await form.chooseRepeat("weekly");
    await form.chooseEnds("after");
    await form.repeatCount().fill("8");
    await expect(form.summary()).not.toHaveText("");
    await form.publish();

    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    const eventId = new URL(page.url()).pathname.split("/").pop()!;
    trackSeries(await mediaHolderOf(eventId));
    const event = new EventPage(page);
    await expect(event.recurringIcon()).toBeVisible();
    await expect(event.repeatSummary()).toBeVisible();
    const occurrences = await occurrencesOf(await mediaHolderOf(eventId));
    expect(occurrences).toHaveLength(8);
    expect(occurrences.every((o) => /Tue.*18:00/.test(o.londonStart)), occurrences.map((o) => o.londonStart).join(" | ")).toBe(true);
  });

  test("'This event' changes only that occurrence", async ({ freshUser, freshSeries, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const series = await freshSeries(manager, { label: "this", startLocal: `${tuesday(1)}T18:00`, rule: WEEKLY_8 });
    const before = await occurrencesOf(series.mediaEventId);
    expect(before).toHaveLength(8);

    const event = new EventPage(await pageAs(manager));
    await event.goto(before[2]!.id);
    const form = await event.editSeries("this");
    await form.title().fill(`${series.title} (changed)`);
    await form.publish();

    await expect.poll(async () => (await occurrencesOf(series.mediaEventId)).filter((o) => o.title !== series.title).map((o) => o.id)).toEqual([before[2]!.id]);
    const after = await occurrencesOf(series.mediaEventId);
    expect(after).toHaveLength(8);
    expect(after[2]!.exception).toBe(true);
  });

  test("'This and following' from week 5 changes only weeks 5-8", async ({ freshUser, freshSeries, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const series = await freshSeries(manager, { label: "following", startLocal: `${tuesday(1)}T18:00`, rule: WEEKLY_8 });
    const before = await occurrencesOf(series.mediaEventId);

    const event = new EventPage(await pageAs(manager));
    await event.goto(before[4]!.id);
    const form = await event.editSeries("following");
    await form.title().fill(`${series.title} (from week 5)`);
    await form.publish();

    await expect.poll(async () => (await occurrencesOf(series.mediaEventId)).map((o) => o.title)).toEqual([
      ...Array(4).fill(series.title),
      ...Array(4).fill(`${series.title} (from week 5)`),
    ]);
    const after = await occurrencesOf(series.mediaEventId);
    expect(after.map((o) => o.id)).toEqual(before.map((o) => o.id)); // same rows, nothing regenerated
    expect(new Set(after.slice(4).map((o) => o.seriesId)).size).toBe(1);
    expect(after[4]!.seriesId).not.toBe(after[0]!.seriesId); // split into a new series
  });

  test("'All events' delete: one series row in the Recycle Bin; restore brings all 8 back", async ({ freshUser, freshSeries, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const series = await freshSeries(manager, { label: "delete all", startLocal: `${tuesday(1)}T19:00`, rule: WEEKLY_8 });
    const page = await pageAs(manager);
    const event = new EventPage(page);
    await event.goto(series.firstEventId);
    await event.deleteSeries("all");
    await expect.poll(async () => (await occurrencesOf(series.mediaEventId)).length).toBe(0);

    const bin = new RecycleBinPage(page);
    await bin.goto();
    await bin.find(series.seriesId, series.title);
    await expect(bin.rows()).toHaveCount(1);
    await expect(bin.row(series.seriesId)).toHaveAttribute("data-item-type", "series");
    await bin.restore(series.seriesId);
    await expect.poll(async () => (await occurrencesOf(series.mediaEventId)).length).toBe(8);
  });

  test("a volunteer sees the recurring icon but cannot create, edit or delete (UI)", async ({ freshUser, freshSeries, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const series = await freshSeries(manager, { label: "volunteer view", startLocal: `${tuesday(1)}T18:00`, rule: WEEKLY_8 });
    const page = await pageAs(volunteer);

    const calendar = new CalendarPage(page);
    await calendar.goto("list");
    await expect(calendar.card("list", series.firstEventId).getByTestId("event-recurring-icon")).toBeVisible();
    await expect(page.getByTestId("calendar-create-event-button")).toHaveCount(0);

    const event = new EventPage(page);
    await event.goto(`${series.firstEventId}?edit=true`);
    await expect(event.recurringIcon()).toBeVisible();
    await expect(event.editButton()).toHaveCount(0);
    await expect(event.deleteButton()).toHaveCount(0);
    await expect(event.scopeDialog()).toHaveCount(0);
    await expect(page.getByTestId("event-form")).toHaveCount(0);
  });
});
