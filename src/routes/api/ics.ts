import { createFileRoute } from "@tanstack/react-router";

// Public calendar feed: /api/ics?branch=medway,brighton (or every branch). Public events of the next 6 months;
// cancelled ones as STATUS:CANCELLED; no online links. Cached for 15 minutes.
export const Route = createFileRoute("/api/ics")({
  ssr: false,
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const branch = url.searchParams.get("branch");
        if (branch && branch.length > 4000) return new Response("Bad request", { status: 400 });
        try {
          const { fetchPublicEvents } = await import("@/lib/public-events.server");
          const { publicEventsIcs } = await import("@/lib/public-events");
          const events = await fetchPublicEvents({ branchSlugs: branch, months: 6, includeCancelled: true });
          const body = publicEventsIcs(events, url.origin, "Dialogue Society events");
          return new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "text/calendar; charset=utf-8",
              "Content-Disposition": 'inline; filename="dialogue-society-events.ics"',
              "Cache-Control": "public, max-age=900",
            },
          });
        } catch {
          return new Response("Calendar unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
