import { createHmac } from "node:crypto";
import { E2E_EMAIL_LINK_SECRET } from "../../setup/email-capture";

export type LinkPurpose = "guest-confirm" | "guest-cancel" | "subscriber-confirm" | "subscriber-unsubscribe";

/**
 * A signed email link token, as src/lib/email/links.server.ts makes it, with the e2e app server's secret: for links
 * whose email a test does not trigger (e.g. the unsubscribe link of an announcement).
 */
export async function emailLinkToken(purpose: LinkPurpose, id: string): Promise<string> {
  const secret = process.env["EMAIL_LINK_SECRET"]?.trim() || E2E_EMAIL_LINK_SECRET;
  const sig = createHmac("sha256", secret).update(`${purpose}:${id}`).digest("base64url").slice(0, 32);
  return `${id}.${sig}`;
}
