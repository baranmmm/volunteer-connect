import { createFileRoute } from "@tanstack/react-router";

// One-click unsubscribe (RFC 8058) for the List-Unsubscribe header of announcement emails: mail clients POST here
// with the signed token (?t=). A GET (someone opening the header link) goes to the unsubscribe page instead. The
// answer never says whether the token belonged to anyone.
export const Route = createFileRoute("/api/public/unsubscribe")({
  ssr: false,
  server: {
    handlers: {
      GET: ({ request }) => {
        const token = new URL(request.url).searchParams.get("t") ?? "";
        return new Response(null, {
          status: 303,
          headers: {
            Location: `/updates/unsubscribe?t=${encodeURIComponent(token)}`,
            "Cache-Control": "no-store",
          },
        });
      },
      POST: async ({ request }) => {
        const headers = { "Cache-Control": "no-store" };
        try {
          const { unsubscribeWithToken } = await import("@/lib/public-guest.server");
          const state = await unsubscribeWithToken(new URL(request.url).searchParams.get("t"));
          return new Response(null, { status: state === "unsubscribed" ? 200 : 400, headers });
        } catch {
          return new Response(null, { status: 500, headers });
        }
      },
    },
  },
});
