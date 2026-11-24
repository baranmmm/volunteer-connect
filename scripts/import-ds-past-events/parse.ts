// Pure HTML parsing for the Dialogue Society public site (https://www.dialoguesociety.org/events/ and /event/<slug>/).
// No network and no Node-only APIs, so Vitest can run it against saved fixtures.
import { parse, type HTMLElement } from "node-html-parser";

export const SITE_ORIGIN = "https://www.dialoguesociety.org";
export const EVENTS_LIST_URL = `${SITE_ORIGIN}/events/`;

export type ListItem = {
  url: string;
  title: string;
  /** Event day as an ISO date (YYYY-MM-DD), the London calendar date shown on the site; null when missing. */
  date: string | null;
  /** Branch (or region) badge names, in page order. */
  branches: string[];
  image: string | null;
};

export type ListPage = { items: ListItem[]; nextUrl: string | null };

export type GalleryImage = {
  /** Full-size original (the lightbox link); stored as event_media.source_url. */
  originalUrl: string;
  width: number | null;
  height: number | null;
  /** Smallest published size whose long side is at least the target (falls back to the original). */
  downloadUrl: string;
};

export type EventPage = {
  title: string;
  date: string | null;
  /** First branch/region badge in the header (categories under /event/<cat>/ are excluded). */
  branch: string | null;
  branches: string[];
  /** Event category names from the header (e.g. "Discussion Forum"). */
  categories: string[];
  /** "Open to Everyone", "Invite Only", ... */
  eventType: string | null;
  price: string | null;
  venue: string | null;
  paragraphs: string[];
  galleryImages: GalleryImage[];
  featuredImage: GalleryImage | null;
  /** Images in the body that are not in a gallery (speaker photos excluded). */
  contentImages: GalleryImage[];
  youtubeIds: string[];
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Decodes the HTML entities WordPress emits in titles (named, decimal and hex). */
export function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return named[code.toLowerCase()] ?? whole;
  });
}

