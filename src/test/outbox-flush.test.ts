import { createECDH, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Push delivery diagnostics and the outbox tick (docs/push.md "Troubleshooting"): a failed VAPID check is never cached,
// every flush logs a summary and one line per attempt without endpoints, keys, user ids or content, claim errors are
// logged log-safe, and /api/public/outbox-flush needs SCHEDULED_JOBS_SECRET and claims no email without Brevo.

// The public key browsers subscribe with, replaced by a fresh test pair (the committed key's private half is a secret).
vi.mock("@/lib/push/config", async () => {
  const { createECDH: ecdh } = await import("node:crypto");
  const pair = ecdh("prime256v1");
  pair.generateKeys();
  return {
    VAPID_PUBLIC_KEY: pair.getPublicKey("base64url"),
    // getPrivateKey() drops leading zero bytes (about 1 key in 256): a raw P-256 scalar is always 32 bytes.
    TEST_VAPID_PRIVATE_KEY: Buffer.concat([Buffer.alloc(32), pair.getPrivateKey()])
      .subarray(-32)
      .toString("base64url"),
    DEFAULT_VAPID_PUBLIC_KEY: pair.getPublicKey("base64url"),
  };
});

const db = vi.hoisted(() => ({
  rpc: null as null | ((fn: string, args?: Record<string, unknown>) => Promise<unknown>),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (fn: string, args?: Record<string, unknown>) => db.rpc!(fn, args) },
}));

const config = (await import("@/lib/push/config")) as unknown as {
  VAPID_PUBLIC_KEY: string;
  TEST_VAPID_PRIVATE_KEY: string;
};
const { serverVapid, resetVapidCache } = await import("@/lib/push/vapid.server");
const { flushPush, logSafe } = await import("@/lib/push/sender.server");
const { handleOutboxFlush } = await import("@/lib/outbox-flush.server");
const { scheduledJobAuthorized, bearerAuthorized } = await import("@/lib/scheduled-jobs.server");

const USER_ID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const NOTIFICATION_ID = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const SECRET = "test-only-scheduled-jobs-secret";

function device() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey("base64url"), auth: randomBytes(16).toString("base64url") };
}
const claimedRow = (id: string, endpoint: string, keys = device()) => ({
  id,
  endpoint,
  ...keys,
  attempts: 1,
  kind: "task_assigned",
  payload: { title: "Private task title", user_id: USER_ID },
  link: "/tasks",
  notification_id: NOTIFICATION_ID,
  language: "en",
});

type Calls = { fn: string; args?: Record<string, unknown> | undefined }[];
function fakeDb(answers: Record<string, (args?: Record<string, unknown>) => unknown>): Calls {
  const calls: Calls = [];
  const once = new Set<string>();
  db.rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fn === "claim_push_batch" && once.has(fn)) return { data: [], error: null };
    once.add(fn);
    return answers[fn]?.(args) ?? { data: null, error: null };
  };
  return calls;
}

