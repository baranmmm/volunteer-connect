// iCalendar invitations attached to event emails (RFC 5545 / RFC 5546 iTIP). Pure: no I/O, no clock unless passed in.
// * UID is per registration (`<registration id>@dialoguesociety-hub`): one attendee's entry for one event. The
//   registration row is reused when someone registers again, so a later update or cancel replaces the same entry.
// * SEQUENCE comes from events.ics_sequence, which the database bumps on every time/place change and on cancel.
// * Online links are never included: guests receive the joining details from the organisers.
import { eventEnd, eventStart, londonDate } from "@/lib/event-rules";

export type IcsEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  location_type: string;
  location_tba: boolean;
  all_day: boolean;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
  ics_sequence: number;
  status: string;
};

export const ICS_UID_DOMAIN = "dialoguesociety-hub";
export const LOCATION_TBA_TEXT = "To be announced";
export const ONLINE_TEXT = "Online — the organisers will share the joining details";

/** The place as shown in emails and calendar entries (never an online link). */
export function eventPlace(
  event: Pick<IcsEvent, "location" | "location_type" | "location_tba">,
): string {
  if (event.location_tba) return LOCATION_TBA_TEXT;
  if (event.location_type === "online") return ONLINE_TEXT;
  return event.location.trim() || LOCATION_TBA_TEXT;
}

export const icsUid = (registrationId: string) => `${registrationId}@${ICS_UID_DOMAIN}`;

// Control characters other than newlines have no place in a text value.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function escapeIcsText(value: string): string {
  return value
    .replace(CONTROL, "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** A parameter value (e.g. CN): quoted, without quotes or control characters (RFC 5545 3.2). */
function paramValue(value: string): string {
  return `"${value
    .replace(CONTROL, "")
    .replace(/[\r\n"]/g, " ")
    .trim()}"`;
}

/** Folds a content line at 75 octets (UTF-8, never splitting a character); continuation lines start with a space. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  let result = "",
    bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      result += "\r\n ";
      bytes = 1;
    }
    result += char;
    bytes += size;
  }
  return result;
}

function utcStamp(value: string | Date): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type RegistrationIcsInput = {
  method: "REQUEST" | "CANCEL";
  registrationId: string;
  event: IcsEvent;
  /** SEQUENCE: event.ics_sequence plus the registration offset (raised by the database on cancel and re-register). */
  sequence: number;
  /** ORGANIZER: the sender address (EMAIL_FROM). */
  organizer: { email: string; name?: string | null | undefined };
  attendee?: { email: string; name?: string | null | undefined } | null | undefined;
  /** The event page (members: the app; guests: the public page). */
  url: string;
  now?: Date | undefined;
};

/** The calendar entry for one registration, or null when the event has no date yet. */
export function registrationIcs(input: RegistrationIcsInput): string | null {
  const { event } = input;
  const start = eventStart(event);
  if (!start) return null;
  const cancelled = input.method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dialogue Society//Volunteer Hub//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${icsUid(input.registrationId)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(input.sequence))}`,
    `DTSTAMP:${utcStamp(input.now ?? new Date())}`,
  ];
  if (event.all_day || DATE_ONLY.test(start)) {
    const first = londonDate(start);
    // DTEND of an all-day entry is exclusive: the day after the last day.
    const last = londonDate(eventEnd(event) ?? start);
    lines.push(
      `DTSTART;VALUE=DATE:${first.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${nextDay(last < first ? first : last).replace(/-/g, "")}`,
    );
  } else {
    lines.push(`DTSTART:${utcStamp(start)}`);
    const end = eventEnd(event);
    lines.push(
      `DTEND:${utcStamp(end && Date.parse(end) > Date.parse(start) ? end : new Date(Date.parse(start) + 3600000))}`,
    );
  }
  const description = [event.description.trim(), input.url].filter(Boolean).join("\n\n");
  const organizerName = input.organizer.name?.trim();
  lines.push(
    `SUMMARY:${escapeIcsText(event.title)}`,
    `LOCATION:${escapeIcsText(eventPlace(event))}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `URL:${input.url.replace(CONTROL, "").replace(/[\r\n]/g, "")}`,
    `ORGANIZER${organizerName ? `;CN=${paramValue(organizerName)}` : ""}:mailto:${input.organizer.email}`,
  );
  if (input.attendee) {
    const name = input.attendee.name?.trim();
    lines.push(
      `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=${cancelled ? "DECLINED" : "ACCEPTED"};RSVP=FALSE${name ? `;CN=${paramValue(name)}` : ""}:mailto:${input.attendee.email}`,
    );
  }
  lines.push(
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
