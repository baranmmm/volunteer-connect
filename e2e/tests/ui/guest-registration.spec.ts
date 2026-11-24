// Guest registration without an account on the public event page: email confirmation, capacity and waitlist,
// cancellation by link, and the bot guard (honeypot).
import { randomUUID } from "node:crypto";
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { capturedEmails, linkFrom, waitForEmail } from "../../api/outbox";
import { emailDomain } from "../../setup/env";
import { GuestRegistrationForm } from "../../pages/public/GuestRegistrationForm";
import { GuestLinkPage } from "../../pages/public/GuestLinkPage";
import { useOwnClientIp } from "../../pages/public/clientIp";

const IN_FOUR_DAYS = 4 * 24 * 60;
const guestEmail = (label: string) => `e2e-guest-${runId}-${label}-${randomUUID().slice(0, 8)}@${emailDomain()}`;

async function guestRegistration(eventId: string, email: string) {
  const { data, error } = await adminClient()
    .from("event_guests")
    .select("registration_id, confirmed_at, keep_informed, event_registrations!inner(status, places)")
    .eq("event_id", eventId)
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(`read event_guests: ${error.message}`);
  if (!data) return null;
  const reg = data.event_registrations as unknown as { status: string; places: number };
  return { id: data.registration_id as string, status: reg.status, confirmedAt: data.confirmed_at as string | null };
}

test.describe("Guest registration (signed out)", () => {
  test("a guest registers, the email link shows the event and the place is taken only after Confirm", { tag: "@smoke" }, async ({ page, freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "guest", status: "published", startInMinutes: IN_FOUR_DAYS, audience: "public" });
    await useOwnClientIp(page);
    const email = guestEmail("smoke");
    const form = new GuestRegistrationForm(page);
    await form.goto(event.id);
    await expect(form.places()).toHaveCount(0); // one place per registration on this event
    await expect(form.keepInformed()).toHaveAttribute("data-state", "unchecked");
    await expect(form.privacyLink()).toHaveAttribute("href", "/privacy/attendees");
    await form.register({ name: "E2E Guest Smoke", email, phone: "07000 000000" });

    const confirmEmail = await waitForEmail({ template: "guest_confirm", to: email });
    // Opening the link (as a mail scanner would) only shows the event: still waiting for the guest.
    const link = new GuestLinkPage(page);
    await link.open(linkFrom(confirmEmail, "/e/confirm"));
    await expect(link.event()).toHaveAttribute("data-event-id", event.id);
    await expect(link.confirmButton()).toBeVisible();
    expect((await guestRegistration(event.id, email))?.status).toBe("pending");
    await link.confirmButton().click();
    await link.expectState("registered");
    expect((await guestRegistration(event.id, email))?.status).toBe("registered");
    // The confirmation carries the cancel link.
    const confirmed = await waitForEmail({ template: "registration_confirmed", to: email });
    expect(linkFrom(confirmed, "/e/cancel")).toContain("/e/cancel?t=");
  });

  test("a full event puts the next guest on the waitlist; cancelling by link promotes them", async ({ page, freshUser, freshEvent }) => {
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "guest full", status: "published", startInMinutes: IN_FOUR_DAYS, audience: "public", capacity: 1 });
    await useOwnClientIp(page);
    const first = guestEmail("first"), second = guestEmail("second");
    const form = new GuestRegistrationForm(page);
    const link = new GuestLinkPage(page);

    await form.goto(event.id);
    await expect(form.form()).toHaveAttribute("data-state", "open");
    await form.register({ name: "E2E Guest First", email: first });
    await link.open(linkFrom(await waitForEmail({ template: "guest_confirm", to: first }), "/e/confirm"));
    await link.confirmButton().click();
    await link.expectState("registered");
    const firstConfirmed = await waitForEmail({ template: "registration_confirmed", to: first });

    // The event is full now: the form offers the waitlist.
    await form.goto(event.id);
    await expect(form.form()).toHaveAttribute("data-state", "full");
    await form.register({ name: "E2E Guest Second", email: second });
    await link.open(linkFrom(await waitForEmail({ template: "guest_confirm", to: second }), "/e/confirm"));
    await link.confirmButton().click();
    await link.expectState("waitlisted");
    const waitlisted = await waitForEmail({ template: "registration_confirmed", to: second });
    expect(waitlisted.payload["status"]).toBe("waitlisted");

    // The first guest cancels with the link in their confirmation: only after the click.
    await link.open(linkFrom(firstConfirmed, "/e/cancel"));
    await expect(link.cancelButton()).toBeVisible();
    expect((await guestRegistration(event.id, first))?.status).toBe("registered");
    await link.cancelButton().click();
    await link.expectState("cancelled");
    // The freed seat goes to the second guest, who gets a new confirmation.
    await expect.poll(async () => (await guestRegistration(event.id, second))?.status).toBe("registered");
    const promoted = await waitForEmail({ template: "registration_confirmed", to: second, exclude: [waitlisted.id] });
    expect(promoted.payload["promoted"]).toBe(true);
  });

  test("a filled honeypot looks like success but registers nobody and sends nothing", async ({ page, freshUser, freshEvent }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "guest bot", status: "published", startInMinutes: IN_FOUR_DAYS, audience: "public" });
    await useOwnClientIp(page);
    const email = guestEmail("bot");
    const form = new GuestRegistrationForm(page);
    await form.goto(event.id);
    await form.fill({ name: "E2E Guest Bot", email });
    await form.honeypot().fill("https://spam.example", { force: true });
    await form.submit().click();
    await expect(form.sent()).toBeVisible();
    // Nothing was stored or queued (give a late write the time a real one takes).
    await page.waitForTimeout(2000);
    expect(await guestRegistration(event.id, email)).toBeNull();
    expect(await capturedEmails({ template: "guest_confirm", to: email })).toHaveLength(0);
  });
});
