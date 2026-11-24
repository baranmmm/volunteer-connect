import { createFileRoute } from "@tanstack/react-router";

// The landing page data as a plain GET, so the HTML shell of "/" can <link rel="preload"> it: the request then runs
// in parallel with the page code instead of after it. Same content as getLanding (public fields, 5-minute signed
// image links, no storage paths); never cached because the links expire.
export const Route = createFileRoute("/api/public/landing")({
  ssr: false,
  server: {
    handlers: {
      GET: async () => {
        try {
          const { fetchLanding } = await import("@/lib/landing.server");
          return Response.json(await fetchLanding(), { headers: { "Cache-Control": "no-store" } });
        } catch {
          return Response.json(
            { error: "unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
