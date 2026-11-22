// A2b registrations through the UI. Fresh managers/volunteers and events only; removed after each test.
import { test, expect } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { EVENT_TITLE_PREFIX } from "../../api/events";
import { cancelRegistrationAs, registerAs, registrationOf, registrationsOf } from "../../api/registrations";
import { EventPage } from "../../pages/EventPage";
import { CalendarPage } from "../../pages/CalendarPage";
import { DashboardPage } from "../../pages/DashboardPage";
import { EventFormDialog } from "../../pages/components/EventFormDialog";

const IN_3_DAYS = 3 * 24 * 60;

test.describe("Event registrations", () => {
  test("a volunteer registers (count and calendar badge update), shows their name, then cancels", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const event = await freshEvent(manager, { label: "ui register", status: "published", startInMinutes: IN_3_DAYS, capacity: 30 });
    const page = new EventPage(await pageAs(volunteer));
    await page.goto(event.id);
    await expect(page.registrationCount()).toHaveText("0 / 30 registered");
    await page.showNameCheckbox().click();
    await page.registerButton().click();
    await expect(page.page.getByTestId("toast-success")).toBeVisible();
    await expect(page.registrationCount()).toHaveText("1 / 30 registered");
    await expect(page.registrationStatus()).toHaveAttribute("data-status", "registered");
    await expect(page.attendeeList()).toContainText(volunteer.fullName);
    expect(await registrationOf(event.id, volunteer.id)).toMatchObject({ status: "registered", show_name: true });

    const calendar = new CalendarPage(page.page);
    await calendar.goto("list");
    await expect(calendar.registrationBadge("list", event.id, "registered")).toBeVisible();

    await page.goto(event.id);
    await page.cancelRegistrationButton().click();
    await expect(page.registerButton()).toBeVisible();
    await expect(page.registrationCount()).toHaveText("0 / 30 registered");
    expect(await registrationOf(event.id, volunteer.id)).toMatchObject({ status: "cancelled" });
    await calendar.goto("list");
    await expect(calendar.card("list", event.id)).toBeVisible();
    await expect(calendar.registrationBadge("list", event.id, "registered")).toHaveCount(0);
  });

  test("waitlist: join when full, see the position and badge, then the dashboard notice after promotion", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const [first, volunteer] = [await freshUser(), await freshUser()];
    const event = await freshEvent(manager, { label: "ui waitlist", status: "published", startInMinutes: IN_3_DAYS, capacity: 1 });
    await registerAs(first!.email, event.id);
    const page = new EventPage(await pageAs(volunteer!));
    await page.goto(event.id);
    await expect(page.registrationCount()).toHaveText("1 / 1 registered");
    await page.joinWaitlistButton().click();
    await expect(page.waitlistPosition()).toHaveText("You are #1 on the waitlist");
    await expect(page.registrationCount()).toHaveText("1 / 1 registered · 1 on waitlist");
    const calendar = new CalendarPage(page.page);
    await calendar.goto("list");
    await expect(calendar.registrationBadge("list", event.id, "waitlisted")).toBeVisible();

    await cancelRegistrationAs(first!.email, event.id);
    const mine = (await registrationOf(event.id, volunteer!.id))!;
    expect(mine).toMatchObject({ status: "registered", notice: "promoted" });
    const dashboard = new DashboardPage(page.page);
    await dashboard.goto();
    await expect(dashboard.registrationNotice(mine.id)).toHaveAttribute("data-notice", "promoted");
    await expect(dashboard.myRegistrationItem(event.id)).toHaveAttribute("data-status", "registered");
    await dashboard.dismissRegistrationNotice(mine.id).click();
    await expect(dashboard.registrationNotice(mine.id)).toBeHidden();
    expect((await registrationOf(event.id, volunteer!.id))!.notice_seen_at).not.toBeNull();
  });

  test("a manager sees the full list, marks attendance after the start and exports CSV", async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const [a, b] = [await freshUser(), await freshUser()];
    const event = await freshEvent(manager, { label: "ui manager", status: "published", startInMinutes: -10, durationMinutes: 120 });
    const ra = await registerAs(a!.email, event.id);
    const rb = await registerAs(b!.email, event.id);
    const page = new EventPage(await pageAs(manager));
    await page.goto(event.id);
    await expect(page.managerRegistrations()).toBeVisible();
    await expect(page.registrationRow(ra.registration_id)).toContainText(a!.email);
    await expect(page.registrationRow(rb.registration_id)).toContainText(b!.email);
    await page.attendanceButton(ra.registration_id, "attended").click();
    await expect(page.registrationRow(ra.registration_id)).toHaveAttribute("data-status", "attended");
    await page.attendanceButton(rb.registration_id, "no_show").click();
    await expect(page.registrationRow(rb.registration_id)).toHaveAttribute("data-status", "no_show");
    expect((await registrationsOf(event.id)).map((r) => r.status).sort()).toEqual(["attended", "no_show"]);

    const download = page.page.waitForEvent("download");
    await page.exportCsvButton().click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`registrations-${event.id}.csv`);
    const csv = await new Promise<string>((resolve, reject) => {
      void file.createReadStream().then((stream) => { const chunks: Buffer[] = []; stream.on("data", (c: Buffer) => chunks.push(c)); stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); stream.on("error", reject); });
    });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("name,email,status,registered_at,attendance");
    expect(lines).toHaveLength(3);
    expect(csv).toContain(`"${a!.email}","attended"`);
    expect(csv).toContain(`"${b!.email}","no_show"`);
  });

  test("the form sets capacity and closes registration; volunteers then see why they cannot register", async ({ freshUser, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const volunteer = await freshUser();
    const page = await pageAs(manager);
    await page.goto("/calendar?view=list");
    await page.getByTestId("calendar-create-event-button").click();
    const form = new EventFormDialog(page);
    await expect(form.root).toBeVisible();
    const title = `${EVENT_TITLE_PREFIX}ui-${Date.now()} capacity`;
    await form.title().fill(title);
    await form.location().fill("E2E Community Hall");
    const start = new Date(Date.now() + IN_3_DAYS * 60_000);
    const local = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" }).format(start).replace(" ", "T");
    await form.setStart(`${local.slice(0, 10)}T18:00`);
    await form.capacity().fill("5");
    await expect(form.registrationEnabled()).toHaveAttribute("aria-checked", "true");
    await form.registrationEnabled().click();
    await form.publish();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    const eventId = new URL(page.url()).pathname.split("/").pop()!;
    try {
      const { data } = await adminClient().from("events").select("capacity, registration_enabled").eq("id", eventId).single();
      expect(data).toEqual({ capacity: 5, registration_enabled: false });
      const asVolunteer = new EventPage(await pageAs(volunteer));
      await asVolunteer.goto(eventId);
      await expect(asVolunteer.registrationUnavailable()).toHaveAttribute("data-reason", "closed");
      await expect(asVolunteer.registerButton()).toHaveCount(0);
      await expect(asVolunteer.registrationCount()).toHaveText("0 / 5 registered");
    } finally {
      await adminClient().from("events").delete().eq("id", eventId);
    }
  });
});
