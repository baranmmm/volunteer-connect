// A3 revision through the UI: an external request with a leaflet, reviewed, edited and published by a manager.
import { test, expect } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { REQUEST_TITLE_PREFIX, requestIdByTitle, requestRow, TINY_PNG } from "../../api/eventRequests";
import { RequestsPage } from "../../pages/RequestsPage";
import { EventRequestFormDialog } from "../../pages/components/EventRequestFormDialog";

const londonDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));

test.describe("External event requests", () => {
  test("a volunteer adds an event from a leaflet; the manager sees the file and a duplicate, edits, approves and publishes", async ({ freshUser, freshEvent, pageAs }) => {
    const volunteer = await freshUser();
    const manager = await freshUser({ role: "branch_manager" });
    const token = `Leaflet${Date.now()}`;
    // An existing event on the same day with a similar title triggers the duplicate warning.
    const existing = await freshEvent(manager, { label: `${token} evening`, status: "published", startInMinutes: 10 * 24 * 60 });
    const { data: ev } = await adminClient().from("events").select("start_at").eq("id", existing.id).single();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(ev!.start_at!));

    const page = await pageAs(volunteer);
    await page.goto("/calendar?view=list");
    await page.getByTestId("event-request-open-button").click();
    const form = new EventRequestFormDialog(page);
    await form.chooseType("external");
    const name = token; // contained in the existing event's title, so the duplicate warning shows
    await form.title().fill(name);
    await form.organizer().fill("E2E Community Centre");
    await form.chooseSource("leaflet");
    await form.setDateTime("start", `${day}T19:00`);
    await form.sourceUrl().fill("https://example.org/leaflet");
    await form.notes().fill("Picked up at the library");
    await form.attachments().setInputFiles({ name: "leaflet.png", mimeType: "image/png", buffer: TINY_PNG });
    await expect(form.attachmentItems()).toHaveCount(1);
    await form.submit();
    await expect(page).toHaveURL(/\/my-requests$/);
    const id = await requestIdByTitle(name);
    const mine = new RequestsPage(page);
    await expect(mine.typeBadge(id)).toHaveAttribute("data-type", "external");

    const managerPage = await pageAs(manager);
    const review = new RequestsPage(managerPage);
    await review.goto();
    await expect(review.typeBadge(id)).toHaveAttribute("data-type", "external");
    await review.openManaged(id, "pending");
    await expect(review.attachments().getByTestId("request-attachment")).toHaveCount(1);
    await expect(review.duplicateWarning().locator(`[data-event-id="${existing.id}"]`)).toBeVisible();
    // Publishing needs a category and a place: the manager edits the request (no approval overrides).
    await review.editRequest().click();
    const edit = new EventRequestFormDialog(managerPage);
    await expect(edit.root).toHaveAttribute("data-type", "external");
    await edit.chooseCategory("community");
    await edit.location().fill("E2E Community Hall");
    await edit.saveAsManager().click();
    await expect(edit.root).toBeHidden();
    await expect(review.detailStatus()).toHaveAttribute("data-status", "under_review");
    await review.approvePublish().click();
    await expect(managerPage).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    await expect(managerPage.getByTestId("event-detail-title")).toHaveText(name);
    await expect(managerPage.getByTestId("event-external-badge")).toBeVisible();
    await expect(managerPage.getByTestId("event-detail-organizer")).toContainText("E2E Community Centre");
    await expect(managerPage.getByTestId("event-detail-image")).toHaveCount(1);
    const row = await requestRow(id);
    expect(row).toMatchObject({ status: "approved" });
    const { data: event } = await adminClient().from("events").select("status, is_external, location, category").eq("id", row!.event_id!).single();
    expect(event).toEqual({ status: "published", is_external: true, location: "E2E Community Hall", category: "community" });

    // The requester sees the manager's edit and the published event in the calendar with the External badge.
    await mine.gotoMine();
    await expect(mine.myEditedNote(id)).toBeVisible();
    await page.goto("/calendar?view=list");
    await expect(page.locator(`[data-testid="event-card"][data-event-id="${row!.event_id}"]`).getByTestId("event-external-badge")).toBeVisible();
  });

  test("the proposal flow is unchanged: type choice, then the proposal form with an alternative date", async ({ freshUser, pageAs }) => {
    const volunteer = await freshUser();
    const page = await pageAs(volunteer);
    const requests = new RequestsPage(page);
    await requests.gotoMine();
    await requests.newEventRequest();
    const form = new EventRequestFormDialog(page);
    await form.chooseType("proposal");
    await expect(form.organizer()).toHaveCount(0);
    await expect(form.attachments()).toHaveCount(0);
    await expect(form.addAlternative()).toBeVisible();
    const name = `${REQUEST_TITLE_PREFIX}ui-${Date.now()} proposal`;
    await form.title().fill(name);
    await form.setDateTime("start", `${londonDay(12)}T18:00`);
    await form.submit();
    const id = await requestIdByTitle(name);
    await expect(requests.typeBadge(id)).toHaveAttribute("data-type", "proposal");
  });
});
