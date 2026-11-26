import { describe, expect, it } from "vitest";
import { notification, notificationSettings } from "@/lib/notifications";

// Migrations run before the code: a notice type or entity the database adds before this app version knows it must
// not break the settings screen or the bell.
describe("notices from a newer database", () => {
  const setting = (type: string) => ({
    type,
    enabled: true,
    email: true,
    push: false,
    locked: false,
    email_timing: "digest",
  });

  it("an unknown settings type is left out; the known ones stay", () => {
    const parsed = notificationSettings.parse({
      task_reminder_emails: true,
      types: [setting("meeting"), setting("some_future_type"), setting("request_decided")],
    });
    expect(parsed.types.map((t) => t.type)).toEqual(["meeting", "request_decided"]);
  });

  it("the Media notices (download decisions, post-event nudge) parse in the bell", () => {
    for (const entity_type of ["media_download_request", "event", "media_upload_request"])
      expect(
        notification.safeParse({
          id: "11111111-1111-4111-8111-111111111111",
          kind: "media_photo_nudge",
          entity_type,
          entity_id: "22222222-2222-4222-8222-222222222222",
          title: "Christmas Dinner",
          link: "/media",
          payload: { count: 2 },
          created_at: "2026-12-01T09:30:00Z",
          read_at: null,
          actor_name: null,
        }).success,
      ).toBe(true);
  });
});
