import { describe, expect, it } from "vitest";
import {
  absoluteAppLink,
  digestLines,
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
    expect(online.text).toContain("Where: Online");
    expect(online.text).not.toContain("Join online");
  });

  it("online events: the joining link only when the sender provides it (confirmed place), never in the .ics", () => {
    const link = "https://meet.example.org/room-42";
    const onlineEvent = { ...event, location_type: "online", location: "" };
    const confirmed = renderEmail(
      "registration_confirmed",
      guestCtx({ event: onlineEvent, onlineUrl: link }),
    );
    expect(confirmed.text).toContain(`Join online: ${link}`);
    expect(confirmed.html).toContain(`href="${link}"`);
    expect(confirmed.attachments[0]!.content).not.toContain("meet.example.org");
    const reminder = renderEmail(
      "event_reminder",
      guestCtx({ event: onlineEvent, onlineUrl: link }),
    );
    expect(reminder.text).toContain(`Join online: ${link}`);
    const waitlisted = renderEmail(
      "registration_confirmed",
      guestCtx({
        event: onlineEvent,
        registration: {
          id: REG,
          status: "waitlisted",
          places: 1,
          guest: true,
          waitlist_position: 2,
        },
      }),
    );
    expect(waitlisted.text).not.toContain("meet.example.org");
    expect(waitlisted.text).toContain("joining link when a place becomes available");
    const update = renderEmail("event_update", guestCtx({ event: onlineEvent, onlineUrl: link }));
    expect(update.text).not.toContain("meet.example.org");
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

  it("daily_digest lists the counts per kind and links to the app (English)", () => {
    const r = renderEmail("daily_digest", {
      origin: ORIGIN,
      toEmail: "bm@example.org",
      toName: "Ayse <b>",
      from: { email: "events@example.org" },
      payload: {
        count: 4,
        kinds: { task_status_changed: 2, meeting_changed: 1, some_new_kind: 1 },
        day: "2027-01-15",
      },
    });
    expect(r.subject).toBe("Your daily summary: 4 updates");
    expect(r.text).toContain("Hello Ayse <b>,");
    expect(r.html).toContain("Hello Ayse &lt;b&gt;,");
    expect(r.html).toContain('<html lang="en">');
    expect(r.text).toMatch(/summary of Friday,? 15 January/);
    const lines = r.text.split("\n");
    const first = lines.findIndex((l) =>
      l.includes("2 tasks you created were blocked or completed"),
    );
    expect(first).toBeGreaterThan(-1);
    expect(lines[first + 2]).toContain("1 meeting changed");
    expect(r.text).toContain("1 other update");
    expect(r.text).toContain(`${ORIGIN}/notifications`);
    expect(r.html).toContain(`href="${ORIGIN}/notifications"`);
    expect(r.text).toContain(`${ORIGIN}/profile#notifications`);
    expect(r.attachments).toEqual([]);
    expect(r.listUnsubscribe).toBeNull();
    expect(
      renderEmail("daily_digest", {
        origin: ORIGIN,
        toEmail: "bm@example.org",
        from: { email: "events@example.org" },
        payload: { count: 1, kinds: { task_request_accepted: 1 }, day: "2027-01-15" },
      }).subject,
    ).toBe("Your daily summary: 1 update");
  });

  it("daily_digest in Turkish for a member who prefers Turkish", () => {
    const r = renderEmail("daily_digest", {
      origin: ORIGIN,
      toEmail: "bm@example.org",
      toName: "Ayşe",
      from: { email: "events@example.org" },
      language: "tr",
      payload: {
        count: 3,
        kinds: { meeting_cancelled: 1, task_request_declined: 2 },
        day: "2027-01-15",
      },
    });
    expect(r.subject).toBe("Günlük özetiniz: 3 güncelleme");
    expect(r.html).toContain('<html lang="tr">');
    expect(r.text).toContain("Merhaba Ayşe,");
    expect(r.text).toContain("1 toplantı iptal edildi");
    expect(r.text).toContain("2 görev isteğiniz reddedildi");
    expect(r.text).toMatch(/15 Ocak/);
    expect(r.text).toContain("Bildirimlerimi aç: " + `${ORIGIN}/notifications`);
    expect(digestLines({ task_status_changed: 1 }, "tr")).toEqual([
      "Oluşturduğunuz 1 görev engellendi veya tamamlandı",
    ]);
  });

  it("daily_digest has one stop link per notice type in it", () => {
    const r = renderEmail("daily_digest", {
      origin: ORIGIN,
      toEmail: "bm@example.org",
      from: { email: "events@example.org" },
      payload: {
        count: 2,
        kinds: { task_status_changed: 1, task_note_mention: 1 },
        day: "2027-01-15",
      },
      links: {
        typeUnsubscribe: {
          task_status: `${ORIGIN}/e/notices?t=a`,
          mention: `${ORIGIN}/e/notices?t=b`,
        },
      },
    });
    expect(r.text).toContain(
      `Stop emails for “A task I created is blocked or done”: ${ORIGIN}/e/notices?t=a`,
    );
    expect(r.text).toContain(`Stop emails for “I am mentioned in a note”: ${ORIGIN}/e/notices?t=b`);
    expect(r.text).toContain("1 mention of you in a note");
  });

  const noticeCtx = (over: Partial<RenderContext> = {}): RenderContext => ({
    origin: ORIGIN,
    toEmail: "v@example.org",
    toName: "Vol",
    from: { email: "events@example.org" },
    payload: { type: "task_assigned" },
    notice: {
      kind: "task_assigned",
      title: "Book <the> hall",
      link: "/tasks?task=abc",
      payload: {},
      actor_name: "Ayşe",
    },
    links: {
      noticeUnsubscribe: `${ORIGIN}/e/notices?t=tok`,
      noticeUnsubscribeOneClick: `${ORIGIN}/api/public/notice-unsubscribe?t=tok`,
    },
    ...over,
  });

  it("notice: a task assignment links to the task, says why, and has the stop link and List-Unsubscribe", () => {
    const r = renderEmail("notice", noticeCtx());
    expect(r.subject).toBe("New task: Book <the> hall");
    expect(r.html).toContain("Book &lt;the&gt; hall");
    expect(r.html).toContain('<html lang="en">');
    expect(r.html).toContain("<h1");
    expect(r.text).toContain("Ayşe assigned you a task:");
    expect(r.text).toContain(`Open the task: ${ORIGIN}/tasks?task=abc`);
    expect(r.text).toContain("emails for “A task is assigned to me” are on");
    expect(r.text).toContain(`Stop these emails: ${ORIGIN}/e/notices?t=tok`);
    expect(r.text).toContain(`Notification settings: ${ORIGIN}/profile#notifications`);
    expect(r.listUnsubscribe).toEqual({
      url: `${ORIGIN}/e/notices?t=tok`,
      oneClick: `${ORIGIN}/api/public/notice-unsubscribe?t=tok`,
    });
  });

  it("notice in Turkish: meeting invitation with the time, review waiting with the count", () => {
    const meeting = renderEmail(
      "notice",
      noticeCtx({
        language: "tr",
        payload: { type: "meeting" },
        notice: {
          kind: "meeting_invited",
          title: "Şube toplantısı",
          link: "/meetings/m1",
          payload: { starts_at: "2027-02-01T18:00:00Z" },
          actor_name: "Ayşe",
        },
      }),
    );
    expect(meeting.subject).toBe("Toplantı daveti: Şube toplantısı");
    expect(meeting.html).toContain('<html lang="tr">');
    expect(meeting.text).toContain("Merhaba Vol,");
    expect(meeting.text).toContain("Ayşe sizi bir toplantıya davet etti:");
    expect(meeting.text).toMatch(/Ne zaman: .*1 Şubat 2027.*18:00 \(Birleşik Krallık saati\)/);
    expect(meeting.text).toContain(`Toplantıyı aç: ${ORIGIN}/meetings/m1`);
    expect(meeting.text).toContain(`Bu e-postaları durdur: ${ORIGIN}/e/notices?t=tok`);
    expect(meeting.text).toContain("“Davet edildiğim toplantılar");
    const review = renderEmail(
      "notice",
      noticeCtx({
        payload: { type: "review" },
        notice: {
          kind: "review_waiting",
          title: "",
          link: "/requests?tab=review",
          payload: { total: 3, branches: ["Medway", "Brighton"] },
          actor_name: null,
        },
      }),
    );
    expect(review.subject).toBe("3 requests are waiting for your review");
    expect(review.text).toContain(
      "3 requests from Medway and Brighton are waiting for your decision.",
    );
    expect(review.text).toContain(`Open To review: ${ORIGIN}/requests?tab=review`);
  });

  it("task_reminder in Turkish with its stop link", () => {
    const r = renderEmail("task_reminder", {
      origin: ORIGIN,
      toEmail: "v@example.org",
      from: { email: "events@example.org" },
      language: "tr",
      payload: {
        task_title: "Salonu ayırt",
        due_date: "2027-06-01",
        link: "/tasks?task=abc",
        reminder: "overdue",
      },
      links: { noticeUnsubscribe: `${ORIGIN}/e/notices?t=tok` },
    });
    expect(r.subject).toBe("Süresi geçen görev: Salonu ayırt");
    expect(r.text).toMatch(/1 Haziran 2027/);
    expect(r.text).toContain(`Görevi aç: ${ORIGIN}/tasks?task=abc`);
    expect(r.text).toContain(`Bu e-postaları durdur: ${ORIGIN}/e/notices?t=tok`);
  });

  it("notice: a mention links to the note (EN and TR)", () => {
    const mention = (language: "en" | "tr") =>
      renderEmail(
        "notice",
        noticeCtx({
          language,
          payload: { type: "mention" },
          notice: {
            kind: "task_note_mention",
            title: "Book the hall",
            link: "/tasks?task=abc&note=n1",
            payload: {},
            actor_name: "Ayşe",
          },
        }),
      );
    const en = mention("en");
    expect(en.subject).toBe("You were mentioned: Book the hall");
    expect(en.text).toContain("Ayşe mentioned you in a note on this task:");
    expect(en.text).toContain(`Open the note: ${ORIGIN}/tasks?task=abc&note=n1`);
    expect(en.text).toContain("emails for “I am mentioned in a note” are on");
    const tr = mention("tr");
    expect(tr.subject).toBe("Sizden bahsedildi: Book the hall");
    expect(tr.text).toContain(`Notu aç: ${ORIGIN}/tasks?task=abc&note=n1`);
  });

  it("notice refuses a missing notice", () => {
    expect(() => renderEmail("notice", noticeCtx({ notice: null }))).toThrow();
  });

  it("daily_digest refuses an empty summary", () => {
    const ctx = {
      origin: ORIGIN,
      toEmail: "bm@example.org",
      from: { email: "events@example.org" },
    };
    expect(() =>
      renderEmail("daily_digest", { ...ctx, payload: { count: 0, kinds: {} } }),
    ).toThrow();
    expect(() => renderEmail("daily_digest", { ...ctx, payload: {} })).toThrow();
  });

  it("throws when the context is incomplete", () => {
    expect(() => renderEmail("guest_confirm", guestCtx({ links: {} }))).toThrow();
    expect(() => renderEmail("event_reminder", guestCtx({ event: null }))).toThrow();
  });
});
