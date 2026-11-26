// The push sender (server only): claims queued push_outbox rows (claim_push_batch skips what no longer applies),
// renders each from its notice in the member's language (src/lib/push/payload.ts: no sensitive details), encrypts it
// for the device (RFC 8291) and posts it to the device's push service with a VAPID token (RFC 8292).
// * Nothing is claimed while the VAPID keys are missing or fail the self-check (src/lib/push/vapid.server.ts): rows wait
//   and expire after a day.
// * 404/410 from the push service: the subscription is gone and deleted ('gone'); 429/5xx/network: retried with
//   back-off; other refusals: failed.
// * Never throws; never logs endpoints, keys or content.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { buildPushMessage } from "./payload";
import { serverVapid } from "./vapid.server";
import { buildPushRequest } from "./webpush";

type Admin = SupabaseClient<Database>;
type ClaimedPush = Database["public"]["Functions"]["claim_push_batch"]["Returns"][number];
export type PushFlushResult = { sent: number; gone: number; retried: number; failed: number };
export type PushOutcome = { result: "sent" | "gone" | "retry" | "failed"; error?: string };

const BATCH = 25;
const PARALLEL = 6;
const REQUEST_TIMEOUT_MS = 8000;

/** How the sender treats a push service answer. */
export function classifyPushResponse(status: number): PushOutcome {
  if (status >= 200 && status < 300) return { result: "sent" };
  if (status === 404 || status === 410) return { result: "gone", error: `http_${status}` };
  if (status === 429 || status >= 500) return { result: "retry", error: `http_${status}` };
  return { result: "failed", error: `http_${status}` };
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
    return { result: "gone", error: "invalid_subscription" };
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
    return { result: "retry", error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** Claims and sends queued pushes (at most `max`, about `timeBudgetMs`). Never throws. */
export async function flushPush(
  opts: { max?: number; timeBudgetMs?: number } = {},
): Promise<PushFlushResult> {
  const counts: PushFlushResult = { sent: 0, gone: 0, retried: 0, failed: 0 };
  try {
    const vapid = await serverVapid();
    if (!vapid.ok) return counts;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as Admin;
    const deadline = Date.now() + (opts.timeBudgetMs ?? 10000);
    let remaining = Math.max(1, Math.min(Math.trunc(opts.max ?? 50), 300));
    while (remaining > 0 && Date.now() < deadline) {
      const claim = await admin.rpc("claim_push_batch", { p_max: Math.min(remaining, BATCH) });
      if (claim.error || !claim.data?.length) break;
      remaining -= claim.data.length;
      for (let i = 0; i < claim.data.length; i += PARALLEL) {
        const chunk = claim.data.slice(i, i + PARALLEL);
        await Promise.all(
          chunk.map(async (row) => {
            // Out of time: give it back (claims also return by themselves after 5 minutes).
            const outcome: PushOutcome =
              Date.now() > deadline + REQUEST_TIMEOUT_MS
                ? { result: "retry", error: "deferred" }
                : await sendOne(row, vapid);
            await admin.rpc("finish_push", {
              p_id: row.id,
              p_result: outcome.result,
              ...(outcome.error ? { p_error: outcome.error } : {}),
            });
            if (outcome.result === "sent") counts.sent++;
            else if (outcome.result === "gone") counts.gone++;
            else if (outcome.result === "retry") counts.retried++;
            else counts.failed++;
          }),
        );
      }
    }
  } catch {
    /* non-fatal: rows stay queued for the next run */
  }
  return counts;
}
