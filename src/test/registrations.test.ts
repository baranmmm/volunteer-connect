import { afterEach, describe, expect, it } from "vitest";
import i18n, { setLanguage } from "@/lib/i18n";
import {
  registrationAction,
  registrationBadge,
  registrationCountText,
  registrationsCsv,
  type ManagerRegistration,
} from "@/lib/registrations";

afterEach(() => setLanguage("en"));
const now = new Date("2027-01-10T12:00:00Z");
const event = {
  status: "published",
  registration_enabled: true,
  all_day: false,
  start_at: "2027-01-12T18:00:00Z",
  end_at: "2027-01-12T20:00:00Z",
  start_date: null,
  end_date: null,
};
const none = { my_status: null, capacity: 30, registered_count: 12 };

describe("registration helpers", () => {
  it("count text: limited, unlimited, waitlist (EN/TR)", () => {
    expect(
      registrationCountText({ capacity: 30, registered_count: 12, waitlisted_count: 3 }, i18n.t),
    ).toBe("12 / 30 registered · 3 on waitlist");
    expect(
      registrationCountText({ capacity: null, registered_count: 12, waitlisted_count: 0 }, i18n.t),
    ).toBe("12 registered");
    setLanguage("tr");
    expect(
      registrationCountText({ capacity: 30, registered_count: 12, waitlisted_count: 3 }, i18n.t),
    ).toBe("12 / 30 kayıtlı · bekleme listesinde 3 kişi");
  });
  it("badge state", () => {
    expect(registrationBadge("registered")).toBe("registered");
    expect(registrationBadge("attended")).toBe("registered");
    expect(registrationBadge("waitlisted")).toBe("waitlisted");
    expect(registrationBadge("cancelled")).toBeNull();
    expect(registrationBadge(undefined)).toBeNull();
  });
  it("action: register, waitlist when full, cancel when registered; hidden with a reason otherwise", () => {
    expect(registrationAction(event, none, now)).toEqual({ kind: "register" });
    expect(registrationAction(event, { ...none, registered_count: 30 }, now)).toEqual({
      kind: "waitlist",
    });
    expect(registrationAction(event, { ...none, my_status: "waitlisted" }, now)).toEqual({
      kind: "cancel",
    });
    expect(registrationAction({ ...event, status: "cancelled" }, none, now)).toEqual({
      kind: "none",
      reason: "cancelled",
    });
    expect(registrationAction({ ...event, registration_enabled: false }, none, now)).toEqual({
      kind: "none",
      reason: "closed",
    });
    expect(registrationAction(event, none, new Date("2027-01-12T21:00:00Z"))).toEqual({
      kind: "none",
      reason: "past",
    });
    expect(
      registrationAction(
        event,
        { ...none, my_status: "registered" },
        new Date("2027-01-12T19:00:00Z"),
      ),
    ).toEqual({ kind: "none", reason: "started" });
    // All-day events end at the end of their London day (BST in June).
    const allDay = {
      ...event,
      all_day: true,
      start_at: null,
      end_at: null,
      start_date: "2027-06-10",
      end_date: "2027-06-10",
    };
    expect(registrationAction(allDay, none, new Date("2027-06-10T22:59:00Z"))).toEqual({
      kind: "register",
    });
    expect(registrationAction(allDay, none, new Date("2027-06-10T23:00:00Z"))).toEqual({
      kind: "none",
      reason: "past",
    });
    // …and start at London midnight: registered volunteers can cancel until 23:00Z the day before.
    expect(
      registrationAction(
        allDay,
        { ...none, my_status: "registered" },
        new Date("2027-06-09T22:59:00Z"),
      ),
    ).toEqual({ kind: "cancel" });
    expect(
      registrationAction(
        allDay,
        { ...none, my_status: "registered" },
        new Date("2027-06-09T23:00:00Z"),
      ),
    ).toEqual({ kind: "none", reason: "started" });
  });
  it("CSV: name, e-mail, status, registered_at, attendance only; quoted and formula-safe", () => {
    const row: ManagerRegistration = {
      id: "r1",
      user_id: "u1",
      full_name: '=HYPERLINK("x")',
      email: "a@example.org",
      status: "attended",
      show_name: true,
      registered_at: "2027-01-01T10:00:00Z",
      cancelled_at: null,
      attendance_marked_at: null,
      attendance_marked_by_name: null,
      waitlist_position: null,
    };
    const csv = registrationsCsv([
      row,
      { ...row, id: "r2", full_name: 'Ayşe "A" Yılmaz', status: "waitlisted" },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "name,email,status,registered_at,attendance",
      `"'=HYPERLINK(""x"")","a@example.org","attended","2027-01-01T10:00:00Z","attended"`,
      `"Ayşe ""A"" Yılmaz","a@example.org","waitlisted","2027-01-01T10:00:00Z",""`,
      "",
    ]);
    expect(csv).not.toContain("phone");
  });
});
