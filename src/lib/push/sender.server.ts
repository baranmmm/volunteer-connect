// The push sender (server only): claims queued push_outbox rows (claim_push_batch skips what no longer applies),
// renders each from its notice in the member's language (src/lib/push/payload.ts: no sensitive details), encrypts it
// for the device (RFC 8291) and posts it to the device's push service with a VAPID token (RFC 8292).
// * Nothing is claimed while the VAPID keys are missing or fail the self-check (src/lib/push/vapid.server.ts): rows wait
//   and expire after a day.
// * 404/410 from the push service: the subscription is gone and deleted ('gone'); 429/5xx/network: retried with
//   back-off; other refusals: failed.
// * Never throws. Logs (Lovable server logs, docs/push.md "Troubleshooting"): one `[push] flush …` summary per flush,
//   one `[push] attempt …` line per send, `[push] vapid problem=…` once per flush while pushes wait and the keys are
//   unusable, and claim/finish/unexpected errors. Never endpoints, keys, user ids, emails or content: only the outbox
//   row id, the notice kind, the attempt number, the result and the HTTP status (or network / invalid_subscription).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { buildPushMessage } from "./payload";
import { serverVapid, type VapidProblem } from "./vapid.server";
import { buildPushRequest } from "./webpush";

type Admin = SupabaseClient<Database>;
type ClaimedPush = Database["public"]["Functions"]["claim_push_batch"]["Returns"][number];
/** What started a flush (for the log): a member action, the minute pg_cron call, or the scheduled reminders run. */
export type PushTrigger = "post-action" | "cron" | "reminders";
export type PushFlushResult = {
  claimed: number;
  sent: number;
  gone: number;
  retried: number;
  failed: number;
  /** "ok", or why the VAPID keys are unusable (nothing was claimed). */
  vapid: "ok" | VapidProblem;
};
export type PushOutcome = {
  result: "sent" | "gone" | "retry" | "failed";
  error?: string;
  /** For the log: the HTTP status, or network / invalid_subscription / deferred. */
  http?: string;
};

const BATCH = 25;
const PARALLEL = 6;
const REQUEST_TIMEOUT_MS = 8000;

/** How the sender treats a push service answer. */
export function classifyPushResponse(status: number): PushOutcome {
  const http = String(status);
  if (status >= 200 && status < 300) return { result: "sent", http };
  if (status === 404 || status === 410) return { result: "gone", error: `http_${status}`, http };
  if (status === 429 || status >= 500) return { result: "retry", error: `http_${status}`, http };
  return { result: "failed", error: `http_${status}`, http };
}

/**
 * A log-safe short text (an error code or message): long tokens (keys, JWTs, URLs, ids) are replaced and the text is
 * cut to 160 characters, so a database or network message can never carry a secret or an endpoint into the log.
 */
export function logSafe(value: unknown): string {
  return String(value ?? "")
    .replace(/[A-Za-z0-9+/_=.:%-]{24,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; message?: unknown };
    const code = e.code ? `code=${logSafe(e.code)} ` : "";
    return `${code}${logSafe(e.message ?? "unknown error")}`;
  }
  return logSafe(error);
}

function asRecord(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function sendOne(
  row: ClaimedPush,
  vapid: { signingKey: CryptoKey; publicKey: string; subject: string },
): Promise<PushOutcome> {
  const message = buildPushMessage({
    kind: row.kind,
    payload: asRecord(row.payload),
    link: row.link,
    notificationId: row.notification_id,
    language: row.language,
  });
  let request;
  try {
    request = await buildPushRequest(
      { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
      JSON.stringify(message),
      vapid,
      {
        ttlSeconds: 24 * 3600,
        urgency: row.kind === "task_reminder" ? "normal" : "high",
        ...(row.kind === "review_waiting" ? { topic: "review" } : {}),
      },
    );
  } catch {
    // The device's keys or endpoint cannot be used (not a valid point, not https): the subscription is unusable.
    return { result: "gone", error: "invalid_subscription", http: "invalid_subscription" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    // Drain the (small) body so the connection is released.
    await response.arrayBuffer().catch(() => undefined);
    return classifyPushResponse(response.status);
  } catch {
    return { result: "retry", error: "network", http: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** Claims and sends queued pushes (at most `max`, about `timeBudgetMs`). Never throws. */
export async function flushPush(
  opts: { trigger?: PushTrigger; max?: number; timeBudgetMs?: number } = {},
): Promise<PushFlushResult> {
  const trigger: PushTrigger = opts.trigger ?? "post-action";
  const counts: PushFlushResult = {
    claimed: 0,
    sent: 0,
    gone: 0,
    retried: 0,
    failed: 0,
    vapid: "ok",
  };
  let summary = true;
  try {
    const vapid = await serverVapid();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as Admin;
    if (!vapid.ok) {
      counts.vapid = vapid.problem;
      // Loud only while pushes are waiting (an environment without keys stays quiet otherwise); once per flush.
      const due = await admin.rpc("outbox_flush_due");
      if (due.error || due.data) {
        const line = `[push] vapid problem=${vapid.problem}: ${vapid.message}`;
        if (vapid.problem === "missing") console.warn(line);
        else console.error(line);
      } else summary = false;
    }
    const deadline = Date.now() + (opts.timeBudgetMs ?? 10000);
    let remaining = Math.max(1, Math.min(Math.trunc(opts.max ?? 50), 300));
    while (vapid.ok && remaining > 0 && Date.now() < deadline) {
      const claim = await admin.rpc("claim_push_batch", { p_max: Math.min(remaining, BATCH) });
      if (claim.error) {
        console.error(`[push] claim failed: ${errorText(claim.error)}`);
        break;
      }
      if (!claim.data?.length) break;
      remaining -= claim.data.length;
      counts.claimed += claim.data.length;
      for (let i = 0; i < claim.data.length; i += PARALLEL) {
        const chunk = claim.data.slice(i, i + PARALLEL);
        await Promise.all(
          chunk.map(async (row) => {
            // Out of time: give it back (claims also return by themselves after 5 minutes).
            const outcome: PushOutcome =
              Date.now() > deadline + REQUEST_TIMEOUT_MS
                ? { result: "retry", error: "deferred", http: "deferred" }
                : await sendOne(row, vapid);
            console.log(
              `[push] attempt outbox=${row.id} kind=${logSafe(row.kind)} attempt=${row.attempts} ` +
                `result=${outcome.result} http=${outcome.http ?? "none"}`,
            );
            const finish = await admin.rpc("finish_push", {
              p_id: row.id,
              p_result: outcome.result,
              ...(outcome.error ? { p_error: outcome.error } : {}),
            });
            if (finish.error)
              console.error(`[push] finish failed outbox=${row.id}: ${errorText(finish.error)}`);
            if (outcome.result === "sent") counts.sent++;
            else if (outcome.result === "gone") counts.gone++;
            else if (outcome.result === "retry") counts.retried++;
            else counts.failed++;
          }),
        );
      }
    }
  } catch (error) {
    // Non-fatal: rows stay queued for the next run.
    console.error(`[push] flush error: ${errorText(error)}`);
  }
  if (summary)
    console.log(
      `[push] flush trigger=${trigger} vapid=${counts.vapid} claimed=${counts.claimed} sent=${counts.sent} ` +
        `gone=${counts.gone} retry=${counts.retried} failed=${counts.failed}`,
    );
  return counts;
}
