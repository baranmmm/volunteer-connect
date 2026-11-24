import { describe, expect, it } from "vitest";
import {
  absoluteAppLink,
  escapeHtml,
  renderEmail,
  type EmailEvent,
  type RenderContext,
} from "@/lib/email/templates";

const ORIGIN = "https://hub.example.org";
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const REG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const event: EmailEvent = {
  id: EVENT_ID,
  title: "Dinner <script>alert(1)</script> & talk",
  description: "Bring a friend",
  location: "Hall 1",
  location_type: "in_person",
  location_tba: false,
  all_day: false,
  start_at: "2027-06-01T17:00:00Z",
  end_at: "2027-06-01T19:00:00Z",
  start_date: null,
  end_date: null,
  ics_sequence: 0,
  status: "published",
  branch: "Camden",
};
const now = new Date("2027-05-01T10:00:00Z");
const guestCtx = (over: Partial<RenderContext> = {}): RenderContext => ({
  origin: ORIGIN,
  toEmail: "guest@example.org",
  toName: "Ada <b>",
  from: { email: "events@example.org", name: "Dialogue Society" },
  event,
  registration: { id: REG, status: "registered", places: 2, guest: true, waitlist_position: null },
  links: {
    guestConfirm: `${ORIGIN}/e/confirm?t=confirm-token`,
    guestCancel: `${ORIGIN}/e/cancel?t=cancel-token`,
  },
  now,
  ...over,
});