let logs: string[];
beforeEach(() => {
  resetVapidCache();
  logs = [];
  for (const level of ["log", "warn", "error", "info"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetVapidCache();
});
const useKeys = () => {
  vi.stubEnv("VAPID_PRIVATE_KEY", config.TEST_VAPID_PRIVATE_KEY);
  vi.stubEnv("VAPID_SUBJECT", "mailto:medway@dialoguesociety.org");
};
const forbidden = () => [
  config.TEST_VAPID_PRIVATE_KEY,
  config.VAPID_PUBLIC_KEY,
  USER_ID,
  NOTIFICATION_ID,
];

describe("VAPID check", () => {
  it("a failure is not cached: fixing the env makes the next call usable; a success is cached; nothing is logged", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
    const first = await serverVapid();
    expect(first.ok ? "ok" : first.problem).toBe("missing");
    useKeys();
    const second = await serverVapid();
    expect(second.ok).toBe(true);
    // Cached: a later env change does not matter until the isolate restarts.
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect((await serverVapid()).ok).toBe(true);
    expect(logs).toEqual([]);
  });
});

describe("flushPush logging", () => {
  it("keys missing and pushes waiting: one vapid problem line and the summary per flush; nothing claimed", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
    const calls = fakeDb({ outbox_flush_due: () => ({ data: true, error: null }) });
    const result = await flushPush({ trigger: "cron" });
    expect(result).toMatchObject({ vapid: "missing", claimed: 0 });
    expect(calls.map((c) => c.fn)).toEqual(["outbox_flush_due"]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/^\[push\] vapid problem=missing: /);
    expect(logs[1]).toBe(
      "[push] flush trigger=cron vapid=missing claimed=0 sent=0 gone=0 retry=0 failed=0",
    );
    // The next flush checks (and logs) again: the failure was not cached.
    await flushPush({ trigger: "post-action" });
    expect(logs.filter((l) => l.startsWith("[push] vapid problem=missing"))).toHaveLength(2);
  });

  it("keys missing and nothing waiting: silent", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    fakeDb({ outbox_flush_due: () => ({ data: false, error: null }) });
    await flushPush();
    expect(logs).toEqual([]);
  });

  it("one line per attempt and a summary, with no endpoint, key, user id or content", async () => {
    useKeys();
    const ok = device();
    const rows = [
      claimedRow(
        "11111111-1111-4111-8111-111111111111",
        "https://push.example.test/secret-endpoint-a",
        ok,
      ),
      claimedRow(
        "22222222-2222-4222-8222-222222222222",
        "https://push.example.test/secret-endpoint-b",
        {
          p256dh: "B" + "a".repeat(86),
          auth: "c".repeat(22),
        },
      ),
      claimedRow(
        "33333333-3333-4333-8333-333333333333",
        "https://push.example.test/secret-endpoint-c",
      ),
    ];
    const calls = fakeDb({ claim_push_batch: () => ({ data: rows, error: null }) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("-a")
          ? new Response(null, { status: 201 })
          : Promise.reject(new TypeError("fetch failed")),
      ),
    );
    const result = await flushPush({ trigger: "post-action" });
    expect(result).toEqual({ claimed: 3, sent: 1, gone: 1, retried: 1, failed: 0, vapid: "ok" });
    const attempts = logs.filter((l) => l.startsWith("[push] attempt"));
    expect(attempts.sort()).toEqual([
      "[push] attempt outbox=11111111-1111-4111-8111-111111111111 kind=task_assigned attempt=1 result=sent http=201",
      "[push] attempt outbox=22222222-2222-4222-8222-222222222222 kind=task_assigned attempt=1 result=gone http=invalid_subscription",
      "[push] attempt outbox=33333333-3333-4333-8333-333333333333 kind=task_assigned attempt=1 result=retry http=network",
    ]);
    expect(logs.at(-1)).toBe(
      "[push] flush trigger=post-action vapid=ok claimed=3 sent=1 gone=1 retry=1 failed=0",
    );
    expect(
      calls
        .filter((c) => c.fn === "finish_push")
        .map((c) => c.args?.["p_result"])
        .sort(),
    ).toEqual(["gone", "retry", "sent"]);
    const text = logs.join("\n");
    for (const secret of [
      ...forbidden(),
      ok.p256dh,
      ok.auth,
      "push.example.test",
      "secret-endpoint",
      "Private task",
    ])
      expect(text).not.toContain(secret);
  });

  it("claim errors are logged log-safe (code and short message, no tokens)", async () => {
    useKeys();
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnop";
    fakeDb({
      claim_push_batch: () => ({
        data: null,
        error: {
          code: "42501",
          message: `permission denied for function claim_push_batch ${token}`,
        },
      }),
    });
    await flushPush({ trigger: "cron" });
    expect(logs[0]).toBe(
      "[push] claim failed: code=42501 permission denied for function claim_push_batch [redacted]",
    );
    expect(logs.at(-1)).toContain("claimed=0");
    expect(logs.join("\n")).not.toContain(token.slice(0, 30));
    expect(logSafe("https://fcm.googleapis.com/fcm/send/abc")).toBe("[redacted]");
  });

  it("never throws (an unexpected error is logged)", async () => {
    useKeys();
    db.rpc = async () => {
      throw new Error("socket hang up");
    };
    await expect(flushPush()).resolves.toMatchObject({ claimed: 0 });
    expect(logs[0]).toBe("[push] flush error: socket hang up");
  });
});

