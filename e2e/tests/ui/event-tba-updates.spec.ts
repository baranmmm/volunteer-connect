// "To be announced" locations and the cover image of public events: publishing a public event needs an image, and
// announcing the real place later emails every registrant (members and confirmed guests) an update with the same
// calendar UID and a higher SEQUENCE.
import { randomUUID } from "node:crypto";
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { EVENT_TITLE_PREFIX, TINY_PNG, addConfirmedGuest, deleteEvents } from "../../api/events";
import { registerAs } from "../../api/registrations";
import { icsFrom, triggerScheduledRun, waitForEmail, type OutboxEmail } from "../../api/outbox";
import { emailDomain } from "../../setup/env";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { EventPage } from "../../pages/EventPage";
import { EventFormDialog } from "../../pages/components/EventFormDialog";

const londonDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));
function icsField(email: OutboxEmail, field: "UID" | "SEQUENCE" | "LOCATION") {
  const ics = icsFrom(email);
  if (!ics) throw new Error(`email ${email.id} has no .ics`);
  const line = ics.split(/\r?\n/).find((l) => l.startsWith(`${field}:`));
  return line?.slice(field.length + 1) ?? null;
}

test.describe("Public events: cover image and 'To be announced'", () => {
  test("publishing a public event needs a cover image; the place may be 'To be announced'", async ({ freshUser, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const page = await pageAs(manager);
    await page.goto("/calendar?view=list");
    await page.getByTestId("calendar-create-event-button").click({ timeout: APP_LOAD_TIMEOUT });
    const form = new EventFormDialog(page);
    const title = `${EVENT_TITLE_PREFIX}${runId} tba-form ${Date.now()}`;
    await form.title().fill(title);
    await form.setStart(`${londonDay(6)}T18:00`);
    await form.locationTba().click();
    await expect(form.location()).toBeDisabled();
    await form.openSection("audience");
    await page.getByTestId("event-form-audience").click();
    await page.getByTestId("event-form-audience-option-public").click();
    // No image: the form refuses and points at the files.
    await form.publishButton().click();
    await expect(form.filesError()).toBeVisible();
    await expect(form.root).toBeVisible();
    await form.attachImage("cover.png", TINY_PNG);
    await form.publish();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    try {
      await expect(new EventPage(page).locationTba()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
      const row = await adminClient().from("events").select("status, audience, location, location_tba").eq("id", id).single();
      expect(row.data).toEqual({ status: "published", audience: "public", location: "", location_tba: true });
      // The database refuses the same thing for direct API calls (a public event without an image).
      const media = await adminClient().from("event_media").select("id").eq("event_id", id);
      expect(media.data).toHaveLength(1);
    } finally {
      await deleteEvents([id]);
    }
  });

  test("announcing the real place emails the member and the guest an update with the same UID and the next SEQUENCE", async ({ freshUser, freshEvent, pageAs }) => {
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const member = await freshUser({ role: "volunteer" });
    const event = await freshEvent(manager, { label: "tba updates", status: "published", startInMinutes: 5 * 24 * 60, audience: "public", locationTba: true });
    const mine = await registerAs(member.email, event.id);
    const guestEmail = `e2e-guest-${runId}-tba-${randomUUID().slice(0, 8)}@${emailDomain()}`;
    const guest = await addConfirmedGuest(event.id, { name: `E2E Guest ${runId}`, email: guestEmail });
    // Send the confirmations first (the scheduled sender), so the update is a separate email.
    await triggerScheduledRun();
    const confirmations = await Promise.all([
      waitForEmail({ template: "registration_confirmed", registrationId: mine.registration_id }),
      waitForEmail({ template: "registration_confirmed", registrationId: guest.registrationId }),
    ]);
    const since = new Date();

    const page = await pageAs(manager);
    const detail = new EventPage(page);
    await detail.goto(event.id);
    await expect(detail.locationTba()).toBeVisible();
    await detail.editButton().click();
    const form = detail.form();
    await expect(form.locationTba()).toBeChecked();
    await form.locationTba().click();
    await form.location().fill("E2E Announced Hall");
    await form.publish();
    await expect(detail.locationLink()).toContainText("E2E Announced Hall", { timeout: APP_LOAD_TIMEOUT });

    for (const [registrationId, confirmation] of [[mine.registration_id, confirmations[0]], [guest.registrationId, confirmations[1]]] as const) {
      const update = await waitForEmail({ template: "event_update", registrationId, since, timeoutMs: 20_000 });
      expect(update.payload["location_announced"]).toBe(true);
      expect(icsField(update, "UID")).toBe(icsField(confirmation, "UID"));
      expect(Number(icsField(update, "SEQUENCE"))).toBe(Number(icsField(confirmation, "SEQUENCE")) + 1);
      expect(icsField(update, "LOCATION")).toContain("E2E Announced Hall");
    }
    expect(confirmations[1].captured.to).toBe(guestEmail);
  });
});
