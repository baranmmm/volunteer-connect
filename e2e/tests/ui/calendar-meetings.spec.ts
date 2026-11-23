// One calendar: meetings appear in the calendar for exactly the people who can see them, open their meeting page, and
// are created from the event form with the category "Meeting". Also the simpler event form (collapsed sections).
// Meetings live in a temporary branch with fresh users (fixtures remove them); every check looks at this test's ids.
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { MEETING_TITLE_PREFIX, createMeetingAs, inDays } from "../../api/work";
import { EVENT_TITLE_PREFIX, deleteEvents } from "../../api/events";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { CalendarPage } from "../../pages/CalendarPage";
import { EventPage } from "../../pages/EventPage";
import { EventFormDialog, type EventFormSection } from "../../pages/components/EventFormDialog";

let n = 0;
const meetingTitle = (label: string) => `${MEETING_TITLE_PREFIX}${runId} cal-${Date.now().toString(36)}-${++n} ${label}`;
const londonDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86400000));
async function eventOfMeeting(meetingId: string) {
  const { data, error } = await adminClient().from("meetings").select("event_id").eq("id", meetingId).single();
  expect(error).toBeNull();
  return data!.event_id as string;
}

test.describe("Meetings in the calendar", () => {
  test("an invited member sees the meeting in the calendar with the Meeting badge and opens the meeting; an uninvited member does not", { tag: "@smoke" }, async ({ freshUser, freshBranch, pageAs }) => {
    const branch = await freshBranch("cal-meeting");
    const manager = await freshUser({ role: "branch_manager", branch });
    const invitee = await freshUser({ role: "volunteer", branch });
    const outsider = await freshUser({ role: "volunteer", branch });
    const meetingId = await createMeetingAs(manager, { scope: "branch", branch_id: branch, title: meetingTitle("invite-only"), starts_at: inDays(5), ends_at: inDays(5, 1), invitee_ids: [invitee.id] });
    const eventId = await eventOfMeeting(meetingId);

    // The invitee: a calendar entry with the Meeting badge and no registration; "Open meeting" leads to the meeting.
    const page = await pageAs(invitee);
    const calendar = new CalendarPage(page);
    await calendar.goto("list");
    const card = calendar.card("list", eventId);
    await expect(card).toHaveAttribute("data-category", "meeting");
    await expect(card.getByTestId("event-meeting-badge")).toBeVisible();
    await card.click();
    const event = new EventPage(page);
    await expect(event.root()).toHaveAttribute("data-category", "meeting", { timeout: APP_LOAD_TIMEOUT });
    await expect(event.registration()).toHaveCount(0);
    await expect(event.editButton()).toHaveCount(0);
    await page.getByTestId("event-open-meeting").click();
    await expect(page).toHaveURL(new RegExp(`/meetings/${meetingId}$`));
    await expect(page.getByTestId("meeting-detail")).toHaveAttribute("data-meeting-id", meetingId, { timeout: APP_LOAD_TIMEOUT });

    // A member of the same branch who is not invited: not in the calendar, not by id.
    const other = await pageAs(outsider);
    const otherCalendar = new CalendarPage(other);
    await otherCalendar.goto("list");
    await expect(otherCalendar.card("list", eventId)).toHaveCount(0);
    const otherEvent = new EventPage(other);
    await otherEvent.goto(eventId);
    await expect(otherEvent.notFound()).toBeVisible();
  });

  test("the event form with the category Meeting creates the meeting with an invitee; its calendar entry is managed through the meeting", async ({ freshUser, freshBranch, pageAs }) => {
    test.setTimeout(90_000);
    const branch = await freshBranch("form-meeting");
    const manager = await freshUser({ role: "branch_manager", branch });
    const invitee = await freshUser({ role: "volunteer", branch });
    const title = meetingTitle("from event form");
    const page = await pageAs(manager);
    await page.goto("/calendar?view=list");
    await page.getByTestId("calendar-create-event-button").click({ timeout: APP_LOAD_TIMEOUT });
    const form = new EventFormDialog(page);
    await expect(form.root).toBeVisible();
    await form.chooseCategory("meeting");
    await expect(form.root).toHaveAttribute("data-mode", "meeting");
    for (const name of ["registration", "audience", "files"] as const) await expect(form.section(name)).toHaveCount(0);
    await form.title().fill(title);
    await form.setStart(`${londonDay(6)}T18:00`);
    await form.location().fill("E2E Meeting Room");
    await form.invite(invitee.id);
    await expect(form.root).toBeVisible();
    await form.publishButton().click();
    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}$/, { timeout: APP_LOAD_TIMEOUT });
    const meetingId = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.getByTestId("toast-success").last()).toBeVisible();
    const db = adminClient();
    const invited = await db.from("meeting_invitees").select("user_id").eq("meeting_id", meetingId);
    expect((invited.data ?? []).map((r) => r.user_id)).toEqual([invitee.id]);
    const eventId = await eventOfMeeting(meetingId);
    const entry = await db.from("events").select("category, title, audience, registration_enabled").eq("id", eventId).single();
    expect(entry.data).toEqual({ category: "meeting", title, audience: "members", registration_enabled: false });

    // On the calendar entry, Cancel / Reopen / Delete act on the meeting.
    const event = new EventPage(page);
    await event.goto(eventId);
    await expect(page.getByTestId("event-open-meeting")).toBeVisible();
    await page.getByTestId("event-cancel-event-button").click();
    await page.getByTestId("confirm-dialog-confirm-button").click();
    await expect(event.root()).toHaveAttribute("data-status", "cancelled");
    expect((await db.from("meetings").select("status").eq("id", meetingId).single()).data).toEqual({ status: "cancelled" });
    await page.getByTestId("event-reopen-meeting-button").click();
    await expect(event.root()).toHaveAttribute("data-status", "published");
    expect((await db.from("meetings").select("status").eq("id", meetingId).single()).data).toEqual({ status: "scheduled" });
    await event.deleteButton().click();
    await page.getByTestId("event-delete-confirm").click();
    await expect(page).toHaveURL(/\/calendar/);
    const deleted = await db.from("meetings").select("deleted_at").eq("id", meetingId).single();
    expect(deleted.data?.deleted_at).not.toBeNull();
  });
});

test.describe("Simpler event form", () => {
  test("sections start collapsed; a branch manager publishes with title, place and start only, with member defaults", async ({ freshUser, pageAs }) => {
    const manager = await freshUser({ role: "branch_manager" });
    const page = await pageAs(manager);
    await page.goto("/calendar?view=list");
    await page.getByTestId("calendar-create-event-button").click({ timeout: APP_LOAD_TIMEOUT });
    const form = new EventFormDialog(page);
    await expect(form.root).toBeVisible();
    for (const name of ["description", "registration", "audience", "files", "repeat"] as EventFormSection[]) {
      await expect(form.sectionToggle(name)).toHaveAttribute("aria-expanded", "false");
    }
    await expect(form.capacity()).toBeHidden();
    const title = `${EVENT_TITLE_PREFIX}simple-${Date.now()}`;
    await form.title().fill(title);
    await form.location().fill("E2E Simple Hall");
    await form.setStart(`${londonDay(7)}T18:00`);
    await form.publish();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    try {
      const { data } = await adminClient().from("events").select("status, category, audience, registration_enabled, capacity, organizer").eq("id", id).single();
      expect(data).toEqual({ status: "published", category: "dialogue", audience: "members", registration_enabled: true, capacity: null, organizer: "Dialogue Society" });
    } finally {
      await deleteEvents([id]);
    }
  });
});
