import { createECDH, createHmac, createDecipheriv, randomBytes, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { base64urlDecode, base64urlEncode } from "@/lib/push/base64url";
import { DEFAULT_VAPID_PUBLIC_KEY } from "@/lib/push/config";
import { isOnCurve, p256PublicKey } from "@/lib/push/p256";
import { buildPushMessage, safeAppPath } from "@/lib/push/payload";
import {
  deviceLabel,
  pushDeviceState,
  pushPromptMode,
  pushSettingsHelp,
  pushSupport,
  readPushPromptMemory,
  recordPushPromptDismissal,
  sameKey,
  PUSH_PROMPT_SNOOZE_MS,
  type PushEnvironment,
} from "@/lib/push/support";
import { checkVapidKeys } from "@/lib/push/vapid.server";
import {
  buildPushRequest,
  encryptPushMessage,
  importVapidSigningKey,
  vapidJwt,
} from "@/lib/push/webpush";
import { classifyPushResponse } from "@/lib/push/sender.server";

// Web Push: P-256 key derivation, RFC 8291 encryption (RFC test vector and a round trip), the RFC 8292 VAPID token, the
// VAPID self-check, the push text (no sensitive details) and the device / dashboard card rules.

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const b64 = (s: string) => base64urlDecode(s);

/** A fresh P-256 key pair as base64url (private scalar, uncompressed public point). */
function nodeKeyPair() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    privateKey: base64urlEncode(ecdh.getPrivateKey()),
    publicKey: base64urlEncode(ecdh.getPublicKey()),
  };
}

/** RFC 8291 decryption (what the browser does), with Node's crypto: an independent check of encryptPushMessage. */
function decrypt(body: Uint8Array, uaPrivate: Buffer, uaPublic: Buffer, authSecret: Buffer) {
  const salt = body.subarray(0, 16);
  const rs = Buffer.from(body.subarray(16, 20)).readUInt32BE(0);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const secret = ecdh.computeSecret(asPublic);
  const hmac = (k: Uint8Array, d: Uint8Array) => createHmac("sha256", k).update(d).digest();
  const expand = (prk: Buffer, info: Buffer, n: number) =>
    hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, n);
  const ikm = expand(
    hmac(authSecret, secret),
    Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]),
    32,
  );
  const prk = hmac(salt, ikm);
  const cek = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(Buffer.from(ciphertext.subarray(ciphertext.length - 16)));
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  return { rs, idlen, plain };
}

