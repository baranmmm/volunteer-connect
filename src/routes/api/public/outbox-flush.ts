import { createFileRoute } from "@tanstack/react-router";

// The outbox tick: pg_cron (job 'outbox-flush', every minute while work is due) posts here with SCHEDULED_JOBS_SECRET;
// sends waiting push notifications and queued emails (src/lib/outbox-flush.server.ts, docs/push.md, docs/email.md).
export const Route = createFileRoute("/api/public/outbox-flush")({
  ssr: false,
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleOutboxFlush } = await import("@/lib/outbox-flush.server");
        return handleOutboxFlush(request);
      },
    },
  },
});
