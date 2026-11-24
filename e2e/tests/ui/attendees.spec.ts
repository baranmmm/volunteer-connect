// Attendee list on public events: members and confirmed guests together for the scope managers, check-in once the
// event has started, CSV export. National Coordinators see counts only.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { addConfirmedGuest, createNationalEventAdmin, deleteEvents, startEventMinutesAgo } from "../../api/events";
import { registerAs } from "../../api/registrations";
import { emailDomain } from "../../setup/env";
import { EventPage } from "../../pages/EventPage";

const guestEmail = () => `e2e-guest-${runId}-att-${randomUUID().slice(0, 8)}@${emailDomain()}`;

test.describe("Attendee list", () => {
  test("a branch manager sees a member and a guest together, checks them in after the start and exports both to CSV", { tag: "@smoke" }, async ({ freshUser, freshEvent, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const member = await freshUser({ role: "volunteer" });
    const event = await freshEvent(manager, { label: "attendees", status: "published", startInMinutes: 3 * 24 * 60, audience: "public", maxPlaces: 3 });
    const mine = await registerAs(member.email, event.id);
    const email = guestEmail();
    const guest = await addConfirmedGuest(event.id, { name: `E2E Guest ${runId}`, email, phone: "07700 900123", places: 2 });
    expect(guest.status).toBe("registered");
    await startEventMinutesAgo(event.id, 10);

    const page = await pageAs(manager);
    const detail = new EventPage(page);
    await detail.goto(event.id);
    await expect(detail.attendeesTable()).toBeVisible();
    const memberRow = detail.attendeeRow(mine.registration_id), guestRow = detail.attendeeRow(guest.registrationId);
    await expect(memberRow).toHaveAttribute("data-kind", "member");
    await expect(guestRow).toHaveAttribute("data-kind", "guest");
    await expect(guestRow.getByTestId("attendees-row-places")).toHaveText("2");
    await expect(page.getByTestId("attendees-counts")).toContainText("3");

    // Check-in (the event has started) and undo.
    await detail.attendeeCheckIn(guest.registrationId).click();
    await expect(guestRow).toHaveAttribute("data-status", "attended");
    await detail.attendeeCheckIn(mine.registration_id).click();
    await expect(memberRow).toHaveAttribute("data-status", "attended");
    await detail.attendeeCheckIn(mine.registration_id).click();
    await expect(memberRow).toHaveAttribute("data-status", "registered");
    const rows = await adminClient().from("event_registrations").select("id, status").in("id", [mine.registration_id, guest.registrationId]);
    expect(Object.fromEntries(rows.data!.map((r) => [r.id, r.status]))).toEqual({ [mine.registration_id]: "registered", [guest.registrationId]: "attended" });

    // CSV: both rows, a BOM, every cell quoted.
    const download = page.waitForEvent("download");
    await detail.attendeesExportCsv().click();
    const file = await (await download).path();
    const csv = await readFile(file!, "utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`"${member.fullName}","member","${member.email}"`);
    expect(csv).toContain(`"E2E Guest ${runId}","guest","${email}","07700 900123","2","attended"`);
  });

  test("a National Coordinator sees counts only, never the attendee table", async ({ freshUser, pageAs }) => {
    const nc = await freshUser({ role: "national_coordinator" });
    const id = await createNationalEventAdmin(nc.id, { title: `E2E Event ${runId} national attendees`, status: "published", startInMinutes: 3 * 24 * 60, audience: "public" });
    try {
      await addConfirmedGuest(id, { name: `E2E Guest ${runId}`, email: guestEmail() });
      const page = await pageAs(nc);
      const detail = new EventPage(page);
      await detail.goto(id);
      await expect(detail.registrationCount()).toBeVisible();
      await expect(detail.editButton()).toBeVisible();
      await expect(detail.attendees()).toHaveCount(0);
      await expect(detail.managerRegistrations()).toHaveCount(0);
    } finally {
      await deleteEvents([id]);
    }
  });
});
