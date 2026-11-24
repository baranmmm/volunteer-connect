// Short neutral descriptions for imported past events, written from the page's facts (host, kind of event, venue, date,
// audience) and a few theme words. Deterministic, never more than 2 sentences / 300 characters, and it does not copy
// the site's sentences: the only text taken over verbatim is a venue name and single theme words.
import type { EventPage } from "./parse";

export const MAX_SUMMARY_CHARS = 300;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-11-15" → "15 November 2026". */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1] ?? ""} ${y}`;
}

/** Site category → the noun phrase used in the summary. */
const KIND_BY_CATEGORY: Record<string, string> = {
  "discussion forum": "a discussion forum",
  "community engagement": "a community gathering",
  "community event": "a community gathering",
  interfaith: "an interfaith gathering",
  "interfaith dialogue": "an interfaith gathering",
  "dialogue dinner": "a dialogue dinner",
  dinner: "a dialogue dinner",
  iftar: "an iftar dinner",
  "iftar dinner": "an iftar dinner",
  conference: "a conference",
  "panel discussion": "a panel discussion",
  panel: "a panel discussion",
  lecture: "a talk",
  talk: "a talk",
  seminar: "a seminar",
  workshop: "a workshop",
  course: "a course session",
  "school programme": "a school programme session",
  trip: "a trip",
  "cultural trip": "a cultural trip",
  "film screening": "a film screening",
  exhibition: "an exhibition",
  "book launch": "a book launch",
  "award ceremony": "an award ceremony",
  "youth event": "a youth event",
};

/** What the host did, and the kind of event (from the title, then the site category). */
function activity(page: EventPage): { verb: string; kind: string } {
  const t = page.title.toLowerCase();
  const where = `${t} ${(page.venue ?? "").toLowerCase()}`;
  if (
    /\b(took part|taking part|participat\w*|joined|attended)\b/.test(t) ||
    (/\bfestival\b/.test(t) && !/\bhosts?\b/.test(t))
  ) {
    return {
      verb: "took part in",
      kind: /\bfestival\b/.test(t) ? "a local festival" : "a community event",
    };
  }
  if (/\b(school|academy|college|pupils)\b/.test(where))
    return { verb: "led", kind: "a school session" };
  if (/\buniversity\b/.test(where)) return { verb: "held", kind: "a university event" };
  if (/\broundtable\b/.test(t)) return { verb: "hosted", kind: "a roundtable" };
  if (/\bpicnic\b/.test(t)) return { verb: "organised", kind: "a community picnic" };
  if (/\bfun day\b/.test(t)) return { verb: "organised", kind: "a family fun day" };
  if (/\btraining\b/.test(t)) return { verb: "held", kind: "a training session" };
  if (/\biftar\b/.test(t)) return { verb: "hosted", kind: "an iftar dinner" };
  if (/\bscriptural reasoning\b/.test(t))
    return { verb: "hosted", kind: "a scriptural reasoning session" };
  if (/\bpanel\b/.test(t)) return { verb: "hosted", kind: "a panel discussion" };
  if (/\bconference\b/.test(t)) return { verb: "hosted", kind: "a conference" };
  if (/\bworkshop\b/.test(t)) return { verb: "ran", kind: "a workshop" };
  if (/\byouth\b/.test(t)) return { verb: "held", kind: "a youth session" };
  if (/\bdinner\b/.test(t)) return { verb: "hosted", kind: "a dinner" };
  if (/\breception\b/.test(t)) return { verb: "hosted", kind: "a reception" };
  if (/\bcelebrat\w*\b/.test(t)) return { verb: "hosted", kind: "a celebration" };
  for (const c of page.categories) {
    const hit = KIND_BY_CATEGORY[c.trim().toLowerCase()];
    if (hit) return { verb: "hosted", kind: hit };
  }
  if (/\binterfaith\b/.test(t)) return { verb: "hosted", kind: "an interfaith gathering" };
  if (/\bseries\b/.test(t)) return { verb: "hosted", kind: "a talk in its series" };
  return { verb: "hosted", kind: "an event" };
}

// Words that carry no theme (function words, generic event vocabulary, praise).
const STOP = new Set(
  (
    "about above across after again against along also although among another around because been before being below " +
    "between both bring brings brought came come comes could during each either enough every from further have having " +
    "here into itself just later least less like many might more most much must near never often once only other others " +
    "ours over perhaps quite rather really same several shall should since some still such than that their theirs them " +
    "themselves then there these they thing things this those though through thus together toward towards under until " +
    "upon very well were what when where whether which while whom whose will with within without would year years your " +
    "yours today tonight evening morning afternoon night week weeks month months first second third last next " +
    "event events dialogue society branch branches part session sessions panel panellists panelists speaker speakers " +
    "guest guests attendee attendees attended attending participants participant people person everyone everybody " +
    "everything someone something anyone held hosted host hosting organised organized took take takes taking place " +
    "join joined joining thank thanks thankful grateful gratitude heartfelt special truly wonderful great warm warmly " +
    "welcoming welcome beautiful memorable meaningful particularly especially greatly deeply honoured honored delighted " +
    "pleased proud happy different various wide range many number including included include includes alongside " +
    "following followed follow follows began begin begins ended ending opened opening closing remarks speech speeches " +
    "spoke speak speaks shared share sharing offered offer offering provided provide providing gave give given giving " +
    "made make makes making show showed shown highlighted highlight highlights reflected reflect reflecting explored " +
    "explore exploring discussed discuss discussing focused focus centred centered around presence possible support " +
    "generosity energy time times heart hearts open free attend wish wished hear heard listen listened work working " +
    "those whose already above below across further london england britain british local enjoyed enjoy " +
    "enjoying valued value gathering gatherings bringing young inspired inspiring insightful engaging engaged " +
    "lovely fantastic amazing excellent successful volunteers volunteer members member organisation organisations"
  ).split(/\s+/),
);

