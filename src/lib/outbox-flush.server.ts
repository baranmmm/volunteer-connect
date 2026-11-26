// The outbox tick (server only): POST /api/public/outbox-flush, called every minute by pg_cron (public.outbox_flush_tick,
// only while work is due) with SCHEDULED_JOBS_SECRET. Sends the waiting push notifications and the email outbox for
// every priority (transactional, notice emails, reminders, announcements, daily summaries) within the daily limit,
// side by side, each within about 10 s so the answer comes well before pg_net's 25 s timeout. Without Brevo
// (BREVO_API_KEY / EMAIL_FROM) the email part does nothing: no row is claimed, so no attempt is used and nothing is
// marked failed; one line is logged. Only counts and the configuration state are returned (never a key).
import { scheduledJobAuthorized, unauthorizedResponse } from "./scheduled-jobs.server";

export const OUTBOX_FLUSH_BUDGET_MS = 10000;

export type OutboxFlushBody = {
  vapid: string;
  pushes_claimed: number;
  pushes_sent: number;
  pushes_gone: number;
  pushes_retried: number;
  pushes_failed: number;
  email: "ok" | "not_configured";
  emails_sent: number;
  emails_skipped: number;
  emails_failed: number;
};

export async function handleOutboxFlush(request: Request): Promise<Response> {
  if (!scheduledJobAuthorized(request.headers.get("Authorization"))) return unauthorizedResponse();
  const headers = { "Cache-Control": "no-store" };
  try {
    const { flushPush } = await import("@/lib/push/sender.server");
    const { emailSenderConfigured, flushOutbox } = await import("@/lib/email/outbox.server");
    const email = emailSenderConfigured() ? "ok" : "not_configured";
    if (email === "not_configured")
      console.warn("[email] flush skipped: BREVO_API_KEY or EMAIL_FROM not set");
    const [pushes, emails] = await Promise.all([
      flushPush({ trigger: "cron", max: 300, timeBudgetMs: OUTBOX_FLUSH_BUDGET_MS }),
      email === "ok"
        ? flushOutbox({ maxPriority: 5, max: 300, timeBudgetMs: OUTBOX_FLUSH_BUDGET_MS })
        : Promise.resolve({ sent: 0, skipped: 0, failed: 0 }),
    ]);
    const body: OutboxFlushBody = {
      vapid: pushes.vapid,
      pushes_claimed: pushes.claimed,
      pushes_sent: pushes.sent,
      pushes_gone: pushes.gone,
      pushes_retried: pushes.retried,
      pushes_failed: pushes.failed,
      email,
      emails_sent: emails.sent,
      emails_skipped: emails.skipped,
      emails_failed: emails.failed,
    };
    return Response.json(body, { headers });
  } catch (error) {
    console.error(`[outbox] tick failed: ${error instanceof Error ? error.name : "error"}`);
    return Response.json({ error: "unavailable" }, { status: 500, headers });
  }
}
