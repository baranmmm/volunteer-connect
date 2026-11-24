import { createFileRoute } from "@tanstack/react-router";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The cover of a public event as a stable URL for link previews (og:image, JSON-LD): signed storage links expire after
// five minutes, which breaks previews that crawlers fetch later. Serves the 1280 px copy (else the original) only after
// get_public_event_image confirms the event is public and not deleted; never reveals the storage path. Cached for a
// day (a changed or removed cover shows up within that time).
export const Route = createFileRoute("/api/public/event-image/$id")({
  ssr: false,
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!UUID.test(params.id)) return notFound();
        try {
          const { publicEventCover } = await import("@/lib/public-events.server");
          const cover = await publicEventCover(params.id.toLowerCase());
          if (!cover) return notFound();
          return new Response(cover.body, {
            headers: {
              "Content-Type": cover.type,
              "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          return new Response("Unavailable", {
            status: 503,
            headers: { "Cache-Control": "no-store" },
          });
        }
      },
    },
  },
});

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
