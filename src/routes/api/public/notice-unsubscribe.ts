import { createFileRoute } from "@tanstack/react-router";

// One-click unsubscribe (RFC 8058) for the List-Unsubscribe header of member notice emails: mail clients POST here
// with the signed token (?t=); it turns off that notice type's emails. A GET (someone opening the header link) goes to
// the /e/notices page instead. The answer never says whose token it was.
export const Route = createFileRoute("/api/public/notice-unsubscribe")({
  ssr: false,
  server: {
    handlers: {
      GET: ({ request }) => {
        const token = new URL(request.url).searchParams.get("t") ?? "";
        return new Response(null, {
          status: 303,
          headers: {
            Location: `/e/notices?t=${encodeURIComponent(token)}`,
            "Cache-Control": "no-store",
          },
        });
      },
      POST: async ({ request }) => {
        const headers = { "Cache-Control": "no-store" };
        try {
          const { unsubscribeNoticeWithToken } = await import("@/lib/notice-emails.server");
          const result = await unsubscribeNoticeWithToken(
            new URL(request.url).searchParams.get("t"),
          );
          return new Response(null, {
            status: result.state === "unsubscribed" ? 200 : 400,
            headers,
          });
        } catch {
          return new Response(null, { status: 500, headers });
        }
      },
    },
  },
});