function cleanText(text: string | undefined | null): string {
  return decodeEntities(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** " 15 November 2026" → "2026-11-15". The time part ("13:00PM": a 24 h value with a stray suffix) is ignored. */
export function parseDayText(text: string | null | undefined): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text ?? "");
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.indexOf((m[2] ?? "").toLowerCase()) + 1;
  const year = Number(m[3]);
  if (month < 1 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateFrom(root: HTMLElement | null): string | null {
  if (!root) return null;
  const day = root.querySelector("time.tep_date .event-start-date .event-day");
  return parseDayText(day?.text);
}

function absoluteUrl(href: string | undefined | null): string | null {
  const value = (href ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value, SITE_ORIGIN);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

function branchNames(root: HTMLElement): string[] {
  const names: string[] = [];
  for (const a of root.querySelectorAll("p.entry-category a")) {
    const href = a.getAttribute("href") ?? "";
    if (!/\/branch\/[^/]+\/?$/.test(href.trim())) continue;
    const name = cleanText(a.text);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Parses one events archive page (`/events/` or `/events/page/<n>/`). */
export function parseEventsList(html: string): ListPage {
  const root = parse(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  for (const article of root.querySelectorAll("article.post-summary.type-event")) {
    const url = absoluteUrl(article.querySelector("a.post-summary__link")?.getAttribute("href"));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = cleanText(
      article.querySelector(".post-summary__content .post-summary__title")?.text ??
        article.querySelector(".post-summary__title")?.text,
    );
    const img = article.querySelector("figure.post-summary__image img");
    items.push({
      url,
      title,
      date: dateFrom(article.querySelector(".post-summary__date")),
      branches: branchNames(article),
      image: absoluteUrl(img?.getAttribute("src")),
    });
  }
  const nextUrl = absoluteUrl(
    root.querySelector("nav.archive-pagination li.pagination-next a")?.getAttribute("href"),
  );
  return { items, nextUrl };
}

type Candidate = { url: string; w: number };

function parseSrcset(srcset: string | undefined | null): Candidate[] {
  const out: Candidate[] = [];
  for (const part of (srcset ?? "").split(",")) {
    const [url, size] = part.trim().split(/\s+/);
    const w = /^(\d+)w$/.exec(size ?? "");
    const abs = absoluteUrl(url);
    if (abs && w) out.push({ url: abs, w: Number(w[1]) });
  }
  return out;
}

function positiveInt(value: string | undefined | null): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Picks the smallest published size whose long side reaches `target` px (so the resize never upscales and we do not
 * download 5120 px originals), else the largest candidate.
 */
export function pickDownloadUrl(
  originalUrl: string,
  width: number | null,
  height: number | null,
  srcset: string | null | undefined,
  target = 1920,
): string {
  const ratio = width && height ? Math.max(1, height / width) : 1;
  const candidates = parseSrcset(srcset).map((c) => ({ ...c, long: c.w * ratio }));
  const originalLong = width && height ? Math.max(width, height) : Infinity;
  candidates.push({ url: originalUrl, w: width ?? Infinity, long: originalLong });
  candidates.sort((a, b) => a.long - b.long);
  const enough = candidates.find((c) => c.long >= target);
  return (enough ?? candidates[candidates.length - 1] ?? { url: originalUrl }).url;
}

/** Strips WordPress size suffixes so the same photo in several sizes is recognised once. */
export function imageKey(url: string): string {
  return url
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/-(\d+x\d+|scaled)(?=\.[a-z]+$)/, "")
    .replace(/\.jpeg$/, ".jpg");
}

function imageFromImg(img: HTMLElement, link: HTMLElement | null): GalleryImage | null {
  const linkHref = link?.getAttribute("href") ?? "";
  const linkIsImage = /\.(jpe?g|png|webp)(\?|$)/i.test(linkHref.trim());
  const originalUrl = absoluteUrl(linkIsImage ? linkHref : img.getAttribute("src"));
  if (!originalUrl) return null;
  const width =
    positiveInt(link?.getAttribute("data-lbwps-width")) ??
    (linkIsImage ? null : positiveInt(img.getAttribute("width")));
  const height =
    positiveInt(link?.getAttribute("data-lbwps-height")) ??
    (linkIsImage ? null : positiveInt(img.getAttribute("height")));
  // Without known original dimensions, derive the ratio from the displayed size.
  const ratioW = width ?? positiveInt(img.getAttribute("width"));
  const ratioH = height ?? positiveInt(img.getAttribute("height"));
  return {
    originalUrl,
    width,
    height,
    downloadUrl: pickDownloadUrl(originalUrl, ratioW, ratioH, img.getAttribute("srcset")),
  };
}

/** Parses an event page (`/event/<slug>/`). */
export function parseEventPage(html: string): EventPage {
  const root = parse(html);
  const article =
    root.querySelector("main article.type-event") ??
    root.querySelector("article.type-event") ??
    root;
  const header = article.querySelector("header.entry-header") ?? article;
  const categories: string[] = [];
  for (const a of header.querySelectorAll("p.entry-category a")) {
    const href = a.getAttribute("href") ?? "";
    if (/\/event\/[^/]+\/?$/.test(href.trim())) categories.push(cleanText(a.text));
  }
  const branches = branchNames(header);

  const content = article.querySelector("div.entry-content");
  // Speakers, series lists and related posts are not part of the event's own text or photos.
  for (const sel of [
    ".authors__wrapper",
    ".assosiated-content-toc",
    "section.related-posts-wrapper",
    "script",
    "style",
  ]) {
    for (const el of content?.querySelectorAll(sel) ?? []) el.remove();
  }

  const paragraphs = (content?.querySelectorAll("p") ?? [])
    .map((p) => cleanText(p.text))
    .filter((t) => t.length > 0);

  const galleryImages: GalleryImage[] = [];
  const contentImages: GalleryImage[] = [];
  const seen = new Set<string>();
  for (const img of content?.querySelectorAll("img") ?? []) {
    if (img.closest(".youtube") || img.closest(".wp-block-embed")) continue;
    const parent = img.parentNode as HTMLElement | null;
    const link = parent && parent.tagName === "A" ? parent : null;
    const image = imageFromImg(img, link);
    if (!image) continue;
    const key = imageKey(image.originalUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    if (img.closest("figure.wp-block-gallery")) galleryImages.push(image);
    else contentImages.push(image);
  }

  const featuredImg = article.querySelector("figure.post-thumbnail img");
  const featuredImage = featuredImg ? imageFromImg(featuredImg, null) : null;

  const youtubeIds: string[] = [];
  for (const el of content?.querySelectorAll("[data-embed]") ?? []) {
    const id = (el.getAttribute("data-embed") ?? "").trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(id) && !youtubeIds.includes(id)) youtubeIds.push(id);
  }
  for (const frame of content?.querySelectorAll("iframe") ?? []) {
    const m = /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/.exec(
      frame.getAttribute("src") ?? "",
    );
    if (m?.[1] && !youtubeIds.includes(m[1])) youtubeIds.push(m[1]);
  }

  const metas = header.querySelectorAll(".entry-header-meta");
  const dateMeta = metas.find((m) => m.querySelector("time.tep_date")) ?? null;
  return {
    title: cleanText(
      header.querySelector("h1.entry-title")?.text ?? article.getAttribute("aria-label"),
    ),
    date: dateFrom(dateMeta),
    branch: branches[0] ?? null,
    branches,
    categories,
    eventType: cleanText(header.querySelector(".event-type")?.text) || null,
    price: cleanText(header.querySelector(".event-price")?.text) || null,
    venue: cleanText(header.querySelector(".event-venue-address a.event-venue-link")?.text) || null,
    paragraphs,
    galleryImages,
    featuredImage,
    contentImages,
    youtubeIds,
  };
}

/**
 * The photos to import: gallery images when there are at least `min`, otherwise the featured image followed by the
 * body images. Picks at most `max`, spread evenly over the set so one moment does not fill the whole selection.
 */
export function selectPhotos(page: EventPage, min = 3, max = 6): GalleryImage[] {
  let pool: GalleryImage[];
  if (page.galleryImages.length >= min) {
    pool = page.galleryImages;
  } else {
    pool = [];
    const seen = new Set<string>();
    for (const img of [
      ...(page.featuredImage ? [page.featuredImage] : []),
      ...page.galleryImages,
      ...page.contentImages,
    ]) {
      const key = imageKey(img.originalUrl);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(img);
    }
  }
  if (pool.length < min) return [];
  if (pool.length <= max) return pool;
  const picked: GalleryImage[] = [];
  for (let i = 0; i < max; i++) {
    const img = pool[Math.floor((i * pool.length) / max)];
    if (img) picked.push(img);
  }
  return picked;
}

export type BranchRow = { id: string; name: string; region_id: string };

/** Maps the site's branch badges to an app branch by name (case-insensitive); null = a national record. */
/** Known typos in source titles (as published on dialoguesociety.org) → the title we import. */
export const TITLE_FIXES: ReadonlyArray<readonly [string, string]> = [
  ["A Case Studdy of Iran", "A Case Study of Iran"],
];

/** The import title: the source title with known typos fixed, at most 200 characters. */
export function cleanTitle(title: string): string {
  let out = title;
  for (const [wrong, right] of TITLE_FIXES) out = out.split(wrong).join(right);
  return out.slice(0, 200);
}

/**
 * Events with children or young people (schools, youth sessions) are imported with their photos hidden from the
 * public gallery (in_gallery false): safeguarding — a manager can still show individual photos in the app after
 * checking consent. Decided from the title only, so the result is predictable.
 */
const CHILDREN_EVENT = /\b(schools?|primary|academy|pupils?|students?|youth|children|kids)\b/i;
export function isChildrenEvent(title: string): boolean {
  return CHILDREN_EVENT.test(title);
}

export type RegionRow = { id: string; name: string };
export type ScopeMatch =
  | { scope: "branch"; branch: BranchRow; region: null }
  | { scope: "region"; branch: null; region: RegionRow }
  | { scope: "national"; branch: null; region: null };

/**
 * Where an imported event belongs: a branch whose name matches one of the site's badges; otherwise a region whose
 * name matches (DS region pages such as "Greater London" → a region-scope record of that region); otherwise national.
 */
export function mapScope(names: string[], branches: BranchRow[], regions: RegionRow[]): ScopeMatch {
  const branch = mapBranch(names, branches);
  if (branch) return { scope: "branch", branch, region: null };
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  for (const name of names) {
    const region = regions.find((r) => norm(r.name) === norm(name));
    if (region) return { scope: "region", branch: null, region };
  }
  return { scope: "national", branch: null, region: null };
}

export function mapBranch(names: string[], branches: BranchRow[]): BranchRow | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  for (const name of names) {
    const hit = branches.find((b) => norm(b.name) === norm(name));
    if (hit) return hit;
  }
  return null;
}
