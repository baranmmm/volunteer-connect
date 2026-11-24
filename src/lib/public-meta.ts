// Link-preview and search metadata of the server-rendered public pages: title, description, canonical URL, Open Graph,
// Twitter card and schema.org Event JSON-LD. Only public fields (get_public_* functions); never online meeting links,
// storage paths or people. Preview images use the stable /api/public/event-image/<id> route: signed links expire.
import { createIsomorphicFn } from "@tanstack/react-start";
import { whenText } from "@/components/landing/format";
import type { PublicEvent } from "@/lib/public-events";

export const SITE_NAME = "Dialogue Society";
const TZ = "Europe/London";

/** The public origin: APP_URL (or the request origin) on the server, the page's origin in the browser. */
export const siteOrigin = createIsomorphicFn()
  .server(async (): Promise<string> => {
    const { getRequestUrl } = await import("@tanstack/react-start/server");
    const { appOrigin } = await import("@/lib/email/links.server");
    let origin: string | null = null;
    try {
      origin = getRequestUrl().origin;
    } catch {
      origin = null;
    }
    return appOrigin(origin);
  })
  .client(async (): Promise<string> => window.location.origin);

/** The cover of a public event as a stable, cacheable URL (served by src/routes/api/public/event-image.$id.ts). */
export function eventImageUrl(origin: string, id: string) {
  return `${origin}/api/public/event-image/${id}`;
}

type Meta = Record<string, string>;
type Link = { rel: string; href: string };

/** Title, description, canonical and the Open Graph / Twitter tags of one page. */
export function pageMeta(input: {
  title: string;
  description: string;
  url: string;
  image?: string | null;
  imageAlt?: string;
  type?: "website" | "article";
}): { meta: Meta[]; links: Link[] } {
  const description = clip(input.description, 200);
  const meta: Meta[] = [
    { title: input.title },
    { name: "description", content: description },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: input.type ?? "website" },
    { property: "og:url", content: input.url },
    { property: "og:title", content: input.title },
    { property: "og:description", content: description },
    { property: "og:locale", content: "en_GB" },
    { name: "twitter:card", content: input.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: description },
  ];
  if (input.image) {
    meta.push(
      { property: "og:image", content: input.image },
      { name: "twitter:image", content: input.image },
    );
    if (input.imageAlt)
      meta.push(
        { property: "og:image:alt", content: input.imageAlt },
        { name: "twitter:image:alt", content: input.imageAlt },
      );
  }
  return { meta, links: [{ rel: "canonical", href: input.url }] };
}

/** Collapses whitespace and cuts at a word boundary. */
export function clip(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** "Saturday 6 December 2026, 18:30 · Dialogue House, Medway · Medway, South East" (English, London time). */
export function eventSummary(event: PublicEvent) {
  const place = event.location_tba
    ? "Location to be announced"
    : [event.location, event.is_online ? "Online" : null].filter(Boolean).join(" and ");
  const host = [event.branch, event.region].filter(Boolean).join(", ");
  return [whenText(event, "en", true), place, host].filter(Boolean).join(" · ");
}

/** The preview description: date, place and branch first, then the start of the event's own description. */
export function eventDescription(event: PublicEvent) {
  const summary = eventSummary(event);
  const own = clip(event.description, 160);
  if (event.status === "cancelled") return clip(`Cancelled. ${summary}. ${own}`, 200);
  return clip(own ? `${summary}. ${own}` : summary || "A Dialogue Society event.", 200);
}

/** ISO 8601 with the London offset ("2026-12-06T18:30:00+00:00"), or the plain date of an all-day event. */
export function isoLondon(value: string | null, allDay: boolean) {
  if (!value) return undefined;
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  // "GMT" in winter, "GMT+01:00" in summer.
  const offset = /GMT([+-]\d{2}:\d{2})/.exec(parts["timeZoneName"] ?? "")?.[1] ?? "+00:00";
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}${offset}`;
}

/** schema.org Event: no online meeting link (a VirtualLocation points at the public event page instead). */
export function eventJsonLd(
  event: PublicEvent,
  opts: { url: string; origin: string; image: string | null },
): Record<string, unknown> {
  const start = isoLondon(event.all_day ? event.start_date : event.start_at, event.all_day);
  const end = isoLondon(event.all_day ? event.end_date : event.end_at, event.all_day);
  const place =
    event.location && !event.location_tba
      ? {
          "@type": "Place",
          name: event.location,
          address: {
            "@type": "PostalAddress",
            streetAddress: event.location,
            addressCountry: "GB",
          },
        }
      : null;
  const virtual = event.is_online ? { "@type": "VirtualLocation", url: opts.url } : null;
  const locations = [place, virtual].filter(Boolean);
  const mode =
    place && virtual
      ? "MixedEventAttendanceMode"
      : virtual
        ? "OnlineEventAttendanceMode"
        : "OfflineEventAttendanceMode";
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    url: opts.url,
    eventStatus: `https://schema.org/${event.status === "cancelled" ? "EventCancelled" : "EventScheduled"}`,
    eventAttendanceMode: `https://schema.org/${mode}`,
    organizer: { "@type": "Organization", name: SITE_NAME, url: opts.origin },
  };
  if (start) data["startDate"] = start;
  if (end) data["endDate"] = end;
  if (event.description.trim()) data["description"] = clip(event.description, 500);
  if (locations.length) data["location"] = locations.length === 1 ? locations[0] : locations;
  if (opts.image) data["image"] = [opts.image];
  if (event.status !== "cancelled" && event.registration !== "closed")
    data["offers"] = {
      "@type": "Offer",
      price: 0,
      priceCurrency: "GBP",
      availability: `https://schema.org/${event.registration === "full" ? "SoldOut" : "InStock"}`,
      url: opts.url,
    };
  return data;
}

/** A JSON-LD <script> for head(): `<` is escaped so no text in the data can close the script element. */
export function jsonLdScript(data: Record<string, unknown>) {
  return {
    type: "application/ld+json",
    children: JSON.stringify(data).replace(/</g, "\\u003c"),
  };
}
