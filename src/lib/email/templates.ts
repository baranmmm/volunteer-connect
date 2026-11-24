// Email templates (server-rendered, English only; not i18n keys). Pure: the sender passes every link and the clock.
// Each email has a branded HTML part (inline CSS, table layout, no remote images) and a plain-text part. All text that
// comes from people (event titles, descriptions, names, places) is escaped in HTML.
import { eventStart, eventWhen } from "@/lib/event-rules";
import { eventPlace, registrationIcs, type IcsEvent } from "./ics";

export type EmailTemplate =
  | "guest_confirm"
  | "registration_confirmed"
  | "event_update"
  | "event_reminder"
  | "registration_cancelled"
  | "event_cancelled"
  | "subscriber_confirm"
  | "event_announcement"
  | "task_reminder";

export const EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  "guest_confirm",
  "registration_confirmed",
  "event_update",
  "event_reminder",
  "registration_cancelled",
  "event_cancelled",
  "subscriber_confirm",
  "event_announcement",
  "task_reminder",
];
export const isEmailTemplate = (value: string): value is EmailTemplate =>
  (EMAIL_TEMPLATES as readonly string[]).includes(value);

export type EmailEvent = IcsEvent & { branch?: string | null; region?: string | null };
export type EmailRegistration = {
  id: string;
  status: string;
  places: number;
  guest: boolean;
  waitlist_position: number | null;
};

export type RenderContext = {
  /** Absolute app origin, e.g. https://hub.example.org (no trailing slash). */
  origin: string;
  toEmail: string;
  toName?: string | null;
  /** The sender address and name (ORGANIZER in calendar attachments). */
  from: { email: string; name?: string | null };
  payload?: Record<string, unknown>;
  event?: EmailEvent | null;
  registration?: EmailRegistration | null;
  /**
   * The online meeting link, set by the sender only for confirmation and reminder emails to people who hold a place
   * (members, and guests who confirmed their email) on a published online event. Never in calendar files or
   * announcements.
   */
  onlineUrl?: string | null;
  /** Signed links, built by the sender. */
  links?: {
    guestConfirm?: string;
    guestCancel?: string;
    subscriberConfirm?: string;
    unsubscribe?: string;
    /** One-click unsubscribe endpoint for the List-Unsubscribe header. */
    unsubscribeOneClick?: string;
  };
  now?: Date;
};

export type EmailAttachment = { name: string; contentType: string; content: string };
export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
  /** List-Unsubscribe target (announcements only). */
  listUnsubscribe?: { url: string; oneClick?: string | undefined } | null | undefined;
};

const BLUE = "#008AC4";
const SLATE = "#28303D";
const MUTED = "#5B6472";
const BG = "#F3F6F9";
const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) links reach an href (everything is escaped as an attribute). */
function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

/** "Event" when the title is empty; long titles are shortened for subject lines (no newlines). */
function subjectTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim() || "Event";
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

export function eventWhenText(event: EmailEvent): string {
  const when = eventWhen(event, "en-GB");
  if (!when) return "Date to be confirmed";
  return when.allDay ? when.text : `${when.text} (UK time)`;
}

function eventStarted(event: EmailEvent, now: Date): boolean {
  const start = eventStart(event);
  if (!start) return false;
  // All-day events count as started from the London start date onwards.
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
    return start <= today;
  }
  return Date.parse(start) <= now.getTime();
}

