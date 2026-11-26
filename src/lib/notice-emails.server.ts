// Notice email links (server only): the signed "stop these emails" link turns off one notice type's emails for one
// member without signing in (/e/notices and the RFC 8058 one-click endpoint). The answer never says more than
// valid/invalid. Logs nothing personal.
import {
  isNoticeEmailType,
  verifyNoticeToken,
  type NoticeEmailType,
} from "@/lib/email/links.server";

export type NoticeLinkState =
  | { state: "valid"; type: NoticeEmailType }
  | { state: "unsubscribed"; type: NoticeEmailType }
  | { state: "invalid" };

/** Whether a token is valid (signature and expiry), and for which notice type; no database call. */
export async function checkNoticeToken(token: string | null | undefined): Promise<NoticeLinkState> {
  const link = await verifyNoticeToken(token);
  return link ? { state: "valid", type: link.type } : { state: "invalid" };
}

/** Turns that notice type's emails off for the token's member. */
export async function unsubscribeNoticeWithToken(
  token: string | null | undefined,
): Promise<NoticeLinkState> {
  const link = await verifyNoticeToken(token);
  if (!link || !isNoticeEmailType(link.type)) return { state: "invalid" };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("notice_email_unsubscribe", {
    p_user: link.user,
    p_type: link.type,
  });
  if (error) throw new Error("Email links unavailable");
  return data === "unsubscribed"
    ? { state: "unsubscribed", type: link.type }
    : { state: "invalid" };
}

/**
 * Sends what a member action just queued: the notice emails (assignments, invitations, requests waiting) and the push
 * notifications of the same notices (src/lib/push/sender.server.ts), side by side. Never throws.
 */
export async function flushNoticeEmails(): Promise<void> {
  const emails = (async () => {
    const { flushOutbox, requestOrigin } = await import("@/lib/email/outbox.server");
    await flushOutbox({ maxPriority: 2, max: 60, origin: await requestOrigin() });
  })();
  const pushes = (async () => {
    const { flushPush } = await import("@/lib/push/sender.server");
    await flushPush({ trigger: "post-action", max: 50, timeBudgetMs: 8000 });
  })();
  // Non-fatal: rows stay queued for the minute outbox tick (/api/public/outbox-flush). Logged (message only), e.g. a
  // sender module that failed to load.
  const results = await Promise.allSettled([emails, pushes]);
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const reason = result.reason as { message?: unknown } | null;
      const message = String(reason?.message ?? result.reason ?? "unknown error")
        .replace(/[A-Za-z0-9+/_=.:%-]{24,}/g, "[redacted]")
        .slice(0, 160);
      console.error(`[${i === 0 ? "email" : "push"}] post-action flush failed: ${message}`);
    }
  });
}
