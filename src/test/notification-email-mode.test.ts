import { describe, expect, it } from "vitest";
import {
  IMPORTANT_EMAIL_TYPES,
  emailModeChanges,
  emailModeOf,
  emailOnFor,
  withEmailMode,
  withTypeChange,
} from "@/lib/notification-email-mode";
import { NOTIFICATION_TYPES, type NotificationSettings } from "@/lib/notifications";

const settings = (email: (type: string) => boolean): NotificationSettings => ({
  task_reminder_emails: email("task_reminder"),
  types: NOTIFICATION_TYPES.map((type) => ({
    type,
    enabled: true,
    email: email(type),
    push: false,
    locked: ["task_assigned", "mention", "review"].includes(type),
    email_timing: "immediate" as const,
  })),
});
const important = (type: string) => (IMPORTANT_EMAIL_TYPES as readonly string[]).includes(type);

describe("email mode", () => {
  it("important types are assignments, mentions, requests to review, meetings and task reminders", () => {
    expect([...IMPORTANT_EMAIL_TYPES].sort()).toEqual(
      ["meeting", "mention", "review", "task_assigned", "task_reminder"].sort(),
    );
    expect(emailOnFor("all", "task_note")).toBe(true);
    expect(emailOnFor("important", "task_note")).toBe(false);
    expect(emailOnFor("important", "meeting")).toBe(true);
    expect(emailOnFor("none", "task_assigned")).toBe(false);
  });

  it("derives the mode from the stored per-type values, else custom", () => {
    expect(emailModeOf(settings(() => true).types)).toBe("all");
    expect(emailModeOf(settings(important).types)).toBe("important");
    expect(emailModeOf(settings(() => false).types)).toBe("none");
    expect(emailModeOf(settings((t) => t === "task_note").types)).toBe("custom");
    expect(emailModeOf(settings((t) => important(t) && t !== "mention").types)).toBe("custom");
    expect(emailModeOf([])).toBe("custom");
    // A type off in the app still counts with its stored email switch.
    const off = settings(important);
    off.types = off.types.map((s) => (s.type === "task_note" ? { ...s, enabled: false } : s));
    expect(emailModeOf(off.types)).toBe("important");
  });

  it("a mode writes only the switches that differ", () => {
    const all = settings(() => true);
    expect(emailModeChanges(all.types, "all")).toEqual([]);
    expect(emailModeChanges(all.types, "important")).toEqual([
      { type: "task_status", on: false },
      { type: "task_note", on: false },
      { type: "request_decided", on: false },
    ]);
    // The post-event photo nudge ('media', email off by default) is outside the simple choice: never changed by it.
    expect(emailModeChanges(all.types, "none")).toHaveLength(NOTIFICATION_TYPES.length - 1);
    expect(emailModeChanges(all.types, "none").map((c) => c.type)).not.toContain("media");
    expect(
      emailModeChanges(settings(() => false).types, "important")
        .map((c) => c.type)
        .sort(),
    ).toEqual([...IMPORTANT_EMAIL_TYPES].sort());
  });

  it("the settings after a mode or one change match the mode, and task reminder emails follow", () => {
    const none = withEmailMode(
      settings(() => true),
      "none",
    );
    expect(emailModeOf(none.types)).toBe("none");
    expect(none.task_reminder_emails).toBe(false);
    const back = withEmailMode(none, "important");
    expect(emailModeOf(back.types)).toBe("important");
    expect(back.task_reminder_emails).toBe(true);
    const custom = withTypeChange(back, "task_note", { email: true });
    expect(emailModeOf(custom.types)).toBe("custom");
    // A push or in-app change keeps the email choice.
    expect(
      emailModeOf(withTypeChange(back, "task_note", { push: true, enabled: false }).types),
    ).toBe("important");
  });
});
