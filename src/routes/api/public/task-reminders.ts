import { createFileRoute } from "@tanstack/react-router";

// Daily task reminders and the daily notification summary (fallback when pg_cron is not available): the "Task
// reminders" workflow calls this at 07:05, 08:05 and 09:05 UTC with the cleanup secret. Both functions are idempotent;
// run_notification_digest does nothing before 08:00 London time, run_task_reminders nothing before 09:00.
export const Route = createFileRoute("/api/public/task-reminders")({
  ssr: false,
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { cleanupAuthorized } = await import("@/lib/event-cleanup.server");
        if (
          !cleanupAuthorized(
            request.headers.get("Authorization"),
            process.env["CLEANUP_CRON_SECRET"],
          )
        ) {
          return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const digest = await supabaseAdmin.rpc("run_notification_digest");
          if (digest.error) throw new Error("Daily summary unavailable");
          const result = await supabaseAdmin.rpc("run_task_reminders");
          if (result.error) throw new Error("Reminders unavailable");
          return Response.json(
            { reminders: result.data ?? 0, digests: digest.data ?? 0 },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            { reminders: 0, digests: 0 },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
