// Notice email links (server only): the signed "stop these emails" link turns off one notice type's emails for one
// member without signing in (/e/notices and the RFC 8058 one-click endpoint). The answer never says more than
// valid/invalid. Logs nothing personal.
import { isNoticeEmailType, verifyNoticeToken, type NoticeEmailType } from "@/lib/email/links.server";

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
  return data === "unsubscribed" ? { state: "unsubscribed", type: link.type } : { state: "invalid" };
}

/** Sends the notice emails a member action just queued (assignments, invitations, requests waiting). Never throws. */
export async function flushNoticeEmails(): Promise<void> {
  try {
    const { flushOutbox, requestOrigin } = await import("@/lib/email/outbox.server");
    await flushOutbox({ maxPriority: 2, max: 60, origin: await requestOrigin() });
  } catch {
    /* non-fatal: rows stay queued for the scheduled sender */
  }
}
