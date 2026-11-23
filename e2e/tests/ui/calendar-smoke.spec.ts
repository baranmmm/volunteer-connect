// Calendar smoke test: the main event and request journeys end to end. Runs in every PR (the full suite runs in CI).
// Fresh users only; the event is created through the UI and removed by teardown (fresh creator).
import { test, expect } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { EVENT_TITLE_PREFIX } from "../../api/events";
import { cancelRegistrationAs, registerAs, registrationOf } from "../../api/registrations";
import { externalInput, REQUEST_TITLE_PREFIX, rpcAs } from "../../api/eventRequests";
import { EventPage } from "../../pages/EventPage";
import { DashboardPage } from "../../pages/DashboardPage";
import { RecycleBinPage } from "../../pages/RecycleBinPage";
import { RequestsPage } from "../../pages/RequestsPage";
import { EventFormDialog } from "../../pages/components/EventFormDialog";
import { EventRequestFormDialog } from "../../pages/components/EventRequestFormDialog";

const londonDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));

test.describe("Calendar smoke", () => {
  test("create → publish → register → waitlist → promote → time change notice → cancel → Recycle Bin → restore", { tag: "@smoke" }, async ({ freshUser, pageAs }) => {
    test.setTimeout(120_000);
    const manager = await freshUser({ role: "branch_manager" });
    const [first, second] = [await freshUser(), await freshUser()];
    const page = await pageAs(manager);
    await page.goto("/calendar?view=list");
    await page.getByTestId("calendar-create-event-button").click();
    const form = new EventFormDialog(page);
    const title = `${EVENT_TITLE_PREFIX}smoke-${Date.now()}`;
    await form.title().fill(title);
    await form.location().fill("E2E Smoke Hall");
    await form.setStart(`${londonDay(6)}T18:00`);
    await form.openSection("registration");
    await form.capacity().fill("1");
    await form.publish();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    const eventId = new URL(page.url()).pathname.split("/").pop()!;
    const event = new EventPage(page);

    // Register through the UI, wait-list through the API, then the first place frees up.
    const asFirst = new EventPage(await pageAs(first));
    await asFirst.goto(eventId);
    await asFirst.registerButton().click();
    await expect(asFirst.registrationStatus()).toHaveAttribute("data-status", "registered");
    expect((await registerAs(second.email, eventId)).status).toBe("waitlisted");
    await cancelRegistrationAs(first.email, eventId);
    expect(await registrationOf(eventId, second.id)).toMatchObject({ status: "registered", notice: "promoted" });

    // A time change notifies the registered member.
    await event.goto(eventId);
    await event.editButton().click();
    await event.form().chooseTime("start", "19:00");
    await event.form().publish();
    await expect.poll(async () => (await registrationOf(eventId, second.id))?.notice).toBe("event_changed");
    const secondPage = await pageAs(second);
    const dashboard = new DashboardPage(secondPage);
    await dashboard.goto();
    const reg = (await registrationOf(eventId, second.id))!;
    await expect(dashboard.registrationNotice(reg.id)).toHaveAttribute("data-notice", "event_changed");

    // Cancel, delete to the Recycle Bin, restore.
    await page.getByTestId("event-cancel-event-button").click();
    await page.getByTestId("confirm-dialog-confirm-button").click();
    await expect(page.locator("article")).toHaveAttribute("data-status", "cancelled");
    await event.deleteButton().click();
    await page.getByTestId("event-delete-confirm").click();
    await expect(page).toHaveURL(/\/calendar/);
    const bin = new RecycleBinPage(page);
    await bin.goto();
    await bin.find(eventId, title);
    await bin.restore(eventId);
    const { data } = await adminClient().from("events").select("deleted_at, status").eq("id", eventId).single();
    expect(data).toEqual({ deleted_at: null, status: "cancelled" });
  });

  test("external request → manager edits → approve and publish", { tag: "@smoke" }, async ({ freshUser, pageAs }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const title = `${REQUEST_TITLE_PREFIX}smoke-${Date.now()}`;
    const submitted = await rpcAs<string>(volunteer.email, "submit_event_request", { p: externalInput(title) });
    expect(submitted.error).toBeNull();
    const page = await pageAs(manager);
    const review = new RequestsPage(page);
    await review.goto();
    await review.openManaged(submitted.data, "pending");
    await review.editRequest().click();
    const edit = new EventRequestFormDialog(page);
    await edit.chooseCategory("community");
    await edit.location().fill("E2E Smoke Centre");
    await edit.saveAsManager().click();
    await expect(edit.root).toBeHidden();
    await review.approvePublish().click();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("event-external-badge")).toBeVisible();
    await expect(page.locator("article")).toHaveAttribute("data-status", "published");
  });
});