function londonDay(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

const eventUrl = (origin: string, event: { id: string }) => `${origin}/events/${event.id}`;

/** An app path from a notification (e.g. /tasks?task=…) as an absolute link on this origin. */
export function absoluteAppLink(origin: string, link: unknown): string {
  if (
    typeof link === "string" &&
    link.startsWith("/") &&
    !link.startsWith("//") &&
    !/[\s\\]/.test(link)
  )
    return `${origin}${link}`;
  return `${origin}/dashboard`;
}

// ─── Building blocks ─────────────────────────────────────────────────────────────────────────────────────────────

type Block =
  | { kind: "p"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "event"; event: EmailEvent; places?: number | null }
  | { kind: "button"; label: string; url: string }
  | { kind: "link"; label: string; url: string }
  | { kind: "note"; text: string };

type Layout = {
  subject: string;
  preheader: string;
  heading: string;
  blocks: Block[];
  footer: string[];
  footerLinks?: { label: string; url: string }[];
};

function htmlParagraphs(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

function eventCardHtml(event: EmailEvent, places?: number | null): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:${MUTED};font-size:13px;vertical-align:top;white-space:nowrap;">${label}</td>` +
    `<td style="padding:4px 0;color:${SLATE};font-size:14px;vertical-align:top;">${htmlParagraphs(value)}</td></tr>`;
  const rows = [row("When", eventWhenText(event)), row("Where", eventPlace(event))];
  if (event.branch) rows.push(row("Hosted by", `Dialogue Society ${event.branch}`));
  if (places && places > 1) rows.push(row("Places", String(places)));
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-left:4px solid ${BLUE};background:#F7FBFD;">` +
    `<tr><td style="padding:14px 16px;">` +
    `<div style="font-size:17px;font-weight:600;color:${SLATE};margin:0 0 8px;">${escapeHtml(event.title)}</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0">${rows.join("")}</table>` +
    `</td></tr></table>`
  );
}

function eventCardText(event: EmailEvent, places?: number | null): string {
  const lines = [event.title, `When: ${eventWhenText(event)}`, `Where: ${eventPlace(event)}`];
  if (event.branch) lines.push(`Hosted by: Dialogue Society ${event.branch}`);
  if (places && places > 1) lines.push(`Places: ${places}`);
  return lines.join("\n");
}

