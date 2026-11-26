import { createFileRoute } from "@tanstack/react-router";

// Daily task reminders, the daily summary email, event reminders and the email sender. The "Task reminders" workflow
// calls this at 07:05, 08:05, 09:05, 13:05 and 18:05 UTC with the cleanup secret. The queueing functions are
// idempotent: run_notification_digest does nothing before 08:00 London time and queues at most one summary email per
// person and London day (none when nothing is new; `digests` counts those emails), run_task_reminders nothing before
// 09:00, enqueue_event_reminders queues one reminder per registration two days before the start. Each run then sends
// what the daily email limit allows (transactional first, then notice emails, reminders, announcements and the daily
// summaries last); the later runs drain the rest, and anything over the limit continues the next day. Then it sends the
// push notifications still waiting (docs/push.md). Only numbers are returned.
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
          const events = await supabaseAdmin.rpc("enqueue_event_reminders");
          if (events.error) throw new Error("Event reminders unavailable");
          const { flushOutbox } = await import("@/lib/email/outbox.server");
          const emails = await flushOutbox({ maxPriority: 5, max: 300 });
          // Pushes a member action could not send at once (the scheduled backstop).
          const { flushPush } = await import("@/lib/push/sender.server");
          const pushes = await flushPush({ max: 300, timeBudgetMs: 15000 });
          return Response.json(
            {
              reminders: result.data ?? 0,
              digests: digest.data ?? 0,
              event_reminders: events.data ?? 0,
              emails_sent: emails.sent,
              emails_skipped: emails.skipped,
              emails_failed: emails.failed,
              pushes_sent: pushes.sent,
              pushes_failed: pushes.failed,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            {
              reminders: 0,
              digests: 0,
              event_reminders: 0,
              emails_sent: 0,
              emails_skipped: 0,
              emails_failed: 0,
              pushes_sent: 0,
              pushes_failed: 0,
            },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
