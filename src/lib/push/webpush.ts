// Web Push with Web Crypto only (Cloudflare Workers, Node, browsers; no Node-only library): message encryption per
// RFC 8291 (aes128gcm content coding, RFC 8188) and VAPID per RFC 8292 (an ES256 JWT for the push service's origin).
// Server code imports this (src/lib/push/sender.server.ts); it holds no keys itself.
import { base64urlDecode, base64urlEncode, concatBytes, utf8 } from "./base64url";

const subtle = () => globalThis.crypto.subtle;
type Bytes = Uint8Array<ArrayBuffer>;

/** A browser's subscription (PushSubscription.toJSON()). */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await subtle().importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await subtle().sign("HMAC", k, data));
}

/** HKDF (RFC 5869) with one block of output (≤ 32 bytes), as RFC 8291 uses it. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concatBytes(info, new Uint8Array([1])))).slice(0, length);
}

export type LocalKeys = { privateKey: CryptoKey; publicKey: Bytes };

/** A fresh ECDH key pair for one message (the "application server" keys of RFC 8291). */
export async function generateLocalKeys(): Promise<LocalKeys> {
  const pair = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicKey: new Uint8Array(await subtle().exportKey("raw", pair.publicKey)),
  };
}

/**
 * Encrypts a message for one subscription: the aes128gcm body (salt ‖ record size ‖ key id length ‖ sender public key ‖
 * ciphertext), one record. `salt` and `local` are for test vectors only; by default both are random per message.
 */
export async function encryptPushMessage(
  plaintext: Uint8Array,
  target: Pick<PushTarget, "p256dh" | "auth">,
  options: { salt?: Uint8Array; local?: LocalKeys; recordSize?: number } = {},
): Promise<Bytes> {
  const uaPublic = base64urlDecode(target.p256dh);
  const authSecret = base64urlDecode(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("invalid_p256dh");
  if (authSecret.length !== 16) throw new Error("invalid_auth");
  const recordSize = options.recordSize ?? 4096;
  // One record: the plaintext, the last-record delimiter (2), then the 16-byte tag must fit.
  if (plaintext.length + 1 + 16 > recordSize) throw new Error("payload_too_large");
  const local = options.local ?? (await generateLocalKeys());
  const salt = options.salt
    ? new Uint8Array(options.salt)
    : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error("invalid_salt");

  const uaKey = await subtle().importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await subtle().deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256),
  );
  // RFC 8291 §3.4: IKM from the ECDH secret and the auth secret, then the content encryption key and nonce (RFC 8188).
  const keyInfo = concatBytes(utf8("WebPush: info\0"), uaPublic, local.publicKey);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const aesKey = await subtle().importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concatBytes(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, record),
  );
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize);
  header[20] = local.publicKey.length;
  return concatBytes(header, local.publicKey, ciphertext);
}

/** Imports the VAPID signing key from its private scalar and public point (JWK needs both). */
export async function importVapidSigningKey(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Promise<CryptoKey> {
  if (privateKey.length !== 32 || publicKey.length !== 65 || publicKey[0] !== 4)
    throw new Error("invalid_vapid_key");
  return subtle().importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: base64urlEncode(privateKey),
      x: base64urlEncode(publicKey.slice(1, 33)),
      y: base64urlEncode(publicKey.slice(33, 65)),
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** The audience of a VAPID token: the push service's origin. */
export const vapidAudience = (endpoint: string) => new URL(endpoint).origin;

/**
 * An RFC 8292 token: ES256 JWT {aud: push service origin, exp: at most 24 h ahead (12 h here), sub: mailto:/https:
 * contact}. Web Crypto's ECDSA signature is already the JOSE form (r ‖ s, 64 bytes).
 */
export async function vapidJwt(
  signingKey: CryptoKey,
  claims: { audience: string; subject: string; now?: number; ttlSeconds?: number },
): Promise<string> {
  const now = Math.floor((claims.now ?? Date.now()) / 1000);
  const header = base64urlEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = base64urlEncode(
    utf8(
      JSON.stringify({
        aud: claims.audience,
        exp: now + Math.min(claims.ttlSeconds ?? 12 * 3600, 24 * 3600),
        sub: claims.subject,
      }),
    ),
  );
  const signature = new Uint8Array(
    await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, utf8(`${header}.${body}`)),
  );
  return `${header}.${body}.${base64urlEncode(signature)}`;
}

export type PushRequest = { url: string; headers: Record<string, string>; body: Bytes };

/** The HTTP request for one push: encrypted body, VAPID authorization, TTL and urgency. */
export async function buildPushRequest(
  target: PushTarget,
  payload: string,
  vapid: { signingKey: CryptoKey; publicKey: string; subject: string },
  options: {
    ttlSeconds?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
  } = {},
): Promise<PushRequest> {
  const url = new URL(target.endpoint);
  if (url.protocol !== "https:") throw new Error("invalid_endpoint");
  const jwt = await vapidJwt(vapid.signingKey, {
    audience: url.origin,
    subject: vapid.subject,
  });
  const body = await encryptPushMessage(utf8(payload), target);
  const headers: Record<string, string> = {
    Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds ?? 24 * 3600),
    Urgency: options.urgency ?? "normal",
  };
  // Topic: a newer push with the same topic replaces one the push service still holds (max 32 base64url characters).
  if (options.topic && /^[A-Za-z0-9_-]{1,32}$/.test(options.topic))
    headers["Topic"] = options.topic;
  return { url: target.endpoint, headers, body };
}
