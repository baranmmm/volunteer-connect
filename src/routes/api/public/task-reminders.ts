import { createFileRoute } from "@tanstack/react-router";

// Daily task reminders (fallback when pg_cron is not available): the "Task reminders" workflow calls this at 08:05 and
// 09:05 UTC with the cleanup secret. run_task_reminders is idempotent and does nothing before 09:00 London time.
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
          const result = await supabaseAdmin.rpc("run_task_reminders");
          if (result.error) throw new Error("Reminders unavailable");
          return Response.json(
            { reminders: result.data ?? 0 },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            { reminders: 0 },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
