/** One row of the manager's attendee list: a member or a (confirmed) guest. */
export type Attendee = {
  registration_id: string;
  kind: "member" | "guest";
  user_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  places: number;
  status: "registered" | "waitlisted" | "cancelled" | "attended" | "no_show";
  registered_at: string;
  cancelled_at: string | null;
  checked_in_at: string | null;
  checked_in_by_name: string | null;
  waitlist_position: number | null;
};

/** A CSV cell: always quoted, and a leading = + - @ (or tab / CR) is neutralised so spreadsheets never run it. */
export function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

const HEADER = [
  "name",
  "type",
  "email",
  "phone",
  "places",
  "status",
  "checked_in",
  "registered_at",
];
/** The attendee list as CSV (UTF-8 with a BOM so spreadsheets read names correctly; CRLF line ends). */
export function attendeesCsv(rows: Attendee[]) {
  const lines = [HEADER.map(csvCell).join(",")];
  for (const r of rows)
    lines.push(
      [
        r.full_name,
        r.kind,
        r.email,
        r.phone,
        r.places,
        r.status,
        r.status === "attended" ? (r.checked_in_at ?? "yes") : "",
        r.registered_at,
      ]
        .map(csvCell)
        .join(","),
    );
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Seats taken (registered / attended / no-show places) and the waitlist. */
export function attendeeCounts(rows: Attendee[]) {
  let seats = 0,
    waitlisted = 0;
  for (const r of rows) {
    if (r.status === "registered" || r.status === "attended" || r.status === "no_show")
      seats += r.places;
    if (r.status === "waitlisted") waitlisted += 1;
  }
  return { seats, waitlisted };
}
