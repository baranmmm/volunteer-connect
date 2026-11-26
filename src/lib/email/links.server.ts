// Signed links in emails (server only). A link token is "<id>.<signature>": HMAC-SHA256 over purpose and id with a
// server secret, so links work without storing tokens and cannot be forged or reused for another purpose.
// Secret: EMAIL_LINK_SECRET, or else derived from the service role key (both server-only; rotating either one
// invalidates links already sent).

export type LinkPurpose =
  "guest-confirm" | "guest-cancel" | "subscriber-confirm" | "subscriber-unsubscribe";
/** Signature purposes: the link purposes plus notice unsubscribe links (their own token shape, below). */
type SignPurpose = LinkPurpose | "notice-unsubscribe";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function secret(): string {
  const own = process.env["EMAIL_LINK_SECRET"]?.trim();
  if (own) return own;
  const service = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!service) throw new Error("Email links unavailable");
  return `email-links:${service}`;
}

function base64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signature(purpose: SignPurpose, id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${purpose}:${id}`));
  return base64url(mac).slice(0, 32);
}

/** A token for `id` (a registration or subscriber uuid) and one purpose. */
export async function signLinkToken(purpose: LinkPurpose, id: string): Promise<string> {
  if (!UUID.test(id)) throw new Error("Invalid link id");
  return `${id}.${await signature(purpose, id)}`;
}

/** The id inside a valid token for this purpose, or null (constant-time comparison). */
export async function verifyLinkToken(
  purpose: LinkPurpose,
  token: string | null | undefined,
): Promise<string | null> {
  if (!token || token.length > 100) return null;
  const [id, sig, extra] = token.split(".");
  if (!id || !sig || extra !== undefined || !UUID.test(id)) return null;
  const expected = await signature(purpose, id);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? id : null;
}

/** The public origin for links in emails: APP_URL (e.g. https://hub.example.org), else the request origin. */
export function appOrigin(requestOrigin?: string | null): string {
  const configured = process.env["APP_URL"]?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\/[^\s/]+$/.test(configured)) return configured;
  if (requestOrigin && /^https?:\/\/[^\s/]+$/.test(requestOrigin)) return requestOrigin;
  return "http://localhost:3000";
}

const PATHS: Record<LinkPurpose, string> = {
  "guest-confirm": "/e/confirm",
  "guest-cancel": "/e/cancel",
  "subscriber-confirm": "/updates/confirm",
  "subscriber-unsubscribe": "/updates/unsubscribe",
};

/** The full link for an email, e.g. https://…/e/cancel?t=<token>. */
export async function emailLink(purpose: LinkPurpose, id: string, origin: string): Promise<string> {
  return `${origin}${PATHS[purpose]}?t=${encodeURIComponent(await signLinkToken(purpose, id))}`;
}

// ─── Notice email unsubscribe links ──────────────────────────────────────────────────────────────────────────────
// "<user>.<type>.<expiry day>.<signature>": turns off one notice type's emails for one member without signing in
// (/e/notices, and the List-Unsubscribe one-click endpoint). Valid for NOTICE_LINK_DAYS days after the email.

export const NOTICE_EMAIL_TYPES = [
  "task_assigned",
  "mention",
  "review",
  "task_status",
  "task_note",
  "task_reminder",
  "meeting",
  "request_decided",
] as const;
export type NoticeEmailType = (typeof NOTICE_EMAIL_TYPES)[number];
export const isNoticeEmailType = (value: string): value is NoticeEmailType =>
  (NOTICE_EMAIL_TYPES as readonly string[]).includes(value);
export const NOTICE_LINK_DAYS = 60;

const day = (now: Date) => Math.floor(now.getTime() / 86400000);

async function noticeSignature(user: string, type: string, expires: number): Promise<string> {
  // The purpose prefix keeps these apart from every other link (the signed text has a different shape too).
  return signature("notice-unsubscribe", `${user}:${type}:${expires}`);
}

/** A notice unsubscribe token for one member and type, valid for NOTICE_LINK_DAYS days. */
export async function signNoticeToken(
  user: string,
  type: NoticeEmailType,
  now = new Date(),
): Promise<string> {
  if (!UUID.test(user) || !isNoticeEmailType(type)) throw new Error("Invalid link id");
  const expires = day(now) + NOTICE_LINK_DAYS;
  return `${user}.${type}.${expires}.${await noticeSignature(user, type, expires)}`;
}

/** The member and type inside a valid, unexpired token, or null (constant-time comparison). */
export async function verifyNoticeToken(
  token: string | null | undefined,
  now = new Date(),
): Promise<{ user: string; type: NoticeEmailType } | null> {
  if (!token || token.length > 100) return null;
  const [user, type, expires, sig, extra] = token.split(".");
  if (
    !user ||
    !type ||
    !expires ||
    !sig ||
    extra !== undefined ||
    !UUID.test(user) ||
    !isNoticeEmailType(type)
  )
    return null;
  if (!/^\d{1,7}$/.test(expires) || Number(expires) < day(now)) return null;
  const expected = await noticeSignature(user, type, Number(expires));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { user, type } : null;
}

/** The page link (/e/notices?t=) and the RFC 8058 one-click endpoint for one member and type. */
export async function noticeUnsubscribeLinks(
  user: string,
  type: NoticeEmailType,
  origin: string,
  now = new Date(),
): Promise<{ page: string; oneClick: string }> {
  const t = encodeURIComponent(await signNoticeToken(user, type, now));
  return {
    page: `${origin}/e/notices?t=${t}`,
    oneClick: `${origin}/api/public/notice-unsubscribe?t=${t}`,
  };
}
