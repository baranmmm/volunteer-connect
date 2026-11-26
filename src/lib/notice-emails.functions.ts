import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Signed-out: the notice email "stop these emails" link page (/e/notices). No auth middleware on purpose: the signed
// token is the authorisation, and the only database call is the service-role-only notice_email_unsubscribe.
const token = z.object({ token: z.string().min(1).max(100) });

export const checkNoticeLink = createServerFn({ method: "POST" })
  .inputValidator(token)
  .handler(async ({ data }) => {
    const { checkNoticeToken } = await import("@/lib/notice-emails.server");
    return checkNoticeToken(data.token);
  });

export const unsubscribeNoticeEmails = createServerFn({ method: "POST" })
  .inputValidator(token)
  .handler(async ({ data }) => {
    const { unsubscribeNoticeWithToken } = await import("@/lib/notice-emails.server");
    return unsubscribeNoticeWithToken(data.token);
  });
