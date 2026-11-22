// Event form Start/End: date input + quarter-hour time list. Fresh branch managers; the only saved event is a
// freshEvent (removed after the test).
import { test, expect } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { londonIso } from "../../api/events";
import { EventPage } from "../../pages/EventPage";
import { EventFormDialog } from "../../pages/components/EventFormDialog";
import type { Page } from "@playwright/test";

/** London date `days` from today, "YYYY-MM-DD". */
function londonDay(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  return new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function openCreateForm(page: Page) {
  await page.goto("/calendar?view=list");
  await page.getByTestId("calendar-create-event-button").click();
  const form = new EventFormDialog(page);
  await expect(form.root).toBeVisible();
  return form;
}

test.describe("Event form time picker", () => {
  test("quarter-hour list opens at 18:00, typing jumps to a time, End follows Start + 2 hours", async ({ freshUser, pageAs }) => {
    const page = await pageAs(await freshUser({ role: "branch_manager" }));
    const form = await openCreateForm(page);
    const day = londonDay(14);

    await form.startTime().click();
    await expect(page.locator('[data-testid^="event-form-start-time-option-"]')).toHaveCount(96);
    await expect(form.timeOption("start", "18:00")).toBeInViewport();
    await expect(form.timeOption("start", "18:00")).toBeFocused();
    await page.keyboard.type("21");
    await expect(form.timeOption("start", "21:00")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(form.startTime()).toHaveText("21:00");

    await form.startDate().fill(day);
    await expect(form.endDate()).toHaveValue(day);
    await expect(form.endTime()).toHaveText("23:00");

    // Typing on the closed list selects too.
    await form.startTime().focus();
    await page.keyboard.type("09");
    await expect(form.startTime()).toHaveText("09:00");
    await expect(form.endTime()).toHaveText("11:00");

    // A late start moves End to the next day.
    await form.chooseTime("start", "23:15");
    await expect(form.endDate()).toHaveValue(londonDay(15));
    await expect(form.endTime()).toHaveText("01:15");

    // The Repeat summary follows the chosen time.
    await form.chooseRepeat("weekly");
    await expect(form.summary()).toContainText("23:15");
    await form.chooseTime("start", "19:30");
    await expect(form.summary()).toContainText("19:30");

    await page.getByTestId("event-form-all-day").click();
    await expect(form.startTime()).toBeHidden();
    await expect(form.endTime()).toBeHidden();
    await expect(form.startDate()).toBeVisible();
  });

  test("an existing event at 21:51 shows and keeps its off-grid time when edited", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const startLocal = `${londonDay(10)}T21:51`;
    const created = await freshEvent(manager, { label: "off-grid time", status: "published", startLocal, durationMinutes: 76 });
    const event = new EventPage(await pageAs(manager));
    await event.goto(created.id);
    await event.editButton().click();
    const form = event.form();
    await expect(form.root).toBeVisible();
    await expect(form.startTime()).toHaveText("21:51");
    await expect(form.endTime()).toHaveText("23:07");

    await form.startTime().click();
    await expect(event.page.locator('[data-testid^="event-form-start-time-option-"]')).toHaveCount(97);
    await expect(form.timeOption("start", "21:51")).toBeFocused();
    await event.page.keyboard.press("Escape");

    await form.title().fill(`${created.title} (edited)`);
    await form.publish();
    const { data, error } = await adminClient().from("events").select("title, start_at, end_at").eq("id", created.id).single();
    expect(error).toBeNull();
    expect(data!.title).toBe(`${created.title} (edited)`);
    expect(Date.parse(data!.start_at as string)).toBe(Date.parse(londonIso(startLocal)));
    expect(Date.parse(data!.end_at as string) - Date.parse(data!.start_at as string)).toBe(76 * 60_000);
  });

  test("usable at 375px: date and time fit side by side and a time can be tapped", async ({ freshUser, pageAs }) => {
    const page = await pageAs(await freshUser({ role: "branch_manager" }));
    await page.setViewportSize({ width: 375, height: 667 });
    const form = await openCreateForm(page);
    for (const field of [form.startDate(), form.startTime(), form.endDate(), form.endTime()]) {
      const box = await field.boundingBox();
      expect(box, "field is laid out").not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
    const start = await form.startDate().boundingBox(), time = await form.startTime().boundingBox();
    expect(Math.abs(start!.y - time!.y)).toBeLessThan(4);

    await form.startTime().click();
    await expect(form.timeOption("start", "18:00")).toBeInViewport();
    await form.timeOption("start", "18:30").click();
    await expect(form.startTime()).toHaveText("18:30");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