describe("P-256 public key from the private scalar", () => {
  it("d = 1 gives the generator; d = 2 matches Node", () => {
    const one = new Uint8Array(32);
    one[31] = 1;
    expect(hex(p256PublicKey(one))).toBe(
      "04" +
        "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296" +
        "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
    );
    const two = new Uint8Array(32);
    two[31] = 2;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(two));
    expect(hex(p256PublicKey(two))).toBe(ecdh.getPublicKey("hex"));
  });

  it("matches Node's crypto for random keys, and the RFC 8291 sender key", () => {
    for (let i = 0; i < 20; i++) {
      const ecdh = createECDH("prime256v1");
      ecdh.generateKeys();
      // getPrivateKey() drops leading zero bytes (about 1 key in 256): a raw P-256 scalar is always 32 bytes.
      const scalar = Buffer.alloc(32);
      const raw = ecdh.getPrivateKey();
      raw.copy(scalar, 32 - raw.length);
      const derived = p256PublicKey(scalar);
      expect(hex(derived)).toBe(ecdh.getPublicKey("hex"));
      const x = BigInt("0x" + hex(derived.slice(1, 33)));
      const y = BigInt("0x" + hex(derived.slice(33)));
      expect(isOnCurve(x, y)).toBe(true);
    }
    expect(base64urlEncode(p256PublicKey(b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")))).toBe(
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    );
  });

  it("the committed VAPID public key is an uncompressed point on the curve", () => {
    const key = b64(DEFAULT_VAPID_PUBLIC_KEY);
    expect(key).toHaveLength(65);
    expect(key[0]).toBe(4);
    expect(isOnCurve(BigInt("0x" + hex(key.slice(1, 33))), BigInt("0x" + hex(key.slice(33))))).toBe(
      true,
    );
  });

  it("refuses scalars outside [1, n - 1] and wrong lengths", () => {
    expect(() => p256PublicKey(new Uint8Array(32))).toThrow("out of range");
    expect(() => p256PublicKey(new Uint8Array(32).fill(0xff))).toThrow("out of range");
    expect(() => p256PublicKey(new Uint8Array(31))).toThrow("32 bytes");
  });
});

describe("RFC 8291 message encryption (aes128gcm)", () => {
  it("reproduces the RFC 8291 Appendix A example", async () => {
    const asPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    const asPublic =
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    const pub = b64(asPublic);
    const privateKey = await webcrypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        d: asPrivate,
        x: base64urlEncode(pub.slice(1, 33)),
        y: base64urlEncode(pub.slice(33)),
      },
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const body = await encryptPushMessage(
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      {
        p256dh:
          "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      {
        salt: b64("DGv6ra1nlYgDCS1FRnbzlw"),
        local: { privateKey: privateKey as CryptoKey, publicKey: pub },
      },
    );
    expect(base64urlEncode(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("round trip: a browser key pair decrypts what the server encrypted (fresh sender key and salt each time)", async () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const authSecret = randomBytes(16);
    const target = {
      p256dh: base64urlEncode(ua.getPublicKey()),
      auth: base64urlEncode(authSecret),
    };
    const text = JSON.stringify({ title: "New task for you", url: "/tasks?task=1" });
    const a = await encryptPushMessage(new TextEncoder().encode(text), target);
    const b = await encryptPushMessage(new TextEncoder().encode(text), target);
    expect(hex(a.slice(0, 16))).not.toBe(hex(b.slice(0, 16)));
    const out = decrypt(a, ua.getPrivateKey(), ua.getPublicKey(), authSecret);
    expect(out.rs).toBe(4096);
    expect(out.idlen).toBe(65);
    expect(out.plain.subarray(out.plain.length - 1)[0]).toBe(2); // last-record delimiter
    expect(out.plain.subarray(0, out.plain.length - 1).toString()).toBe(text);
  });

  it("refuses bad keys and payloads that do not fit one record", async () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const target = {
      p256dh: base64urlEncode(ua.getPublicKey()),
      auth: base64urlEncode(randomBytes(16)),
    };
    await expect(encryptPushMessage(new Uint8Array(4080), target)).rejects.toThrow(
      "payload_too_large",
    );
    await expect(
      encryptPushMessage(new Uint8Array(1), { ...target, auth: "AAAA" }),
    ).rejects.toThrow("invalid_auth");
    await expect(
      encryptPushMessage(new Uint8Array(1), {
        ...target,
        p256dh: base64urlEncode(randomBytes(33)),
      }),
    ).rejects.toThrow("invalid_p256dh");
  });
});

describe("VAPID (RFC 8292)", () => {
  it("the token is an ES256 JWT for the push service origin that verifies with the public key", async () => {
    const pair = nodeKeyPair();
    const key = await importVapidSigningKey(b64(pair.privateKey), b64(pair.publicKey));
    const now = Date.UTC(2026, 10, 26, 12);
    const jwt = await vapidJwt(key, {
      audience: "https://fcm.googleapis.com",
      subject: "mailto:medway@dialoguesociety.org",
      now,
    });
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64(h!)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(b64(c!)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: now / 1000 + 12 * 3600,
      sub: "mailto:medway@dialoguesociety.org",
    });
    const signature = b64(s!);
    expect(signature).toHaveLength(64); // r ‖ s, not DER
    const verifyKey = await webcrypto.subtle.importKey(
      "raw",
      b64(pair.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(
      await webcrypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        verifyKey,
        signature,
        new TextEncoder().encode(`${h}.${c}`),
      ),
    ).toBe(true);
  });

  it("the push request carries the encrypted body, the vapid authorization, TTL and urgency", async () => {
    const pair = nodeKeyPair();
    const signingKey = await importVapidSigningKey(b64(pair.privateKey), b64(pair.publicKey));
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const request = await buildPushRequest(
      {
        endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc",
        p256dh: base64urlEncode(ua.getPublicKey()),
        auth: base64urlEncode(randomBytes(16)),
      },
      '{"title":"x"}',
      { signingKey, publicKey: pair.publicKey, subject: "mailto:a@b.org" },
      { urgency: "high", topic: "review" },
    );
    expect(request.url).toBe("https://updates.push.services.mozilla.com/wpush/v2/abc");
    expect(request.headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
      Topic: "review",
    });
    expect(request.headers["Authorization"]).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${pair.publicKey}$`),
    );
    const claims = JSON.parse(
      new TextDecoder().decode(b64(request.headers["Authorization"]!.split(".")[1]!)),
    );
    expect(claims.aud).toBe("https://updates.push.services.mozilla.com");
    await expect(
      buildPushRequest({ endpoint: "http://insecure.test/x", p256dh: "a", auth: "b" }, "{}", {
        signingKey,
        publicKey: pair.publicKey,
        subject: "mailto:a@b.org",
      }),
    ).rejects.toThrow("invalid_endpoint");
  });

  it("self-check: a matching pair passes; a mismatch, a bad key or a missing secret fails without naming any key", async () => {
    const pair = nodeKeyPair();
    const other = nodeKeyPair();
    const subject = "mailto:medway@dialoguesociety.org";
    const ok = await checkVapidKeys({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      subject,
    });
    expect(ok.ok).toBe(true);

    const checks = [
      await checkVapidKeys({ privateKey: other.privateKey, publicKey: pair.publicKey, subject }),
      await checkVapidKeys({
        privateKey: pair.privateKey,
        publicKey: DEFAULT_VAPID_PUBLIC_KEY,
        subject,
      }),
      await checkVapidKeys({ privateKey: "not-a-key", publicKey: pair.publicKey, subject }),
      await checkVapidKeys({ privateKey: pair.privateKey, publicKey: "short", subject }),
      await checkVapidKeys({
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
        subject: "medway",
      }),
      await checkVapidKeys({ privateKey: undefined, publicKey: pair.publicKey, subject }),
    ];
    expect(checks.map((c) => (c.ok ? "ok" : c.problem))).toEqual([
      "mismatch",
      "mismatch",
      "invalid_private_key",
      "invalid_public_key",
      "invalid_subject",
      "missing",
    ]);
    const text = JSON.stringify(checks);
    for (const secret of [
      pair.privateKey,
      other.privateKey,
      pair.publicKey,
      DEFAULT_VAPID_PUBLIC_KEY,
    ])
      expect(text).not.toContain(secret);
    expect(checks[0]).toMatchObject({ message: expect.stringContaining("does not match") });
  });

  it("the server check fails on a mismatch without logging or caching it (the sender logs: outbox-flush.test.ts)", async () => {
    const pair = nodeKeyPair();
    vi.stubEnv("VAPID_PRIVATE_KEY", pair.privateKey);
    vi.stubEnv("VAPID_SUBJECT", "mailto:medway@dialoguesociety.org");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { serverVapid, resetVapidCache } = await import("@/lib/push/vapid.server");
      resetVapidCache();
      const first = await serverVapid();
      expect(first.ok).toBe(false); // a random key never matches the committed public key
      expect(first).toMatchObject({ problem: "mismatch" });
      expect(JSON.stringify(first)).not.toContain(pair.privateKey);
      expect(error).not.toHaveBeenCalled();
      resetVapidCache();
    } finally {
      error.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("push service answers: 2xx sent, 404/410 gone, 429/5xx retried, other refusals failed", () => {
    expect(
      [201, 202, 404, 410, 429, 503, 400, 403, 413].map((s) => classifyPushResponse(s).result),
    ).toEqual(["sent", "sent", "gone", "gone", "retry", "retry", "failed", "failed", "failed"]);
  });
});

describe("push text", () => {
  it("a generic title per kind in the member's language, never the item's title or a name", () => {
    const m = buildPushMessage({
      kind: "task_assigned",
      payload: { branch: "Medway" },
      link: "/tasks?task=1",
      notificationId: "n1",
      language: "en",
    });
    expect(m).toEqual({
      title: "New task for you",
      body: "Open the Volunteer Hub to see it.",
      url: "/tasks?task=1",
      tag: "n-n1",
      lang: "en",
    });
    expect(
      buildPushMessage({
        kind: "meeting_invited",
        link: "/meetings/1",
        notificationId: "n2",
        language: "tr",
      }),
    ).toMatchObject({ title: "Yeni toplantı daveti", lang: "tr" });
    const review = (total: number, language = "en") =>
      buildPushMessage({
        kind: "review_waiting",
        payload: { total },
        link: "/requests?tab=review",
        notificationId: "r",
        language,
      }).body;
    expect(review(1)).toBe("1 request is waiting for you. Open the Volunteer Hub to review it.");
    expect(review(3)).toBe(
      "3 requests are waiting for you. Open the Volunteer Hub to review them.",
    );
    expect(review(3, "tr")).toContain("3 talep");
    expect(buildPushMessage({ kind: "something_new", notificationId: "x" }).title).toBe(
      "New notification",
    );
    // Unknown language: English.
    expect(
      buildPushMessage({ kind: "task_reminder", notificationId: "x", language: "de" }).lang,
    ).toBe("en");
  });

  it("every kind with a push title has it in both languages; links stay in the app", async () => {
    const en = (await import("@/locales/en.json")).default as unknown as {
      push: { titles: Record<string, string> };
    };
    const tr = (await import("@/locales/tr.json")).default as unknown as {
      push: { titles: Record<string, string> };
    };
    expect(Object.keys(tr.push.titles).sort()).toEqual(Object.keys(en.push.titles).sort());
    expect(safeAppPath("/tasks?task=1")).toBe("/tasks?task=1");
    for (const bad of ["https://evil.test/", "//evil.test", "/\\evil", "", null])
      expect(safeAppPath(bad)).toBe("/notifications");
  });
});

describe("this device and the dashboard card", () => {
  const env = (over: Partial<PushEnvironment> = {}): PushEnvironment => ({
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    crossOriginFrame: false,
    ios: false,
    standalone: false,
    ...over,
  });

  it("support: cross-origin frames and browsers without the APIs are unsupported; iOS needs the installed app", () => {
    expect(pushSupport(env())).toBe("supported");
    expect(pushSupport(env({ crossOriginFrame: true }))).toBe("unsupported");
    expect(pushSupport(env({ hasPushManager: false }))).toBe("unsupported");
    expect(pushSupport(env({ hasServiceWorker: false }))).toBe("unsupported");
    expect(pushSupport(env({ ios: true, hasPushManager: false }))).toBe("ios-install");
    expect(pushSupport(env({ ios: true, standalone: true }))).toBe("supported");
    expect(pushSupport(env({ ios: true, standalone: true, hasPushManager: false }))).toBe(
      "unsupported",
    );
  });

  it("device state from support, permission and the subscription", () => {
    expect(pushDeviceState("supported", "granted", true)).toBe("on");
    expect(pushDeviceState("supported", "default", true)).toBe("off");
    expect(pushDeviceState("supported", "granted", false)).toBe("off");
    expect(pushDeviceState("supported", "denied", true)).toBe("denied");
    expect(pushDeviceState("ios-install", "default", false)).toBe("ios-install");
    expect(pushDeviceState("unsupported", null, false)).toBe("unsupported");
  });

  it("short device labels without versions", () => {
    const android =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const ipad =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    const edge =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
    const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";
    expect(deviceLabel(android)).toBe("Chrome on Android");
    expect(deviceLabel(iphone)).toBe("Safari on iPhone");
    expect(deviceLabel(ipad, 5)).toBe("Safari on iPad");
    expect(deviceLabel(ipad)).toBe("Safari on Mac");
    expect(deviceLabel(edge)).toBe("Edge on Windows");
    expect(deviceLabel(firefox)).toBe("Firefox on Linux");
    expect(deviceLabel("")).toBe("Browser");
  });

  it("an existing subscription is reused only with our key", () => {
    const key = b64(DEFAULT_VAPID_PUBLIC_KEY);
    expect(sameKey(key.slice().buffer, key)).toBe(true);
    expect(sameKey(null, key)).toBe(true);
    const other = key.slice();
    other[10] = other[10]! ^ 1;
    expect(sameKey(other.buffer, key)).toBe(false);
  });

  it("card: installed app only, while push is off or blocked; Not now -> again after 7 days -> never after the second", () => {
    const now = Date.UTC(2026, 10, 26);
    const none = { dismissals: 0, lastDismissedAt: null };
    const mode = (over: Partial<Parameters<typeof pushPromptMode>[0]>) =>
      pushPromptMode({ standalone: true, state: "off", memory: none, now, ...over });
    expect(mode({})).toBe("ask");
    expect(mode({ state: "denied" })).toBe("denied");
    expect(mode({ standalone: false })).toBeNull();
    for (const state of ["on", "unsupported", "ios-install", null] as const)
      expect(mode({ state })).toBeNull();

    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const first = recordPushPromptDismissal(storage, readPushPromptMemory(storage), now);
    expect(readPushPromptMemory(storage)).toEqual({ dismissals: 1, lastDismissedAt: now });
    expect(mode({ memory: first, now: now + PUSH_PROMPT_SNOOZE_MS - 1 })).toBeNull();
    expect(mode({ memory: first, now: now + PUSH_PROMPT_SNOOZE_MS })).toBe("ask");
    const second = recordPushPromptDismissal(storage, first, now + PUSH_PROMPT_SNOOZE_MS);
    expect(mode({ memory: second, now: now + 100 * PUSH_PROMPT_SNOOZE_MS })).toBeNull();
    expect(
      mode({ memory: second, state: "denied", now: now + 100 * PUSH_PROMPT_SNOOZE_MS }),
    ).toBeNull();
  });

  it("card memory works without storage (blocked or throwing) and ignores junk", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPushPromptMemory(throwing)).toEqual({ dismissals: 0, lastDismissedAt: null });
    expect(
      recordPushPromptDismissal(throwing, { dismissals: 0, lastDismissedAt: null }, 5),
    ).toEqual({
      dismissals: 1,
      lastDismissedAt: 5,
    });
    expect(readPushPromptMemory(null)).toEqual({ dismissals: 0, lastDismissedAt: null });
    expect(readPushPromptMemory({ getItem: () => "{oops", setItem: () => undefined })).toEqual({
      dismissals: 0,
      lastDismissedAt: null,
    });
  });

  it("settings help by platform", () => {
    expect(pushSettingsHelp({ ios: true, android: false })).toBe("ios");
    expect(pushSettingsHelp({ ios: false, android: true })).toBe("android");
    expect(pushSettingsHelp({ ios: false, android: false })).toBe("desktop");
  });
});