describe("scheduled routes secret", () => {
  it("only the exact SCHEDULED_JOBS_SECRET passes; unset or empty refuses everything", () => {
    expect(bearerAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(bearerAuthorized(SECRET, SECRET)).toBe(false);
    expect(bearerAuthorized(null, SECRET)).toBe(false);
    expect(bearerAuthorized("Bearer ", "")).toBe(false);
    expect(bearerAuthorized("Bearer  ", "  ")).toBe(false);
    expect(bearerAuthorized("Bearer undefined", undefined)).toBe(false);
    vi.stubEnv("SCHEDULED_JOBS_SECRET", SECRET);
    expect(scheduledJobAuthorized(`Bearer ${SECRET}`)).toBe(true);
    vi.stubEnv("SCHEDULED_JOBS_SECRET", "");
    expect(scheduledJobAuthorized("Bearer ")).toBe(false);
  });
});

describe("POST /api/public/outbox-flush", () => {
  const call = (auth?: string) =>
    handleOutboxFlush(
      new Request("http://localhost/api/public/outbox-flush", {
        method: "POST",
        headers: auth ? { Authorization: auth } : {},
      }),
    );

  it("refuses a missing or wrong secret (and everything while the secret is unset)", async () => {
    const calls = fakeDb({});
    vi.stubEnv("SCHEDULED_JOBS_SECRET", SECRET);
    for (const auth of [undefined, "Bearer wrong", SECRET])
      expect((await call(auth)).status).toBe(401);
    vi.stubEnv("SCHEDULED_JOBS_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("without Brevo: pushes are flushed, no email is claimed (no attempt used), one line says why", async () => {
    vi.stubEnv("SCHEDULED_JOBS_SECRET", SECRET);
    vi.stubEnv("EMAIL_TRANSPORT", "");
    vi.stubEnv("BREVO_API_KEY", "");
    useKeys();
    const calls = fakeDb({});
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      vapid: "ok",
      pushes_claimed: 0,
      pushes_sent: 0,
      pushes_gone: 0,
      pushes_retried: 0,
      pushes_failed: 0,
      email: "not_configured",
      emails_sent: 0,
      emails_skipped: 0,
      emails_failed: 0,
    });
    expect(calls.map((c) => c.fn)).toEqual(["claim_push_batch"]);
    expect(logs.filter((l) => l.startsWith("[email]"))).toEqual([
      "[email] flush skipped: BREVO_API_KEY or EMAIL_FROM not set",
    ]);
  });

  it("with an email transport: every priority is claimed; the VAPID problem is reported without keys", async () => {
    vi.stubEnv("SCHEDULED_JOBS_SECRET", SECRET);
    vi.stubEnv("EMAIL_TRANSPORT", "capture");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const calls = fakeDb({
      claim_email_batch: () => ({ data: [], error: null }),
      outbox_flush_due: () => ({ data: true, error: null }),
    });
    const body = (await (await call(`Bearer ${SECRET}`)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ vapid: "missing", email: "ok" });
    expect(calls.find((c) => c.fn === "claim_email_batch")?.args).toMatchObject({
      p_max_priority: 5,
    });
    expect(JSON.stringify(body)).not.toContain(config.VAPID_PUBLIC_KEY);
  });
});
