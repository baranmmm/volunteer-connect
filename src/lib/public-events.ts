import { z } from "zod";
import { eventEnd, eventStart } from "@/lib/event-rules";

/**
 * Public events (no sign-in). The database functions get_public_events / get_public_event return only these fields:
 * never online links, attendees, contacts, creators or files other than the first image (signed by the server).
 */
export const publicEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  status: z.enum(["published", "cancelled"]),
  scope: z.enum(["branch", "region", "national"]),
  all_day: z.boolean(),
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  branch_id: z.string().uuid().nullable(),
  branch: z.string().nullable(),
  region_id: z.string().uuid().nullable(),
  region: z.string().nullable(),
  category: z.string(),
  location: z.string().nullable(),
  is_online: z.boolean(),
  organizer: z.string().nullable(),
  registration: z.enum(["open", "full", "closed"]),
  has_image: z.boolean(),
  // Public events v2 (optional so older rows and fixtures still parse).
  location_tba: z.boolean().optional(),
  max_places: z.number().int().min(1).max(10).optional(),
  spots_left: z.number().int().nullable().optional(),
  past_record: z.boolean().optional(),
});
export type PublicEvent = z.infer<typeof publicEventSchema>;
export const publicEventsSchema = z.array(publicEventSchema);

/** Branch names in URLs: lower case, spaces as hyphens (/events?branch=medway,brighton). */
export function branchSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Comma-separated slugs → branch ids (unknown slugs are ignored). */
export function branchIdsFromSlugs(
  param: string | null | undefined,
  branches: { id: string; name: string }[],
) {
  const wanted = new Set(
    (param ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return branches.filter((b) => wanted.has(branchSlug(b.name))).map((b) => b.id);
}

/** At most 100 branch slugs; anything longer is not a real filter. */
export const branchParam = z.string().max(4000).optional();

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function foldLine(line: string) {
  let result = "",
    bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) {
      result += "\r\n ";
      bytes = 1;
    }
    result += char;
    bytes += size;
  }
  return result;
}
const utcStamp = (value: string | Date) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const dateStamp = (value: string) => value.replace(/-/g, "");
function nextDay(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The public calendar feed: one VEVENT per event, UID = event id, cancelled events as STATUS:CANCELLED, the public
 * detail page as URL. No online links (the "Online event" flag only), no attendee or contact data.
 */
export function publicEventsIcs(
  events: PublicEvent[],
  origin: string,
  name: string,
  now = new Date(),
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dialogue Society//Volunteer Hub public events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(name)}`,
    "X-WR-TIMEZONE:Europe/London",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const event of events) {
    const start = eventStart(event);
    if (!start) continue;
    const end = eventEnd(event);
    const url = `${origin}/events/${event.id}`;
    const where = [
      event.location,
      event.is_online ? "Online event" : null,
      [event.branch, event.region].filter(Boolean).join(", ") || null,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push("BEGIN:VEVENT", `UID:${event.id}@dialoguesociety.org`, `DTSTAMP:${utcStamp(now)}`);
    if (event.all_day)
      lines.push(
        `DTSTART;VALUE=DATE:${dateStamp(start)}`,
        `DTEND;VALUE=DATE:${dateStamp(nextDay(end ?? start))}`,
      );
    else {
      lines.push(`DTSTART:${utcStamp(start)}`);
      if (end) lines.push(`DTEND:${utcStamp(end)}`);
    }
    lines.push(
      `SUMMARY:${escapeIcs(event.title)}`,
      `DESCRIPTION:${escapeIcs(`${event.description}\n\n${url}`.trim())}`,
    );
    if (where) lines.push(`LOCATION:${escapeIcs(where)}`);
    lines.push(
      `URL:${escapeIcs(url)}`,
      `STATUS:${event.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
