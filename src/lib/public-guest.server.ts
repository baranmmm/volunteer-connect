// Server-only protection for the signed-out forms (guest registration, "Get event updates").
// * Cloudflare Turnstile when both TURNSTILE_SITE_KEY and TURNSTILE_SECRET are set.
// * Always: a honeypot field that must stay empty, a minimum fill time (a signed form stamp issued when the form is
//   shown, at least 2 seconds before the submit) and per-IP rate limits (public_rate_hit, service role only).
// Client IPs are never stored: rate-limit buckets use an HMAC-SHA-256 of the IP with a server secret, and the raw IP
// goes only to Cloudflare's siteverify (when Turnstile is on).
import { getRequest } from "@tanstack/react-start/server";

const MIN_FILL_MS = 2000;

/** The Turnstile keys, only when both halves are configured. */
export function turnstileConfig(): { siteKey: string; secret: string } | null {
  const siteKey = process.env["TURNSTILE_SITE_KEY"]?.trim();
  const secret = process.env["TURNSTILE_SECRET"]?.trim();
  return siteKey && secret ? { siteKey, secret } : null;
}

function serverSecret(): string {
  const own = process.env["EMAIL_LINK_SECRET"]?.trim();
  if (own) return `public-forms:${own}`;
  const service = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!service) throw new Error("Public forms unavailable");
  return `public-forms:${service}`;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(serverSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A stamp for a form shown now: "<ms>.<signature>". */
export async function formStamp(now = Date.now()): Promise<string> {
  return `${now}.${(await hmac(`stamp:${now}`)).slice(0, 32)}`;
}

/** True when the stamp is genuine and was issued at least MIN_FILL_MS ago (not in the future). */
export async function stampOk(stamp: string, now = Date.now()): Promise<boolean> {
  const [ms, sig, extra] = stamp.split(".");
  if (!ms || !sig || extra !== undefined || !/^\d{10,16}$/.test(ms)) return false;
  if (!sameString((await hmac(`stamp:${ms}`)).slice(0, 32), sig)) return false;
  return now - Number(ms) >= MIN_FILL_MS;
}

/**
 * The visitor's IP. Cloudflare sets cf-connecting-ip (visitors cannot forge it behind Cloudflare); elsewhere the
 * first x-forwarded-for entry (the local/e2e server).
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 64) : "unknown";
}

/** The request origin for links in emails (appOrigin prefers APP_URL). */
export function requestOrigin(request: Request): string | null {
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

async function verifyTurnstile(
  secret: string,
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip !== "unknown") body.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

type Limit = { name: string; windowSeconds: number; max: number };
export const LIMITS: Record<"register" | "subscribe", Limit[]> = {
  register: [
    { name: "guest:ip10m", windowSeconds: 600, max: 5 },
    { name: "guest:ipday", windowSeconds: 86400, max: 20 },
  ],
  subscribe: [{ name: "sub:ip10m", windowSeconds: 600, max: 5 }],
};

async function withinLimits(kind: keyof typeof LIMITS, ip: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = (await hmac(`ip:${ip}`)).slice(0, 40);
  let ok = true;
  // Every bucket counts the hit, even after one is exhausted.
  for (const limit of LIMITS[kind]) {
    const { data, error } = await supabaseAdmin.rpc("public_rate_hit", {
      p_bucket: `${limit.name}:${key}`,
      p_window_seconds: limit.windowSeconds,
      p_max: limit.max,
    });
    if (error) throw new Error("Public forms unavailable");
    if (data !== true) ok = false;
  }
  return ok;
}

export type GuardInput = {
  honeypot?: string | undefined;
  startedAt: string;
  turnstileToken?: string | undefined;
};

/**
 * "pass": go ahead. "drop": a bot or over the limit; answer like a success and do nothing. Throws "Verification
 * failed" when Turnstile is on and its check fails (a real person can retry the challenge).
 */
export async function guardPublicForm(
  kind: keyof typeof LIMITS,
  input: GuardInput,
): Promise<{ verdict: "pass" | "drop"; origin: string | null }> {
  const request = getRequest();
  const origin = requestOrigin(request);
  if (input.honeypot) return { verdict: "drop", origin };
  if (!(await stampOk(input.startedAt))) return { verdict: "drop", origin };
  const ip = clientIp(request);
  if (!(await withinLimits(kind, ip))) return { verdict: "drop", origin };
  const turnstile = turnstileConfig();
  if (turnstile && !(await verifyTurnstile(turnstile.secret, input.turnstileToken, ip))) {
    throw new Error("Verification failed");
  }
  return { verdict: "pass", origin };
}

/** Unsubscribe by a signed link token (the unsubscribe page and the RFC 8058 one-click endpoint). */
export async function unsubscribeWithToken(
  token: string | null | undefined,
): Promise<"unsubscribed" | "invalid"> {
  const { verifyLinkToken } = await import("@/lib/email/links.server");
  const id = await verifyLinkToken("subscriber-unsubscribe", token);
  if (!id) return "invalid";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("subscriber_unsubscribe", { p_id: id });
  if (error) {
    if (error.message === "Link is no longer valid") return "invalid";
    throw new Error("Public forms unavailable");
  }
  return "unsubscribed";
}
