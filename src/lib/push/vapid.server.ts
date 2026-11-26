// VAPID keys on the server (server only). VAPID_PRIVATE_KEY (base64url raw 32-byte P-256 scalar) and VAPID_SUBJECT
// (mailto: or https: contact) are server secrets; the public key is VAPID_PUBLIC_KEY (src/lib/push/config.ts, the one the
// browsers subscribed with). Self-check: the public point derived from the private key must equal that public key,
// otherwise every push would be refused by the push services (or, worse, signed with a key the browsers do not know):
// nothing is sent until it is fixed, and every flush with pushes waiting logs the problem (never either key). Workers have
// no long-lived start-up, so the check runs lazily; only a usable result is cached per isolate.
import { base64urlDecode } from "./base64url";
import { VAPID_PUBLIC_KEY } from "./config";
import { p256PublicKey } from "./p256";
import { importVapidSigningKey } from "./webpush";

export type VapidProblem =
  "missing" | "invalid_private_key" | "invalid_public_key" | "invalid_subject" | "mismatch";
export type VapidCheck =
  | { ok: true; signingKey: CryptoKey; publicKey: string; subject: string }
  | { ok: false; problem: VapidProblem; message: string };

const MESSAGES: Record<VapidProblem, string> = {
  missing:
    "Web Push is not configured: VAPID_PRIVATE_KEY or VAPID_SUBJECT is not set; no push is sent.",
  invalid_private_key:
    "Web Push disabled: VAPID_PRIVATE_KEY is not a base64url raw 32-byte P-256 private key; no push is sent until it is fixed.",
  invalid_public_key:
    "Web Push disabled: VITE_VAPID_PUBLIC_KEY is not a base64url uncompressed P-256 public key; no push is sent until it is fixed.",
  invalid_subject:
    "Web Push disabled: VAPID_SUBJECT must start with mailto: or https:; no push is sent until it is fixed.",
  mismatch:
    "Web Push disabled: VAPID_PRIVATE_KEY does not match VITE_VAPID_PUBLIC_KEY (the public key browsers subscribe with). " +
    "Set the private key that belongs to that public key (or rotate both, docs/push.md); no push is sent until they match.",
};

const fail = (problem: VapidProblem): VapidCheck => ({
  ok: false,
  problem,
  message: MESSAGES[problem],
});

/** Checks a key pair and subject; the result never contains either key. */
export async function checkVapidKeys(input: {
  privateKey: string | undefined;
  publicKey: string | undefined;
  subject: string | undefined;
}): Promise<VapidCheck> {
  const privateText = input.privateKey?.trim();
  const subject = input.subject?.trim();
  if (!privateText || !subject) return fail("missing");
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) return fail("invalid_subject");
  let publicBytes: Uint8Array;
  try {
    publicBytes = base64urlDecode(input.publicKey ?? "");
  } catch {
    return fail("invalid_public_key");
  }
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) return fail("invalid_public_key");
  let derived: Uint8Array;
  let privateBytes: Uint8Array;
  try {
    privateBytes = base64urlDecode(privateText);
    derived = p256PublicKey(privateBytes);
  } catch {
    return fail("invalid_private_key");
  }
  let same = derived.length === publicBytes.length;
  for (let i = 0; same && i < derived.length; i++) same = derived[i] === publicBytes[i];
  if (!same) return fail("mismatch");
  try {
    const signingKey = await importVapidSigningKey(privateBytes, derived);
    return { ok: true, signingKey, publicKey: input.publicKey!.trim(), subject };
  } catch {
    return fail("invalid_private_key");
  }
}

// Only a usable result is cached: a failed check (a secret added or fixed later, a key pair published together) is
// repeated on the next call, which is cheap, so the isolate never stays silent and disabled after the fix.
let cached: Promise<VapidCheck> | null = null;

/**
 * The server's VAPID keys. A success is cached per isolate; a failure is re-checked on every call. Logs nothing: the
 * sender (src/lib/push/sender.server.ts) logs the problem once per flush that has pushes waiting.
 */
export async function serverVapid(): Promise<VapidCheck> {
  if (cached) return cached;
  const attempt = checkVapidKeys({
    privateKey: process.env["VAPID_PRIVATE_KEY"],
    publicKey: VAPID_PUBLIC_KEY,
    subject: process.env["VAPID_SUBJECT"],
  }).catch(() => fail("invalid_private_key"));
  cached = attempt;
  const result = await attempt;
  if (!result.ok && cached === attempt) cached = null;
  return result;
}

/** Tests only: forget the cached check. */
export function resetVapidCache() {
  cached = null;
}
