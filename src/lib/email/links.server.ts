// Signed links in emails (server only). A link token is "<id>.<signature>": HMAC-SHA256 over purpose and id with a
// server secret, so links work without storing tokens and cannot be forged or reused for another purpose.
// Secret: EMAIL_LINK_SECRET, or else derived from the service role key (both server-only; rotating either one
// invalidates links already sent).

export type LinkPurpose =
  "guest-confirm" | "guest-cancel" | "subscriber-confirm" | "subscriber-unsubscribe";

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

async function signature(purpose: LinkPurpose, id: string): Promise<string> {
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