function blockHtml(block: Block): string {
  switch (block.kind) {
    case "p":
      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${SLATE};">${htmlParagraphs(block.text)}</p>`;
    case "strong":
      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${SLATE};font-weight:600;">${htmlParagraphs(block.text)}</p>`;
    case "note":
      return `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:${MUTED};">${htmlParagraphs(block.text)}</p>`;
    case "event":
      return eventCardHtml(block.event, block.places);
    case "button":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr>` +
        `<td style="border-radius:6px;background:${BLUE};">` +
        `<a href="${escapeHtml(safeUrl(block.url))}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px;">${escapeHtml(block.label)}</a>` +
        `</td></tr></table>`
      );
    case "link":
      return `<p style="margin:0 0 14px;font-size:14px;line-height:1.5;"><a href="${escapeHtml(safeUrl(block.url))}" style="color:${BLUE};text-decoration:underline;">${escapeHtml(block.label)}</a></p>`;
  }
}

function blockText(block: Block): string {
  switch (block.kind) {
    case "p":
    case "strong":
    case "note":
      return block.text;
    case "event":
      return eventCardText(block.event, block.places);
    case "button":
    case "link":
      return `${block.label}: ${block.url}`;
  }
}

function layoutHtml(layout: Layout): string {
  const footerLinks = (layout.footerLinks ?? [])
    .map(
      (l) =>
        `<a href="${escapeHtml(safeUrl(l.url))}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(l.label)}</a>`,
    )
    .join(" &middot; ");
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>${escapeHtml(layout.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${BG};font-family:${FONT};color:${SLATE};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(layout.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:8px;border-top:4px solid ${BLUE};">` +
    `<tr><td style="padding:22px 28px 6px;font-family:${FONT};">` +
    `<span style="font-size:20px;font-weight:700;letter-spacing:-0.2px;color:${BLUE};">Dialogue</span>` +
    `<span style="font-size:20px;font-weight:700;letter-spacing:-0.2px;color:${SLATE};"> Society</span>` +
    `</td></tr>` +
    `<tr><td style="padding:10px 28px 8px;font-family:${FONT};">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:${SLATE};">${escapeHtml(layout.heading)}</h1>` +
    layout.blocks.map(blockHtml).join("") +
    `</td></tr>` +
    `<tr><td style="padding:16px 28px 24px;border-top:1px solid #E3E8EE;font-family:${FONT};">` +
    layout.footer
      .map(
        (f) =>
          `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${MUTED};">${htmlParagraphs(f)}</p>`,
      )
      .join("") +
    (footerLinks
      ? `<p style="margin:6px 0 0;font-size:12px;line-height:1.5;color:${MUTED};">${footerLinks}</p>`
      : "") +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

function layoutText(layout: Layout): string {
  const parts = [
    "Dialogue Society",
    "",
    layout.heading,
    "",
    ...layout.blocks.flatMap((b) => [blockText(b), ""]),
  ];
  parts.push(
    "--",
    ...layout.footer,
    ...(layout.footerLinks ?? []).map((l) => `${l.label}: ${l.url}`),
  );
  return (
    parts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

// ─── Templates ───────────────────────────────────────────────────────────────────────────────────────────────────

const GUEST_FOOTER =
  "You are receiving this email because this address was used to register for a Dialogue Society event.";
const MEMBER_FOOTER =
  "You are receiving this email because you registered for this event in the Dialogue Society Volunteer Hub.";

function greeting(name?: string | null): string {
  const first = name?.trim();
  return first ? `Hello ${first},` : "Hello,";
}

function requireEvent(ctx: RenderContext): EmailEvent {
  if (!ctx.event) throw new Error("Email context missing");
  return ctx.event;
}
function requireRegistration(ctx: RenderContext): EmailRegistration {
  if (!ctx.registration) throw new Error("Email context missing");
  return ctx.registration;
}

/** The online joining link (only when the sender provided one for this person). */
function joinBlocks(ctx: RenderContext): Block[] {
  if (!ctx.onlineUrl) return [];
  return [
    { kind: "button", label: "Join online", url: ctx.onlineUrl },
    { kind: "note", text: "This joining link is for you. Please do not share it." },
  ];
}

/** Guests manage their registration with the signed cancel link (until the start); members in the app. */
function manageBlocks(
  ctx: RenderContext,
  event: EmailEvent,
  registration: EmailRegistration,
  now: Date,
): Block[] {
  const url = eventUrl(ctx.origin, event);
  if (!registration.guest) {
    return [
      { kind: "link", label: "View the event in the Volunteer Hub", url },
      {
        kind: "note",
        text: "You can cancel your registration on the event page in the Volunteer Hub.",
      },
    ];
  }
  const blocks: Block[] = [{ kind: "link", label: "View the event page", url }];
  const cancellable =
    ["pending", "registered", "waitlisted"].includes(registration.status) &&
    !eventStarted(event, now);
  if (cancellable && ctx.links?.guestCancel) {
    blocks.push(
      { kind: "note", text: "Can't make it? Please cancel so someone else can take your place." },
      { kind: "link", label: "Cancel my registration", url: ctx.links.guestCancel },
    );
  }
  return blocks;
}

function ics(
  ctx: RenderContext,
  event: EmailEvent,
  registration: EmailRegistration,
  method: "REQUEST" | "CANCEL",
  sequence: number,
): EmailAttachment[] {
  const content = registrationIcs({
    method,
    registrationId: registration.id,
    event,
    sequence,
    organizer: ctx.from,
    attendee: { email: ctx.toEmail, name: ctx.toName },
    url: eventUrl(ctx.origin, event),
    now: ctx.now,
  });
  if (!content) return [];
  return [
    {
      name: method === "CANCEL" ? "cancelled.ics" : "invite.ics",
      contentType: `text/calendar; charset=utf-8; method=${method}`,
      content,
    },
  ];
}

function footerFor(registration: EmailRegistration): string[] {
  return [registration.guest ? GUEST_FOOTER : MEMBER_FOOTER, "Dialogue Society, London"];
}

function build(
  layout: Layout,
  attachments: EmailAttachment[] = [],
  listUnsubscribe?: RenderedEmail["listUnsubscribe"],
): RenderedEmail {
  return {
    subject: layout.subject,
    text: layoutText(layout),
    html: layoutHtml(layout),
    attachments,
    listUnsubscribe: listUnsubscribe ?? null,
  };
}

function guestConfirm(ctx: RenderContext): RenderedEmail {
  const event = requireEvent(ctx);
  const registration = requireRegistration(ctx);
  if (!ctx.links?.guestConfirm) throw new Error("Email context missing");
  const title = subjectTitle(event.title);
  return build({
    subject: `Confirm your registration: ${title}`,
    preheader: "One more step: confirm your email address to complete your registration.",
    heading: "Confirm your registration",
    blocks: [
      { kind: "p", text: greeting(ctx.toName) },
      {
        kind: "p",
        text: "Thank you for registering. Please confirm your email address to complete your registration for:",
      },
      { kind: "event", event, places: registration.places },
      { kind: "button", label: "Confirm your registration", url: ctx.links.guestConfirm },
      {
        kind: "note",
        text: "This link is valid for 48 hours. Your place is not reserved until you confirm. If you did not register, you can ignore this email.",
      },
    ],
    footer: [GUEST_FOOTER, "Dialogue Society, London"],
  });
}

function registrationConfirmed(ctx: RenderContext, now: Date): RenderedEmail {
  const event = requireEvent(ctx);
  const registration = requireRegistration(ctx);
  const payload = ctx.payload ?? {};
  const title = subjectTitle(event.title);
  const waitlisted = registration.status === "waitlisted";
  const promoted = payload["promoted"] === true && !waitlisted;
  const resent = payload["resent"] === true;
  let subject: string, heading: string, intro: string;
  if (waitlisted) {
    subject = `You're on the waiting list: ${title}`;
    heading = "You're on the waiting list";
    intro =
      registration.waitlist_position != null
        ? `The event is full at the moment. You are number ${registration.waitlist_position} on the waiting list. We will email you if a place becomes available.`
        : "The event is full at the moment. You are on the waiting list, and we will email you if a place becomes available.";
  } else if (promoted) {
    subject = `A place is now available for you: ${title}`;
    heading = "Good news: you have a place";
    intro =
      "A place became available, and you have moved from the waiting list to the attendee list.";
  } else {
    subject = `You're registered: ${title}`;
    heading = resent ? "Your registration details" : "You're registered";
    intro = resent
      ? "You are already registered for this event. Here are your registration details again."
      : "Your registration is confirmed. We look forward to seeing you.";
  }
  const blocks: Block[] = [
    { kind: "p", text: greeting(ctx.toName) },
    { kind: "p", text: intro },
    { kind: "event", event, places: registration.places },
  ];
  if (!waitlisted) {
    blocks.push(...joinBlocks(ctx));
    blocks.push({
      kind: "note",
      text: "The attached calendar invitation adds the event to your calendar.",
    });
  } else if (event.location_type === "online")
    blocks.push({
      kind: "note",
      text: "You will receive the joining link when a place becomes available for you.",
    });
  blocks.push(...manageBlocks(ctx, event, registration, now));
  return build(
    { subject, preheader: intro, heading, blocks, footer: footerFor(registration) },
    waitlisted ? [] : ics(ctx, event, registration, "REQUEST", event.ics_sequence),
  );
}

function eventUpdate(ctx: RenderContext, now: Date): RenderedEmail {
  const event = requireEvent(ctx);
  const registration = requireRegistration(ctx);
  const announced = ctx.payload?.["location_announced"] === true && !event.location_tba;
  const title = subjectTitle(event.title);
  const subject = announced ? `Location announced: ${title}` : `Event update: ${title}`;
  const intro = announced
    ? "The location of this event has now been announced. Here are the current details:"
    : "The time or place of this event has changed. Here are the current details:";
  const waitlisted = registration.status === "waitlisted";
  const blocks: Block[] = [
    { kind: "p", text: greeting(ctx.toName) },
    { kind: "p", text: intro },
    { kind: "event", event, places: registration.places },
  ];
  if (waitlisted)
    blocks.push({
      kind: "note",
      text: "You are still on the waiting list. We will email you if a place becomes available.",
    });
  else {
    if (event.location_type === "online")
      blocks.push({
        kind: "note",
        text: registration.guest
          ? "Your joining link is on your registration page (the link below), and we will send it again in your reminder."
          : "Your joining link is on the event page in the Volunteer Hub.",
      });
    blocks.push({
      kind: "note",
      text: "The attached calendar invitation updates the entry in your calendar.",
    });
  }
  blocks.push(...manageBlocks(ctx, event, registration, now));
  return build(
    {
      subject,
      preheader: intro,
      heading: announced ? "The location is now announced" : "The event details have changed",
      blocks,
      footer: footerFor(registration),
    },
    waitlisted ? [] : ics(ctx, event, registration, "REQUEST", event.ics_sequence),
  );
}

function eventReminder(ctx: RenderContext, now: Date): RenderedEmail {
  const event = requireEvent(ctx);
  const registration = requireRegistration(ctx);
  const title = subjectTitle(event.title);
  const intro =
    "This is a reminder that you are registered for this event, which takes place in two days.";
  return build({
    subject: `Reminder: ${title}`,
    preheader: intro,
    heading: "See you soon",
    blocks: [
      { kind: "p", text: greeting(ctx.toName) },
      { kind: "p", text: intro },
      { kind: "event", event, places: registration.places },
      ...joinBlocks(ctx),
      ...manageBlocks(ctx, event, registration, now),
    ],
    footer: footerFor(registration),
  });
}

function registrationCancelled(ctx: RenderContext): RenderedEmail {
  const event = requireEvent(ctx);
  const registration = requireRegistration(ctx);
  const title = subjectTitle(event.title);
  const intro =
    "Your registration for this event has been cancelled. Thank you for letting us know.";
  return build(
    {
      subject: `Registration cancelled: ${title}`,
      preheader: intro,
      heading: "Your registration is cancelled",
      blocks: [
        { kind: "p", text: greeting(ctx.toName) },
        { kind: "p", text: intro },
        { kind: "event", event },
        {
          kind: "note",
          text: registration.guest
            ? "Changed your mind? You are welcome to register again on the event page while registration is open."
            : "Changed your mind? You can register again on the event page in the Volunteer Hub while registration is open.",
        },
        {
          kind: "link",
          label: registration.guest ? "View the event page" : "View the event in the Volunteer Hub",
          url: eventUrl(ctx.origin, event),
        },
      ],
      footer: footerFor(registration),
    },
    // The attendee's own cancellation: the database already raised this registration's offset, so the SEQUENCE
    // (event counter + offset) is above every invitation the person received.
    ics(ctx, event, registration, "CANCEL", event.ics_sequence),
  );
}

function eventCancelled(ctx: RenderContext): RenderedEmail {
  const event = requireEvent(ctx);
  const registration = requireRegistration(ctx);
  const title = subjectTitle(event.title);
  const intro = "We are sorry to let you know that this event has been cancelled.";
  return build(
    {
      subject: `Event cancelled: ${title}`,
      preheader: intro,
      heading: "This event has been cancelled",
      blocks: [
        { kind: "p", text: greeting(ctx.toName) },
        { kind: "p", text: intro },
        { kind: "event", event },
        {
          kind: "note",
          text: "You don't need to do anything. We hope to see you at another event soon.",
        },
      ],
      footer: footerFor(registration),
    },
    // Only registered attendees received an invitation; the database already bumped the SEQUENCE.
    registration.status === "waitlisted"
      ? []
      : ics(ctx, event, registration, "CANCEL", event.ics_sequence),
  );
}

function subscriberConfirm(ctx: RenderContext): RenderedEmail {
  if (!ctx.links?.subscriberConfirm) throw new Error("Email context missing");
  const intro =
    "Please confirm that you would like to receive emails about upcoming Dialogue Society events.";
  return build({
    subject: "Confirm your subscription to Dialogue Society event updates",
    preheader: intro,
    heading: "Confirm your subscription",
    blocks: [
      { kind: "p", text: greeting(ctx.toName) },
      { kind: "p", text: intro },
      { kind: "button", label: "Confirm my subscription", url: ctx.links.subscriberConfirm },
      {
        kind: "note",
        text: "This link is valid for 7 days. If you did not ask for event updates, you can ignore this email and you will not hear from us.",
      },
    ],
    footer: [
      "You are receiving this email because this address was entered on the Dialogue Society website.",
      "Dialogue Society, London",
    ],
  });
}

function eventAnnouncement(ctx: RenderContext): RenderedEmail {
  const event = requireEvent(ctx);
  if (!ctx.links?.unsubscribe) throw new Error("Email context missing");
  const title = subjectTitle(event.title);
  const description = event.description.trim();
  const blocks: Block[] = [
    { kind: "p", text: greeting(ctx.toName) },
    { kind: "p", text: "We would love to see you at our next event:" },
    { kind: "event", event },
  ];
  if (description)
    blocks.push({
      kind: "p",
      text: description.length > 600 ? `${description.slice(0, 597)}…` : description,
    });
  blocks.push({
    kind: "button",
    label: "See details and register",
    url: eventUrl(ctx.origin, event),
  });
  return build(
    {
      subject: `New event: ${title}`,
      preheader: `${eventWhenText(event)} · ${eventPlace(event)}`,
      heading: "A new Dialogue Society event",
      blocks,
      footer: [
        "You are receiving this email because you subscribed to Dialogue Society event updates.",
        "Dialogue Society, London",
      ],
      footerLinks: [{ label: "Unsubscribe", url: ctx.links.unsubscribe }],
    },
    [],
    { url: ctx.links.unsubscribe, oneClick: ctx.links.unsubscribeOneClick },
  );
}

function taskReminder(ctx: RenderContext): RenderedEmail {
  const payload = ctx.payload ?? {};
  const rawTitle = typeof payload["task_title"] === "string" ? payload["task_title"] : "";
  const title = subjectTitle(rawTitle || "Task");
  const due =
    typeof payload["due_date"] === "string" && payload["due_date"]
      ? londonDay(payload["due_date"])
      : null;
  const kind = payload["reminder"];
  const link = absoluteAppLink(ctx.origin, payload["link"]);
  let subject: string, intro: string;
  if (kind === "overdue") {
    subject = `Overdue task: ${title}`;
    intro = due
      ? `This task was due on ${due} and is not done yet.`
      : "This task is overdue and not done yet.";
  } else if (kind === "repeat") {
    subject = `Task reminder: ${title}`;
    intro = due ? `A reminder about this task, due on ${due}.` : "A reminder about this task.";
  } else {
    subject = `Task due soon: ${title}`;
    intro = due ? `This task is due on ${due}.` : "This task is due soon.";
  }
  return build({
    subject,
    preheader: intro,
    heading: "Task reminder",
    blocks: [
      { kind: "p", text: greeting(ctx.toName) },
      { kind: "strong", text: rawTitle.trim() || "Task" },
      { kind: "p", text: intro },
      { kind: "button", label: "Open the task", url: link },
    ],
    footer: [
      "You are receiving this email because you are assigned to this task in the Dialogue Society Volunteer Hub.",
      "You can turn off task reminder emails in your profile.",
    ],
  });
}

/** Renders one email. Throws when the context is incomplete (the sender then retries the row later). */
export function renderEmail(template: EmailTemplate, ctx: RenderContext): RenderedEmail {
  const now = ctx.now ?? new Date();
  switch (template) {
    case "guest_confirm":
      return guestConfirm(ctx);
    case "registration_confirmed":
      return registrationConfirmed(ctx, now);
    case "event_update":
      return eventUpdate(ctx, now);
    case "event_reminder":
      return eventReminder(ctx, now);
    case "registration_cancelled":
      return registrationCancelled(ctx);
    case "event_cancelled":
      return eventCancelled(ctx);
    case "subscriber_confirm":
      return subscriberConfirm(ctx);
    case "event_announcement":
      return eventAnnouncement(ctx);
    case "task_reminder":
      return taskReminder(ctx);
  }
}

export const render = renderEmail;