function words(text: string): string[] {
  return text.match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]/g) ?? [];
}

// Topics the Dialogue Society often works on: preferred when they appear.
const THEMES = new Set(
  (
    "interfaith faith faiths religion religions belief beliefs diversity cohesion trust community communities " +
    "migrants migration refugees asylum belonging friendship unity humanity hope peace respect understanding " +
    "inclusion integration solidarity citizenship democracy government policing safety education students pupils " +
    "youth young women families family culture cultures heritage tradition traditions food charity volunteering " +
    "environment climate wellbeing health hate racism islamophobia antisemitism neighbours scripture scriptural " +
    "reasoning festival celebration"
  ).split(/\s+/),
);

/**
 * Up to `max` theme words, all lowercase common nouns: a word must appear in lowercase in the page text (so names,
 * places and title-case verbs drop out). Ranked by body frequency, with a bonus for title words and known topics.
 */
export function themeWords(page: EventPage, max = 3, alsoExclude = ""): string[] {
  const exclude = new Set<string>(
    [page.branch ?? "", ...page.branches, page.venue ?? "", alsoExclude].flatMap((s) =>
      words(s.toLowerCase()),
    ),
  );
  const norm = (raw: string) => raw.replace(/[’']s$/, "");
  const ok = (w: string) => w.length >= 5 && !STOP.has(w) && !exclude.has(w);

  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  for (const raw of words(page.paragraphs.join(" "))) {
    const w = norm(raw);
    if (w !== w.toLowerCase() || !ok(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
    if (!firstSeen.has(w)) firstSeen.set(w, order++);
  }
  const inTitle = new Set(words(page.title).map((w) => norm(w).toLowerCase()));
  // Known topics named in the title count even when the body only uses them capitalised.
  for (const w of inTitle) {
    if (THEMES.has(w) && ok(w) && !counts.has(w)) {
      counts.set(w, 0);
      firstSeen.set(w, order++);
    }
  }
  const score = (w: string) =>
    (counts.get(w) ?? 0) + (inTitle.has(w) ? 3 : 0) + (THEMES.has(w) ? 2 : 0);
  // Weak words (said once or twice, neither a topic nor in the title) are left out.
  const ranked = [...counts.keys()]
    .filter((w) => THEMES.has(w) || inTitle.has(w) || (counts.get(w) ?? 0) >= 3)
    .sort((a, b) => score(b) - score(a) || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));

  const picked: string[] = [];
  for (const w of ranked) {
    if (picked.length >= max) break;
    // Skip near-duplicates such as "migrant" / "migrants" or "community" / "communities".
    const stem = (x: string) => x.slice(0, Math.min(7, x.length - 1));
    if (picked.some((p) => stem(p) === stem(w) || p.startsWith(stem(w)) || w.startsWith(stem(p))))
      continue;
    picked.push(w);
  }
  return picked;
}

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

const THEME_TEMPLATES = [
  (list: string) => `Conversations centred on ${list}.`,
  (list: string) => `The programme touched on ${list}.`,
  (list: string) => `Themes of the day included ${list}.`,
];

function audiencePhrase(page: EventPage): string {
  const type = (page.eventType ?? "").toLowerCase();
  const free = /free/i.test(page.price ?? "");
  if (type.includes("everyone") || type.includes("public"))
    return free ? ", free and open to all" : ", open to all";
  return "";
}

function clampSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}.`;
}

/** The description of an imported past event: at most 2 sentences and 300 characters. */
export function summarize(page: EventPage, date: string | null = page.date): string {
  const host = page.branch ? `Dialogue Society ${page.branch}` : "The Dialogue Society";
  // Abbreviation dots ("St. Mary's") would read as a sentence end.
  const venueName = (page.venue ?? "").replace(/\.(?=\s)/g, "").replace(/[.!?]+$/, "");
  const venue = venueName && venueName.length <= 60 ? ` at ${venueName}` : "";
  const when = date ? ` on ${formatDay(date)}` : "";
  const { verb, kind } = activity(page);
  const first = clampSentence(
    `${host} ${verb} ${kind}${venue}${when}${audiencePhrase(page)}.`,
    200,
  );
  const themes = themeWords(page, 3, kind);
  if (themes.length === 0) return first;
  const template =
    THEME_TEMPLATES[hash(page.title) % THEME_TEMPLATES.length] ?? THEME_TEMPLATES[0]!;
  const second = template(listPhrase(themes));
  const both = `${first} ${second}`;
  return both.length <= MAX_SUMMARY_CHARS ? both : first;
}

/** Number of sentences (terminal punctuation followed by a space or the end). */
export function sentenceCount(text: string): number {
  return (text.trim().match(/[.!?](\s|$)/g) ?? []).length;
}
