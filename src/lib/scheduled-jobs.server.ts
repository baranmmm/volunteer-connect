// The scheduled routes (server only): /api/public/task-reminders, /api/public/cleanup-deleted-events and
// /api/public/push-flush are called by pg_cron (pg_net, the secret in Supabase Vault) and the manual fallback GitHub
// workflows with `Authorization: Bearer <SCHEDULED_JOBS_SECRET>`. One shared secret (a server env variable, never a
// VITE_ one); an unset or empty secret refuses every call. Constant-time comparison of the SHA-256 digests (equal
// lengths whatever the input).
import { createHash, timingSafeEqual } from "node:crypto";

/** Whether an Authorization header carries the secret. */
export function bearerAuthorized(header: string | null | undefined, secret: string | undefined) {
  const expected = secret?.trim();
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7).trim()), digest(expected));
}

/** Whether a request to a scheduled route carries SCHEDULED_JOBS_SECRET. */
export function scheduledJobAuthorized(
  header: string | null | undefined,
  secret: string | undefined = process.env["SCHEDULED_JOBS_SECRET"],
) {
  return bearerAuthorized(header, secret);
}

/** The answer to a call without the secret (nothing else is said). */
export const unauthorizedResponse = () =>
  new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
