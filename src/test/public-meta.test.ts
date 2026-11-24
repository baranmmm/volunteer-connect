import { describe, expect, it } from "vitest";
import {
  eventDescription,
  eventJsonLd,
  isoLondon,
  jsonLdScript,
  pageMeta,
} from "@/lib/public-meta";
import type { PublicEvent } from "@/lib/public-events";

const event: PublicEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Dialogue dinner",
  description: "An evening of conversation.",
  status: "published",
  scope: "branch",
  all_day: false,
  start_at: "2026-07-01T17:30:00Z",
  end_at: "2026-07-01T19:30:00Z",
  start_date: null,
  end_date: null,
  branch_id: null,
  branch: "Medway",
  region_id: null,
  region: "South",
  category: "dinner",
  location: "Dialogue House, Medway",
  is_online: true,
  organizer: "DS",
  registration: "open",
  has_image: true,
};
const opts = {
  url: "https://hub.test/events/1",
  origin: "https://hub.test",
  image: "https://hub.test/img",
};

describe("public page metadata", () => {
  it("writes London times with their offset (summer and winter) and all-day dates as dates", () => {
    expect(isoLondon("2026-07-01T17:30:00Z", false)).toBe("2026-07-01T18:30:00+01:00");
    expect(isoLondon("2026-12-01T17:30:00Z", false)).toBe("2026-12-01T17:30:00+00:00");
    expect(isoLondon("2026-12-01", true)).toBe("2026-12-01");
  });
  it("builds a schema.org Event without any online meeting link", () => {
    const ld = eventJsonLd(event, opts);
    expect(ld["eventAttendanceMode"]).toBe("https://schema.org/MixedEventAttendanceMode");
    expect(ld["startDate"]).toBe("2026-07-01T18:30:00+01:00");
    expect(JSON.stringify(ld)).not.toMatch(/zoom|meet\.google|teams/i);
    const locations = ld["location"] as { "@type": string; url?: string }[];
    expect(locations.find((l) => l["@type"] === "VirtualLocation")?.url).toBe(opts.url);
    expect(ld["offers"]).toMatchObject({ price: 0, priceCurrency: "GBP" });
    expect(eventJsonLd({ ...event, status: "cancelled" }, opts)["eventStatus"]).toBe(
      "https://schema.org/EventCancelled",
    );
  });
  it("escapes < so data can never close the JSON-LD script", () => {
    const script = jsonLdScript({ name: "</script><script>alert(1)</script>" });
    expect(script.children).not.toContain("</script>");
    expect(JSON.parse(script.children)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
  it("puts date, place and branch in the preview description and a large card with an image", () => {
    expect(eventDescription(event)).toMatch(
      /^Wednesday,? 1 July 2026, 18:30 · Dialogue House, Medway and Online · Medway, South\./,
    );
    const head = pageMeta({ title: "T", description: "D", url: opts.url, image: opts.image });
    expect(head.meta).toContainEqual({ property: "og:image", content: opts.image });
    expect(head.meta).toContainEqual({ name: "twitter:card", content: "summary_large_image" });
    expect(head.links).toEqual([{ rel: "canonical", href: opts.url }]);
  });
});