describe("email templates", () => {
  it("guest_confirm links to /e/confirm and says 48 hours", () => {
    const r = renderEmail(
      "guest_confirm",
      guestCtx({
        registration: {
          id: REG,
          status: "pending",
          places: 1,
          guest: true,
          waitlist_position: null,
        },
      }),
    );
    expect(r.subject).toContain("Confirm your registration");
    expect(r.text).toContain(`${ORIGIN}/e/confirm?t=confirm-token`);
    expect(r.html).toContain(`href="${ORIGIN}/e/confirm?t=confirm-token"`);
    expect(r.text).toContain("48 hours");
    expect(r.attachments).toHaveLength(0);
  });

  it("escapes user text in HTML and keeps it readable in text", () => {
    const r = renderEmail(
      "registration_confirmed",
      guestCtx({ payload: { status: "registered" } }),
    );
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain(escapeHtml(event.title));
    expect(r.html).toContain("Hello Ada &lt;b&gt;,");
    expect(r.text).toContain(event.title);
    expect(r.html).not.toMatch(/<img/i);
    expect(r.html).toContain("#008AC4");
  });

  it("registered guests get an .ics invite, the cancel link and London times", () => {
    const r = renderEmail(
      "registration_confirmed",
      guestCtx({ payload: { status: "registered" } }),
    );
    expect(r.subject).toMatch(/^You're registered/);
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0]!.name).toBe("invite.ics");
    expect(r.attachments[0]!.content).toContain("METHOD:REQUEST");
    expect(r.attachments[0]!.content).toContain(`UID:${REG}@dialoguesociety-hub`);
    expect(r.text).toContain(`${ORIGIN}/e/cancel?t=cancel-token`);
    // 17:00 UTC in June is 18:00 in London.
    expect(r.text).toContain("18:00 – 20:00 (UK time)");
    expect(r.text).toContain("Places: 2");
  });

  it("waitlisted confirmations show the position and carry no .ics", () => {
    const r = renderEmail(
      "registration_confirmed",
      guestCtx({
        registration: {
          id: REG,
          status: "waitlisted",
          places: 1,
          guest: true,
          waitlist_position: 3,
        },
        payload: { status: "waitlisted" },
      }),
    );
    expect(r.subject).toMatch(/waiting list/);
    expect(r.text).toContain("number 3 on the waiting list");
    expect(r.attachments).toHaveLength(0);
  });

  it("promoted and resent variants", () => {
    expect(
      renderEmail("registration_confirmed", guestCtx({ payload: { promoted: true } })).subject,
    ).toMatch(/place is now available/);
    expect(
      renderEmail("registration_confirmed", guestCtx({ payload: { resent: true } })).text,
    ).toContain("details again");
  });

  it("members link to the event in the app and never get a guest cancel link", () => {
    const r = renderEmail(
      "registration_confirmed",
      guestCtx({
        registration: {
          id: REG,
          status: "registered",
          places: 1,
          guest: false,
          waitlist_position: null,
        },
        links: {},
      }),
    );
    expect(r.text).toContain(`${ORIGIN}/events/${EVENT_ID}`);
    expect(r.text).not.toContain("/e/cancel");
  });

  it("no cancel link once the event has started", () => {
    const r = renderEmail("event_reminder", guestCtx({ now: new Date("2027-06-01T18:00:00Z") }));
    expect(r.text).not.toContain("/e/cancel");
    expect(renderEmail("event_reminder", guestCtx()).text).toContain("/e/cancel");
  });

  it("TBA and online places, never an online link", () => {
    const tba = renderEmail(
      "registration_confirmed",
      guestCtx({ event: { ...event, location_tba: true, location: "" } }),
    );
    expect(tba.text).toContain("Where: To be announced");
    const online = renderEmail(
      "registration_confirmed",
      guestCtx({ event: { ...event, location_type: "online", location: "" } }),
    );
    expect(online.text).toContain("Online — the organisers will share the joining details");
  });

  it("event_update: location announced, same UID, current sequence", () => {
    const r = renderEmail(
      "event_update",
      guestCtx({ event: { ...event, ics_sequence: 2 }, payload: { location_announced: true } }),
    );
    expect(r.subject).toMatch(/^Location announced/);
    expect(r.attachments[0]!.content).toContain("SEQUENCE:2");
    expect(r.attachments[0]!.content).toContain(`UID:${REG}@dialoguesociety-hub`);
    const plain = renderEmail("event_update", guestCtx({ payload: { location_announced: false } }));
    expect(plain.subject).toMatch(/^Event update/);
  });

  it("cancellations attach METHOD:CANCEL (the sequence passed in already includes the attendee offset)", () => {
    const own = renderEmail(
      "registration_cancelled",
      guestCtx({
        event: { ...event, ics_sequence: 2 },
        registration: {
          id: REG,
          status: "cancelled",
          places: 1,
          guest: true,
          waitlist_position: null,
        },
      }),
    );
    expect(own.attachments[0]!.content).toContain("METHOD:CANCEL");
    expect(own.attachments[0]!.content).toContain("SEQUENCE:2");
    expect(own.text).not.toContain("/e/cancel");
    const ev = renderEmail(
      "event_cancelled",
      guestCtx({ event: { ...event, status: "cancelled", ics_sequence: 3 } }),
    );
    expect(ev.attachments[0]!.content).toContain("SEQUENCE:3");
    expect(ev.attachments[0]!.content).toContain("STATUS:CANCELLED");
    expect(ev.text).not.toContain("/e/cancel");
  });

  it("subscriber_confirm and announcements (unsubscribe link + header)", () => {
    const confirm = renderEmail("subscriber_confirm", {
      origin: ORIGIN,
      toEmail: "s@example.org",
      from: { email: "events@example.org" },
      links: { subscriberConfirm: `${ORIGIN}/updates/confirm?t=s-token` },
    });
    expect(confirm.text).toContain(`${ORIGIN}/updates/confirm?t=s-token`);
    const a = renderEmail("event_announcement", {
      origin: ORIGIN,
      toEmail: "s@example.org",
      from: { email: "events@example.org" },
      event,
      links: {
        unsubscribe: `${ORIGIN}/updates/unsubscribe?t=u`,
        unsubscribeOneClick: `${ORIGIN}/api/public/unsubscribe?t=u`,
      },
    });
    expect(a.text).toContain(`${ORIGIN}/events/${EVENT_ID}`);
    expect(a.text).toContain(`${ORIGIN}/updates/unsubscribe?t=u`);
    expect(a.html).toContain(`href="${ORIGIN}/updates/unsubscribe?t=u"`);
    expect(a.listUnsubscribe).toEqual({
      url: `${ORIGIN}/updates/unsubscribe?t=u`,
      oneClick: `${ORIGIN}/api/public/unsubscribe?t=u`,
    });
    expect(a.attachments).toHaveLength(0);
  });

  it("task_reminder makes the app path absolute", () => {
    const r = renderEmail("task_reminder", {
      origin: ORIGIN,
      toEmail: "v@example.org",
      toName: "Vol",
      from: { email: "events@example.org" },
      payload: {
        task_title: "Book the hall",
        due_date: "2027-06-01",
        link: "/tasks?task=abc",
        reminder: "overdue",
      },
    });
    expect(r.subject).toBe("Overdue task: Book the hall");
    expect(r.text).toContain(`${ORIGIN}/tasks?task=abc`);
    expect(r.text).toMatch(/Tuesday,? 1 June 2027/);
    expect(absoluteAppLink(ORIGIN, "//evil.example")).toBe(`${ORIGIN}/dashboard`);
    expect(absoluteAppLink(ORIGIN, "https://evil.example")).toBe(`${ORIGIN}/dashboard`);
  });

  it("throws when the context is incomplete", () => {
    expect(() => renderEmail("guest_confirm", guestCtx({ links: {} }))).toThrow();
    expect(() => renderEmail("event_reminder", guestCtx({ event: null }))).toThrow();
  });
});
