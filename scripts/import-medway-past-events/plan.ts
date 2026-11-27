// Pure parts of the Medway past-events import: reading events.json, the expected photo files and the descriptions.
// No I/O here except through the functions passed in, so the rules are unit-tested (src/test/import-medway-past-events.test.ts).

export const PHOTOS_PER_EVENT = 12; // also the per-past-event cap in add_event_media
export const PHOTO_FILES = Array.from(
  { length: PHOTOS_PER_EVENT },
  (_, i) => `${String(i + 1).padStart(2, "0")}.jpg`,
);
export const MAX_DESCRIPTION_CHARS = 300;
export const ORGANIZER = "Dialogue Society Medway";

export type EventInput = {
  folder: string;
  title: string;
  date: string; // YYYY-MM-DD, a London calendar date
  venue: string;
  /** Optional override of the generated description. */
  description?: string;
};

const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Parses and checks events.json. Throws one error listing every problem. */
export function parseEventsJson(text: string, today: string): EventInput[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`events.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(raw) || raw.length === 0)
    throw new Error("events.json must be a non-empty array");
  const problems: string[] = [];
  const out: EventInput[] = [];
  const folders = new Set<string>();
  const keys = new Set<string>();
  raw.forEach((item: unknown, i) => {
    const at = `events.json[${i}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${at}: not an object`);
      return;
    }
    const o = item as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
    const ev: EventInput = {
      folder: str("folder"),
      title: str("title").replace(/\s+/g, " "),
      date: str("date"),
      venue: str("venue").replace(/\s+/g, " "),
    };
    if (o["description"] !== undefined) ev.description = str("description").replace(/\s+/g, " ");
    if (!FOLDER_RE.test(ev.folder)) problems.push(`${at}: folder must be a plain folder name`);
    if (ev.title.length === 0 || ev.title.length > 200)
      problems.push(`${at}: title must be 1–200 characters`);
    if (!isRealDate(ev.date)) problems.push(`${at}: date must be YYYY-MM-DD`);
    else if (ev.date < "1990-01-01" || ev.date > today)
      problems.push(`${at}: date must be in the past (${ev.date})`);
    if (ev.venue.length === 0 || ev.venue.length > 500)
      problems.push(`${at}: venue must be 1–500 characters`);
    if (
      ev.description !== undefined &&
      (ev.description.length === 0 || ev.description.length > 2000)
    )
      problems.push(`${at}: description must be 1–2000 characters`);
    if (folders.has(ev.folder)) problems.push(`${at}: folder ${ev.folder} is listed twice`);
    folders.add(ev.folder);
    const key = `${ev.title.toLowerCase()}|${ev.date}`;
    if (keys.has(key)) problems.push(`${at}: the same title and date are listed twice`);
    keys.add(key);
    out.push(ev);
  });
  if (problems.length > 0) throw new Error(`events.json:\n  ${problems.join("\n  ")}`);
  return out;
}

/** The folder's files compared with 01.jpg–12.jpg: missing ones are an error, others are ignored (and listed). */
export function checkFolderFiles(names: string[]): { missing: string[]; ignored: string[] } {
  const present = new Set(names);
  const expected = new Set(PHOTO_FILES);
  return {
    missing: PHOTO_FILES.filter((f) => !present.has(f)),
    ignored: names.filter((n) => !expected.has(n) && n !== ".DS_Store").sort(),
  };
}

export function formatLondonDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** What kind of gathering it was, from the title only (a second, neutral sentence; never names people). */
function kindSentence(title: string): string {
  const t = title.toLowerCase();
  if (/women'?s day/.test(t) && t.includes("iftar"))
    return "The evening marked International Women's Day with a shared iftar meal.";
  if (t.includes("iftar"))
    return "Guests from the local community came together to break the fast and share a meal.";
  if (t.includes("christmas"))
    return "Guests from the local community came together to share a festive meal.";
  if (/walk for peace|peace walk/.test(t))
    return "Participants walked together in support of peace and good relations in the community.";
  return "";
}

/** A short, neutral description from the facts: who held it, what, where and when; at most 2 sentences. */
export function describe(ev: EventInput): string {
  if (ev.description) return ev.description;
  // A venue with commas (an address) reads better closed by one: "…, Gillingham ME7 1AJ, on 6 March 2026."
  const venue = ev.venue.includes(",") ? `${ev.venue},` : ev.venue;
  const first = `${ORGANIZER} held its ${ev.title} at ${venue} on ${formatLondonDate(ev.date)}.`;
  const both = [first, kindSentence(ev.title)].filter(Boolean).join(" ");
  return both.length <= MAX_DESCRIPTION_CHARS ? both : first.slice(0, MAX_DESCRIPTION_CHARS);
}
